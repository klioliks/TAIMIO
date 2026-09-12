import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'
import type { AppPaths } from '../paths'

function devicePath(paths: AppPaths): string {
  return join(paths.appDataRoot, 'secrets', 'device.bin')
}

export function getOrCreateDeviceId(paths: AppPaths): string {
  const file = devicePath(paths)
  if (existsSync(file) && safeStorage.isEncryptionAvailable()) {
    try {
      const value = safeStorage.decryptString(readFileSync(file)).trim()
      if (value) return value
    } catch {
      /* создадим заново */
    }
  }
  const id = randomUUID()
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Защищённое хранилище Windows недоступно.')
  }
  mkdirSync(join(paths.appDataRoot, 'secrets'), { recursive: true })
  writeFileSync(file, safeStorage.encryptString(id))
  return id
}
