import {
  capabilitiesFromLicense,
  type LicenseCapabilities,
  type LicenseRefreshReason,
  type LicenseSnapshot
} from '../../shared/license'
import type { LicenseProvider } from './licenseProvider'

export class LicenseService {
  constructor(private readonly provider: LicenseProvider) {}

  async getSnapshot(): Promise<LicenseSnapshot> {
    return this.provider.getSnapshot()
  }

  async getCapabilities(): Promise<LicenseCapabilities> {
    return capabilitiesFromLicense(await this.getSnapshot())
  }

  async refresh(reason: LicenseRefreshReason = 'manual'): Promise<LicenseSnapshot> {
    return this.provider.refresh(reason)
  }

  async activate(accessKey: string): Promise<LicenseSnapshot> {
    if (!this.provider.activate) {
      throw new Error('Активация ключа недоступна.')
    }
    return this.provider.activate(accessKey)
  }

  async clear(): Promise<LicenseSnapshot> {
    if (!this.provider.clear) {
      throw new Error('Удаление ключа недоступно.')
    }
    return this.provider.clear()
  }

  async assertCanStartProcessing(): Promise<void> {
    const snapshot = await this.getSnapshot()
    const caps = capabilitiesFromLicense(snapshot)
    if (caps.canStartNewProcessing) return
    if (snapshot.state === 'blocked') {
      throw new Error('Этот ключ заблокирован.')
    }
    if (snapshot.state === 'expired') {
      if (snapshot.plan === 'trial') {
        throw new Error('5 дней пробного доступа закончились.')
      }
      throw new Error('Срок действия вашего ключа TAIMIO Beta закончился.')
    }
    throw new Error('Сначала активируйте ключ доступа.')
  }
}
