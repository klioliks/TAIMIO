import { createReadStream, existsSync, statSync } from 'fs'
import { extname } from 'path'
import { Readable } from 'stream'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/x-m4v',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.ogv': 'video/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp'
}

export function serveLocalMedia(filePath: string, request: Request): Response {
  if (!existsSync(filePath)) {
    return new Response('Файл не найден', { status: 404 })
  }

  const { size } = statSync(filePath)
  const mime = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  const range = request.headers.get('range')
  const match = range ? /bytes=(\d*)-(\d*)/.exec(range) : null

  let start = 0
  let end = size - 1
  let status = 200
  if (match) {
    start = match[1] ? Number(match[1]) : 0
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= size || start > end) {
      return new Response(null, {
        status: 416,
        headers: {
          'Content-Range': `bytes */${size}`,
          'Accept-Ranges': 'bytes'
        }
      })
    }
    end = Math.min(end, size - 1)
    status = 206
  }

  const stream = createReadStream(filePath, { start, end })
  const headers: Record<string, string> = {
    'Content-Type': mime,
    'Content-Length': String(end - start + 1),
    'Accept-Ranges': 'bytes'
  }
  if (status === 206) {
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }

  return new Response(Readable.toWeb(stream) as ReadableStream, { status, headers })
}
