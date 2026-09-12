import { ADMIN_KEY_PREFIX } from '../../shared/accessConfig'
import { decodeBase32, encodeBase32, groupChars, looksLikeAdminKey, normalizeTypedKey } from '../../shared/accessCodec'
import { verifyWithAppPublicKey } from './ed25519'

const PAYLOAD_LEN = 16
const SIG_LEN = 64
const KIND_ADMIN = 0xad

export interface AdminKeyPayload {
  serial: number
  nonce: string
  signature: Uint8Array
}

export function parseAdminKey(raw: string): AdminKeyPayload {
  const typed = normalizeTypedKey(raw)
  if (!looksLikeAdminKey(typed)) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  const body = typed.slice(ADMIN_KEY_PREFIX.length)
  const bytes = decodeBase32(body)
  if (bytes.length < PAYLOAD_LEN + SIG_LEN) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  const payload = bytes.slice(0, PAYLOAD_LEN)
  const signature = bytes.slice(PAYLOAD_LEN, PAYLOAD_LEN + SIG_LEN)
  const serial = payload[2]
  if (payload[0] !== 1 || payload[1] !== KIND_ADMIN || serial < 1 || serial > 2) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  if (!verifyWithAppPublicKey(payload, signature)) {
    throw new Error('Такой ключ не найден. Проверьте правильность ввода.')
  }
  return {
    serial,
    nonce: Buffer.from(payload.slice(4)).toString('hex'),
    signature
  }
}

export function buildAdminPayload(serial: number, nonce: Uint8Array): Uint8Array {
  const payload = new Uint8Array(PAYLOAD_LEN)
  payload[0] = 1
  payload[1] = KIND_ADMIN
  payload[2] = serial
  payload.set(nonce.subarray(0, 12), 4)
  return payload
}

export function buildAdminKey(serial: number, nonce: Uint8Array, signature: Uint8Array): string {
  const payload = buildAdminPayload(serial, nonce)
  const blob = new Uint8Array(PAYLOAD_LEN + SIG_LEN)
  blob.set(payload, 0)
  blob.set(signature, PAYLOAD_LEN)
  return groupChars(ADMIN_KEY_PREFIX, encodeBase32(blob))
}

export function adminKeyId(serial: number): string {
  return `admin-${serial}`
}
