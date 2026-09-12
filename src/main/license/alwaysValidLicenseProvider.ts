import type { LicenseSnapshot } from '../../shared/license'
import type { LicenseProvider } from './licenseProvider'

/** Временная заглушка: лицензия всегда активна, сети и ключа нет. */
export class AlwaysValidLicenseProvider implements LicenseProvider {
  async getSnapshot(): Promise<LicenseSnapshot> {
    return {
      state: 'active',
      licenseKeyMasked: null,
      expiresAt: null,
      graceEndsAt: null,
      lastCheckedAt: new Date().toISOString(),
      offline: true,
      source: 'stub'
    }
  }

  async refresh(): Promise<LicenseSnapshot> {
    return this.getSnapshot()
  }
}
