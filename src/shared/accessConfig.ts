export const ACCESS_CONFIG = {
  /** Сменить после деплоя Key Service. */
  keyServiceUrl: 'https://taimio-keys.taimio.workers.dev',
  periodicCheckHours: 168,
  gracePeriodHours: 336,
  clockSkewMinutes: 120,
  durationDays: 60,
  deviceLimit: 1
} as const

export const ONLINE_KEY_RE = /^TAIMIO-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/
export const OFFLINE_KEY_PREFIX = 'TAIMIO-OF-'
export const ADMIN_KEY_PREFIX = 'TAIMIO-AD-'
