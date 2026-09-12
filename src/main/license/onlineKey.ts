import { ACCESS_CONFIG } from '../../shared/accessConfig'
import { looksLikeOnlineKey, normalizeTypedKey } from '../../shared/accessCodec'
import { verifyWithAppPublicKey } from './ed25519'

export interface ServerAccessToken {
  payload: string
  signature: string
}

export interface ServerAccessClaims {
  keyId: string
  plan: 'beta'
  status: 'active' | 'blocked' | 'expired' | 'not_activated'
  expiresAt: string | null
  activatedAt: string | null
  deviceId: string
  issuedAt: string
  v: 1
}

export class AccessClientError extends Error {
  code: 'not_found' | 'other_device' | 'expired' | 'blocked' | 'network'

  constructor(code: AccessClientError['code'], message: string) {
    super(message)
    this.code = code
  }
}

export function normalizeOnlineKey(value: string): string {
  const typed = normalizeTypedKey(value)
  if (!looksLikeOnlineKey(typed)) {
    throw new AccessClientError('not_found', 'Такой ключ не найден. Проверьте правильность ввода.')
  }
  return typed
}

export function verifyServerToken(token: ServerAccessToken): ServerAccessClaims {
  const data = Buffer.from(token.payload, 'utf8')
  const signature = Buffer.from(token.signature, 'base64')
  if (!verifyWithAppPublicKey(data, signature)) {
    throw new AccessClientError('network', 'Не удалось подтвердить ответ сервера TAIMIO.')
  }
  const claims = JSON.parse(token.payload) as ServerAccessClaims
  if (claims.v !== 1 || !claims.keyId) {
    throw new AccessClientError('network', 'Не удалось подтвердить ответ сервера TAIMIO.')
  }
  return claims
}

function userMessage(code: string | undefined): AccessClientError {
  switch (code) {
    case 'not_found':
      return new AccessClientError('not_found', 'Такой ключ не найден. Проверьте правильность ввода.')
    case 'other_device':
      return new AccessClientError('other_device', 'Этот ключ уже активирован на другом устройстве.')
    case 'expired':
      return new AccessClientError('expired', 'Срок действия ключа закончился.')
    case 'blocked':
      return new AccessClientError('blocked', 'Этот ключ заблокирован.')
    default:
      return new AccessClientError(
        'network',
        'Не удалось связаться с сервером TAIMIO. Проверьте подключение к интернету и попробуйте снова.'
      )
  }
}

function keyServiceUrl(): string {
  const override = process.env.TAIMIO_KEY_SERVICE_URL?.trim()
  if (override) return override.replace(/\/$/, '')
  return ACCESS_CONFIG.keyServiceUrl
}

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  let response: Response
  try {
    response = await fetch(`${keyServiceUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'TAIMIO/0.1' },
      body: JSON.stringify(body)
    })
  } catch {
    throw userMessage('network')
  }
  let data: Record<string, unknown> = {}
  try {
    data = (await response.json()) as Record<string, unknown>
  } catch {
    throw userMessage('network')
  }
  if (!response.ok || data.ok === false) {
    throw userMessage(typeof data.code === 'string' ? data.code : 'network')
  }
  return data
}

export async function activateOnlineKey(input: {
  key: string
  deviceId: string
  appVersion: string
}): Promise<{ claims: ServerAccessClaims; token: ServerAccessToken }> {
  const key = normalizeOnlineKey(input.key)
  const data = await postJson('/v1/activate', {
    key,
    deviceId: input.deviceId,
    appVersion: input.appVersion
  })
  const token = data.token as ServerAccessToken | undefined
  if (!token?.payload || !token.signature) throw userMessage('network')
  return { claims: verifyServerToken(token), token }
}

export async function checkOnlineKey(input: {
  keyId: string
  deviceId: string
  appVersion: string
}): Promise<{ claims: ServerAccessClaims; token: ServerAccessToken }> {
  const data = await postJson('/v1/check', {
    keyId: input.keyId,
    deviceId: input.deviceId,
    appVersion: input.appVersion
  })
  const token = data.token as ServerAccessToken | undefined
  if (!token?.payload || !token.signature) throw userMessage('network')
  return { claims: verifyServerToken(token), token }
}
