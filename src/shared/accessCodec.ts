import { ONLINE_KEY_RE } from './accessConfig'

/** Алфавит без 0/O/1/I, чтобы ключ было проще продиктовать. */
export const ACCESS_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function looksLikeOfflineKey(value: string): boolean {
  return value.toUpperCase().replace(/\s+/g, '').startsWith('TAIMIO-OF-')
}

export function looksLikeAdminKey(value: string): boolean {
  return value.toUpperCase().replace(/\s+/g, '').startsWith('TAIMIO-AD-')
}

export function looksLikeOnlineKey(value: string): boolean {
  return ONLINE_KEY_RE.test(normalizeTypedKey(value))
}

export function normalizeTypedKey(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '').replace(/[–—]/g, '-')
}

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0
  let acc = 0
  let out = ''
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ACCESS_ALPHABET[(acc >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ACCESS_ALPHABET[(acc << (5 - bits)) & 31]
  return out
}

export function decodeBase32(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[^A-Z2-9]/g, '')
  let bits = 0
  let acc = 0
  const out: number[] = []
  for (const char of clean) {
    const idx = ACCESS_ALPHABET.indexOf(char)
    if (idx < 0) continue
    acc = (acc << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

export function groupChars(prefix: string, body: string, size = 4): string {
  const chunks: string[] = []
  for (let i = 0; i < body.length; i += size) chunks.push(body.slice(i, i + size))
  return `${prefix}${chunks.join('-')}`
}

export function maskAccessKey(value: string): string {
  const parts = normalizeTypedKey(value).split('-').filter(Boolean)
  if (parts.length < 3) return 'TAIMIO-••••'
  const last = parts[parts.length - 1]
  const head = parts[1] === 'OF' ? 'TAIMIO-OF' : parts[1] === 'AD' ? 'TAIMIO-AD' : 'TAIMIO'
  return `${head}-••••-••••-${last.slice(-4)}`
}

export function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary)
}

export function base64ToBytes(value: string): Uint8Array {
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64'))
  const binary = atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}
