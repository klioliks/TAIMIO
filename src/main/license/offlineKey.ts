import { ACCESS_CONFIG, OFFLINE_KEY_PREFIX } from '../../shared/accessConfig'
import { decodeBase32, encodeBase32, groupChars, looksLikeOfflineKey, normalizeTypedKey } from '../../shared/accessCodec'
import { verifyWithAppPublicKey } from './ed25519'

const PAYLOAD_LEN = 16
const SIG_LEN = 64

export interface OfflineKeyPayload {
  serial: number
  durationDays: number
  nonce: string
  signature: Uint8Array
}

export function parseOfflineKey(raw: string): OfflineKeyPayload {
  const typed = normalizeTypedKey(raw)
  if (!looksLikeOfflineKey(typed)) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  const body = typed.slice(OFFLINE_KEY_PREFIX.length)
  const bytes = decodeBase32(body)
  if (bytes.length < PAYLOAD_LEN + SIG_LEN) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  const payload = bytes.slice(0, PAYLOAD_LEN)
  const signature = bytes.slice(PAYLOAD_LEN, PAYLOAD_LEN + SIG_LEN)
  if (payload[0] !== 1) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  const serial = payload[1]
  const durationDays = (payload[2] << 8) | payload[3]
  if (serial < 1 || serial > 3 || durationDays < 1) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  if (!verifyWithAppPublicKey(payload, signature)) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  return {
    serial,
    durationDays: durationDays || ACCESS_CONFIG.durationDays,
    nonce: Buffer.from(payload.slice(4)).toString('hex'),
    signature
  }
}

export function buildOfflinePayload(serial: number, durationDays: number, nonce: Uint8Array): Uint8Array {
  const payload = new Uint8Array(PAYLOAD_LEN)
  payload[0] = 1
  payload[1] = serial
  payload[2] = (durationDays >> 8) & 255
  payload[3] = durationDays & 255
  payload.set(nonce.subarray(0, 12), 4)
  return payload
}

export function buildOfflineKey(serial: number, durationDays: number, nonce: Uint8Array, signature: Uint8Array): string {
  const payload = buildOfflinePayload(serial, durationDays, nonce)
  const blob = new Uint8Array(PAYLOAD_LEN + SIG_LEN)
  blob.set(payload, 0)
  blob.set(signature, PAYLOAD_LEN)
  return groupChars(OFFLINE_KEY_PREFIX, encodeBase32(blob))
}

export function offlineKeyId(serial: number): string {
  return `offline-${serial}`
}
