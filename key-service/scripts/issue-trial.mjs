import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..')
const issuedDir = join(root, 'issued')
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DURATION_DAYS = 5

function parseDevVars(text) {
  const out = {}
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 0) continue
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim()
  }
  return out
}

function randomGroup() {
  let out = ''
  for (let i = 0; i < 4; i += 1) out += ALPHABET[randomBytes(1)[0] % ALPHABET.length]
  return out
}

function maskAccessKey(value) {
  const parts = value.split('-').filter(Boolean)
  const last = parts[parts.length - 1] ?? '????'
  return `TAIMIO-••••-••••-${last.slice(-4)}`
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

const privateB64 = readFileSync(join(root, 'secrets', 'ed25519-private.b64'), 'utf8').trim()
const privateKey = createPrivateKey({
  key: Buffer.from(privateB64, 'base64'),
  format: 'der',
  type: 'pkcs8'
})
const derivedPublic = createPublicKey(privateKey)
  .export({ type: 'spki', format: 'der' })
  .toString('base64')
const appSource = readFileSync(join(repoRoot, 'src', 'shared', 'accessPublicKey.ts'), 'utf8')
const appPublic = appSource.match(/ACCESS_PUBLIC_KEY_B64 = "([^"]+)"/)?.[1]
if (!appPublic || derivedPublic !== appPublic) {
  throw new Error('Приватный ключ не совпадает с публичным ключом приложения.')
}

const vars = existsSync(join(root, '.dev.vars'))
  ? parseDevVars(readFileSync(join(root, '.dev.vars'), 'utf8'))
  : {}
const pepper = vars.ACCESS_PEPPER
if (!pepper) throw new Error('В key-service/.dev.vars нет ACCESS_PEPPER.')

const key = `TAIMIO-${randomGroup()}-${randomGroup()}-${randomGroup()}`
const item = {
  key,
  keyId: randomUUID(),
  keyHash: sha256Hex(`${pepper}:${key}`),
  keyMasked: maskAccessKey(key)
}
const now = new Date().toISOString()
const seed = [
  "-- Пробный ключ. Не удаляет Beta-ключи.",
  `INSERT OR REPLACE INTO access_keys (key_id, key_hash, key_masked, status, plan, created_at, duration_days, device_limit, notes) VALUES (${sql(item.keyId)}, ${sql(item.keyHash)}, ${sql(item.keyMasked)}, 'active', 'trial', ${sql(now)}, ${DURATION_DAYS}, 0, 'Пробный доступ 5 дней');`,
  ''
].join('\n')

const keysFile = join(issuedDir, 'KEYS.txt')
const manifestFile = join(issuedDir, 'MANIFEST.txt')
if (!existsSync(keysFile)) throw new Error('Сначала выпустите обычные ключи.')

writeFileSync(join(issuedDir, 'trial-seed.sql'), seed)

const block = [
  '',
  '=== Пробный доступ (1) ===',
  'Один ключ на всех. 5 дней считаются отдельно на каждом компьютере. Только онлайн.',
  `1. ${item.key}`,
  ''
].join('\n')

const current = readFileSync(keysFile, 'utf8')
if (current.includes('=== Пробный доступ (1) ===')) {
  writeFileSync(keysFile, current.replace(/\r?\n=== Пробный доступ \(1\) ===[\s\S]*$/, block.replace(/^\r?\n/, '\n')))
} else {
  writeFileSync(keysFile, `${current.trimEnd()}\n${block}`)
}

if (existsSync(manifestFile)) {
  const manifest = readFileSync(manifestFile, 'utf8')
  const line = `\nПробный:\n1. ${item.keyMasked}  ${item.keyId}\n`
  if (manifest.includes('Пробный:')) {
    writeFileSync(manifestFile, manifest.replace(/\r?\nПробный:[\s\S]*$/, line))
  } else {
    writeFileSync(manifestFile, `${manifest.trimEnd()}\n${line}`)
  }
}

console.log('Выпущен пробный ключ.')
console.log('Добавлен в:', keysFile)
console.log('Сиды D1:', join(issuedDir, 'trial-seed.sql'))
console.log('Полный ключ в консоль не выводится.')
