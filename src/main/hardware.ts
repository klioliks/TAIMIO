import { execFile } from 'child_process'
import { statfs } from 'fs/promises'
import { totalmem, freemem } from 'os'
import { promisify } from 'util'
import type { HardwareInfo } from '../shared/types'

const execFileAsync = promisify(execFile)

const MIN_RAM_BYTES = 6 * 1024 * 1024 * 1024
const MIN_DISK_BYTES = 2.5 * 1024 * 1024 * 1024

function gb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024 * 1024)) * 10) / 10
}

async function detectGpu(): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(
      'nvidia-smi',
      ['--query-gpu=name,memory.total', '--format=csv,noheader'],
      { timeout: 2500, windowsHide: true }
    )
    const line = stdout.trim().split(/\r?\n/)[0]?.trim()
    return line || null
  } catch {
    return null
  }
}

export async function collectHardware(cacheDir: string): Promise<HardwareInfo> {
  const ramTotal = totalmem()
  const ramFree = freemem()
  let diskFree = 0
  try {
    const stats = await statfs(cacheDir)
    diskFree = Number(stats.bavail) * Number(stats.bsize)
  } catch {
    diskFree = 0
  }
  return {
    ramTotalGb: gb(ramTotal),
    ramFreeGb: gb(ramFree),
    ramOk: ramTotal >= MIN_RAM_BYTES,
    diskFreeGb: gb(diskFree),
    diskOk: diskFree >= MIN_DISK_BYTES,
    gpuName: await detectGpu()
  }
}
