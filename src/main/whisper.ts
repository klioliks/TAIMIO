import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs'
import { cpus } from 'os'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'
import type { TranscriptDocument, TranscriptSegment } from '../shared/types'
import { runProcess } from './media'
import { resolveWhisperCli, type WhisperModelId } from './whisperRuntime'

interface WhisperJson {
  transcription?: Array<{
    text?: string
    offsets?: { from?: number; to?: number }
    timestamps?: { from?: string; to?: string }
  }>
}

export interface SttProgress {
  ratio: number
  processedSec: number | null
  durationSec: number | null
}

function nowIso(): string {
  return new Date().toISOString()
}

function parseClock(h: string, m: string, s: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s)
}

function parsePercentProgress(chunk: string): number | null {
  const matches = [...chunk.matchAll(/progress\s*=\s*(\d+(?:\.\d+)?)\s*%/gi)]
  if (matches.length === 0) {
    const loose = [...chunk.matchAll(/(\d+(?:\.\d+)?)\s*%/g)]
    if (loose.length === 0) return null
    const value = Number(loose[loose.length - 1][1])
    if (!Number.isFinite(value)) return null
    return Math.max(0, Math.min(0.99, value / 100))
  }
  const value = Number(matches[matches.length - 1][1])
  if (!Number.isFinite(value)) return null
  return Math.max(0, Math.min(0.99, value / 100))
}

function parseTimestampProgress(
  chunk: string,
  durationSec: number | null
): { ratio: number; processedSec: number } | null {
  const matches = [
    ...chunk.matchAll(
      /\[(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)\s*-->\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)\]/g
    )
  ]
  if (matches.length === 0) return null
  const last = matches[matches.length - 1]
  const processedSec = parseClock(last[4], last[5], last[6])
  if (!Number.isFinite(processedSec)) return null
  if (!durationSec || durationSec <= 0) {
    return { ratio: 0, processedSec }
  }
  return {
    ratio: Math.max(0, Math.min(0.99, processedSec / durationSec)),
    processedSec
  }
}

function toSegments(json: WhisperJson): TranscriptSegment[] {
  return (json.transcription ?? [])
    .map((item) => {
      const text = String(item.text ?? '').replace(/\s+/g, ' ').trim()
      const startMs = Number(item.offsets?.from)
      const endMs = Number(item.offsets?.to)
      const start = Number.isFinite(startMs) ? startMs / 1000 : 0
      const end = Number.isFinite(endMs) ? endMs / 1000 : start
      return {
        id: randomUUID(),
        start,
        end: end >= start ? end : start,
        text,
        originalText: text,
        edited: false
      }
    })
    .filter((item) => item.text.length > 0)
}

export async function transcribeAudio(options: {
  jobId: string
  audioPath: string
  outputPrefix: string
  modelPath: string
  modelId: WhisperModelId
  language: string
  videoId: string
  durationSec?: number | null
  onProgress?: (progress: SttProgress) => void
}): Promise<TranscriptDocument> {
  const cli = resolveWhisperCli()
  if (!cli) {
    throw new Error('Компонент распознавания речи не найден. Переустановите TAIMIO.')
  }
  if (!existsSync(options.audioPath)) {
    throw new Error('Аудиофайл не найден. Сначала подготовьте видео.')
  }
  if (!existsSync(options.modelPath)) {
    throw new Error('Модель распознавания не найдена. Скачайте её в настройках.')
  }

  mkdirSync(dirname(options.outputPrefix), { recursive: true })
  const jsonPath = `${options.outputPrefix}.json`
  if (existsSync(jsonPath)) {
    try {
      unlinkSync(jsonPath)
    } catch {
      /* ignore */
    }
  }

  const threads = Math.max(2, Math.min(8, cpus().length || 4))
  let bestRatio = 0
  let processedSec: number | null = null

  const result = await runProcess(
    options.jobId,
    cli,
    [
      '-m',
      options.modelPath,
      '-f',
      options.audioPath,
      '-l',
      options.language,
      '-oj',
      '-of',
      options.outputPrefix,
      '-pp',
      '--no-gpu',
      '-nfa',
      '-bs',
      '1',
      '-bo',
      '1',
      '-t',
      String(threads)
    ],
    (chunk) => {
      const byPercent = parsePercentProgress(chunk)
      const byTime = parseTimestampProgress(chunk, options.durationSec ?? null)
      if (byTime) processedSec = byTime.processedSec
      const next = Math.max(bestRatio, byPercent ?? 0, byTime?.ratio ?? 0)
      if (next > bestRatio + 0.002 || (byTime && next >= bestRatio)) {
        bestRatio = next
        options.onProgress?.({
          ratio: bestRatio,
          processedSec,
          durationSec: options.durationSec ?? null
        })
      }
    },
    { cwd: dirname(cli) }
  )

  if (result.code !== 0) {
    const hint = result.stderr.slice(-400).trim()
    throw new Error(
      hint
        ? `Не удалось распознать речь. ${hint}`
        : 'Не удалось распознать речь. Попробуйте ещё раз.'
    )
  }
  if (!existsSync(jsonPath)) {
    throw new Error('Файл расшифровки не был создан.')
  }

  let parsed: WhisperJson
  try {
    parsed = JSON.parse(readFileSync(jsonPath, 'utf8')) as WhisperJson
  } catch {
    throw new Error('Не удалось прочитать результат распознавания.')
  }

  const segments = toSegments(parsed)
  return {
    videoId: options.videoId,
    language: options.language,
    model: options.modelId,
    analysisStale: false,
    retellStale: false,
    bodyText: null,
    segments,
    updatedAt: nowIso()
  }
}

export function transcriptPath(projectFolder: string, videoId: string): string {
  return join(projectFolder, 'videos', videoId, 'transcript', 'segments.json')
}

export function formatSttLabel(
  processedSec: number | null,
  durationSec: number | null,
  etaHint?: string | null
): string {
  const base =
    processedSec == null || durationSec == null || durationSec <= 0
      ? 'Распознаём речь'
      : (() => {
          const fmt = (sec: number): string => {
            const total = Math.max(0, Math.floor(sec))
            const m = Math.floor(total / 60)
            const s = total % 60
            return `${m}:${String(s).padStart(2, '0')}`
          }
          return `Распознаём речь · ${fmt(processedSec)} из ${fmt(durationSec)}`
        })()
  return etaHint ? `${base} · ${etaHint}` : base
}
