import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import { mkdirSync } from 'fs'

export interface AppPaths {
  appDataRoot: string
  projectsRoot: string
  cacheDir: string
  tempDir: string
  logsDir: string
  catalogPath: string
  settingsPath: string
}

function localAppDataDir(): string {
  return process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
}

export function getAppDataRoot(): string {
  return join(localAppDataDir(), 'TAIMIO')
}

export function applyUserDataPath(): void {
  app.setPath('userData', getAppDataRoot())
}

export function resolveAppPaths(): AppPaths {
  const appDataRoot = getAppDataRoot()
  const documentsDir = app.getPath('documents')
  const projectsRoot = join(documentsDir, 'TAIMIO', 'Projects')
  const cacheDir = join(appDataRoot, 'models')
  const tempDir = join(appDataRoot, 'temp')
  const logsDir = join(appDataRoot, 'logs')

  mkdirSync(appDataRoot, { recursive: true })
  mkdirSync(projectsRoot, { recursive: true })
  mkdirSync(cacheDir, { recursive: true })
  mkdirSync(tempDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })

  return {
    appDataRoot,
    projectsRoot,
    cacheDir,
    tempDir,
    logsDir,
    catalogPath: join(appDataRoot, 'catalog.sqlite'),
    settingsPath: join(appDataRoot, 'settings.json')
  }
}
