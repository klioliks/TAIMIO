import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { TranscriptDocument, TranscriptSegment } from '../shared/types'
import { displayTranscriptText, isNonSpeechMark } from '../shared/transcriptText'
import { queryTokens, textHasToken, tokenMatchesWord } from '../shared/searchText'
import { embedTexts } from './openaiProvider'

const EMBED_MODEL = 'text-embedding-3-small'
const INDEX_VERSION = 'v3-segments'
const MERGE_SHORT = 48

export interface SearchChunk {
  id: string
  videoId: string
  start: number
  end: number
  text: string
  segmentIds: string[]
  embedding: number[] | null
}

export interface VideoSearchIndex {
  videoId: string
  transcriptHash: string
  embeddingModel: string | null
  chunks: SearchChunk[]
  updatedAt: string
}

const STOP = new Set([
  'и',
  'в',
  'во',
  'на',
  'по',
  'про',
  'о',
  'об',
  'от',
  'до',
  'за',
  'из',
  'к',
  'ко',
  'у',
  'с',
  'со',
  'а',
  'но',
  'или',
  'что',
  'это',
  'как',
  'где',
  'когда',
  'чтобы',
  'же',
  'ли',
  'бы',
  'не',
  'ни',
  'да',
  'там',
  'тут',
  'то',
  'той',
  'этот',
  'эта',
  'для',
  'после',
  'говорили',
  'говорил',
  'сказали',
  'было',
  'была',
  'были',
  'есть'
])

export function searchIndexPath(folderPath: string, videoId: string): string {
  return join(folderPath, 'videos', videoId, 'search', 'index.json')
}

export function transcriptHash(doc: TranscriptDocument): string {
  const body = displayTranscriptText(doc)
  return createHash('sha1').update(`${INDEX_VERSION}\n${doc.updatedAt}\n${body}`).digest('hex')
}

export function tokenize(text: string): string[] {
  return queryTokens(text, STOP)
}

function readIndex(folderPath: string, videoId: string): VideoSearchIndex | null {
  const file = searchIndexPath(folderPath, videoId)
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as VideoSearchIndex
  } catch {
    return null
  }
}

function writeIndex(folderPath: string, videoId: string, index: VideoSearchIndex): void {
  const file = searchIndexPath(folderPath, videoId)
  mkdirSync(join(folderPath, 'videos', videoId, 'search'), { recursive: true })
  writeFileSync(file, JSON.stringify(index, null, 2), 'utf8')
}

function usableSegments(doc: TranscriptDocument): TranscriptSegment[] {
  return doc.segments.filter((item) => {
    const text = item.text.replace(/\s+/g, ' ').trim()
    return text && !isNonSpeechMark(text)
  })
}

export function buildChunks(videoId: string, doc: TranscriptDocument): SearchChunk[] {
  const segments = usableSegments(doc)
  if (segments.length === 0) {
    const body = displayTranscriptText(doc).trim()
    if (!body) return []
    return [
      {
        id: randomUUID(),
        videoId,
        start: 0,
        end: 1,
        text: body.slice(0, 800),
        segmentIds: [],
        embedding: null
      }
    ]
  }

  const chunks: SearchChunk[] = []
  let bucket: TranscriptSegment[] = []

  const flush = (): void => {
    if (bucket.length === 0) return
    chunks.push({
      id: randomUUID(),
      videoId,
      start: bucket[0].start,
      end: bucket[bucket.length - 1].end,
      text: bucket.map((item) => item.text.replace(/\s+/g, ' ').trim()).join(' '),
      segmentIds: bucket.map((item) => item.id),
      embedding: null
    })
    bucket = []
  }

  for (const segment of segments) {
    const next = segment.text.replace(/\s+/g, ' ').trim()
    const currentLen = bucket.reduce((sum, item) => sum + item.text.length, 0)
    if (bucket.length > 0 && currentLen >= MERGE_SHORT) flush()
    bucket.push(segment)
    if (next.length >= MERGE_SHORT) flush()
  }
  flush()
  return chunks
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let left = 0
  let right = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i]
    left += a[i] * a[i]
    right += b[i] * b[i]
  }
  if (left <= 0 || right <= 0) return 0
  return dot / (Math.sqrt(left) * Math.sqrt(right))
}

export function lexicalScore(query: string, text: string): number {
  const q = tokenize(query)
  if (q.length === 0) return 0
  let hits = 0
  for (const token of q) {
    if (textHasToken(text, token)) hits += 1
  }
  return hits / q.length
}

export function hasEmbeddings(index: VideoSearchIndex): boolean {
  return Boolean(index.embeddingModel && index.chunks.some((chunk) => chunk.embedding?.length))
}

export async function ensureVideoIndex(
  folderPath: string,
  videoId: string,
  transcript: TranscriptDocument,
  apiKey: string | null
): Promise<{ index: VideoSearchIndex; embedError: string | null }> {
  const hash = transcriptHash(transcript)
  const existing = readIndex(folderPath, videoId)
  const chunksFresh = existing && existing.transcriptHash === hash ? existing.chunks : buildChunks(videoId, transcript)
  let index: VideoSearchIndex = {
    videoId,
    transcriptHash: hash,
    embeddingModel: existing?.transcriptHash === hash ? existing.embeddingModel : null,
    chunks: chunksFresh,
    updatedAt: new Date().toISOString()
  }

  const needEmbed =
    Boolean(apiKey) &&
    index.chunks.length > 0 &&
    (!hasEmbeddings(index) || index.embeddingModel !== EMBED_MODEL)

  if (!needEmbed) {
    if (!existing || existing.transcriptHash !== hash) writeIndex(folderPath, videoId, index)
    return { index, embedError: null }
  }

  try {
    const vectors = await embedTexts(
      apiKey as string,
      index.chunks.map((chunk) => chunk.text.slice(0, 2000)),
      EMBED_MODEL
    )
    index = {
      ...index,
      embeddingModel: EMBED_MODEL,
      chunks: index.chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] ?? null }))
    }
    writeIndex(folderPath, videoId, index)
    return { index, embedError: null }
  } catch (error) {
    writeIndex(folderPath, videoId, { ...index, embeddingModel: null })
    return {
      index,
      embedError: error instanceof Error ? error.message : 'Не удалось построить смысловой индекс.'
    }
  }
}

export function scoreChunk(
  chunk: SearchChunk,
  query: string,
  queryEmbedding: number[] | null
): number {
  const lexical = lexicalScore(query, chunk.text)
  if (queryEmbedding && chunk.embedding?.length) {
    const semantic = cosine(queryEmbedding, chunk.embedding)
    if (lexical >= 0.35) return Math.min(1, semantic * 0.4 + lexical * 0.6 + 0.12)
    if (semantic >= 0.78) return semantic
    return 0
  }
  return lexical >= 0.45 ? lexical : 0
}

export function snippetOf(text: string, query: string, max = 220): string {
  const compact = text.replace(/\s+/g, ' ').trim()
  if (compact.length <= max) return compact
  const tokens = tokenize(query)
  let at = 0
  const wordRe = /[a-zа-яё0-9]+/gi
  let found: RegExpExecArray | null
  scan: while ((found = wordRe.exec(compact)) != null) {
    for (const token of tokens) {
      if (tokenMatchesWord(token, found[0])) {
        at = found.index
        break scan
      }
    }
  }
  const start = Math.max(0, at - 40)
  const slice = compact.slice(start, start + max)
  return `${start > 0 ? '…' : ''}${slice}${start + max < compact.length ? '…' : ''}`
}
