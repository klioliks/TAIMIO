import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, statSync } from 'fs'
import { basename, dirname, extname } from 'path'
import { getFfmpegPath, getFfprobePath } from './ffmpegPaths'

export interface ProbeResult {
  durationSec: number | null
  width: number | null
  height: number | null
  container: string | null
  videoCodec: string | null
  audioCodec: string | null
  sizeBytes: number
  playableInApp: boolean
  fileName: string
  inputHash: string
}

export class CancelledError extends Error {
  constructor() {
    super('Операция отменена.')
    this.name = 'CancelledError'
  }
}

const active = new Map<string, ChildProcessWithoutNullStreams>()

export function cancelJob(jobId: string): boolean {
  const child = active.get(jobId)
  if (!child) return false
  child.kill('SIGTERM')
  active.delete(jobId)
  return true
}

export function sourceFingerprint(filePath: string): string {
  const stat = statSync(filePath)
  return createHash('sha1')
    .update(`${filePath}|${stat.size}|${stat.mtimeMs}`)
    .digest('hex')
}

function isPlayable(container: string | null, videoCodec: string | null): boolean {
  const ext = (container || '').toLowerCase()
  const codec = (videoCodec || '').toLowerCase()
  const okContainer = ['mp4', 'webm', 'mov', 'm4v', 'ogg'].includes(ext)
  if (!okContainer) return false
  if (!codec) return okContainer
  return ['h264', 'avc1', 'vp8', 'vp9', 'av1', 'theora'].some((item) => codec.includes(item))
}

export function runProcess(
  jobId: string,
  bin: string,
  args: string[],
  onOutput?: (chunk: string) => void,
  options?: { cwd?: string }
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, cwd: options?.cwd })
    active.set(jobId, child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8')
      stdout += text
      onOutput?.(text)
    })
    child.stderr.on('data', (buf: Buffer) => {
      const text = buf.toString('utf8')
      stderr += text
      onOutput?.(text)
    })
    child.on('error', (error) => {
      active.delete(jobId)
      reject(error)
    })
    child.on('close', (code, signal) => {
      active.delete(jobId)
      if (signal === 'SIGTERM' || signal === 'SIGKILL') {
        reject(new CancelledError())
        return
      }
      resolve({ code, stdout, stderr })
    })
  })
}

export async function probeMedia(jobId: string, filePath: string): Promise<ProbeResult> {
  if (!existsSync(filePath)) {
    throw new Error('Исходный видеофайл не найден. Укажите файл заново.')
  }
  const ffprobe = getFfprobePath()
  if (!ffprobe) {
    throw new Error('FFprobe не найден. Переустановите TAIMIO или проверьте компоненты.')
  }

  const result = await runProcess(jobId, ffprobe, [
    '-v',
    'quiet',
    '-print_format',
    'json',
    '-show_format',
    '-show_streams',
    filePath
  ])

  if (result.code !== 0) {
    throw new Error('Не удалось прочитать метаданные видео.')
  }

  const json = JSON.parse(result.stdout) as {
    format?: { duration?: string; format_name?: string; size?: string }
    streams?: Array<{
      codec_type?: string
      codec_name?: string
      width?: number
      height?: number
    }>
  }

  const videoStream = json.streams?.find((s) => s.codec_type === 'video')
  const audioStream = json.streams?.find((s) => s.codec_type === 'audio')
  const formatName = json.format?.format_name?.split(',')[0] || extname(filePath).replace('.', '') || null
  const container = formatName ? formatName.toLowerCase() : extname(filePath).replace('.', '').toLowerCase() || null
  const videoCodec = videoStream?.codec_name || null
  const size = Number(json.format?.size) || statSync(filePath).size
  const duration = json.format?.duration ? Number(json.format.duration) : null

  return {
    durationSec: Number.isFinite(duration) ? duration : null,
    width: videoStream?.width ?? null,
    height: videoStream?.height ?? null,
    container,
    videoCodec,
    audioCodec: audioStream?.codec_name || null,
    sizeBytes: size,
    playableInApp: isPlayable(container, videoCodec),
    fileName: basename(filePath),
    inputHash: sourceFingerprint(filePath)
  }
}

export interface ExtractAudioOptions {
  channel?: 0 | 1
  maxDurationSec?: number
}

export async function extractAudio(
  jobId: string,
  inputPath: string,
  outputPath: string,
  onProgress?: (ratio: number) => void,
  durationSec?: number | null,
  options?: ExtractAudioOptions
): Promise<void> {
  if (!existsSync(inputPath)) {
    throw new Error('Исходный видеофайл не найден. Укажите файл заново.')
  }
  const ffmpeg = getFfmpegPath()
  if (!ffmpeg) {
    throw new Error('FFmpeg не найден. Переустановите TAIMIO или проверьте компоненты.')
  }

  mkdirSync(dirname(outputPath), { recursive: true })
  const channel = options?.channel ?? 0
  const pan = `pan=mono|c0=c${channel}`
  const normalize = 'highpass=f=80,loudnorm=I=-16:TP=-1.5:LRA=11'
  const args = ['-y']
  if (options?.maxDurationSec && options.maxDurationSec > 0) {
    args.push('-t', String(options.maxDurationSec))
  }
  args.push(
    '-i',
    inputPath,
    '-vn',
    '-af',
    `${pan},${normalize}`,
    '-ar',
    '16000',
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    outputPath
  )

  let lastEmit = 0
  const result = await runProcess(jobId, ffmpeg, args, (chunk) => {
    if (!durationSec || durationSec <= 0 || !onProgress) return
    const match = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(chunk)
    if (!match) return
    const hours = Number(match[1])
    const minutes = Number(match[2])
    const seconds = Number(match[3])
    const current = hours * 3600 + minutes * 60 + seconds
    const now = Date.now()
    if (now - lastEmit < 400) return
    lastEmit = now
    onProgress(Math.max(0, Math.min(0.99, current / durationSec)))
  })

  if (result.code !== 0) {
    throw new Error('Не удалось извлечь аудио из видео.')
  }
  if (!existsSync(outputPath)) {
    throw new Error('Аудиофайл не был создан.')
  }
}

export async function extractFrame(
  jobId: string,
  inputPath: string,
  outputPath: string,
  seconds: number
): Promise<void> {
  if (!existsSync(inputPath)) {
    throw new Error('Исходный видеофайл не найден. Укажите файл заново.')
  }
  const ffmpeg = getFfmpegPath()
  if (!ffmpeg) {
    throw new Error('FFmpeg не найден. Переустановите TAIMIO или проверьте компоненты.')
  }
  mkdirSync(dirname(outputPath), { recursive: true })
  const result = await runProcess(jobId, ffmpeg, [
    '-y',
    '-ss',
    String(Math.max(0, seconds)),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-q:v',
    '3',
    outputPath
  ])
  if (result.code !== 0 || !existsSync(outputPath)) {
    throw new Error('Не удалось сохранить кадр из видео.')
  }
}

export async function detectSceneCuts(
  jobId: string,
  inputPath: string,
  durationSec?: number | null
): Promise<number[]> {
  const ffmpeg = getFfmpegPath()
  if (!ffmpeg || !existsSync(inputPath)) return []
  const args = ['-hide_banner', '-an']
  if (durationSec && durationSec > 40 * 60) {
    args.push('-t', String(40 * 60))
  }
  args.push('-i', inputPath, '-vf', "fps=2,select='gt(scene,0.28)',showinfo", '-f', 'null', '-')
  try {
    const result = await runProcess(jobId, ffmpeg, args)
    const times: number[] = []
    const blob = `${result.stderr}\n${result.stdout}`
    const regex = /pts_time:(\d+(?:\.\d+)?)/g
    let match: RegExpExecArray | null
    while ((match = regex.exec(blob)) != null) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value >= 0) times.push(value)
    }
    return times
  } catch {
    return []
  }
}

export async function probeAudioChannels(jobId: string, inputPath: string): Promise<number> {
  const ffprobe = getFfprobePath()
  if (!ffprobe) return 1
  try {
    const result = await runProcess(`${jobId}:achannels`, ffprobe, [
      '-v',
      'error',
      '-select_streams',
      'a:0',
      '-show_entries',
      'stream=channels',
      '-of',
      'csv=p=0',
      inputPath
    ])
    const value = Number(String(result.stdout).trim().split(/\s|,/)[0])
    return Number.isFinite(value) && value > 0 ? value : 1
  } catch {
    return 1
  }
}
