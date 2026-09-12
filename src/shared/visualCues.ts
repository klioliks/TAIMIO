export type VisualCueKind = 'slide' | 'chart' | 'table' | 'scheme' | 'look'

const CUES: Array<{ kind: VisualCueKind; pattern: RegExp; label: string }> = [
  { kind: 'chart', pattern: /график|диаграмм/i, label: 'График или диаграмма' },
  { kind: 'slide', pattern: /слайд|презентац/i, label: 'Слайд' },
  { kind: 'table', pattern: /таблиц/i, label: 'Таблица' },
  { kind: 'scheme', pattern: /схем|чертёж|чертеж/i, label: 'Схема' },
  {
    kind: 'look',
    pattern: /посмотри|смотрите|смотри-ка|на экране|видите|вот это|посмотрите на/i,
    label: 'На это показывают'
  }
]

export function visualCueForText(text: string): { kind: VisualCueKind; label: string } | null {
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line) return null
  for (const cue of CUES) {
    if (cue.pattern.test(line)) return { kind: cue.kind, label: cue.label }
  }
  return null
}

export function shortenVisualNote(text: string, limit = 110): string {
  const line = text.replace(/\s+/g, ' ').trim()
  if (line.length <= limit) return line
  return `${line.slice(0, limit - 1).trim()}…`
}
