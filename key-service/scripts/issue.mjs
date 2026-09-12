import { createHash, createPrivateKey, createPublicKey, randomBytes, randomUUID, sign, verify } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..')
const secretsDir = join(root, 'secrets')
const issuedDir = join(root, 'issued')
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const ONLINE_COUNT = 15
const OFFLINE_COUNT = 3
const DURATION_DAYS = 60
const PAYLOAD_LEN = 16
const SIG_LEN = 64

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

function encodeBase32(bytes) {
  let bits = 0
  let acc = 0
  let out = ''
  for (const byte of bytes) {
    acc = (acc << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(acc >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(acc << (5 - bits)) & 31]
  return out
}

function groupChars(prefix, body, size = 4) {
  const chunks = []
  for (let i = 0; i < body.length; i += size) chunks.push(body.slice(i, size + i))
  return `${prefix}${chunks.join('-')}`
}

function randomGroup() {
  let out = ''
  for (let i = 0; i < 4; i += 1) out += ALPHABET[randomBytes(1)[0] % ALPHABET.length]
  return out
}

function maskAccessKey(value) {
  const parts = value.split('-').filter(Boolean)
  const last = parts[parts.length - 1] ?? '????'
  const head = parts[1] === 'OF' ? 'TAIMIO-OF' : 'TAIMIO'
  return `${head}-••••-••••-${last.slice(-4)}`
}

function sha256Hex(value) {
  return createHash('sha256').update(value).digest('hex')
}

function sql(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}

function publicKeyFromApp() {
  const source = readFileSync(join(repoRoot, 'src', 'shared', 'accessPublicKey.ts'), 'utf8')
  const match = source.match(/ACCESS_PUBLIC_KEY_B64 = "([^"]+)"/)
  if (!match) throw new Error('Не найден публичный ключ в приложении.')
  return match[1]
}

const privateB64 = readFileSync(join(secretsDir, 'ed25519-private.b64'), 'utf8').trim()
const vars = existsSync(join(root, '.dev.vars'))
  ? parseDevVars(readFileSync(join(root, '.dev.vars'), 'utf8'))
  : {}
const pepper = vars.ACCESS_PEPPER
if (!pepper) throw new Error('В key-service/.dev.vars нет ACCESS_PEPPER.')

const privateKey = createPrivateKey({
  key: Buffer.from(privateB64, 'base64'),
  format: 'der',
  type: 'pkcs8'
})
const derivedPublic = createPublicKey(privateKey)
  .export({ type: 'spki', format: 'der' })
  .toString('base64')
const appPublic = publicKeyFromApp()
if (derivedPublic !== appPublic) {
  throw new Error('Приватный ключ не совпадает с публичным ключом приложения.')
}

function signBytes(data) {
  return new Uint8Array(sign(null, Buffer.from(data), privateKey))
}

const now = new Date().toISOString()
const online = []
const used = new Set()
while (online.length < ONLINE_COUNT) {
  const key = `TAIMIO-${randomGroup()}-${randomGroup()}-${randomGroup()}`
  if (used.has(key)) continue
  used.add(key)
  online.push({
    key,
    keyId: randomUUID(),
    keyHash: sha256Hex(`${pepper}:${key}`),
    keyMasked: maskAccessKey(key)
  })
}

const offline = []
for (let serial = 1; serial <= OFFLINE_COUNT; serial += 1) {
  const payload = new Uint8Array(PAYLOAD_LEN)
  payload[0] = 1
  payload[1] = serial
  payload[2] = (DURATION_DAYS >> 8) & 255
  payload[3] = DURATION_DAYS & 255
  payload.set(randomBytes(12), 4)
  const signature = signBytes(payload)
  if (!verify(null, Buffer.from(payload), derivedPublicKey(appPublic), Buffer.from(signature))) {
    throw new Error(`Не удалось проверить офлайн-ключ ${serial}.`)
  }
  const blob = new Uint8Array(PAYLOAD_LEN + SIG_LEN)
  blob.set(payload, 0)
  blob.set(signature, PAYLOAD_LEN)
  const key = groupChars('TAIMIO-OF-', encodeBase32(blob))
  offline.push({
    serial,
    key,
    keyMasked: maskAccessKey(key)
  })
}

function derivedPublicKey(b64) {
  return createPublicKey({
    key: Buffer.from(b64, 'base64'),
    format: 'der',
    type: 'spki'
  })
}

mkdirSync(issuedDir, { recursive: true })

const seed = [
  '-- Онлайн-ключи TAIMIO Beta. Офлайн-ключи сюда не входят.',
  'DELETE FROM access_keys;',
  ...online.map(
    (item) =>
      `INSERT INTO access_keys (key_id, key_hash, key_masked, status, plan, created_at, duration_days, device_limit, notes) VALUES (${sql(item.keyId)}, ${sql(item.keyHash)}, ${sql(item.keyMasked)}, 'not_activated', 'beta', ${sql(now)}, ${DURATION_DAYS}, 1, 'TAIMIO Beta');`
  ),
  ''
].join('\n')

const keysText = [
  'TAIMIO Beta — полные ключи доступа. Не коммитить, не класть в установщик, не слать в чат.',
  `Выпущено: ${now}`,
  `Срок: ${DURATION_DAYS} дней с первой активации.`,
  '',
  '=== Онлайн Beta (15) ===',
  'Первая активация через интернет. 1 устройство. Управление в админке Key Service.',
  ...online.map((item, index) => `${String(index + 1).padStart(2, '0')}. ${item.key}`),
  '',
  '=== Offline Beta (3) ===',
  'Активация без интернета. Копия на другой ПК допустима. Админка D1 ими не управляет.',
  ...offline.map((item) => `${item.serial}. ${item.key}`),
  ''
].join('\n')

const manifest = [
  'Маски ключей. Полные значения только в KEYS.txt.',
  '',
  'Онлайн:',
  ...online.map((item, index) => `${String(index + 1).padStart(2, '0')}. ${item.keyMasked}  ${item.keyId}`),
  '',
  'Офлайн:',
  ...offline.map((item) => `${item.serial}. ${item.keyMasked}`),
  ''
].join('\n')

writeFileSync(join(issuedDir, 'seed.sql'), seed)
writeFileSync(join(issuedDir, 'KEYS.txt'), keysText)
writeFileSync(join(issuedDir, 'MANIFEST.txt'), manifest)
writeFileSync(
  join(issuedDir, 'README.txt'),
  'Полные ключи в KEYS.txt. Папку issued/ не коммитить.\n'
)

console.log('Выпущено онлайн-ключей:', online.length)
console.log('Выпущено офлайн-ключей:', offline.length)
console.log('Файл ключей:', join(issuedDir, 'KEYS.txt'))
console.log('Сиды D1:', join(issuedDir, 'seed.sql'))
console.log('Полные ключи в консоль не выводятся.')
