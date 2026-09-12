import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { AnalysisBlock, AnalysisDocument, TranscriptDocument, TranscriptSegment } from '../shared/types'
import { displayTranscriptText } from '../shared/transcriptText'
import { chatJson } from './openaiProvider'

const CHUNK_CHARS = 12000
const DEFAULT_MODEL = 'gpt-4o-mini'

const SYSTEM = `Ты составляешь конспект видео только по расшифровке.
Не выдумывай факты, имена, цифры и выводы, которых нет в тексте.
Дели на смысловые темы, а не на случайные абзацы.
Верни JSON вида:
{"blocks":[{"start":0,"end":45,"title":"главная мысль","theses":["тезис 1","тезис 2"]}]}
start и end — секунды по таймкодам фрагментов. theses — 2–5 коротких пунктов.`

export function analysisPath(folderPath: string, videoId: string): string {
  return join(folderPath, 'videos', videoId, 'analysis', 'outline.json')
}

export function readAnalysisFile(folderPath: string, videoId: string): AnalysisDocument | null {
  const file = analysisPath(folderPath, videoId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as AnalysisDocument
  } catch {
    return null
  }
}

export function writeAnalysisFile(folderPath: string, videoId: string, doc: AnalysisDocument): void {
  const file = analysisPath(folderPath, videoId)
  mkdirSync(join(folderPath, 'videos', videoId, 'analysis'), { recursive: true })
  writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8')
}

function formatClock(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function chunkSegments(segments: TranscriptSegment[]): TranscriptSegment[][] {
  if (segments.length === 0) return []
  const chunks: TranscriptSegment[][] = []
  let current: TranscriptSegment[] = []
  let size = 0
  for (const segment of segments) {
    const next = segment.text.length + 16
    if (current.length > 0 && size + next > CHUNK_CHARS) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(segment)
    size += next
  }
  if (current.length) chunks.push(current)
  return chunks
}

function renderChunk(segments: TranscriptSegment[]): string {
  return segments
    .map((item) => `[${formatClock(item.start)}–${formatClock(item.end)}] ${item.text.trim()}`)
    .filter((line) => line.replace(/\[[^\]]+\]/g, '').trim())
    .join('\n')
}

function parseBlocks(raw: string, segments: TranscriptSegment[]): AnalysisBlock[] {
  let parsed: { blocks?: Array<{ start?: number; end?: number; title?: string; theses?: string[] }> }
  try {
    parsed = JSON.parse(raw) as typeof parsed
  } catch {
    throw new Error('Не удалось разобрать конспект. Попробуйте ещё раз.')
  }
  const blocks = Array.isArray(parsed.blocks) ? parsed.blocks : []
  const result: AnalysisBlock[] = []
  for (const item of blocks) {
    const start = Number(item.start)
    const end = Number(item.end)
    const title = String(item.title ?? '').replace(/\s+/g, ' ').trim()
    const theses = (item.theses ?? [])
      .map((line) => String(line).replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 8)
    if (!title || !Number.isFinite(start) || !Number.isFinite(end)) continue
    const from = Math.max(0, start)
    const to = Math.max(from, end)
    result.push({
      id: randomUUID(),
      start: from,
      end: to,
      title,
      theses,
      segmentIds: segments
        .filter((segment) => segment.start < to && segment.end > from)
        .map((segment) => segment.id)
    })
  }
  return result
}

export async function buildAnalysisDocument(
  transcript: TranscriptDocument,
  apiKey: string,
  model = DEFAULT_MODEL
): Promise<AnalysisDocument> {
  const text = displayTranscriptText(transcript).trim()
  if (!text) throw new Error('В расшифровке нет текста для конспекта.')

  const usable =
    transcript.segments.length > 0
      ? transcript.segments.filter((item) => item.text.trim())
      : [
          {
            id: 'body',
            start: 0,
            end: Math.max(1, text.length / 12),
            text,
            originalText: text,
            edited: false
          }
        ]

  const chunks = chunkSegments(usable)
  const blocks: AnalysisBlock[] = []
  for (const chunk of chunks) {
    const raw = await chatJson({
      apiKey,
      model,
      system: SYSTEM,
      user: `Составь конспект по этому фрагменту расшифровки:\n\n${renderChunk(chunk)}`
    })
    blocks.push(...parseBlocks(raw, usable))
  }

  if (blocks.length === 0) {
    throw new Error('Конспект получился пустым. Попробуйте ещё раз.')
  }

  const now = new Date().toISOString()
  return {
    videoId: transcript.videoId,
    provider: 'openai',
    model,
    blocks: blocks.sort((a, b) => a.start - b.start),
    createdAt: now,
    updatedAt: now
  }
}
