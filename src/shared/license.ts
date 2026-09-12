export type LicenseState = 'not_activated' | 'active' | 'grace_period' | 'expired' | 'blocked'

export type LicenseRefreshReason = 'startup' | 'periodic' | 'manual' | 'activate'

export type LicenseSource = 'stub' | 'cached' | 'server' | 'offline'

export type AccessPlan = 'beta' | 'beta_offline'

export interface LicenseSnapshot {
  state: LicenseState
  plan: AccessPlan | null
  /** Маска ключа, никогда полный ключ. */
  licenseKeyMasked: string | null
  activatedAt: string | null
  expiresAt: string | null
  daysLeft: number | null
  graceEndsAt: string | null
  lastCheckedAt: string | null
  offline: boolean
  source: LicenseSource
}

export interface LicenseCapabilities {
  canOpenApp: boolean
  canReadProjects: boolean
  canStartNewProcessing: boolean
  canExport: boolean
}

export function daysUntil(iso: string | null, now = Date.now()): number | null {
  if (!iso) return null
  const end = Date.parse(iso)
  if (!Number.isFinite(end)) return null
  return Math.max(0, Math.ceil((end - now) / 86_400_000))
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
    case 'blocked':
      return {
        canOpenApp: true,
        canReadProjects: true,
        canStartNewProcessing: false,
        canExport: true
      }
    case 'not_activated':
      return {
        canOpenApp: false,
        canReadProjects: false,
        canStartNewProcessing: false,
        canExport: false
      }
  }
}
