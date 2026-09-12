import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AiMode,
  CreateProjectInput,
  PipelineProgressEvent,
  TaimioApi,
  WhisperModelId
} from '../shared/types'

const api: TaimioApi = {
  getAppInfo: () => ipcRenderer.invoke('app:getInfo'),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (input: CreateProjectInput) => ipcRenderer.invoke('projects:create', input),
  openProject: (id: string) => ipcRenderer.invoke('projects:open', id),
  deleteProject: (id: string) => ipcRenderer.invoke('projects:delete', id),
  listVideos: (projectId: string) => ipcRenderer.invoke('videos:list', projectId),
  importVideos: (projectId: string, filePaths: string[]) =>
    ipcRenderer.invoke('videos:import', projectId, filePaths),
  pickVideoFiles: () => ipcRenderer.invoke('videos:pick'),
  renameVideo: (projectId: string, videoId: string, displayName: string) =>
    ipcRenderer.invoke('videos:rename', projectId, videoId, displayName),
  deleteVideo: (projectId: string, videoId: string) =>
    ipcRenderer.invoke('videos:delete', projectId, videoId),
  relinkVideo: (projectId: string, videoId: string) =>
    ipcRenderer.invoke('videos:relink', projectId, videoId),
  startPipeline: (projectId: string, videoId: string, options?: { forceStt?: boolean }) =>
    ipcRenderer.invoke('pipeline:start', projectId, videoId, options),
  cancelPipeline: (projectId: string, videoId: string) =>
    ipcRenderer.invoke('pipeline:cancel', projectId, videoId),
  getTranscript: (projectId: string, videoId: string) =>
    ipcRenderer.invoke('transcript:get', projectId, videoId),
  saveTranscript: (projectId: string, videoId: string, bodyText: string) =>
    ipcRenderer.invoke('transcript:save', projectId, videoId, bodyText),
  rebuildAnalysis: (projectId: string, videoId: string) =>
    ipcRenderer.invoke('transcript:rebuild', projectId, videoId),
  getAnalysis: (projectId: string, videoId: string) =>
    ipcRenderer.invoke('analysis:get', projectId, videoId),
  exportOutlineDocx: (projectId: string, videoIds: string[]) =>
    ipcRenderer.invoke('analysis:exportDocx', projectId, videoIds),
  setProjectAiMode: (projectId: string, aiMode: AiMode) =>
    ipcRenderer.invoke('projects:setAiMode', projectId, aiMode),
  getOpenAiKeyStatus: () => ipcRenderer.invoke('settings:getOpenAiKeyStatus'),
  setOpenAiKey: (apiKey: string) => ipcRenderer.invoke('settings:setOpenAiKey', apiKey),
  clearOpenAiKey: () => ipcRenderer.invoke('settings:clearOpenAiKey'),
  testOpenAiKey: (apiKey?: string) => ipcRenderer.invoke('settings:testOpenAiKey', apiKey),
  searchProject: (projectId: string, query: string, videoId?: string | null) =>
    ipcRenderer.invoke('search:query', projectId, query, videoId),
  getLicenseStatus: () => ipcRenderer.invoke('license:status'),
  setWhisperModel: (model: WhisperModelId) => ipcRenderer.invoke('settings:setWhisperModel', model),
  downloadWhisperModel: (model?: WhisperModelId) =>
    ipcRenderer.invoke('settings:downloadWhisperModel', model),
  openExternalPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath),
  openExternalUrl: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onPipelineProgress: (handler: (event: PipelineProgressEvent) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: PipelineProgressEvent): void => {
      handler(payload)
    }
    ipcRenderer.on('pipeline:progress', listener)
    return () => {
      ipcRenderer.removeListener('pipeline:progress', listener)
    }
  },
  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximize: () => ipcRenderer.invoke('window:maximize'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  windowIsMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  openPath: (targetPath: string) => ipcRenderer.invoke('shell:openPath', targetPath)
}

contextBridge.exposeInMainWorld('taimio', api)
