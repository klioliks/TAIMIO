import type { WhisperModelId } from './whisperRuntime'

/** Секунды стены / секунды аудио. Запас чуть выше замеров на small (~0.18). */
const DEFAULT_FACTOR: Record<WhisperModelId, number> = {
  small: 0.25,
  medium: 0.55
}

export function defaultSttFactor(modelId: WhisperModelId): number {
  return DEFAULT_FACTOR[modelId]
}

export function parseSttFactor(raw: string | null | undefined, modelId: WhisperModelId): number {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0.02 || value > 3) return defaultSttFactor(modelId)
  return value
}

export function blendSttFactor(previous: number, observed: number): number {
  if (!Number.isFinite(observed) || observed <= 0) return previous
  const clamped = Math.max(0.05, Math.min(2.5, observed))
  return previous * 0.6 + clamped * 0.4
}

export function estimateTotalSec(durationSec: number | null | undefined, factor: number): number | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return null
  return Math.max(8, durationSec * factor)
}

export function estimateRemainingSec(options: {
  durationSec: number | null | undefined
  processedSec: number | null | undefined
  ratio: number
  factor: number
  elapsedSec: number
}): number | null {
  const { durationSec, processedSec, ratio, factor, elapsedSec } = options
  const byFactor =
    durationSec != null && durationSec > 0
      ? Math.max(0, (durationSec - Math.max(0, processedSec ?? ratio * durationSec)) * factor)
      : null

  let byProgress: number | null = null
  if (ratio >= 0.08 && elapsedSec >= 4) {
    const projectedTotal = elapsedSec / ratio
    byProgress = Math.max(0, projectedTotal - elapsedSec)
  }

  if (byFactor == null && byProgress == null) {
    return estimateTotalSec(durationSec, factor)
  }
  if (byFactor == null) return byProgress
  if (byProgress == null) return byFactor
  // Пока мало данных — больше верим модели; потом смешиваем.
  const weight = Math.min(0.75, Math.max(0.2, ratio))
  return byFactor * (1 - weight) + byProgress * weight
}

export function formatEta(sec: number | null | undefined): string | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null
  if (sec < 40) return 'меньше минуты'
  if (sec < 80) return 'около 1 мин'
  const mins = Math.max(1, Math.round(sec / 60))
  if (mins === 1) return 'около 1 мин'
  return `около ${mins} мин`
}

export function formatEtaHint(remainingSec: number | null, mode: 'total' | 'remaining' = 'remaining'): string | null {
  const text = formatEta(remainingSec)
  if (!text) return null
  return mode === 'total' ? `Ориентировочно ${text}` : `Осталось ${text}`
}
