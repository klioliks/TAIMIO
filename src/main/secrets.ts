import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'
import type { AppPaths } from './paths'
import type { OpenAiKeyStatus } from '../shared/types'

function secretsDir(paths: AppPaths): string {
  return join(paths.appDataRoot, 'secrets')
}

function openAiKeyPath(paths: AppPaths): string {
  return join(secretsDir(paths), 'openai.bin')
}

export function maskSecret(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length <= 8) return '••••'
  return `${trimmed.slice(0, 3)}••••${trimmed.slice(-4)}`
}

export function readOpenAiKey(paths: AppPaths): string | null {
  const file = openAiKeyPath(paths)
  if (!existsSync(file)) return null
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Не удалось открыть защищённое хранилище Windows.')
  }
  const decrypted = safeStorage.decryptString(readFileSync(file))
  return decrypted.trim() || null
}

export function writeOpenAiKey(paths: AppPaths, apiKey: string): OpenAiKeyStatus {
  const trimmed = apiKey.trim()
  if (!trimmed) throw new Error('Введите API-ключ.')
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Защищённое хранилище Windows недоступно. Ключ нельзя сохранить.')
  }
  mkdirSync(secretsDir(paths), { recursive: true })
  writeFileSync(openAiKeyPath(paths), safeStorage.encryptString(trimmed))
  return { set: true, masked: maskSecret(trimmed) }
}

export function clearOpenAiKey(paths: AppPaths): OpenAiKeyStatus {
  const file = openAiKeyPath(paths)
  if (existsSync(file)) rmSync(file, { force: true })
  return { set: false, masked: null }
}

export function openAiKeyStatus(paths: AppPaths): OpenAiKeyStatus {
  try {
    const key = readOpenAiKey(paths)
    if (!key) return { set: false, masked: null }
    return { set: true, masked: maskSecret(key) }
  } catch {
    return { set: existsSync(openAiKeyPath(paths)), masked: existsSync(openAiKeyPath(paths)) ? '••••' : null }
  }
}
