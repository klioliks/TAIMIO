import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'
import type { AppPaths } from '../paths'
import type { AccessPlan, LicenseState } from '../../shared/license'

export interface AccessEnvelope {
  v: 1
  plan: AccessPlan
  keyId: string
  keyMasked: string
  activatedAt: string
  expiresAt: string | null
  deviceId: string
  lastCheckedAt: string
  lastTrustedLocalAt: string
  status: Extract<LicenseState, 'active' | 'blocked' | 'expired'>
  serverToken?: { payload: string; signature: string }
  offlineSerial?: number
}

function envelopePath(paths: AppPaths): string {
  return join(paths.appDataRoot, 'secrets', 'access.bin')
}

export function readAccessEnvelope(paths: AppPaths): AccessEnvelope | null {
  const file = envelopePath(paths)
  if (!existsSync(file)) return null
  if (!safeStorage.isEncryptionAvailable()) return null
  try {
    const parsed = JSON.parse(safeStorage.decryptString(readFileSync(file))) as AccessEnvelope
    if (parsed?.v !== 1 || !parsed.keyId) return null
    return parsed
  } catch {
    return null
  }
}

export function clearAccessEnvelope(paths: AppPaths): void {
  const file = envelopePath(paths)
  if (existsSync(file)) rmSync(file)
}

export function writeAccessEnvelope(paths: AppPaths, envelope: AccessEnvelope): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Защищённое хранилище Windows недоступно.')
  }
  mkdirSync(join(paths.appDataRoot, 'secrets'), { recursive: true })
  writeFileSync(envelopePath(paths), safeStorage.encryptString(JSON.stringify(envelope)))
}
