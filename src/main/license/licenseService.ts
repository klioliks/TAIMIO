import {
  capabilitiesFromLicense,
  type LicenseCapabilities,
  type LicenseRefreshReason,
  type LicenseSnapshot
} from '../../shared/license'
import type { LicenseProvider } from './licenseProvider'

/**
 * Фасад для остального приложения. Модули спрашивают только snapshot / capabilities.
 * Сменить провайдера (заглушка → внешний сервис) можно здесь, без правок STT/UI/OpenAI.
 */
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

  async assertCanStartProcessing(): Promise<void> {
    const caps = await this.getCapabilities()
    if (caps.canStartNewProcessing) return
    throw new Error(
      'Срок лицензии истёк. Уже готовые проекты и расшифровки доступны, новую обработку видео запустить нельзя.'
    )
  }
}
