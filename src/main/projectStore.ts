import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import initSqlJs, { type Database, type SqlJsStatic, type BindParams } from 'sql.js'
import { app } from 'electron'
import type {
  PipelineStage,
  PipelineStageName,
  ProcessingStatus,
  StageStatus,
  TranscriptDocument,
  VideoItem,
  VideoStatus
} from '../shared/types'
import type { CatalogStore } from './catalog'
import type { FileLogger } from './logger'
import { videoArtifactDir } from './ffmpegPaths'
import { transcriptPath } from './whisper'
import { joinTranscriptText } from '../shared/transcriptText'
import { readAnalysisFile, writeAnalysisFile } from './analysis'
import { readRetellFile, writeRetellFile } from './retell'
import { readVisualsForUi, readVisualsFile } from './visuals'
import { backupSqliteFile, PROJECT_SCHEMA_VERSION } from './sqliteBackup'
import type { AnalysisDocument, RetellDocument, VisualDocument } from '../shared/types'

function nowIso(): string {
  return new Date().toISOString()
}

function wasmFile(isPackaged: boolean): string {
  if (isPackaged) {
    return join(process.resourcesPath, 'sql-wasm.wasm')
  }
  return join(app.getAppPath(), 'node_modules/sql.js/dist/sql-wasm.wasm')
}

function all(db: Database, sql: string, params?: BindParams): Record<string, unknown>[] {
  const stmt = db.prepare(sql)
  if (params) stmt.bind(params)
  const rows: Record<string, unknown>[] = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

function run(db: Database, sql: string, params?: BindParams): void {
  db.run(sql, params)
}

const STAGE_ORDER: PipelineStageName[] = ['probe', 'audio', 'stt']

const STAGE_LABELS: Record<PipelineStageName, string> = {
  probe: 'Читаем информацию о видео',
  audio: 'Подготовка аудио',
  stt: 'Распознаём речь'
}

function readTranscriptFile(folderPath: string, videoId: string): TranscriptDocument | null {
  const file = transcriptPath(folderPath, videoId)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as TranscriptDocument
    return {
      ...parsed,
      bodyText: parsed.bodyText ?? null,
      segments: parsed.segments ?? []
    }
  } catch {
    return null
  }
}

function writeTranscriptFile(folderPath: string, videoId: string, doc: TranscriptDocument): void {
  const file = transcriptPath(folderPath, videoId)
  mkdirSync(join(folderPath, 'videos', videoId, 'transcript'), { recursive: true })
  writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8')
}

export class ProjectStore {
  private SQL: SqlJsStatic | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly catalog: CatalogStore,
    private readonly logger: FileLogger
  ) {}

  private enqueue<T>(work: () => Promise<T>): Promise<T> {
    let release: () => void = () => undefined
    const previous = this.queue
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    return previous
      .catch(() => undefined)
      .then(work)
      .finally(() => release())
  }

  private async engine(): Promise<SqlJsStatic> {
    if (this.SQL) return this.SQL
    this.SQL = await initSqlJs({
      locateFile: () => wasmFile(app.isPackaged)
    })
    return this.SQL
  }

  private save(db: Database, filePath: string): void {
    writeFileSync(filePath, Buffer.from(db.export()))
  }

  private projectDbPath(folderPath: string): string {
    return join(folderPath, 'project.sqlite')
  }

  private migrateProject(db: Database, from: number, stored: number | null): boolean {
    if (from >= PROJECT_SCHEMA_VERSION && stored !== null) return false
    if (from < 1) {
      run(
        db,
        `CREATE TABLE IF NOT EXISTS meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        )`
      )
      run(
        db,
        `CREATE TABLE IF NOT EXISTS videos (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          source_path TEXT NOT NULL,
          file_name TEXT,
          size_bytes INTEGER,
          duration_sec REAL,
          width INTEGER,
          height INTEGER,
          container TEXT,
          video_codec TEXT,
          audio_codec TEXT,
          playable_in_app INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'registered',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        )`
      )
      run(
        db,
        `CREATE TABLE IF NOT EXISTS pipeline_stages (
          video_id TEXT NOT NULL,
          stage TEXT NOT NULL,
          status TEXT NOT NULL,
          artifact_path TEXT,
          input_hash TEXT,
          error_code TEXT,
          error_message TEXT,
          progress REAL NOT NULL DEFAULT 0,
          started_at TEXT,
          finished_at TEXT,
          PRIMARY KEY (video_id, stage)
        )`
      )
    }
    if (from < 1 || stored === null) {
      const columns = all(db, 'PRAGMA table_info(videos)').map((row) => String(row.name))
      const ensure = (name: string, ddl: string): void => {
        if (!columns.includes(name)) {
          run(db, `ALTER TABLE videos ADD COLUMN ${ddl}`)
        }
      }
      ensure('file_name', 'file_name TEXT')
      ensure('width', 'width INTEGER')
      ensure('height', 'height INTEGER')
      ensure('container', 'container TEXT')
      ensure('video_codec', 'video_codec TEXT')
      ensure('audio_codec', 'audio_codec TEXT')
      ensure('playable_in_app', 'playable_in_app INTEGER NOT NULL DEFAULT 0')
      ensure('updated_at', 'updated_at TEXT')

      const videoIds = all(db, 'SELECT id FROM videos').map((row) => String(row.id))
      for (const videoId of videoIds) {
        const existing = all(db, 'SELECT stage FROM pipeline_stages WHERE video_id = ? AND stage = ?', [
          videoId,
          'stt'
        ])
        if (!existing[0]) {
          run(
            db,
            `INSERT INTO pipeline_stages (
              video_id, stage, status, artifact_path, input_hash, error_code, error_message,
              progress, started_at, finished_at
            ) VALUES (?, 'stt', 'queued', NULL, NULL, NULL, NULL, 0, NULL, NULL)`,
            [videoId]
          )
        }
      }
    }
    run(db, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [
      'schema_version',
      String(PROJECT_SCHEMA_VERSION)
    ])
    this.logger.info(`Проект: схема ${from} → ${PROJECT_SCHEMA_VERSION}`)
    return true
  }

  private readProjectSchemaVersion(db: Database): number | null {
    const tables = all(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'`)
    if (tables.length === 0) return null
    const rows = all(db, 'SELECT value FROM meta WHERE key = ?', ['schema_version'])
    if (!rows[0]) return null
    const parsed = Number(rows[0].value)
    return Number.isFinite(parsed) ? parsed : null
  }

  private inferredProjectSchema(db: Database): number {
    const videos = all(db, `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'videos'`)
    return videos.length > 0 ? 1 : 0
  }

  private async openProjectDb(folderPath: string): Promise<Database> {
    const SQL = await this.engine()
    const file = this.projectDbPath(folderPath)
    if (!existsSync(file)) {
      throw new Error('Файл проекта повреждён или не найден.')
    }
    const db = new SQL.Database(readFileSync(file))
    const stored = this.readProjectSchemaVersion(db)
    const from = stored ?? this.inferredProjectSchema(db)
    const needsMigrate = from < PROJECT_SCHEMA_VERSION || stored === null
    if (needsMigrate) backupSqliteFile(file)
    const migrated = this.migrateProject(db, from, stored)
    if (migrated) this.save(db, file)
    return db
  }

  private async requireProject(projectId: string): Promise<{ id: string; folderPath: string }> {
    const project = await this.catalog.getProject(projectId)
    if (!project) throw new Error('Проект не найден.')
    return { id: project.id, folderPath: project.folderPath }
  }

  private mapStages(rows: Record<string, unknown>[]): PipelineStage[] {
    return STAGE_ORDER.map((stage) => {
      const row = rows.find((item) => String(item.stage) === stage)
      if (!row) {
        return {
          stage,
          status: 'queued' as StageStatus,
          artifactPath: null,
          inputHash: null,
          errorCode: null,
          errorMessage: null,
          progress: 0,
          startedAt: null,
          finishedAt: null
        }
      }
      return {
        stage,
        status: String(row.status) as StageStatus,
        artifactPath: row.artifact_path ? String(row.artifact_path) : null,
        inputHash: row.input_hash ? String(row.input_hash) : null,
        errorCode: row.error_code ? String(row.error_code) : null,
        errorMessage: row.error_message ? String(row.error_message) : null,
        progress: Number(row.progress) || 0,
        startedAt: row.started_at ? String(row.started_at) : null,
        finishedAt: row.finished_at ? String(row.finished_at) : null
      }
    })
  }

  private deriveProgress(stages: PipelineStage[]): number {
    if (stages.length === 0) return 0
    const sum = stages.reduce((acc, stage) => {
      if (stage.status === 'completed') return acc + 1
      if (stage.status === 'processing') return acc + stage.progress
      return acc
    }, 0)
    return Math.round((sum / stages.length) * 100)
  }

  private currentLabel(status: VideoStatus, stages: PipelineStage[]): string | null {
    if (status === 'missing_source') return 'Исходный файл не найден'
    if (status === 'failed') {
      const failed = [...stages].reverse().find((s) => s.status === 'failed')
      return failed?.errorMessage || 'Ошибка обработки'
    }
    if (status === 'cancelled') return 'Обработка остановлена — можно повторить'
    const stt = stages.find((s) => s.stage === 'stt')
    const audio = stages.find((s) => s.stage === 'audio')
    if (status === 'ready') {
      return stt?.status === 'completed' ? 'Расшифровка готова' : 'Готово к распознаванию'
    }
    if (status === 'transcribing') return STAGE_LABELS.stt
    if (status === 'registered' && audio?.status === 'completed' && stt && stt.status !== 'completed') {
      if (stt.status === 'processing') return STAGE_LABELS.stt
      if (stt.status === 'needs_retry' || stt.status === 'cancelled') {
        return 'Обработка остановлена — можно повторить'
      }
      return 'Готово к распознаванию'
    }
    const active = stages.find((s) => s.status === 'processing')
    if (active) return STAGE_LABELS[active.stage]
    const needsRetry = stages.find((s) => s.status === 'needs_retry')
    if (needsRetry) return 'Обработка остановлена — можно повторить'
    const queued = stages.find((s) => s.status === 'queued')
    if (!queued) return null
    if (queued.stage === 'stt' && audio?.status === 'completed') return 'Готово к распознаванию'
    return STAGE_LABELS[queued.stage]
  }

  private mapVideo(
    projectId: string,
    folderPath: string,
    row: Record<string, unknown>,
    stageRows: Record<string, unknown>[]
  ): VideoItem {
    const sourcePath = String(row.source_path)
    const sourceExists = existsSync(sourcePath)
    const stages = this.mapStages(stageRows.filter((item) => String(item.video_id) === String(row.id)))
    const transcript = readTranscriptFile(folderPath, String(row.id))
    let status = String(row.status) as VideoStatus
    if (!sourceExists && status !== 'registered') {
      status = 'missing_source'
    }
    const stt = stages.find((item) => item.stage === 'stt')
    if (stt && stt.status !== 'completed') {
      if (stt.status === 'failed') status = 'failed'
      else if (stt.status === 'processing') status = 'transcribing'
      else if (stt.status === 'needs_retry' || stt.status === 'cancelled') status = 'cancelled'
      else if (status === 'ready') {
        // Аудио готово, расшифровка ещё не запускалась — оставляем ready без hasTranscript.
      }
    }
    const hasRetell = Boolean(readRetellFile(folderPath, String(row.id)))
    return {
      id: String(row.id),
      projectId,
      displayName: String(row.display_name),
      sourcePath,
      fileName: row.file_name ? String(row.file_name) : basename(sourcePath),
      sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      durationSec: row.duration_sec == null ? null : Number(row.duration_sec),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
      container: row.container ? String(row.container) : null,
      videoCodec: row.video_codec ? String(row.video_codec) : null,
      audioCodec: row.audio_codec ? String(row.audio_codec) : null,
      playableInApp: Boolean(Number(row.playable_in_app)),
      sourceExists,
      status,
      currentStageLabel: this.currentLabel(status, stages),
      progress: this.deriveProgress(stages),
      stages,
      mediaUrl: sourceExists ? `taimio://file/?p=${encodeURIComponent(sourcePath)}` : null,
      hasTranscript: Boolean(transcript),
      hasAnalysis: Boolean(readAnalysisFile(folderPath, String(row.id))),
      analysisStale: Boolean(transcript?.analysisStale),
      hasRetell,
      hasVisuals: Boolean(readVisualsFile(folderPath, String(row.id))),
      retellStale:
        transcript?.retellStale != null
          ? Boolean(transcript.retellStale)
          : Boolean(transcript?.analysisStale && hasRetell),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    }
  }

  private projectStatus(videos: VideoItem[]): ProcessingStatus {
    if (videos.length === 0) return 'empty'
    const statuses = videos.map((v) => v.status)
    if (statuses.every((s) => s === 'ready')) return 'completed'
    if (statuses.some((s) => s === 'probing' || s === 'extracting_audio' || s === 'transcribing'))
      return 'processing'
    if (statuses.some((s) => s === 'failed' || s === 'missing_source')) {
      if (statuses.some((s) => s === 'ready')) return 'mixed'
      return 'failed'
    }
    if (statuses.some((s) => s === 'registered' || s === 'cancelled')) return 'queued'
    return 'mixed'
  }

  private async syncCatalog(projectId: string, folderPath: string, db: Database): Promise<void> {
    const rows = all(db, 'SELECT * FROM videos ORDER BY created_at ASC')
    const stageRows = all(db, 'SELECT * FROM pipeline_stages')
    const videos = rows.map((row) => this.mapVideo(projectId, folderPath, row, stageRows))
    await this.catalog.updateProjectStats(projectId, videos.length, this.projectStatus(videos))
    void folderPath
  }

  listVideos(projectId: string): Promise<VideoItem[]> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      const db = await this.openProjectDb(project.folderPath)
      try {
        const rows = all(db, 'SELECT * FROM videos ORDER BY created_at ASC')
        const stageRows = all(db, 'SELECT * FROM pipeline_stages')
        return rows.map((row) => this.mapVideo(projectId, project.folderPath, row, stageRows))
      } finally {
        db.close()
      }
    })
  }

  getVideo(projectId: string, videoId: string): Promise<VideoItem> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      const db = await this.openProjectDb(project.folderPath)
      try {
        const rows = all(db, 'SELECT * FROM videos WHERE id = ?', [videoId])
        if (!rows[0]) throw new Error('Видео не найдено.')
        const stageRows = all(db, 'SELECT * FROM pipeline_stages WHERE video_id = ?', [videoId])
        return this.mapVideo(projectId, project.folderPath, rows[0], stageRows)
      } finally {
        db.close()
      }
    })
  }

  importVideos(projectId: string, filePaths: string[]): Promise<VideoItem[]> {
    return this.enqueue(async () => {
      const unique = [...new Set(filePaths.map((p) => p.trim()).filter(Boolean))]
      if (unique.length === 0) throw new Error('Файлы не выбраны.')

      const project = await this.requireProject(projectId)
      const db = await this.openProjectDb(project.folderPath)
      try {
        const created: VideoItem[] = []
        for (const sourcePath of unique) {
          if (!existsSync(sourcePath)) {
            throw new Error(`Файл не найден: ${basename(sourcePath)}`)
          }
          const existing = all(db, 'SELECT id FROM videos WHERE lower(source_path) = lower(?)', [sourcePath])
          if (existing[0]) {
            continue
          }

          const id = randomUUID()
          const stamp = nowIso()
          const fileName = basename(sourcePath)
          const displayName = fileName.replace(/\.[^.]+$/, '') || fileName
          mkdirSync(videoArtifactDir(project.folderPath, id), { recursive: true })
          mkdirSync(join(videoArtifactDir(project.folderPath, id), 'audio'), { recursive: true })
          mkdirSync(join(videoArtifactDir(project.folderPath, id), 'transcript'), { recursive: true })

          run(
            db,
            `INSERT INTO videos (
              id, display_name, source_path, file_name, size_bytes, duration_sec,
              width, height, container, video_codec, audio_codec, playable_in_app,
              status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 0, 'registered', ?, ?)`,
            [id, displayName, sourcePath, fileName, stamp, stamp]
          )
          for (const stage of STAGE_ORDER) {
            run(
              db,
              `INSERT INTO pipeline_stages (
                video_id, stage, status, artifact_path, input_hash, error_code, error_message,
                progress, started_at, finished_at
              ) VALUES (?, ?, 'queued', NULL, NULL, NULL, NULL, 0, NULL, NULL)`,
              [id, stage]
            )
          }
          const stageRows = all(db, 'SELECT * FROM pipeline_stages WHERE video_id = ?', [id])
          const row = all(db, 'SELECT * FROM videos WHERE id = ?', [id])[0]
          created.push(this.mapVideo(projectId, project.folderPath, row, stageRows))
        }
        this.save(db, this.projectDbPath(project.folderPath))
        await this.syncCatalog(projectId, project.folderPath, db)
        this.logger.info(`Imported ${created.length} video(s) into ${projectId}`)
        return created
      } finally {
        db.close()
      }
    })
  }

  renameVideo(projectId: string, videoId: string, displayName: string): Promise<VideoItem> {
    return this.enqueue(async () => {
      const name = displayName.trim()
      if (!name) throw new Error('Название не может быть пустым.')
      const project = await this.requireProject(projectId)
      const db = await this.openProjectDb(project.folderPath)
      try {
        const rows = all(db, 'SELECT * FROM videos WHERE id = ?', [videoId])
        if (!rows[0]) throw new Error('Видео не найдено.')
        const stamp = nowIso()
        run(db, 'UPDATE videos SET display_name = ?, updated_at = ? WHERE id = ?', [name, stamp, videoId])
        this.save(db, this.projectDbPath(project.folderPath))
        const stageRows = all(db, 'SELECT * FROM pipeline_stages WHERE video_id = ?', [videoId])
        return this.mapVideo(
          projectId,
          project.folderPath,
          all(db, 'SELECT * FROM videos WHERE id = ?', [videoId])[0],
          stageRows
        )
      } finally {
        db.close()
      }
    })
  }

  deleteVideo(projectId: string, videoId: string): Promise<{ id: string }> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      const db = await this.openProjectDb(project.folderPath)
      try {
        const rows = all(db, 'SELECT * FROM videos WHERE id = ?', [videoId])
        if (!rows[0]) throw new Error('Видео не найдено.')
        run(db, 'DELETE FROM pipeline_stages WHERE video_id = ?', [videoId])
        run(db, 'DELETE FROM videos WHERE id = ?', [videoId])
        this.save(db, this.projectDbPath(project.folderPath))
        const dir = videoArtifactDir(project.folderPath, videoId)
        if (existsSync(dir)) {
          rmSync(dir, { recursive: true, force: true })
        }
        await this.syncCatalog(projectId, project.folderPath, db)
        this.logger.info(`Deleted video ${videoId} from ${projectId}`)
        return { id: videoId }
      } finally {
        db.close()
      }
    })
  }

  updateSourcePath(projectId: string, videoId: string, sourcePath: string): Promise<VideoItem> {
    return this.enqueue(async () => {
      if (!existsSync(sourcePath)) throw new Error('Выбранный файл не найден.')
      const project = await this.requireProject(projectId)
      const db = await this.openProjectDb(project.folderPath)
      try {
        const rows = all(db, 'SELECT * FROM videos WHERE id = ?', [videoId])
        if (!rows[0]) throw new Error('Видео не найдено.')
        const stamp = nowIso()
        run(
          db,
          `UPDATE videos SET source_path = ?, file_name = ?, status = 'registered', updated_at = ? WHERE id = ?`,
          [sourcePath, basename(sourcePath), stamp, videoId]
        )
        run(
          db,
          `UPDATE pipeline_stages
           SET status = 'queued', artifact_path = NULL, input_hash = NULL, error_code = NULL,
               error_message = NULL, progress = 0, started_at = NULL, finished_at = NULL
           WHERE video_id = ?`,
          [videoId]
        )
        this.save(db, this.projectDbPath(project.folderPath))
        await this.syncCatalog(projectId, project.folderPath, db)
        const stageRows = all(db, 'SELECT * FROM pipeline_stages WHERE video_id = ?', [videoId])
        return this.mapVideo(
          projectId,
          project.folderPath,
          all(db, 'SELECT * FROM videos WHERE id = ?', [videoId])[0],
          stageRows
        )
      } finally {
        db.close()
      }
    })
  }

  updateStage(
    projectId: string,
    videoId: string,
    stage: PipelineStageName,
    patch: {
      status: StageStatus
      artifactPath?: string | null
      inputHash?: string | null
      errorCode?: string | null
      errorMessage?: string | null
      progress?: number
      startedAt?: string | null
      finishedAt?: string | null
    },
    videoStatus: VideoStatus,
    metadata?: Partial<{
      sizeBytes: number | null
      durationSec: number | null
      width: number | null
      height: number | null
      container: string | null
      videoCodec: string | null
      audioCodec: string | null
      playableInApp: boolean
      fileName: string
    }>
  ): Promise<VideoItem> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      const db = await this.openProjectDb(project.folderPath)
      try {
        const stamp = nowIso()
        const existing = all(db, 'SELECT stage FROM pipeline_stages WHERE video_id = ? AND stage = ?', [
          videoId,
          stage
        ])
        if (!existing[0]) {
          run(
            db,
            `INSERT INTO pipeline_stages (
              video_id, stage, status, artifact_path, input_hash, error_code, error_message,
              progress, started_at, finished_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              videoId,
              stage,
              patch.status,
              patch.artifactPath ?? null,
              patch.inputHash ?? null,
              patch.errorCode ?? null,
              patch.errorMessage ?? null,
              patch.progress ?? 0,
              patch.startedAt ?? null,
              patch.finishedAt ?? null
            ]
          )
        } else {
          run(
            db,
            `UPDATE pipeline_stages
             SET status = ?, artifact_path = COALESCE(?, artifact_path), input_hash = COALESCE(?, input_hash),
                 error_code = ?, error_message = ?, progress = ?,
                 started_at = COALESCE(?, started_at), finished_at = ?
             WHERE video_id = ? AND stage = ?`,
            [
              patch.status,
              patch.artifactPath ?? null,
              patch.inputHash ?? null,
              patch.errorCode ?? null,
              patch.errorMessage ?? null,
              patch.progress ?? 0,
              patch.startedAt ?? null,
              patch.finishedAt ?? null,
              videoId,
              stage
            ]
          )
        }
        run(db, 'UPDATE videos SET status = ?, updated_at = ? WHERE id = ?', [videoStatus, stamp, videoId])
        if (metadata) {
          run(
            db,
            `UPDATE videos SET
              size_bytes = COALESCE(?, size_bytes),
              duration_sec = COALESCE(?, duration_sec),
              width = COALESCE(?, width),
              height = COALESCE(?, height),
              container = COALESCE(?, container),
              video_codec = COALESCE(?, video_codec),
              audio_codec = COALESCE(?, audio_codec),
              playable_in_app = COALESCE(?, playable_in_app),
              file_name = COALESCE(?, file_name)
             WHERE id = ?`,
            [
              metadata.sizeBytes ?? null,
              metadata.durationSec ?? null,
              metadata.width ?? null,
              metadata.height ?? null,
              metadata.container ?? null,
              metadata.videoCodec ?? null,
              metadata.audioCodec ?? null,
              metadata.playableInApp == null ? null : metadata.playableInApp ? 1 : 0,
              metadata.fileName ?? null,
              videoId
            ]
          )
        }
        this.save(db, this.projectDbPath(project.folderPath))
        await this.syncCatalog(projectId, project.folderPath, db)
        const stageRows = all(db, 'SELECT * FROM pipeline_stages WHERE video_id = ?', [videoId])
        return this.mapVideo(
          projectId,
          project.folderPath,
          all(db, 'SELECT * FROM videos WHERE id = ?', [videoId])[0],
          stageRows
        )
      } finally {
        db.close()
      }
    })
  }

  clearTranscript(projectId: string, videoId: string): Promise<void> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      const transcriptDir = join(project.folderPath, 'videos', videoId, 'transcript')
      const audioPath = join(project.folderPath, 'videos', videoId, 'audio', 'audio.wav')
      if (existsSync(transcriptDir)) {
        rmSync(transcriptDir, { recursive: true, force: true })
      }
      mkdirSync(transcriptDir, { recursive: true })
      if (existsSync(audioPath)) {
        try {
          rmSync(audioPath, { force: true })
        } catch {
          /* ignore */
        }
      }
      const db = await this.openProjectDb(project.folderPath)
      try {
        run(
          db,
          `UPDATE pipeline_stages
           SET status = 'queued', artifact_path = NULL, input_hash = NULL, error_code = NULL,
               error_message = NULL, progress = 0, started_at = NULL, finished_at = NULL
           WHERE video_id = ? AND stage IN ('audio', 'stt')`,
          [videoId]
        )
        run(db, `UPDATE videos SET status = 'registered', updated_at = ? WHERE id = ?`, [
          nowIso(),
          videoId
        ])
        this.save(db, this.projectDbPath(project.folderPath))
        await this.syncCatalog(projectId, project.folderPath, db)
      } finally {
        db.close()
      }
    })
  }

  getTranscript(projectId: string, videoId: string): Promise<TranscriptDocument | null> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      return readTranscriptFile(project.folderPath, videoId)
    })
  }

  saveTranscript(projectId: string, videoId: string, bodyText: string): Promise<TranscriptDocument> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      const existing = readTranscriptFile(project.folderPath, videoId)
      if (!existing) throw new Error('Расшифровка ещё не готова.')
      const nextBody = bodyText.replace(/\r\n/g, '\n').trim()
      const baseline = existing.bodyText ?? joinTranscriptText(existing.segments)
      const changed = nextBody !== baseline.trim()
      const doc: TranscriptDocument = {
        ...existing,
        bodyText: nextBody,
        analysisStale: changed || existing.analysisStale,
        retellStale: changed || Boolean(existing.retellStale),
        updatedAt: nowIso()
      }
      writeTranscriptFile(project.folderPath, videoId, doc)
      return doc
    })
  }

  markAnalysisFresh(projectId: string, videoId: string): Promise<TranscriptDocument> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      const existing = readTranscriptFile(project.folderPath, videoId)
      if (!existing) throw new Error('Расшифровка ещё не готова.')
      const doc: TranscriptDocument = {
        ...existing,
        analysisStale: false,
        retellStale: Boolean(existing.retellStale),
        updatedAt: nowIso()
      }
      writeTranscriptFile(project.folderPath, videoId, doc)
      return doc
    })
  }

  markRetellFresh(projectId: string, videoId: string): Promise<TranscriptDocument> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      const existing = readTranscriptFile(project.folderPath, videoId)
      if (!existing) throw new Error('Расшифровка ещё не готова.')
      const doc: TranscriptDocument = {
        ...existing,
        retellStale: false,
        analysisStale: Boolean(existing.analysisStale),
        updatedAt: nowIso()
      }
      writeTranscriptFile(project.folderPath, videoId, doc)
      return doc
    })
  }

  getAnalysis(projectId: string, videoId: string): Promise<AnalysisDocument | null> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      return readAnalysisFile(project.folderPath, videoId)
    })
  }

  saveAnalysis(projectId: string, videoId: string, doc: AnalysisDocument): Promise<void> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      writeAnalysisFile(project.folderPath, videoId, doc)
    })
  }

  getRetell(projectId: string, videoId: string): Promise<RetellDocument | null> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      return readRetellFile(project.folderPath, videoId)
    })
  }

  getVisuals(projectId: string, videoId: string): Promise<VisualDocument | null> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      return readVisualsForUi(project.folderPath, videoId)
    })
  }

  saveRetell(projectId: string, videoId: string, doc: RetellDocument): Promise<void> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      writeRetellFile(project.folderPath, videoId, doc)
    })
  }

  writeTranscript(projectId: string, videoId: string, doc: TranscriptDocument): Promise<void> {
    return this.enqueue(async () => {
      const project = await this.requireProject(projectId)
      writeTranscriptFile(project.folderPath, videoId, doc)
    })
  }

  markInterrupted(): Promise<void> {
    return this.enqueue(async () => {
      const projects = await this.catalog.listProjects()
      for (const project of projects) {
        if (!existsSync(this.projectDbPath(project.folderPath))) continue
        const db = await this.openProjectDb(project.folderPath)
        try {
          run(
            db,
            `UPDATE pipeline_stages
             SET status = 'needs_retry', error_code = 'interrupted',
                 error_message = 'Программа была закрыта во время обработки.'
             WHERE status = 'processing'`
          )
          run(
            db,
            `UPDATE videos SET status = 'cancelled', updated_at = ?
             WHERE status IN ('probing', 'extracting_audio', 'transcribing')`,
            [nowIso()]
          )
          this.save(db, this.projectDbPath(project.folderPath))
          await this.syncCatalog(project.id, project.folderPath, db)
        } finally {
          db.close()
        }
      }
    })
  }
}

export { STAGE_LABELS }
