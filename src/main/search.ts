import type { SearchHit, SearchResponse, TranscriptDocument } from '../shared/types'
import { embedTexts } from './openaiProvider'
import {
  ensureVideoIndex,
  hasEmbeddings,
  lexicalScore,
  scoreChunk,
  snippetOf,
  type VideoSearchIndex
} from './searchIndex'

const TOP_N = 6
const MIN_SCORE = 0.42

export async function searchTranscripts(options: {
  query: string
  items: Array<{ videoId: string; videoName: string; folderPath: string; transcript: TranscriptDocument }>
  apiKey: string | null
}): Promise<SearchResponse> {
  const query = options.query.replace(/\s+/g, ' ').trim()
  if (query.length < 2) {
    throw new Error('Введите запрос — хотя бы пару слов.')
  }

  const prepared: Array<{
    videoId: string
    videoName: string
    index: VideoSearchIndex
  }> = []
  const warnings: string[] = []

  for (const item of options.items) {
    const { index, embedError } = await ensureVideoIndex(
      item.folderPath,
      item.videoId,
      item.transcript,
      options.apiKey
    )
    if (embedError) warnings.push(embedError)
    if (index.chunks.length === 0) continue
    prepared.push({ videoId: item.videoId, videoName: item.videoName, index })
  }

  if (prepared.length === 0) {
    throw new Error('Нет расшифровок для поиска. Сначала распознайте речь.')
  }

  const canSemantic = Boolean(options.apiKey) && prepared.some((item) => hasEmbeddings(item.index))
  let queryEmbedding: number[] | null = null
  if (canSemantic && options.apiKey) {
    try {
      queryEmbedding = (await embedTexts(options.apiKey, [query]))[0] ?? null
    } catch (error) {
      warnings.push(error instanceof Error ? error.message : 'Не удалось понять запрос смыслом.')
    }
  }

  const mode: SearchResponse['mode'] = queryEmbedding ? 'semantic' : 'lexical'
  const scored: SearchHit[] = []

  for (const item of prepared) {
    for (const chunk of item.index.chunks) {
      const score = scoreChunk(chunk, query, queryEmbedding)
      if (score < MIN_SCORE) continue
      scored.push({
        videoId: item.videoId,
        videoName: item.videoName,
        start: chunk.start,
        end: chunk.end,
        snippet: snippetOf(chunk.text, query),
        explanation:
          lexicalScore(query, chunk.text) >= 0.35
            ? 'Здесь есть слова из запроса.'
            : 'Смысл этого места совпадает с запросом.',
        score,
        rank: 0
      })
    }
  }

  scored.sort((a, b) => b.score - a.score || a.start - b.start)
  const hits = scored.slice(0, TOP_N).map((hit, index) => ({ ...hit, rank: index + 1 }))

  return {
    hits,
    mode,
    warning: warnings[0] ?? (mode === 'lexical' && options.apiKey
      ? 'Смысловой индекс недоступен — ищем по словам.'
      : null)
  }
}
