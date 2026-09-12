import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { TranscriptDocument, VisualDocument, VisualItem } from '../shared/types'
import { shortenVisualNote, visualCueForText } from '../shared/visualCues'
import { detectSceneCuts, extractFrame } from './media'
import { videoArtifactDir } from './ffmpegPaths'

const MAX_ITEMS = 18
const MIN_GAP = 2.4

export function visualsDir(folderPath: string, videoId: string): string {
  return join(videoArtifactDir(folderPath, videoId), 'visuals')
}

export function visualsPath(folderPath: string, videoId: string): string {
  return join(visualsDir(folderPath, videoId), 'index.json')
}

export function readVisualsFile(folderPath: string, videoId: string): VisualDocument | null {
  const file = visualsPath(folderPath, videoId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as VisualDocument
  } catch {
    return null
  }
}

export function writeVisualsFile(folderPath: string, videoId: string, doc: VisualDocument): void {
  mkdirSync(visualsDir(folderPath, videoId), { recursive: true })
  writeFileSync(visualsPath(folderPath, videoId), JSON.stringify(doc, null, 2), 'utf8')
}

function fileUrl(filePath: string): string {
  return `taimio://file/?p=${encodeURIComponent(filePath)}`
}

function withUrls(folderPath: string, videoId: string, doc: VisualDocument | null): VisualDocument | null {
  if (!doc) return null
  const dir = visualsDir(folderPath, videoId)
  return {
    ...doc,
    items: doc.items.map((item) => {
      const imagePath = join(dir, item.fileName)
      const url = existsSync(imagePath) ? fileUrl(imagePath) : null
      return { ...item, imageUrl: url }
    })
  }
}

export function readVisualsForUi(folderPath: string, videoId: string): VisualDocument | null {
  return withUrls(folderPath, videoId, readVisualsFile(folderPath, videoId))
}

function pushUnique(
  items: Array<{ start: number; source: VisualItem['source']; description: string }>,
  start: number,
  source: VisualItem['source'],
  description: string
): void {
  if (!Number.isFinite(start) || start < 0) return
  const rounded = Math.round(start * 10) / 10
  if (items.some((item) => Math.abs(item.start - rounded) < MIN_GAP)) return
  items.push({ start: rounded, source, description })
}

function collectCandidates(
  transcript: TranscriptDocument | null,
  durationSec: number | null,
  sceneTimes: number[]
): Array<{ start: number; source: VisualItem['source']; description: string }> {
  const found: Array<{ start: number; source: VisualItem['source']; description: string }> = []

  for (const segment of transcript?.segments ?? []) {
    const cue = visualCueForText(segment.text)
    if (!cue) continue
    pushUnique(found, segment.start, 'transcript', `${cue.label}: ${shortenVisualNote(segment.text)}`)
  }

  for (const time of sceneTimes) {
    pushUnique(found, time, 'scene', 'Смена кадра')
  }

  if (found.length < 4 && durationSec && durationSec > 8) {
    for (const ratio of [0.12, 0.34, 0.56, 0.78]) {
      pushUnique(found, durationSec * ratio, 'sample', 'Кадр из видео')
    }
  }

  return found.sort((a, b) => a.start - b.start).slice(0, MAX_ITEMS)
}

export async function buildVisualsDocument(options: {
  folderPath: string
  videoId: string
  sourcePath: string
  durationSec: number | null
  transcript: TranscriptDocument | null
}): Promise<VisualDocument> {
  const dir = visualsDir(options.folderPath, options.videoId)
  if (existsSync(dir)) {
    rmSync(dir, { recursive: true, force: true })
  }
  mkdirSync(dir, { recursive: true })

  const sceneTimes = await detectSceneCuts(
    `${options.videoId}:scenes`,
    options.sourcePath,
    options.durationSec
  )
  const candidates = collectCandidates(options.transcript, options.durationSec, sceneTimes)
  if (candidates.length === 0) {
    throw new Error('Не удалось найти кадры в этом видео.')
  }

  const items: VisualItem[] = []
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]
    const fileName = `frame-${String(index + 1).padStart(2, '0')}.jpg`
    const imagePath = join(dir, fileName)
    try {
      await extractFrame(
        `${options.videoId}:frame:${index}`,
        options.sourcePath,
        imagePath,
        candidate.start
      )
    } catch {
      continue
    }
    items.push({
      id: randomUUID(),
      videoId: options.videoId,
      start: candidate.start,
      fileName,
      imageUrl: fileUrl(imagePath),
      description: candidate.description,
      source: candidate.source
    })
  }

  if (items.length === 0) {
    throw new Error('Не удалось сохранить кадры из видео.')
  }

  const now = new Date().toISOString()
  const doc: VisualDocument = {
    videoId: options.videoId,
    items,
    sourceUpdatedAt: options.transcript?.updatedAt ?? null,
    createdAt: now,
    updatedAt: now
  }
  writeVisualsFile(options.folderPath, options.videoId, {
    ...doc,
    items: items.map((item) => ({ ...item, imageUrl: null }))
  })
  return doc
}
