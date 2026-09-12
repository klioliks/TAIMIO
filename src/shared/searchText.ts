/** Совпадение по словам, не по куску внутри другого слова («ель» ≠ «внимательно»). */

export function wordsOf(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^a-zа-я0-9]+/i)
    .map((word) => word.trim())
    .filter(Boolean)
}

export function tokenMatchesWord(token: string, word: string): boolean {
  const t = token.toLowerCase().replace(/ё/g, 'е')
  const w = word.toLowerCase().replace(/ё/g, 'е')
  if (!t || !w) return false
  if (w === t) return true
  if (t.length >= 4 && w.startsWith(t)) return true
  if (w.length >= 4 && t.startsWith(w)) return true
  if (t.length === 3) {
    if (w.startsWith(t)) return true
    const root = t.slice(0, 2)
    if (w === `${root}и` || w === `${root}ей`) return true
    if (w.startsWith(`${root}ов`) || w.startsWith(`${root}к`)) return true
  }
  return false
}

export function queryTokens(query: string, stop: Set<string>): string[] {
  return wordsOf(query).filter((token) => token.length >= 3 && !stop.has(token))
}

export function textHasToken(text: string, token: string): boolean {
  return wordsOf(text).some((word) => tokenMatchesWord(token, word))
}

export function findWordOffset(body: string, query: string): number | null {
  const q = query.replace(/\s+/g, ' ').trim()
  if (!q || !body) return null
  const tokens = wordsOf(q).filter((token) => token.length >= 3)
  if (tokens.length === 0) return null

  const regex = /[a-zа-яё0-9]+/gi
  let match: RegExpExecArray | null
  while ((match = regex.exec(body)) != null) {
    const word = match[0]
    if (tokens.some((token) => tokenMatchesWord(token, word))) {
      return match.index
    }
  }
  return null
}
