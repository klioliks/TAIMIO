import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RetellDocument, TranscriptDocument } from '../shared/types'
import { displayTranscriptText } from '../shared/transcriptText'
import type { AiChatFn } from './aiChat'

const DEFAULT_MODEL = 'gpt-4o-mini'

const SYSTEM = `Ты пишешь краткий пересказ видео только по расшифровке.
Это не конспект и не план: не дроби текст на тезисы, разделы и таймкоды.
Составь связный компактный текст простым языком.
Передай основную мысль и ключевые события или идеи, без лишней детализации и без дословного повторения расшифровки.
Не выдумывай факты, имена, цифры и выводы, которых нет в тексте.
Обычно хватает одного–трёх коротких абзацев.`

export function retellPath(folderPath: string, videoId: string): string {
  return join(folderPath, 'videos', videoId, 'analysis', 'retell.json')
}

export function readRetellFile(folderPath: string, videoId: string): RetellDocument | null {
  const file = retellPath(folderPath, videoId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as RetellDocument
  } catch {
    return null
  }
}

export function writeRetellFile(folderPath: string, videoId: string, doc: RetellDocument): void {
  const file = retellPath(folderPath, videoId)
  mkdirSync(join(folderPath, 'videos', videoId, 'analysis'), { recursive: true })
  writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8')
}

function unwrapText(raw: string): string {
  const trimmed = raw.replace(/\s+\n/g, '\n').trim()
  if (!trimmed.startsWith('{')) return trimmed
  try {
    const parsed = JSON.parse(trimmed) as { text?: string; retell?: string; summary?: string }
    const text = parsed.text || parsed.retell || parsed.summary
    if (typeof text === 'string' && text.trim()) return text.trim()
  } catch {
    return trimmed
  }
  return trimmed
}

export async function buildRetellDocument(
  transcript: TranscriptDocument,
  chat: AiChatFn,
  meta: { provider: string; model?: string } = { provider: 'openai', model: DEFAULT_MODEL }
): Promise<RetellDocument> {
  const text = displayTranscriptText(transcript).trim()
  if (!text) throw new Error('В расшифровке нет текста для пересказа.')
  const clipped =
    text.length > 14000 ? `${text.slice(0, 10000)}\n\n[...]\n\n${text.slice(-3000)}` : text

  const raw = await chat({
    system: SYSTEM,
    user: `Прочитай расшифровку видео и напиши краткий пересказ.\n\n${clipped}`
  })
  const body = unwrapText(raw)
  if (!body) throw new Error('Пересказ получился пустым. Попробуйте ещё раз.')

  const now = new Date().toISOString()
  return {
    videoId: transcript.videoId,
    provider: meta.provider,
    model: meta.model ?? DEFAULT_MODEL,
    text: body,
    sourceUpdatedAt: transcript.updatedAt,
    createdAt: now,
    updatedAt: now
  }
}
