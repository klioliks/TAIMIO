import type { ProcessingStatus, VideoStatus } from '@shared/types'
import { t, type MessageKey } from '../i18n/ru'

const statusKeys: Record<ProcessingStatus, MessageKey> = {
  empty: 'statusEmpty',
  queued: 'statusQueued',
  processing: 'statusProcessing',
  completed: 'statusCompleted',
  failed: 'statusFailed',
  mixed: 'statusMixed'
}

const videoStatusKeys: Record<VideoStatus, MessageKey> = {
  registered: 'videoStatusRegistered',
  probing: 'videoStatusProbing',
  extracting_audio: 'videoStatusAudio',
  transcribing: 'videoStatusTranscribing',
  ready: 'videoStatusReady',
  failed: 'videoStatusFailed',
  cancelled: 'videoStatusCancelled',
  missing_source: 'videoStatusMissing'
}

export function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(iso))
}

export function statusLabel(status: ProcessingStatus): string {
  return t(statusKeys[status])
}

export function videoStatusLabel(status: VideoStatus, hasTranscript = true): string {
  if (status === 'ready' && !hasTranscript) return t('videoStatusAwaiting')
  return t(videoStatusKeys[status])
}

export function videoCountLabel(count: number): string {
  return `${count} видео`
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const total = Math.max(0, Math.round(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0:00'
  const total = Math.max(0, Math.floor(seconds))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}
