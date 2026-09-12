import { existsSync } from 'fs'
import { join } from 'path'
import type { AppPaths } from './paths'
import type { AiChatRequest } from './aiChat'
import { downloadFile } from './download'

export const LOCAL_LLM = {
  id: 'qwen2.5-1.5b-instruct',
  file: 'qwen2.5-1.5b-instruct-q4_k_m.gguf',
  label: 'Qwen2.5-1.5B Instruct',
  sizeLabel: 'около 1.1 ГБ',
  license: 'Apache 2.0',
  url: 'https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf'
} as const

type LlamaModule = typeof import('node-llama-cpp')
type LlamaInstance = Awaited<ReturnType<LlamaModule['getLlama']>>
type LlamaModelInstance = Awaited<ReturnType<LlamaInstance['loadModel']>>

interface LoadedLlm {
  modelPath: string
  llama: LlamaInstance
  model: LlamaModelInstance
}

let llamaModule: LlamaModule | null = null
let loaded: LoadedLlm | null = null
let loadQueue: Promise<LoadedLlm> | null = null

export function localLlmPath(paths: AppPaths): string {
  return join(paths.cacheDir, 'llm', LOCAL_LLM.file)
}

export function localLlmFileReady(paths: AppPaths): boolean {
  return existsSync(localLlmPath(paths))
}

async function loadLlamaModule(): Promise<LlamaModule> {
  if (llamaModule) return llamaModule
  llamaModule = await import('node-llama-cpp')
  return llamaModule
}

let runtimeOk: boolean | null = null

export async function localRuntimeReady(): Promise<boolean> {
  if (runtimeOk != null) return runtimeOk
  try {
    await loadLlamaModule()
    runtimeOk = true
  } catch {
    runtimeOk = false
  }
  return runtimeOk
}

export async function ensureLocalLlm(
  paths: AppPaths,
  onProgress?: (ratio: number) => void,
  shouldCancel?: () => boolean
): Promise<string> {
  const dest = localLlmPath(paths)
  if (existsSync(dest)) return dest
  await downloadFile(LOCAL_LLM.url, dest, onProgress, shouldCancel)
  return dest
}

async function ensureLoaded(paths: AppPaths): Promise<LoadedLlm> {
  const modelPath = localLlmPath(paths)
  if (!existsSync(modelPath)) {
    throw new Error('Сначала скачайте локальную языковую модель в настройках приложения.')
  }
  if (loaded?.modelPath === modelPath) return loaded
  if (loadQueue) return loadQueue

  loadQueue = (async () => {
    if (loaded) {
      await loaded.model.dispose()
      loaded = null
    }
    const nlc = await loadLlamaModule()
    const llama = await nlc.getLlama({ build: 'never' })
    const model = await llama.loadModel({ modelPath })
    loaded = { modelPath, llama, model }
    return loaded
  })()

  try {
    return await loadQueue
  } finally {
    loadQueue = null
  }
}

function extractJson(text: string): string {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  throw new Error('Локальная модель не вернула JSON. Попробуйте ещё раз.')
}

export async function localChat(paths: AppPaths, request: AiChatRequest): Promise<string> {
  const nlc = await loadLlamaModule()
  const sessionHost = await ensureLoaded(paths)
  const context = await sessionHost.model.createContext({ contextSize: 8192 })
  try {
    const session = new nlc.LlamaChatSession({
      contextSequence: context.getSequence(),
      systemPrompt: request.json
        ? `${request.system}\nОтветь только JSON-объектом, без пояснений и без markdown.`
        : request.system
    })
    const raw = await session.prompt(request.user, {
      maxTokens: request.json ? 1400 : 700,
      temperature: request.json ? 0.2 : 0.3
    })
    const text = String(raw ?? '').trim()
    if (!text) throw new Error('Локальная модель ничего не ответила.')
    return request.json ? extractJson(text) : text
  } finally {
    await context.dispose()
  }
}
