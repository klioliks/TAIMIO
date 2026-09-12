import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import initSqlJs, { type Database, type SqlJsStatic, type BindParams } from 'sql.js'
import { app } from 'electron'
import type { AiMode, CreateProjectInput, ProcessingStatus, ProjectSummary } from '../shared/types'
import type { AppPaths } from './paths'
import type { FileLogger } from './logger'

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

function mapProject(row: Record<string, unknown>): ProjectSummary {
  return {
    id: String(row.id),
    name: String(row.name),
    aiMode: String(row.ai_mode) as AiMode,
    folderPath: String(row.folder_path),
    videoCount: Number(row.video_count) || 0,
    processingStatus: String(row.processing_status) as ProcessingStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastOpenedAt: String(row.last_opened_at)
  }
}

export class CatalogStore {
  private SQL: SqlJsStatic | null = null
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly paths: AppPaths,
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
      .finally(() => {
        release()
      })
  }

  private async engine(): Promise<SqlJsStatic> {
    if (this.SQL) return this.SQL
    this.SQL = await initSqlJs({
      locateFile: () => wasmFile(app.isPackaged)
    })
    return this.SQL
  }

  private async openCatalog(): Promise<Database> {
    const SQL = await this.engine()
    const file = this.paths.catalogPath
    const existed = existsSync(file)
    const db = existed ? new SQL.Database(readFileSync(file)) : new SQL.Database()
    this.migrateCatalog(db)
    if (!existed) {
      this.save(db, file)
    }
    return db
  }

  private save(db: Database, filePath: string): void {
    const data = db.export()
    writeFileSync(filePath, Buffer.from(data))
  }

  private migrateCatalog(db: Database): void {
    run(
      db,
      `CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        ai_mode TEXT NOT NULL,
        folder_path TEXT NOT NULL,
        video_count INTEGER NOT NULL DEFAULT 0,
        processing_status TEXT NOT NULL DEFAULT 'empty',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
      )`
    )
    run(
      db,
      `CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`
    )
  }

  getSetting(key: string): Promise<string | null> {
    return this.enqueue(async () => {
      const db = await this.openCatalog()
      try {
        const rows = all(db, 'SELECT value FROM settings WHERE key = ?', [key])
        return rows[0] ? String(rows[0].value) : null
      } finally {
        db.close()
      }
    })
  }

  setSetting(key: string, value: string): Promise<void> {
    return this.enqueue(async () => {
      const db = await this.openCatalog()
      try {
        run(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, value])
        this.save(db, this.paths.catalogPath)
      } finally {
        db.close()
      }
    })
  }

  listProjects(): Promise<ProjectSummary[]> {
    return this.enqueue(async () => {
      const db = await this.openCatalog()
      try {
        const rows = all(db, 'SELECT * FROM projects ORDER BY last_opened_at DESC')
        return rows.map(mapProject)
      } finally {
        db.close()
      }
    })
  }

  getProject(id: string): Promise<ProjectSummary | null> {
    return this.enqueue(async () => {
      const db = await this.openCatalog()
      try {
        const rows = all(db, 'SELECT * FROM projects WHERE id = ?', [id])
        return rows[0] ? mapProject(rows[0]) : null
      } finally {
        db.close()
      }
    })
  }

  createProject(input: CreateProjectInput): Promise<ProjectSummary> {
    return this.enqueue(async () => {
      const name = input.name.trim()
      if (!name) {
        throw new Error('Название проекта не может быть пустым.')
      }
      if (name.length > 120) {
        throw new Error('Название проекта слишком длинное.')
      }
      if (input.aiMode !== 'cloud' && input.aiMode !== 'local') {
        throw new Error('Неизвестный режим AI.')
      }

      const id = randomUUID()
      const folderPath = join(this.paths.projectsRoot, id)
      mkdirSync(folderPath, { recursive: true })
      mkdirSync(join(folderPath, 'videos'), { recursive: true })
      mkdirSync(join(folderPath, 'exports'), { recursive: true })

      const SQL = await this.engine()
      const projectDbPath = join(folderPath, 'project.sqlite')
      const projectDb = new SQL.Database()
      try {
        run(
          projectDb,
          `CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
          )`
        )
        run(
          projectDb,
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
          projectDb,
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
        const createdAt = nowIso()
        run(projectDb, 'INSERT INTO meta (key, value) VALUES (?, ?)', ['id', id])
        run(projectDb, 'INSERT INTO meta (key, value) VALUES (?, ?)', ['name', name])
        run(projectDb, 'INSERT INTO meta (key, value) VALUES (?, ?)', ['ai_mode', input.aiMode])
        run(projectDb, 'INSERT INTO meta (key, value) VALUES (?, ?)', ['created_at', createdAt])
        this.save(projectDb, projectDbPath)
      } finally {
        projectDb.close()
      }

      const catalog = await this.openCatalog()
      try {
        const stamp = nowIso()
        run(
          catalog,
          `INSERT INTO projects (
            id, name, ai_mode, folder_path, video_count, processing_status,
            created_at, updated_at, last_opened_at
          ) VALUES (?, ?, ?, ?, 0, 'empty', ?, ?, ?)`,
          [id, name, input.aiMode, folderPath, stamp, stamp, stamp]
        )
        run(catalog, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['last_project_id', id])
        this.save(catalog, this.paths.catalogPath)
        this.logger.info(`Created project ${id} (${input.aiMode})`)
        return {
          id,
          name,
          aiMode: input.aiMode,
          folderPath,
          videoCount: 0,
          processingStatus: 'empty',
          createdAt: stamp,
          updatedAt: stamp,
          lastOpenedAt: stamp
        }
      } finally {
        catalog.close()
      }
    })
  }

  openProject(id: string): Promise<ProjectSummary> {
    return this.enqueue(async () => {
      const db = await this.openCatalog()
      try {
        const rows = all(db, 'SELECT * FROM projects WHERE id = ?', [id])
        if (!rows[0]) {
          throw new Error('Проект не найден.')
        }
        const stamp = nowIso()
        run(db, 'UPDATE projects SET last_opened_at = ?, updated_at = ? WHERE id = ?', [stamp, stamp, id])
        run(db, 'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', ['last_project_id', id])
        this.save(db, this.paths.catalogPath)
        const updated = all(db, 'SELECT * FROM projects WHERE id = ?', [id])[0]
        this.logger.info(`Opened project ${id}`)
        return mapProject(updated)
      } finally {
        db.close()
      }
    })
  }

  setProjectAiMode(id: string, aiMode: AiMode): Promise<ProjectSummary> {
    return this.enqueue(async () => {
      if (aiMode !== 'cloud' && aiMode !== 'local') {
        throw new Error('Неизвестный режим AI.')
      }
      const catalog = await this.openCatalog()
      try {
        const rows = all(catalog, 'SELECT * FROM projects WHERE id = ?', [id])
        if (!rows[0]) throw new Error('Проект не найден.')
        const stamp = nowIso()
        run(catalog, 'UPDATE projects SET ai_mode = ?, updated_at = ? WHERE id = ?', [aiMode, stamp, id])
        this.save(catalog, this.paths.catalogPath)
        const project = mapProject(all(catalog, 'SELECT * FROM projects WHERE id = ?', [id])[0])
        const projectDbPath = join(project.folderPath, 'project.sqlite')
        if (existsSync(projectDbPath)) {
          const SQL = await this.engine()
          const projectDb = new SQL.Database(readFileSync(projectDbPath))
          try {
            run(projectDb, 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', ['ai_mode', aiMode])
            this.save(projectDb, projectDbPath)
          } finally {
            projectDb.close()
          }
        }
        this.logger.info(`Project ${id} AI mode -> ${aiMode}`)
        return project
      } finally {
        catalog.close()
      }
    })
  }

  deleteProject(id: string): Promise<{ id: string; name: string; folderPath: string }> {
    return this.enqueue(async () => {
      const db = await this.openCatalog()
      try {
        const rows = all(db, 'SELECT * FROM projects WHERE id = ?', [id])
        if (!rows[0]) {
          throw new Error('Проект не найден.')
        }
        const project = mapProject(rows[0])
        run(db, 'DELETE FROM projects WHERE id = ?', [id])
        const last = all(db, 'SELECT value FROM settings WHERE key = ?', ['last_project_id'])
        if (last[0] && String(last[0].value) === id) {
          run(db, 'DELETE FROM settings WHERE key = ?', ['last_project_id'])
        }
        this.save(db, this.paths.catalogPath)
        this.logger.info(`Removed project ${id} from catalog`)
        return { id: project.id, name: project.name, folderPath: project.folderPath }
      } finally {
        db.close()
      }
    })
  }

  updateProjectStats(
    id: string,
    videoCount: number,
    processingStatus: ProcessingStatus
  ): Promise<void> {
    return this.enqueue(async () => {
      const db = await this.openCatalog()
      try {
        run(
          db,
          `UPDATE projects
           SET video_count = ?, processing_status = ?, updated_at = ?
           WHERE id = ?`,
          [videoCount, processingStatus, nowIso(), id]
        )
        this.save(db, this.paths.catalogPath)
      } finally {
        db.close()
      }
    })
  }
}
