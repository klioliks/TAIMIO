import { app, BrowserWindow, Menu, protocol, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { applyUserDataPath, resolveAppPaths } from './paths'
import { FileLogger } from './logger'
import { CatalogStore } from './catalog'
import { ProjectStore } from './projectStore'
import { PipelineService } from './pipeline'
import { registerIpc } from './ipc'
import { serveLocalMedia } from './mediaProtocol'
import { AlwaysValidLicenseProvider } from './license/alwaysValidLicenseProvider'
import { LicenseService } from './license/licenseService'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'taimio',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
      corsEnabled: true
    }
  }
])

applyUserDataPath()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#070b18',
    title: 'TAIMIO',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.taimio.app')
  Menu.setApplicationMenu(null)

  protocol.handle('taimio', (request) => {
    try {
      const url = new URL(request.url)
      const filePath = url.searchParams.get('p')
      if (!filePath) {
        return new Response('Файл не указан', { status: 400 })
      }
      return serveLocalMedia(filePath, request)
    } catch {
      return new Response('Не удалось открыть файл', { status: 500 })
    }
  })

  const paths = resolveAppPaths()
  const logger = new FileLogger(paths.logsDir)
  const catalog = new CatalogStore(paths, logger)
  const projects = new ProjectStore(catalog, logger)
  const license = new LicenseService(new AlwaysValidLicenseProvider())
  const pipeline = new PipelineService(projects, catalog, paths, logger, () => mainWindow, license)
  await projects.markInterrupted()
  logger.info(`TAIMIO started, data root ${paths.appDataRoot}`)

  registerIpc({
    getWindow: () => mainWindow,
    catalog,
    projects,
    pipeline,
    paths,
    logger,
    license
  })

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
