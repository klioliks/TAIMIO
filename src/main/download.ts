import { createWriteStream, mkdirSync, renameSync, unlinkSync, existsSync } from 'fs'
import { dirname } from 'path'
import https from 'https'
import http from 'http'

export class DownloadCancelledError extends Error {
  constructor() {
    super('Загрузка отменена.')
    this.name = 'DownloadCancelledError'
  }
}

export function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (ratio: number) => void,
  shouldCancel?: () => boolean
): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true })
  const tmpPath = `${destPath}.part`
  if (existsSync(tmpPath)) {
    try {
      unlinkSync(tmpPath)
    } catch {
      /* ignore */
    }
  }

  return new Promise((resolve, reject) => {
    const follow = (current: string, hops: number): void => {
      if (hops > 8) {
        reject(new Error('Слишком много переадресаций при загрузке.'))
        return
      }
      const client = current.startsWith('http://') ? http : https
      const req = client.get(
        current,
        {
          headers: { 'User-Agent': 'TAIMIO/0.1' }
        },
        (res) => {
          const code = res.statusCode ?? 0
          if (code >= 300 && code < 400 && res.headers.location) {
            const next = new URL(res.headers.location, current).toString()
            res.resume()
            follow(next, hops + 1)
            return
          }
          if (code !== 200) {
            reject(new Error(`Не удалось скачать файл (код ${code}).`))
            res.resume()
            return
          }

          const total = Number(res.headers['content-length'] || 0)
          let received = 0
          const file = createWriteStream(tmpPath)
          const cleanup = (): void => {
            try {
              file.destroy()
              if (existsSync(tmpPath)) unlinkSync(tmpPath)
            } catch {
              /* ignore */
            }
          }
          res.on('data', (chunk: Buffer) => {
            if (shouldCancel?.()) {
              req.destroy()
              cleanup()
              reject(new DownloadCancelledError())
              return
            }
            received += chunk.length
            if (total > 0) onProgress?.(received / total)
          })
          res.pipe(file)
          file.on('finish', () => {
            file.close()
            if (shouldCancel?.()) {
              cleanup()
              reject(new DownloadCancelledError())
              return
            }
            try {
              renameSync(tmpPath, destPath)
              resolve()
            } catch (error) {
              reject(error)
            }
          })
          file.on('error', (error) => {
            cleanup()
            reject(error)
          })
        }
      )
      req.on('error', reject)
    }

    follow(url, 0)
  })
}
