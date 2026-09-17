import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const version = JSON.parse(readFileSync(join(root, '..', 'package.json'), 'utf8')).version

function formatBetaVersion(semver) {
  const match = String(semver)
    .trim()
    .match(/^(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return semver
  const patch = match[3] ?? '0'
  return patch === '0' ? `${match[1]}.${match[2]}` : `${match[1]}.${match[2]}.${patch}`
}

function run(command) {
  const result = spawnSync(command, { cwd: join(root, '..'), stdio: 'inherit', shell: true })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const mode = process.argv[2] ?? 'all'
const beta = formatBetaVersion(version)

if (mode === 'setup' || mode === 'all') {
  writeFileSync(
    join(root, '..', 'build', 'update-version.nsh'),
    `!ifndef TAIMIO_BETA_NEW\n  !define TAIMIO_BETA_NEW "${beta}"\n!endif\n`,
    'utf8'
  )
  const unpacked = join(root, '..', 'release', 'win-unpacked')
  if (existsSync(unpacked) && mode === 'setup') {
    run('npx electron-builder --win nsis --config electron-builder.setup.yml --prepackaged release/win-unpacked')
  } else {
    run('npm run build && npx electron-builder --win nsis --config electron-builder.setup.yml')
  }
}

if (mode === 'update' || mode === 'all') {
  writeFileSync(
    join(root, '..', 'build', 'update-version.nsh'),
    `!ifndef TAIMIO_BETA_NEW\n  !define TAIMIO_BETA_NEW "${beta}"\n!endif\n`,
    'utf8'
  )
  const unpacked = join(root, '..', 'release', 'win-unpacked')
  const prepackaged = existsSync(unpacked) ? ' --prepackaged release/win-unpacked' : ''
  if (!prepackaged) run('npm run build')
  run(`npx electron-builder --win nsis --config electron-builder.update.yml${prepackaged}`)
  const from = join(root, '..', 'release', `TAIMIO_Beta_Update_${version}.exe`)
  const to = join(root, '..', 'release', `TAIMIO_Beta_Update_${beta}.exe`)
  if (existsSync(from) && from !== to) renameSync(from, to)
}
