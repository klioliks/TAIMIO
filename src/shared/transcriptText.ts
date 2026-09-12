import type { TranscriptDocument, TranscriptSegment } from '../shared/types'
import { findWordOffset } from './searchText'

const NON_SPEECH =
  /^[\s([«"']*(весёлая\s+|фоновая\s+)?(музыка|music|тишина|шум|аплодисменты|смех|кашель)[\s)\]»"']*$/i

export function isNonSpeechMark(text: string): boolean {
  const trimmed = text.replace(/\s+/g, ' ').trim().replace(/^[\[(]+|[)\]]+$/g, '').trim()
  if (!trimmed) return true
  return NON_SPEECH.test(trimmed) || NON_SPEECH.test(text.replace(/\s+/g, ' ').trim())
}

export function speechScore(texts: string[]): number {
  let score = 0
  for (const raw of texts) {
    const text = raw.replace(/\s+/g, ' ').trim()
    if (!text || isNonSpeechMark(text)) {
      score -= 4
      continue
    }
    score += (text.match(/[а-яёa-z]{3,}/gi) || []).length
  }
  return score
}

export function joinTranscriptText(segments: TranscriptSegment[]): string {
  return segments
    .map((item) => item.text.replace(/\s+/g, ' ').trim())
    .filter((text) => text && !isNonSpeechMark(text))
    .join(' ')
}

export function findTextOffset(body: string, query: string): number | null {
  return findWordOffset(body, query)
}

export function displayTranscriptText(doc: TranscriptDocument | null | undefined): string {
  if (!doc) return ''
  if (doc.bodyText != null && doc.bodyText.length > 0) return doc.bodyText
  return joinTranscriptText(doc.segments)
}

/** По позиции в сплошном тексте (как join сегментов) находим сегмент для перемотки. */
export function segmentAtCharOffset(
  segments: TranscriptSegment[],
  offset: number
): TranscriptSegment | null {
  if (segments.length === 0) return null
  let cursor = 0
  for (let index = 0; index < segments.length; index += 1) {
    const text = segments[index].text.replace(/\s+/g, ' ').trim()
    if (!text) continue
    const start = cursor
    const end = cursor + text.length
    if (offset <= end || index === segments.length - 1) {
      return segments[index]
    }
    cursor = end + 1 // пробел-разделитель
    void start
  }
  return segments[segments.length - 1]
}

export function estimateTimeFromBodyOffset(
  doc: TranscriptDocument,
  offset: number,
  durationSec: number | null
): number {
  const body = displayTranscriptText(doc)
  if (!body) return 0
  const ratio = Math.max(0, Math.min(1, offset / Math.max(1, body.length)))
  if (doc.bodyText != null && doc.bodyText !== joinTranscriptText(doc.segments)) {
    if (durationSec != null && durationSec > 0) return ratio * durationSec
  }
  const segment = segmentAtCharOffset(doc.segments, offset)
  if (segment) return segment.start
  if (durationSec != null && durationSec > 0) return ratio * durationSec
  return 0
}
