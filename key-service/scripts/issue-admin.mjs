import { createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = join(root, '..')
const issuedDir = join(root, 'issued')
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const PAYLOAD_LEN = 16
const SIG_LEN = 64
const KIND_ADMIN = 0xad

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

function maskAccessKey(value) {
  const parts = value.split('-').filter(Boolean)
  const last = parts[parts.length - 1] ?? '????'
  return `TAIMIO-AD-••••-••••-${last.slice(-4)}`
}

const privateB64 = readFileSync(join(root, 'secrets', 'ed25519-private.b64'), 'utf8').trim()
const privateKey = createPrivateKey({
  key: Buffer.from(privateB64, 'base64'),
  format: 'der',
  type: 'pkcs8'
})
const publicKey = createPublicKey(privateKey)
const appSource = readFileSync(join(repoRoot, 'src', 'shared', 'accessPublicKey.ts'), 'utf8')
const appPublic = appSource.match(/ACCESS_PUBLIC_KEY_B64 = "([^"]+)"/)?.[1]
const derivedPublic = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
if (!appPublic || derivedPublic !== appPublic) {
  throw new Error('Приватный ключ не совпадает с публичным ключом приложения.')
}

const keys = []
for (let serial = 1; serial <= 2; serial += 1) {
  const payload = new Uint8Array(PAYLOAD_LEN)
  payload[0] = 1
  payload[1] = KIND_ADMIN
  payload[2] = serial
  payload.set(randomBytes(12), 4)
  const signature = new Uint8Array(sign(null, Buffer.from(payload), privateKey))
  if (!verify(null, Buffer.from(payload), publicKey, Buffer.from(signature))) {
    throw new Error(`Не удалось проверить админский ключ ${serial}.`)
  }
  const blob = new Uint8Array(PAYLOAD_LEN + SIG_LEN)
  blob.set(payload, 0)
  blob.set(signature, PAYLOAD_LEN)
  const key = groupChars('TAIMIO-AD-', encodeBase32(blob))
  keys.push({ serial, key, keyMasked: maskAccessKey(key) })
}

const block = [
  '',
  '=== Admin (2) ===',
  'Без срока, без интернета, без привязки к устройству. Можно активировать на любом ПК.',
  ...keys.map((item) => `${item.serial}. ${item.key}`),
  ''
].join('\n')

const keysFile = join(issuedDir, 'KEYS.txt')
const manifestFile = join(issuedDir, 'MANIFEST.txt')
if (!existsSync(keysFile)) throw new Error('Сначала выпустите обычные ключи: npm run keys:issue')

const current = readFileSync(keysFile, 'utf8')
if (current.includes('=== Admin (2) ===')) {
  const next = current.replace(/\r?\n=== Admin \(2\) ===[\s\S]*$/, block.replace(/^\r?\n/, '\n'))
  writeFileSync(keysFile, next.endsWith('\n') ? next : `${next}\n`)
} else {
  writeFileSync(keysFile, `${current.trimEnd()}\n${block}`)
}

if (existsSync(manifestFile)) {
  const manifest = readFileSync(manifestFile, 'utf8')
  const adminLines = ['', 'Админ:', ...keys.map((item) => `${item.serial}. ${item.keyMasked}`), '']
  if (manifest.includes('Админ:')) {
    writeFileSync(
      manifestFile,
      manifest.replace(/\r?\nАдмин:[\s\S]*$/, `\n${adminLines.slice(1).join('\n')}\n`)
    )
  } else {
    writeFileSync(manifestFile, `${manifest.trimEnd()}\n${adminLines.join('\n')}\n`)
  }
}

console.log('Выпущено админских ключей:', keys.length)
console.log('Добавлены в:', keysFile)
console.log('Полные ключи в консоль не выводятся.')
