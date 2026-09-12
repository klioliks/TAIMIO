import type { AnalysisBlock, TranscriptSegment } from './types'
import { tokenMatchesWord, wordsOf } from './searchText'

const STOP = new Set([
  'и',
  'в',
  'во',
  'на',
  'с',
  'со',
  'по',
  'для',
  'это',
  'как',
  'его',
  'ее',
  'их',
  'они',
  'она',
  'он',
  'а',
  'но',
  'же',
  'то',
  'из',
  'к',
  'у',
  'о',
  'об',
  'от',
  'за',
  'при',
  'без',
  'или',
  'что',
  'чтобы',
  'быть',
  'есть',
  'все',
  'всё',
  'может',
  'также',
  'очень',
  'только',
  'уже',
  'ещё',
  'еще',
  'здесь',
  'там',
  'этот',
  'эта',
  'эти',
  'свой',
  'свои',
  'своей',
  'своего'
])

const CLOSING_GENERIC = new Set([
  'заключение',
  'подведение',
  'итогов',
  'итоги',
  'итог',
  'благодарность',
  'внимание',
  'спасибо',
  'прощание',
  'прощания',
  'пожелание',
  'пожелания',
  'хорошего',
  'хорошей',
  'вечера',
  'вечеру',
  'вечер',
  'отличного',
  'отличную',
  'отличный',
  'пока'
])

function meaningfulTokens(text: string): string[] {
  return wordsOf(text).filter((token) => token.length >= 3 && !STOP.has(token))
}

function looksLikeClosing(text: string): boolean {
  return /заключен|подведен|итог|благодар|прощан|пожелан|спасибо за вниман|хорошего вечер|отличн\w* вечер/i.test(
    text
  )
}

function isClosingTitle(title: string): boolean {
  return /^(заключение|прощание|итоги|финал|концовка)\b/i.test(title.trim())
}

function isBoilerplateClosing(text: string): boolean {
  if (!looksLikeClosing(text) && !isClosingTitle(text.split(/[.\n]/)[0] ?? '')) return false
  const tokens = meaningfulTokens(text)
  if (tokens.length === 0) return false
  return tokens.every((token) => CLOSING_GENERIC.has(token))
}

function spokenClosingScore(text: string): number {
  const lower = text.toLowerCase()
  let score = 0
  if (/спасибо/.test(lower)) score += 4
  if (/\bпока\b|до\s*свидан/.test(lower)) score += 3
  if (/к концу|закончил|заверш/.test(lower)) score += 2
  if (/вечер/.test(lower)) score += 2
  if (/внимание/.test(lower)) score += 1
  return score
}

function findSpokenClosing(segments: TranscriptSegment[]): TranscriptSegment | null {
  if (segments.length === 0) return null
  const end = segments[segments.length - 1].end
  const from = Math.max(0, end - Math.max(45, end * 0.25))
  const tail = segments.filter((segment) => segment.start >= from)
  let best: TranscriptSegment | null = null
  let bestScore = 0
  for (const segment of tail) {
    const score = spokenClosingScore(segment.text)
    if (score > bestScore) {
      bestScore = score
      best = segment
    }
  }
  return bestScore >= 2 ? best : null
}

export function outlineMatchScore(needle: string, haystack: string): number {
  const tokens = meaningfulTokens(needle)
  if (tokens.length === 0) return 0
  const words = wordsOf(haystack)
  if (words.length === 0) return 0
  let hits = 0
  for (const token of tokens) {
    if (words.some((word) => tokenMatchesWord(token, word))) hits += 1
  }
  return hits / tokens.length
}

export function findOutlineSeekTime(
  needle: string,
  segments: TranscriptSegment[]
): number | null {
  if (!needle.trim() || segments.length === 0) return null
  if (isBoilerplateClosing(needle)) {
    const closing = findSpokenClosing(segments)
    if (closing) return closing.start
  }

  let bestIndex = -1
  let bestScore = 0
  for (let index = 0; index < segments.length; index += 1) {
    const score = outlineMatchScore(needle, segments[index].text)
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }
  const tokens = meaningfulTokens(needle)
  const minScore = tokens.length <= 2 ? 0.5 : 0.34
  if (bestIndex < 0 || bestScore < minScore) {
    if (looksLikeClosing(needle) || isClosingTitle(needle)) {
      const closing = findSpokenClosing(segments)
      if (closing) return closing.start
    }
    return null
  }
  return segments[bestIndex].start
}

function nearestSegment(seconds: number, segments: TranscriptSegment[]): TranscriptSegment {
  let best = segments[0]
  let bestDist = Math.abs(best.start - seconds)
  for (const segment of segments) {
    const dist = Math.abs(segment.start - seconds)
    if (dist < bestDist) {
      best = segment
      bestDist = dist
    }
  }
  return best
}

function snapToSegment(block: AnalysisBlock, segment: TranscriptSegment): AnalysisBlock {
  return {
    ...block,
    start: segment.start,
    end: segment.end,
    segmentIds: [segment.id]
  }
}

/** Привязывает блок конспекта к реальным сегментам расшифровки по тексту. */
export function rematchOutlineBlock(
  block: AnalysisBlock,
  segments: TranscriptSegment[]
): AnalysisBlock | null {
  if (segments.length === 0) return block
  const query = `${block.title}. ${block.theses.join(' ')}`
  if (isBoilerplateClosing(query)) {
    const closing = findSpokenClosing(segments)
    return closing ? snapToSegment(block, closing) : null
  }

  const scored = segments
    .map((segment) => ({ segment, score: outlineMatchScore(query, segment.text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)

  if (scored.length === 0 || scored[0].score < 0.25) {
    if (looksLikeClosing(query) || isClosingTitle(block.title)) {
      const closing = findSpokenClosing(segments)
      if (closing) return snapToSegment(block, closing)
    }
    const nearest = nearestSegment(block.start, segments)
    return {
      ...block,
      start: nearest.start,
      end: Math.max(nearest.end, block.end),
      segmentIds: [nearest.id]
    }
  }

  const best = scored[0]
  const related = scored
    .filter(
      (item) =>
        item.score >= Math.max(0.25, best.score * 0.55) &&
        Math.abs(item.segment.start - best.segment.start) <= 75
    )
    .sort((a, b) => a.segment.start - b.segment.start)

  const first = related[0].segment
  const last = related[related.length - 1].segment
  return {
    ...block,
    start: first.start,
    end: Math.max(first.end, last.end),
    segmentIds: related.map((item) => item.segment.id)
  }
}

export function rematchOutlineBlocks(
  blocks: AnalysisBlock[],
  segments: TranscriptSegment[]
): AnalysisBlock[] {
  return blocks
    .map((block) => rematchOutlineBlock(block, segments))
    .filter((block): block is AnalysisBlock => block != null)
    .sort((a, b) => a.start - b.start)
}
