import { existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import ffmpegPath from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'

function unpack(pathValue: string | null | undefined): string | null {
  if (!pathValue) return null
  if (app.isPackaged) {
    return pathValue.replace('app.asar', 'app.asar.unpacked')
  }
  return pathValue
}

export function getFfmpegPath(): string | null {
  const pathValue = unpack(typeof ffmpegPath === 'string' ? ffmpegPath : null)
  return pathValue && existsSync(pathValue) ? pathValue : null
}

export function getFfprobePath(): string | null {
  const pathValue = unpack(ffprobe?.path)
  return pathValue && existsSync(pathValue) ? pathValue : null
}

export function ffmpegStatus(): { ffmpegReady: boolean; ffprobeReady: boolean } {
  return {
    ffmpegReady: Boolean(getFfmpegPath()),
    ffprobeReady: Boolean(getFfprobePath())
  }
}

export function videoArtifactDir(projectFolder: string, videoId: string): string {
  return join(projectFolder, 'videos', videoId)
}
