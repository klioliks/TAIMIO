/** Состояния коммерческой лицензии. Реальная проверка — отдельный этап. */
export type LicenseState = 'active' | 'grace_period' | 'expired' | 'blocked'

export type LicenseRefreshReason = 'startup' | 'periodic' | 'manual' | 'activate'

export type LicenseSource = 'stub' | 'cached' | 'server'

export interface LicenseSnapshot {
  state: LicenseState
  /** Маска ключа, никогда полный ключ. */
  licenseKeyMasked: string | null
  expiresAt: string | null
  graceEndsAt: string | null
  lastCheckedAt: string | null
  offline: boolean
  source: LicenseSource
}

export interface LicenseCapabilities {
  canOpenApp: boolean
  /** Уже созданные проекты, расшифровки, конспекты, экспорт. */
  canReadProjects: boolean
  /** Новая обработка видео (probe / audio / STT / анализ). */
  canStartNewProcessing: boolean
  canExport: boolean
}

export function capabilitiesFromLicense(snapshot: LicenseSnapshot): LicenseCapabilities {
  switch (snapshot.state) {
    case 'active':
    case 'grace_period':
      return {
        canOpenApp: true,
        canReadProjects: true,
        canStartNewProcessing: true,
        canExport: true
      }
    case 'expired':
      return {
        canOpenApp: true,
        canReadProjects: true,
        canStartNewProcessing: false,
        canExport: true
      }
    case 'blocked':
      return {
        canOpenApp: false,
        canReadProjects: false,
        canStartNewProcessing: false,
        canExport: false
      }
  }
}
