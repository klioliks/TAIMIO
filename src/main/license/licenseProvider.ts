import type { LicenseRefreshReason, LicenseSnapshot } from '../../shared/license'

/**
 * Единая точка лицензирования. Не связана с OpenAI, STT, локальными моделями и UI.
 * Сейчас — заглушка. Позже: HTTPS License Service, ключ, устройства, офлайн-кэш.
 */
export interface LicenseProvider {
  getSnapshot(): Promise<LicenseSnapshot>
  refresh(reason?: LicenseRefreshReason): Promise<LicenseSnapshot>
  /** Будет использовано экраном активации. Заглушка может не реализовывать. */
  activate?(licenseKey: string): Promise<LicenseSnapshot>
}
