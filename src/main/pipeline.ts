import { join } from 'path'
import { existsSync, unlinkSync } from 'fs'
import type { BrowserWindow } from 'electron'
import type { PipelineProgressEvent, PipelineStageName, VideoItem } from '../shared/types'
import {
  CancelledError,
  extractAudio,
  probeAudioChannels,
  probeMedia,
  cancelJob,
  sourceFingerprint
} from './media'
import { ProjectStore, STAGE_LABELS } from './projectStore'
import { videoArtifactDir } from './ffmpegPaths'
import type { FileLogger } from './logger'
import type { CatalogStore } from './catalog'
import type { AppPaths } from './paths'
import { DownloadCancelledError } from './download'
import { speechScore } from '../shared/transcriptText'
import { transcribeAudio, transcriptPath, formatSttLabel } from './whisper'
import {
  blendSttFactor,
  estimateRemainingSec,
  estimateTotalSec,
  formatEtaHint,
  parseSttFactor
} from './sttEta'
import { ensureWhisperModel, modelPath, parseWhisperModel, type WhisperModelId } from './whisperRuntime'
import type { LicenseService } from './license/licenseService'

function nowIso(): string {
  return new Date().toISOString()
}

function jobId(projectId: string, videoId: string, stage: PipelineStageName): string {
  return `${projectId}:${videoId}:${stage}`
}

function sttFingerprint(sourcePath: string, modelId: WhisperModelId): string {
  return `${sourceFingerprint(sourcePath)}:${modelId}`
}

export class PipelineService {
  private readonly running = new Set<string>()
  private readonly cancelFlags = new Set<string>()
  private sttLock: Promise<void> = Promise.resolve()

  constructor(
    private readonly projects: ProjectStore,
    private readonly catalog: CatalogStore,
    private readonly paths: AppPaths,
    private readonly logger: FileLogger,
    private readonly getWindow: () => BrowserWindow | null,
    private readonly license: LicenseService
  ) {}

  private withSttLock<T>(work: () => Promise<T>): Promise<T> {
    const run = this.sttLock.then(work, work)
    this.sttLock = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  private emit(event: PipelineProgressEvent): void {
    this.getWindow()?.webContents.send('pipeline:progress', event)
  }

  private key(projectId: string, videoId: string): string {
    return `${projectId}:${videoId}`
  }

  isBusy(projectId: string, videoId: string): boolean {
    return this.running.has(this.key(projectId, videoId))
  }

  async reclaimStale(projectId: string): Promise<void> {
    const videos = await this.projects.listVideos(projectId)
    for (const video of videos) {
      const active =
        video.status === 'probing' ||
        video.status === 'extracting_audio' ||
        video.status === 'transcribing'
      if (!active || this.isBusy(projectId, video.id)) continue
      const stage =
        video.status === 'probing' ? 'probe' : video.status === 'extracting_audio' ? 'audio' : 'stt'
      await this.projects.updateStage(
        projectId,
        video.id,
        stage,
        {
          status: 'needs_retry',
          progress: 0,
          errorCode: 'interrupted',
          errorMessage: 'Обработка была прервана. Можно запустить снова.',
          finishedAt: nowIso()
        },
        'cancelled'
      )
      this.emit({
        projectId,
        videoId: video.id,
        stage,
        status: 'cancelled',
        progress: 0,
        label: 'Обработка остановлена — можно повторить'
      })
    }
  }

  async start(
    projectId: string,
    videoId: string,
    options?: { forceStt?: boolean }
  ): Promise<VideoItem> {
    const key = this.key(projectId, videoId)
    if (this.running.has(key)) {
      return this.projects.getVideo(projectId, videoId)
    }
    this.cancelFlags.delete(key)
    await this.license.assertCanStartProcessing()
    this.running.add(key)
    try {
      return await this.run(projectId, videoId, Boolean(options?.forceStt))
    } finally {
      this.running.delete(key)
    }
  }

  async cancel(projectId: string, videoId: string): Promise<VideoItem> {
    const key = this.key(projectId, videoId)
    this.cancelFlags.add(key)
    cancelJob(jobId(projectId, videoId, 'probe'))
    cancelJob(jobId(projectId, videoId, 'audio'))
    cancelJob(`${jobId(projectId, videoId, 'audio')}:L`)
    cancelJob(`${jobId(projectId, videoId, 'audio')}:R`)
    cancelJob(jobId(projectId, videoId, 'stt'))
    cancelJob(`${projectId}:${videoId}:stt-probe-L`)
    cancelJob(`${projectId}:${videoId}:stt-probe-R`)
    const video = await this.projects.updateStage(
      projectId,
      videoId,
      'stt',
      {
        status: 'cancelled',
        progress: 0,
        errorCode: 'cancelled',
        errorMessage: 'Обработка отменена.',
        finishedAt: nowIso()
      },
      'cancelled'
    )
    this.emit({
      projectId,
      videoId,
      stage: null,
      status: 'cancelled',
      progress: video.progress,
      label: 'Обработка отменена'
    })
    return video
  }

  private assertNotCancelled(projectId: string, videoId: string): void {
    if (this.cancelFlags.has(this.key(projectId, videoId))) {
      throw new CancelledError()
    }
  }

  private async currentModel(): Promise<WhisperModelId> {
    return parseWhisperModel(await this.catalog.getSetting('whisper_model'))
  }

  private async run(projectId: string, videoId: string, forceStt = false): Promise<VideoItem> {
    const project = await this.catalog.getProject(projectId)
    if (!project) throw new Error('Проект не найден.')

    let video = await this.projects.getVideo(projectId, videoId)
    if (!video.sourceExists) {
      video = await this.projects.updateStage(
        projectId,
        videoId,
        'probe',
        {
          status: 'failed',
          errorCode: 'missing_source',
          errorMessage: 'Исходный файл не найден. Укажите его заново.',
          finishedAt: nowIso()
        },
        'missing_source'
      )
      this.emit({
        projectId,
        videoId,
        stage: 'probe',
        status: 'missing_source',
        progress: video.progress,
        label: 'Исходный файл не найден',
        errorMessage: 'Исходный файл не найден. Укажите его заново.'
      })
      return video
    }

    const fingerprint = sourceFingerprint(video.sourcePath)
    if (forceStt) {
      await this.projects.clearTranscript(projectId, videoId)
      video = await this.projects.getVideo(projectId, videoId)
      this.logger.info(`Force re-extract + STT for ${videoId}`)
    }
    const probeStage = video.stages.find((s) => s.stage === 'probe')

    if (!(probeStage?.status === 'completed' && probeStage.inputHash === fingerprint)) {
      this.assertNotCancelled(projectId, videoId)
      this.emit({
        projectId,
        videoId,
        stage: 'probe',
        status: 'probing',
        progress: 5,
        label: STAGE_LABELS.probe
      })
      await this.projects.updateStage(
        projectId,
        videoId,
        'probe',
        { status: 'processing', progress: 0.1, startedAt: nowIso(), finishedAt: null, errorCode: null, errorMessage: null },
        'probing'
      )

      try {
        const probe = await probeMedia(jobId(projectId, videoId, 'probe'), video.sourcePath)
        video = await this.projects.updateStage(
          projectId,
          videoId,
          'probe',
          {
            status: 'completed',
            progress: 1,
            inputHash: probe.inputHash,
            artifactPath: null,
            finishedAt: nowIso(),
            errorCode: null,
            errorMessage: null
          },
          'extracting_audio',
          {
            sizeBytes: probe.sizeBytes,
            durationSec: probe.durationSec,
            width: probe.width,
            height: probe.height,
            container: probe.container,
            videoCodec: probe.videoCodec,
            audioCodec: probe.audioCodec,
            playableInApp: probe.playableInApp,
            fileName: probe.fileName
          }
        )
      } catch (error) {
        return this.fail(projectId, videoId, 'probe', error)
      }
    }

    video = await this.projects.getVideo(projectId, videoId)
    const refreshedAudio = video.stages.find((s) => s.stage === 'audio')
    const audioPath = join(videoArtifactDir(project.folderPath, videoId), 'audio', 'audio.wav')
    const audioDone =
      refreshedAudio?.status === 'completed' &&
      refreshedAudio.inputHash === fingerprint &&
      refreshedAudio.artifactPath &&
      existsSync(refreshedAudio.artifactPath)

    if (!audioDone) {
      this.assertNotCancelled(projectId, videoId)
      this.emit({
        projectId,
        videoId,
        stage: 'audio',
        status: 'extracting_audio',
        progress: 20,
        label: STAGE_LABELS.audio
      })
      await this.projects.updateStage(
        projectId,
        videoId,
        'audio',
        {
          status: 'processing',
          progress: 0.05,
          startedAt: nowIso(),
          finishedAt: null,
          errorCode: null,
          errorMessage: null
        },
        'extracting_audio'
      )

      try {
        const channel = await this.pickSpeechChannel(projectId, videoId, video.sourcePath)
        await extractAudio(
          jobId(projectId, videoId, 'audio'),
          video.sourcePath,
          audioPath,
          (ratio) => {
            this.emit({
              projectId,
              videoId,
              stage: 'audio',
              status: 'extracting_audio',
              progress: Math.round(20 + ratio * 20),
              label: STAGE_LABELS.audio
            })
          },
          video.durationSec,
          { channel }
        )

        video = await this.projects.updateStage(
          projectId,
          videoId,
          'audio',
          {
            status: 'completed',
            progress: 1,
            artifactPath: audioPath,
            inputHash: fingerprint,
            finishedAt: nowIso(),
            errorCode: null,
            errorMessage: null
          },
          'transcribing'
        )
      } catch (error) {
        return this.fail(projectId, videoId, 'audio', error)
      }
    }

    return this.runStt(projectId, videoId, project.folderPath, audioPath, forceStt)
  }

  private async pickSpeechChannel(
    projectId: string,
    videoId: string,
    sourcePath: string
  ): Promise<0 | 1> {
    const channels = await probeAudioChannels(jobId(projectId, videoId, 'audio'), sourcePath)
    if (channels < 2) return 0

    this.emit({
      projectId,
      videoId,
      stage: 'audio',
      status: 'extracting_audio',
      progress: 22,
      label: 'Ищем дорожку с речью'
    })

    const modelId = await this.currentModel()
    await ensureWhisperModel(
      this.paths,
      modelId,
      undefined,
      () => this.cancelFlags.has(this.key(projectId, videoId))
    )
    const language = (await this.catalog.getSetting('whisper_language')) || 'ru'
    const leftSample = join(this.paths.tempDir, `${videoId}-probe-L.wav`)
    const rightSample = join(this.paths.tempDir, `${videoId}-probe-R.wav`)
    const leftPrefix = join(this.paths.tempDir, `${videoId}-probe-L`)
    const rightPrefix = join(this.paths.tempDir, `${videoId}-probe-R`)

    const cleanup = (): void => {
      for (const file of [
        leftSample,
        rightSample,
        `${leftPrefix}.json`,
        `${rightPrefix}.json`,
        `${leftPrefix}.txt`,
        `${rightPrefix}.txt`
      ]) {
        try {
          if (existsSync(file)) unlinkSync(file)
        } catch {
          /* ignore */
        }
      }
    }

    try {
      await extractAudio(
        `${jobId(projectId, videoId, 'audio')}:L`,
        sourcePath,
        leftSample,
        undefined,
        50,
        { channel: 0, maxDurationSec: 50 }
      )
      await extractAudio(
        `${jobId(projectId, videoId, 'audio')}:R`,
        sourcePath,
        rightSample,
        undefined,
        50,
        { channel: 1, maxDurationSec: 50 }
      )
      this.assertNotCancelled(projectId, videoId)
      const leftDoc = await this.withSttLock(async () => {
        this.assertNotCancelled(projectId, videoId)
        return transcribeAudio({
          jobId: `${projectId}:${videoId}:stt-probe-L`,
          audioPath: leftSample,
          outputPrefix: leftPrefix,
          modelPath: modelPath(this.paths, modelId),
          modelId,
          language,
          videoId,
          durationSec: 50
        })
      })
      this.assertNotCancelled(projectId, videoId)
      const rightDoc = await this.withSttLock(async () => {
        this.assertNotCancelled(projectId, videoId)
        return transcribeAudio({
          jobId: `${projectId}:${videoId}:stt-probe-R`,
          audioPath: rightSample,
          outputPrefix: rightPrefix,
          modelPath: modelPath(this.paths, modelId),
          modelId,
          language,
          videoId,
          durationSec: 50
        })
      })
      const leftScore = speechScore(leftDoc.segments.map((item) => item.text))
      const rightScore = speechScore(rightDoc.segments.map((item) => item.text))
      const picked: 0 | 1 = rightScore > leftScore ? 1 : 0
      this.logger.info(
        `Speech channel for ${videoId}: L=${leftScore} R=${rightScore} -> ${picked === 0 ? 'left' : 'right'}`
      )
      return picked
    } catch (error) {
      this.logger.error(`Speech channel probe failed for ${videoId}: ${String(error)}`)
      return 0
    } finally {
      cleanup()
    }
  }

  private async runStt(
    projectId: string,
    videoId: string,
    folderPath: string,
    audioPath: string,
    forceStt = false
  ): Promise<VideoItem> {
    let video = await this.projects.getVideo(projectId, videoId)
    const modelId = await this.currentModel()
    const hash = sttFingerprint(video.sourcePath, modelId)
    const sttStage = video.stages.find((s) => s.stage === 'stt')
    const transcriptFile = transcriptPath(folderPath, videoId)
    const sttDone =
      !forceStt &&
      sttStage?.status === 'completed' &&
      sttStage.inputHash === hash &&
      existsSync(transcriptFile)

    if (sttDone) {
      video = await this.projects.updateStage(
        projectId,
        videoId,
        'stt',
        {
          status: 'completed',
          progress: 1,
          artifactPath: transcriptFile,
          inputHash: hash,
          finishedAt: nowIso()
        },
        'ready'
      )
      this.emit({
        projectId,
        videoId,
        stage: 'stt',
        status: 'ready',
        progress: 100,
        label: 'Расшифровка готова'
      })
      return video
    }

    this.assertNotCancelled(projectId, videoId)
    await this.projects.updateStage(
      projectId,
      videoId,
      'stt',
      {
        status: 'processing',
        progress: 0.02,
        startedAt: nowIso(),
        finishedAt: null,
        errorCode: null,
        errorMessage: null
      },
      'transcribing'
    )

    try {
      const dest = modelPath(this.paths, modelId)
      if (!existsSync(dest)) {
        this.emit({
          projectId,
          videoId,
          stage: 'stt',
          status: 'transcribing',
          progress: 42,
          label: 'Скачиваем модель распознавания'
        })
        await ensureWhisperModel(
          this.paths,
          modelId,
          (ratio) => {
            this.emit({
              projectId,
              videoId,
              stage: 'stt',
              status: 'transcribing',
              progress: Math.round(42 + ratio * 13),
              label: 'Скачиваем модель распознавания'
            })
          },
          () => this.cancelFlags.has(this.key(projectId, videoId))
        )
      }

      this.assertNotCancelled(projectId, videoId)
      const factor = parseSttFactor(await this.catalog.getSetting(`stt_factor_${modelId}`), modelId)
      const initialEta = estimateTotalSec(video.durationSec, factor)
      const initialEtaLabel = formatEtaHint(initialEta, 'total')
      this.emit({
        projectId,
        videoId,
        stage: 'stt',
        status: 'transcribing',
        progress: 56,
        label: initialEtaLabel ? `${STAGE_LABELS.stt} · ${initialEtaLabel}` : STAGE_LABELS.stt,
        etaSec: initialEta,
        etaLabel: initialEtaLabel
      })

      const outputPrefix = join(folderPath, 'videos', videoId, 'transcript', 'whisper')
      const sttStartedAt = Date.now()
      const document = await this.withSttLock(async () => {
        this.assertNotCancelled(projectId, videoId)
        this.logger.info(
          `STT start for ${videoId}, duration=${video.durationSec ?? '?'}, etaSec=${initialEta ?? '?'}`
        )
        return transcribeAudio({
          jobId: jobId(projectId, videoId, 'stt'),
          audioPath,
          outputPrefix,
          modelPath: dest,
          modelId,
          language: (await this.catalog.getSetting('whisper_language')) || 'ru',
          videoId,
          durationSec: video.durationSec,
          onProgress: (progress) => {
            const elapsedSec = (Date.now() - sttStartedAt) / 1000
            const remaining = estimateRemainingSec({
              durationSec: progress.durationSec,
              processedSec: progress.processedSec,
              ratio: progress.ratio,
              factor,
              elapsedSec
            })
            const etaLabel = formatEtaHint(remaining, 'remaining')
            this.emit({
              projectId,
              videoId,
              stage: 'stt',
              status: 'transcribing',
              progress: Math.round(56 + progress.ratio * 43),
              label: formatSttLabel(progress.processedSec, progress.durationSec, etaLabel),
              etaSec: remaining,
              etaLabel
            })
          }
        })
      })

      await this.projects.writeTranscript(projectId, videoId, document)
      const wallSec = (Date.now() - sttStartedAt) / 1000
      if (video.durationSec && video.durationSec > 0 && wallSec > 1) {
        const observed = wallSec / video.durationSec
        const nextFactor = blendSttFactor(factor, observed)
        await this.catalog.setSetting(`stt_factor_${modelId}`, String(nextFactor))
        this.logger.info(
          `STT timing ${videoId}: wall=${wallSec.toFixed(1)}s audio=${video.durationSec}s factor=${observed.toFixed(3)} -> ${nextFactor.toFixed(3)}`
        )
      }
      video = await this.projects.updateStage(
        projectId,
        videoId,
        'stt',
        {
          status: 'completed',
          progress: 1,
          artifactPath: transcriptFile,
          inputHash: hash,
          finishedAt: nowIso(),
          errorCode: null,
          errorMessage: null
        },
        'ready'
      )
      this.emit({
        projectId,
        videoId,
        stage: 'stt',
        status: 'ready',
        progress: 100,
        label: document.segments.length ? 'Расшифровка готова' : 'Речь не найдена',
        etaSec: 0,
        etaLabel: null
      })
      this.logger.info(`STT completed for ${videoId}, segments=${document.segments.length}`)
      return video
    } catch (error) {
      return this.fail(projectId, videoId, 'stt', error)
    }
  }

  private async fail(
    projectId: string,
    videoId: string,
    stage: PipelineStageName,
    error: unknown
  ): Promise<VideoItem> {
    if (
      error instanceof CancelledError ||
      error instanceof DownloadCancelledError ||
      this.cancelFlags.has(this.key(projectId, videoId))
    ) {
      const video = await this.projects.updateStage(
        projectId,
        videoId,
        stage,
        {
          status: 'cancelled',
          progress: 0,
          errorCode: 'cancelled',
          errorMessage: 'Обработка отменена.',
          finishedAt: nowIso()
        },
        'cancelled'
      )
      this.emit({
        projectId,
        videoId,
        stage,
        status: 'cancelled',
        progress: video.progress,
        label: 'Обработка отменена'
      })
      return video
    }

    const message = error instanceof Error ? error.message : 'Неизвестная ошибка обработки.'
    this.logger.error(`Pipeline ${stage} failed for ${videoId}: ${message}`)
    const video = await this.projects.updateStage(
      projectId,
      videoId,
      stage,
      {
        status: 'failed',
        errorCode: 'pipeline_error',
        errorMessage: message,
        finishedAt: nowIso()
      },
      'failed'
    )
    this.emit({
      projectId,
      videoId,
      stage,
      status: 'failed',
      progress: video.progress,
      label: message,
      errorMessage: message
    })
    return video
  }
}
