import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AppPaths } from './paths'
import { downloadFile } from './download'

export const WHISPER_MODELS = {
  small: {
    id: 'small',
    file: 'ggml-small.bin',
    label: 'small',
    sizeLabel: 'около 500 МБ',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin'
  },
  medium: {
    id: 'medium',
    file: 'ggml-medium.bin',
    label: 'medium',
    sizeLabel: 'около 1.5 ГБ',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin'
  }
} as const

export type WhisperModelId = keyof typeof WHISPER_MODELS

export const DEFAULT_WHISPER_MODEL: WhisperModelId = 'small'

export function resolveWhisperCli(): string | null {
  const candidates = [
    join(process.resourcesPath, 'whisper', 'whisper-cli.exe'),
    join(app.getAppPath(), 'resources', 'whisper-runtime', 'whisper-cli.exe'),
    join(process.cwd(), 'resources', 'whisper-runtime', 'whisper-cli.exe'),
    join(app.getAppPath(), '..', '..', 'resources', 'whisper-runtime', 'whisper-cli.exe')
  ]
  if (app.isPackaged) {
    const packaged = candidates[0]
    if (existsSync(packaged)) return packaged
  }
  return candidates.find((item) => existsSync(item)) ?? null
}

export function modelPath(paths: AppPaths, modelId: WhisperModelId = DEFAULT_WHISPER_MODEL): string {
  return join(paths.cacheDir, 'whisper', WHISPER_MODELS[modelId].file)
}

export function whisperStatus(
  paths: AppPaths,
  modelId: WhisperModelId = DEFAULT_WHISPER_MODEL
): { whisperReady: boolean; whisperModelReady: boolean; whisperModel: WhisperModelId } {
  return {
    whisperReady: Boolean(resolveWhisperCli()),
    whisperModelReady: existsSync(modelPath(paths, modelId)),
    whisperModel: modelId
  }
}

export function parseWhisperModel(value: string | null | undefined): WhisperModelId {
  return value === 'medium' ? 'medium' : DEFAULT_WHISPER_MODEL
}

export async function ensureWhisperModel(
  paths: AppPaths,
  modelId: WhisperModelId,
  onProgress?: (ratio: number) => void,
  shouldCancel?: () => boolean
): Promise<string> {
  const dest = modelPath(paths, modelId)
  if (existsSync(dest)) return dest
  const spec = WHISPER_MODELS[modelId]
  await downloadFile(spec.url, dest, onProgress, shouldCancel)
  return dest
}
