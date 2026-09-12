import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join, resolve, sep } from 'path'
import type { AnalysisDocument, CreateProjectInput, Result, TranscriptDocument } from '../shared/types'
import type { CatalogStore } from './catalog'
import type { AppPaths } from './paths'
import type { FileLogger } from './logger'
import type { ProjectStore } from './projectStore'
import type { PipelineService } from './pipeline'
import { ffmpegStatus } from './ffmpegPaths'
import { parseWhisperModel, whisperStatus, ensureWhisperModel } from './whisperRuntime'
import type { AiMode, AppInfo, WhisperModelId as SharedModel } from '../shared/types'
import {
  clearOpenAiKey,
  openAiKeyStatus,
  readOpenAiKey,
  writeOpenAiKey
} from './secrets'
import { testOpenAiKey } from './openaiProvider'
import { buildAnalysisDocument } from './analysis'
import { buildOutlineDocx, outlineExportFileName } from './exportOutline'
import { searchTranscripts } from './search'
import type { LicenseService } from './license/licenseService'

function ok<T>(data: T): Result<T> {
  return { ok: true, data }
}

function fail(error: unknown): Result<never> {
  const message = error instanceof Error ? error.message : 'Неизвестная ошибка.'
  return { ok: false, error: message }
}

function isInside(parent: string, child: string): boolean {
  const root = resolve(parent).toLowerCase()
  const target = resolve(child).toLowerCase()
  return target === root || target.startsWith(root + sep)
}

async function openVideoDialog(
  getWindow: () => BrowserWindow | null,
  options: Electron.OpenDialogOptions
): Promise<Electron.OpenDialogReturnValue> {
  const window = getWindow()
  if (window) return dialog.showOpenDialog(window, options)
  return dialog.showOpenDialog(options)
}

export function registerIpc(options: {
  getWindow: () => BrowserWindow | null
  catalog: CatalogStore
  projects: ProjectStore
  pipeline: PipelineService
  paths: AppPaths
  logger: FileLogger
  license: LicenseService
}): void {
  const { getWindow, catalog, projects, pipeline, paths, logger, license } = options

  async function buildAppInfo(): Promise<AppInfo> {
    const lastProjectId = await catalog.getSetting('last_project_id')
    const media = ffmpegStatus()
    const modelId = parseWhisperModel(await catalog.getSetting('whisper_model'))
    const whisper = whisperStatus(paths, modelId)
    const keyStatus = openAiKeyStatus(paths)
    return {
      version: app.getVersion(),
      appName: 'TAIMIO',
      appDataRoot: paths.appDataRoot,
      projectsRoot: paths.projectsRoot,
      cacheDir: paths.cacheDir,
      tempDir: paths.tempDir,
      logsDir: paths.logsDir,
      catalogPath: paths.catalogPath,
      platform: process.platform,
      lastProjectId,
      ffmpegReady: media.ffmpegReady,
      ffprobeReady: media.ffprobeReady,
      whisperReady: whisper.whisperReady,
      whisperModelReady: whisper.whisperModelReady,
      whisperModel: whisper.whisperModel,
      openaiKeySet: keyStatus.set,
      openaiKeyMasked: keyStatus.masked
    }
  }

  async function runAnalysis(projectId: string, videoId: string) {
    const project = await catalog.getProject(projectId)
    if (!project) throw new Error('Проект не найден.')
    if (project.aiMode !== 'cloud') {
      throw new Error(
        'Конспект через облако доступен в облачном режиме. Смените режим в настройках проекта.'
      )
    }
    const apiKey = readOpenAiKey(paths)
    if (!apiKey) {
      throw new Error('Сначала сохраните ключ OpenAI в настройках приложения.')
    }
    const transcript = await projects.getTranscript(projectId, videoId)
    if (!transcript) throw new Error('Сначала распознайте речь.')
    logger.info(`Analysis start for ${videoId}`)
    const document = await buildAnalysisDocument(transcript, apiKey)
    await projects.saveAnalysis(projectId, videoId, document)
    await projects.markAnalysisFresh(projectId, videoId)
    logger.info(`Analysis completed for ${videoId}, blocks=${document.blocks.length}`)
    return document
  }

  ipcMain.handle('app:getInfo', async () => {
    try {
      return ok(await buildAppInfo())
    } catch (error) {
      logger.error(`app:getInfo ${String(error)}`)
      return fail(error)
    }
  })

  ipcMain.handle('projects:list', async () => {
    try {
      return ok(await catalog.listProjects())
    } catch (error) {
      logger.error(`projects:list ${String(error)}`)
      return fail(error)
    }
  })

  ipcMain.handle('projects:create', async (_event, input: CreateProjectInput) => {
    try {
      return ok(await catalog.createProject(input))
    } catch (error) {
      logger.error(`projects:create ${String(error)}`)
      return fail(error)
    }
  })

  ipcMain.handle('projects:open', async (_event, id: string) => {
    try {
      return ok(await catalog.openProject(id))
    } catch (error) {
      logger.error(`projects:open ${String(error)}`)
      return fail(error)
    }
  })

  ipcMain.handle('projects:delete', async (_event, id: string) => {
    try {
      const removed = await catalog.deleteProject(id)
      if (isInside(paths.projectsRoot, removed.folderPath)) {
        rmSync(removed.folderPath, { recursive: true, force: true })
      } else {
        logger.error(`Refused to delete path outside projects root: ${removed.folderPath}`)
      }
      return ok({
        id: removed.id,
        name: removed.name,
        deletedPath: removed.folderPath
      })
    } catch (error) {
      logger.error(`projects:delete ${String(error)}`)
      return fail(error)
    }
  })

  ipcMain.handle('videos:list', async (_event, projectId: string) => {
    try {
      await pipeline.reclaimStale(projectId)
      return ok(await projects.listVideos(projectId))
    } catch (error) {
      logger.error(`videos:list ${String(error)}`)
      return fail(error)
    }
  })

  ipcMain.handle('videos:pick', async () => {
    try {
      const result = await openVideoDialog(getWindow, {
        title: 'Добавить видео в TAIMIO',
        properties: ['openFile', 'multiSelections'],
        filters: [
          {
            name: 'Видео',
            extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'mpeg', 'mpg']
          },
          { name: 'Все файлы', extensions: ['*'] }
        ]
      })
      if (result.canceled) return ok([] as string[])
      return ok(result.filePaths)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('videos:import', async (_event, projectId: string, filePaths: string[]) => {
    try {
      const imported = await projects.importVideos(projectId, filePaths)
      for (const video of imported) {
        void pipeline.start(projectId, video.id).catch((error) => {
          logger.error(`auto pipeline ${video.id}: ${String(error)}`)
        })
      }
      return ok(imported)
    } catch (error) {
      logger.error(`videos:import ${String(error)}`)
      return fail(error)
    }
  })

  ipcMain.handle('videos:rename', async (_event, projectId: string, videoId: string, displayName: string) => {
    try {
      return ok(await projects.renameVideo(projectId, videoId, displayName))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('videos:delete', async (_event, projectId: string, videoId: string) => {
    try {
      await pipeline.cancel(projectId, videoId).catch(() => undefined)
      return ok(await projects.deleteVideo(projectId, videoId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('videos:relink', async (_event, projectId: string, videoId: string) => {
    try {
      const result = await openVideoDialog(getWindow, {
        title: 'Указать исходный видеофайл',
        properties: ['openFile'],
        filters: [
          {
            name: 'Видео',
            extensions: ['mp4', 'webm', 'mkv', 'avi', 'mov', 'm4v', 'wmv', 'mpeg', 'mpg']
          }
        ]
      })
      if (result.canceled || !result.filePaths[0]) {
        throw new Error('Файл не выбран.')
      }
      const updated = await projects.updateSourcePath(projectId, videoId, result.filePaths[0])
      void pipeline.start(projectId, videoId)
      return ok(updated)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'pipeline:start',
    async (_event, projectId: string, videoId: string, options?: { forceStt?: boolean }) => {
      try {
        return ok(await pipeline.start(projectId, videoId, options))
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('pipeline:cancel', async (_event, projectId: string, videoId: string) => {
    try {
      return ok(await pipeline.cancel(projectId, videoId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('transcript:get', async (_event, projectId: string, videoId: string) => {
    try {
      return ok(await projects.getTranscript(projectId, videoId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'transcript:save',
    async (_event, projectId: string, videoId: string, bodyText: string) => {
      try {
        return ok(await projects.saveTranscript(projectId, videoId, bodyText))
      } catch (error) {
        return fail(error)
      }
    }
  )

  ipcMain.handle('transcript:rebuild', async (_event, projectId: string, videoId: string) => {
    try {
      return ok(await runAnalysis(projectId, videoId))
    } catch (error) {
      const code = error instanceof Error && error.cause != null ? ` (${String(error.cause)})` : ''
      logger.error(`analysis:build ${videoId}: ${error instanceof Error ? error.message : String(error)}${code}`)
      return fail(error)
    }
  })

  ipcMain.handle('analysis:get', async (_event, projectId: string, videoId: string) => {
    try {
      return ok(await projects.getAnalysis(projectId, videoId))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle(
    'analysis:exportDocx',
    async (_event, projectId: string, videoIds: string[]) => {
      try {
        const project = await catalog.getProject(projectId)
        if (!project) throw new Error('Проект не найден.')
        const videos = await projects.listVideos(projectId)
        const wanted = Array.isArray(videoIds) && videoIds.length > 0
          ? videoIds
          : videos.filter((item) => item.hasAnalysis).map((item) => item.id)
        const payload: Array<{
          name: string
          durationSec: number | null
          analysis: AnalysisDocument
        }> = []
        for (const videoId of wanted) {
          const video = videos.find((item) => item.id === videoId)
          if (!video) throw new Error('Видео не найдено.')
          const analysis = await projects.getAnalysis(projectId, video.id)
          if (!analysis) continue
          payload.push({
            name: video.displayName,
            durationSec: video.durationSec,
            analysis
          })
        }
        if (payload.length === 0) {
          throw new Error('Нет готового конспекта для экспорта.')
        }
        const suggested = outlineExportFileName(
          project.name,
          payload.length === 1 ? payload[0].name : undefined
        )
        const defaultDir = join(project.folderPath, 'exports')
        mkdirSync(defaultDir, { recursive: true })
        const saveOptions: Electron.SaveDialogOptions = {
          title: 'Сохранить план',
          defaultPath: join(defaultDir, suggested),
          filters: [{ name: 'Word', extensions: ['docx'] }]
        }
        const window = getWindow()
        const save = window
          ? await dialog.showSaveDialog(window, saveOptions)
          : await dialog.showSaveDialog(saveOptions)
        if (save.canceled || !save.filePath) {
          return ok({ canceled: true, path: null })
        }
        const buffer = await buildOutlineDocx({
          projectName: project.name,
          videos: payload
        })
        writeFileSync(save.filePath, buffer)
        logger.info(`Outline exported: ${save.filePath}`)
        return ok({ canceled: false, path: save.filePath })
      } catch (error) {
        logger.error(`analysis:exportDocx ${String(error)}`)
        return fail(error)
      }
    }
  )

  ipcMain.handle(
    'search:query',
    async (_event, projectId: string, query: string, videoId?: string | null) => {
      try {
        const project = await catalog.getProject(projectId)
        if (!project) throw new Error('Проект не найден.')
        const videos = await projects.listVideos(projectId)
        const selected = videoId ? videos.filter((item) => item.id === videoId) : videos
        const items: Array<{
          videoId: string
          videoName: string
          folderPath: string
          transcript: TranscriptDocument
        }> = []
        for (const video of selected) {
          const transcript = await projects.getTranscript(projectId, video.id)
          if (!transcript) continue
          items.push({
            videoId: video.id,
            videoName: video.displayName,
            folderPath: project.folderPath,
            transcript
          })
        }
        const apiKey = project.aiMode === 'cloud' ? readOpenAiKey(paths) : null
        logger.info(`Search in ${projectId}, videos=${items.length}, semantic=${Boolean(apiKey)}`)
        return ok(await searchTranscripts({ query, items, apiKey }))
      } catch (error) {
        logger.error(`search:query ${String(error)}`)
        return fail(error)
      }
    }
  )

  ipcMain.handle('projects:setAiMode', async (_event, projectId: string, aiMode: AiMode) => {
    try {
      return ok(await catalog.setProjectAiMode(projectId, aiMode))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('license:status', async () => {
    try {
      const snapshot = await license.getSnapshot()
      return ok({ snapshot, capabilities: await license.getCapabilities() })
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('settings:getOpenAiKeyStatus', async () => {
    try {
      return ok(openAiKeyStatus(paths))
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('settings:setOpenAiKey', async (_event, apiKey: string) => {
    try {
      const status = writeOpenAiKey(paths, apiKey)
      logger.info('OpenAI key saved')
      return ok(status)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('settings:clearOpenAiKey', async () => {
    try {
      const status = clearOpenAiKey(paths)
      logger.info('OpenAI key cleared')
      return ok(status)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('settings:testOpenAiKey', async (_event, apiKey?: string) => {
    try {
      const key = apiKey?.trim() || readOpenAiKey(paths)
      if (!key) throw new Error('Сначала введите или сохраните ключ OpenAI.')
      await testOpenAiKey(key)
      return ok({ ok: true as const })
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('settings:setWhisperModel', async (_event, model: SharedModel) => {
    try {
      const next = parseWhisperModel(model)
      await catalog.setSetting('whisper_model', next)
      return ok(await buildAppInfo())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('settings:downloadWhisperModel', async (_event, model?: SharedModel) => {
    try {
      const next = parseWhisperModel(model || (await catalog.getSetting('whisper_model')))
      await catalog.setSetting('whisper_model', next)
      await ensureWhisperModel(paths, next)
      return ok(await buildAppInfo())
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('window:minimize', () => {
    getWindow()?.minimize()
  })

  ipcMain.handle('window:maximize', () => {
    const window = getWindow()
    if (!window) return
    if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  ipcMain.handle('window:close', () => {
    getWindow()?.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    return Boolean(getWindow()?.isMaximized())
  })

  ipcMain.handle('shell:openPath', async (_event, targetPath: string) => {
    try {
      await shell.openPath(targetPath)
      return ok(true)
    } catch (error) {
      return fail(error)
    }
  })

  ipcMain.handle('shell:openExternal', async (_event, url: string) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:' || parsed.hostname !== 'platform.openai.com') {
        throw new Error('Можно открыть только официальную страницу OpenAI.')
      }
      await shell.openExternal(parsed.toString())
      return ok(true)
    } catch (error) {
      return fail(error)
    }
  })
}
