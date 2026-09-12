import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]{10,}/gi
]

function redact(message: string): string {
  let next = message
  for (const pattern of SECRET_PATTERNS) {
    next = next.replace(pattern, '[redacted]')
  }
  return next
}

export class FileLogger {
  private readonly filePath: string

  constructor(logsDir: string) {
    mkdirSync(logsDir, { recursive: true })
    const day = new Date().toISOString().slice(0, 10)
    this.filePath = join(logsDir, `taimio-${day}.log`)
  }

  info(message: string): void {
    this.write('INFO', message)
  }

  error(message: string): void {
    this.write('ERROR', message)
  }

  private write(level: string, message: string): void {
    const line = `${new Date().toISOString()} [${level}] ${redact(message)}\n`
    try {
      appendFileSync(this.filePath, line, 'utf8')
    } catch {
      // Logging must never crash the app.
    }
  }
}
