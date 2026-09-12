import type { LicenseCapabilities, LicenseSnapshot } from './license'

export type { LicenseCapabilities, LicenseSnapshot, LicenseState } from './license'

export type AiMode = 'cloud' | 'local'

export type ProcessingStatus = 'empty' | 'queued' | 'processing' | 'completed' | 'failed' | 'mixed'

export type PipelineStageName = 'probe' | 'audio' | 'stt'

export type StageStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'needs_retry' | 'cancelled'

export type WhisperModelId = 'small' | 'medium'

export type VideoStatus =
  | 'registered'
  | 'probing'
  | 'extracting_audio'
  | 'transcribing'
  | 'ready'
  | 'failed'
  | 'cancelled'
  | 'missing_source'

export interface ProjectSummary {
  id: string
  name: string
  aiMode: AiMode
  folderPath: string
  videoCount: number
  processingStatus: ProcessingStatus
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

export interface HardwareInfo {
  ramTotalGb: number
  ramFreeGb: number
  ramOk: boolean
  diskFreeGb: number
  diskOk: boolean
  gpuName: string | null
}

export interface SetupProgressEvent {
  step: 'whisper' | 'llm' | 'runtime'
  label: string
  ratio: number
}

export interface AppInfo {
  version: string
  appName: string
  appDataRoot: string
  projectsRoot: string
  cacheDir: string
  tempDir: string
  logsDir: string
  catalogPath: string
  platform: string
  lastProjectId: string | null
  ffmpegReady: boolean
  ffprobeReady: boolean
  whisperReady: boolean
  whisperModelReady: boolean
  whisperModel: WhisperModelId
  openaiKeySet: boolean
  openaiKeyMasked: string | null
  localRuntimeReady: boolean
  localLlmReady: boolean
  localLlmLabel: string
  localLlmSizeLabel: string
  hardware: HardwareInfo
}

export interface CreateProjectInput {
  name: string
  aiMode: AiMode
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface DeletedProject {
  id: string
  name: string
  deletedPath: string
}

export interface PipelineStage {
  stage: PipelineStageName
  status: StageStatus
  artifactPath: string | null
  inputHash: string | null
  errorCode: string | null
  errorMessage: string | null
  progress: number
  startedAt: string | null
  finishedAt: string | null
}

export interface VideoItem {
  id: string
  projectId: string
  displayName: string
  sourcePath: string
  fileName: string
  sizeBytes: number | null
  durationSec: number | null
  width: number | null
  height: number | null
  container: string | null
  videoCodec: string | null
  audioCodec: string | null
  playableInApp: boolean
  sourceExists: boolean
  status: VideoStatus
  currentStageLabel: string | null
  progress: number
  stages: PipelineStage[]
  mediaUrl: string | null
  hasTranscript: boolean
  hasAnalysis: boolean
  analysisStale: boolean
  hasRetell: boolean
  retellStale: boolean
  hasVisuals: boolean
  createdAt: string
  updatedAt: string
}

export interface TranscriptSegment {
  id: string
  start: number
  end: number
  text: string
  originalText: string
  edited: boolean
}

export interface TranscriptDocument {
  videoId: string
  language: string
  model: string
  analysisStale: boolean
  retellStale: boolean
  /** Сплошной текст для пользователя. Сегменты с таймкодами хранятся отдельно «под капотом». */
  bodyText: string | null
  segments: TranscriptSegment[]
  updatedAt: string
}

export interface AnalysisBlock {
  id: string
  start: number
  end: number
  title: string
  theses: string[]
  segmentIds: string[]
}

export interface AnalysisDocument {
  videoId: string
  provider: string
  model: string
  blocks: AnalysisBlock[]
  createdAt: string
  updatedAt: string
}

export type VisualSource = 'transcript' | 'scene' | 'sample'

export interface VisualItem {
  id: string
  videoId: string
  start: number
  fileName: string
  imageUrl: string | null
  description: string
  source: VisualSource
}

export interface VisualDocument {
  videoId: string
  items: VisualItem[]
  sourceUpdatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface RetellDocument {
  videoId: string
  provider: string
  model: string
  text: string
  sourceUpdatedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface OpenAiKeyStatus {
  set: boolean
  masked: string | null
}

export interface SearchHit {
  videoId: string
  videoName: string
  start: number
  end: number
  snippet: string
  explanation: string
  score: number
  rank: number
}

export interface SearchResponse {
  hits: SearchHit[]
  mode: 'semantic' | 'lexical'
  warning: string | null
}

export interface PipelineProgressEvent {
  projectId: string
  videoId: string
  stage: PipelineStageName | null
  status: VideoStatus
  progress: number
  label: string
  etaSec?: number | null
  etaLabel?: string | null
  errorMessage?: string
}

export interface TaimioApi {
  getAppInfo: () => Promise<Result<AppInfo>>
  listProjects: () => Promise<Result<ProjectSummary[]>>
  createProject: (input: CreateProjectInput) => Promise<Result<ProjectSummary>>
  openProject: (id: string) => Promise<Result<ProjectSummary>>
  deleteProject: (id: string) => Promise<Result<DeletedProject>>
  listVideos: (projectId: string) => Promise<Result<VideoItem[]>>
  importVideos: (projectId: string, filePaths: string[]) => Promise<Result<VideoItem[]>>
  pickVideoFiles: () => Promise<Result<string[]>>
  renameVideo: (projectId: string, videoId: string, displayName: string) => Promise<Result<VideoItem>>
  deleteVideo: (projectId: string, videoId: string) => Promise<Result<{ id: string }>>
  relinkVideo: (projectId: string, videoId: string) => Promise<Result<VideoItem>>
  startPipeline: (projectId: string, videoId: string, options?: { forceStt?: boolean }) =>
    Promise<Result<VideoItem>>
  cancelPipeline: (projectId: string, videoId: string) => Promise<Result<VideoItem>>
  getTranscript: (projectId: string, videoId: string) => Promise<Result<TranscriptDocument | null>>
  saveTranscript: (
    projectId: string,
    videoId: string,
    bodyText: string
  ) => Promise<Result<TranscriptDocument>>
  rebuildAnalysis: (projectId: string, videoId: string) => Promise<Result<AnalysisDocument>>
  getAnalysis: (projectId: string, videoId: string) => Promise<Result<AnalysisDocument | null>>
  rebuildRetell: (projectId: string, videoId: string) => Promise<Result<RetellDocument>>
  getRetell: (projectId: string, videoId: string) => Promise<Result<RetellDocument | null>>
  getVisuals: (projectId: string, videoId: string) => Promise<Result<VisualDocument | null>>
  rebuildVisuals: (projectId: string, videoId: string) => Promise<Result<VisualDocument>>
  exportOutlineDocx: (
    projectId: string,
    videoIds: string[],
    kind?: 'plan' | 'conspect'
  ) => Promise<Result<{ canceled: boolean; path: string | null }>>
  exportTranscriptDocx: (
    projectId: string,
    videoIds: string[]
  ) => Promise<Result<{ canceled: boolean; path: string | null }>>
  exportReportDocx: (
    projectId: string,
    videoIds: string[]
  ) => Promise<Result<{ canceled: boolean; path: string | null }>>
  setProjectAiMode: (projectId: string, aiMode: AiMode) => Promise<Result<ProjectSummary>>
  getOpenAiKeyStatus: () => Promise<Result<OpenAiKeyStatus>>
  setOpenAiKey: (apiKey: string) => Promise<Result<OpenAiKeyStatus>>
  clearOpenAiKey: () => Promise<Result<OpenAiKeyStatus>>
  testOpenAiKey: (apiKey?: string) => Promise<Result<{ ok: true }>>
  searchProject: (
    projectId: string,
    query: string,
    videoId?: string | null
  ) => Promise<Result<SearchResponse>>
  getLicenseStatus: () => Promise<Result<{ snapshot: LicenseSnapshot; capabilities: LicenseCapabilities }>>
  activateAccessKey: (accessKey: string) => Promise<Result<{ snapshot: LicenseSnapshot; capabilities: LicenseCapabilities }>>
  refreshAccessKey: () => Promise<Result<{ snapshot: LicenseSnapshot; capabilities: LicenseCapabilities }>>
  setWhisperModel: (model: WhisperModelId) => Promise<Result<AppInfo>>
  downloadWhisperModel: (model?: WhisperModelId) => Promise<Result<AppInfo>>
  downloadLocalLlm: () => Promise<Result<AppInfo>>
  installLocalStack: () => Promise<Result<AppInfo>>
  onSetupProgress: (handler: (event: SetupProgressEvent) => void) => () => void
  openExternalPath: (targetPath: string) => Promise<Result<boolean>>
  openExternalUrl: (url: string) => Promise<Result<boolean>>
  getPathForFile: (file: File) => string
  onPipelineProgress: (handler: (event: PipelineProgressEvent) => void) => () => void
  windowMinimize: () => Promise<void>
  windowMaximize: () => Promise<void>
  windowClose: () => Promise<void>
  windowIsMaximized: () => Promise<boolean>
  openPath: (targetPath: string) => Promise<Result<boolean>>
}
