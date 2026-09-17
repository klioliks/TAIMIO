import { useEffect, useState } from 'react'
import type { AppInfo, LicenseSnapshot, SetupProgressEvent, WhisperModelId } from '@shared/types'
import { t, tf } from '../i18n/ru'
import { api } from '../lib/api'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { betaProductLabel } from '@shared/betaVersion'

interface SettingsScreenProps {
  info: AppInfo | null
  access?: LicenseSnapshot | null
  onInfoChange?: (info: AppInfo) => void
  onAccessChange?: (access: LicenseSnapshot) => void
  onToast?: (message: string) => void
}

export function SettingsScreen({
  info,
  access,
  onInfoChange,
  onAccessChange,
  onToast
}: SettingsScreenProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [setupBusy, setSetupBusy] = useState(false)
  const [setupProgress, setSetupProgress] = useState<SetupProgressEvent | null>(null)
  const [accessBusy, setAccessBusy] = useState(false)
  const [confirmClearAccess, setConfirmClearAccess] = useState(false)
  const rows = info
    ? [
        { label: t('settingsAppData'), path: info.appDataRoot },
        { label: t('settingsProjects'), path: info.projectsRoot },
        { label: t('settingsCache'), path: info.cacheDir },
        { label: t('settingsTemp'), path: info.tempDir },
        { label: t('settingsLogs'), path: info.logsDir },
        { label: t('settingsCatalog'), path: info.catalogPath }
      ]
    : []
  const hardware = info?.hardware

  useEffect(() => {
    return api().onSetupProgress((event) => setSetupProgress(event))
  }, [])

  async function refreshInfo(): Promise<void> {
    const result = await api().getAppInfo()
    if (result.ok) onInfoChange?.(result.data)
  }

  async function saveKey(): Promise<void> {
    setKeyBusy(true)
    const savedKey = apiKey.trim()
    const result = await api().setOpenAiKey(savedKey)
    if (!result.ok) {
      setKeyBusy(false)
      onToast?.(result.error)
      return
    }
    setApiKey('')
    await refreshInfo()
    const check = await api().testOpenAiKey(savedKey)
    setKeyBusy(false)
    if (!check.ok) {
      onToast?.(check.error)
      return
    }
    onToast?.(t('settingsApiConnected'))
  }

  async function testKey(): Promise<void> {
    setKeyBusy(true)
    const result = await api().testOpenAiKey(apiKey.trim() || undefined)
    setKeyBusy(false)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    onToast?.(t('settingsApiOk'))
  }

  async function clearKey(): Promise<void> {
    setKeyBusy(true)
    const result = await api().clearOpenAiKey()
    setKeyBusy(false)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    setApiKey('')
    await refreshInfo()
    onToast?.(t('settingsApiCleared'))
  }

  async function changeModel(model: WhisperModelId): Promise<void> {
    const result = await api().setWhisperModel(model)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    onInfoChange?.(result.data)
  }

  function accessPlanLabel(): string {
    if (access?.plan === 'admin') return t('accessAdminName')
    if (access?.plan === 'trial') return t('accessTrialName')
    return t('accessBetaName')
  }

  function accessStatusLabel(): string {
    if (access?.plan === 'admin' && access.state === 'active') return t('accessStatusAdmin')
    if (access?.plan === 'trial' && access.state === 'expired') return t('accessStatusTrialExpired')
    switch (access?.state) {
      case 'active':
        return t('accessStatusActive')
      case 'grace_period':
        return t('accessStatusGrace')
      case 'expired':
        return t('accessStatusExpired')
      case 'blocked':
        return t('accessStatusBlocked')
      default:
        return t('accessStatusNone')
    }
  }

  function formatUntil(iso: string | null | undefined): string {
    if (!iso) return '—'
    return new Date(iso).toLocaleDateString('ru-RU', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    })
  }

  async function enterAnotherKey(): Promise<void> {
    setAccessBusy(true)
    const result = await api().clearAccessKey()
    setAccessBusy(false)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    onAccessChange?.(result.data.snapshot)
  }

  async function clearAccess(): Promise<void> {
    setAccessBusy(true)
    setConfirmClearAccess(false)
    const result = await api().clearAccessKey()
    setAccessBusy(false)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    onAccessChange?.(result.data.snapshot)
  }

  async function checkAccess(): Promise<void> {
    setAccessBusy(true)
    const result = await api().refreshAccessKey()
    setAccessBusy(false)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    onAccessChange?.(result.data.snapshot)
  }

  async function installStack(): Promise<void> {
    setSetupBusy(true)
    setSetupProgress({ step: 'runtime', label: t('setupInstalling'), ratio: 0.02 })
    const result = await api().installLocalStack()
    setSetupBusy(false)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    onInfoChange?.(result.data)
    onToast?.(t('settingsModelReady'))
  }

  async function downloadLlm(): Promise<void> {
    setSetupBusy(true)
    const result = await api().downloadLocalLlm()
    setSetupBusy(false)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    onInfoChange?.(result.data)
    onToast?.(t('settingsModelReady'))
  }

  async function downloadModel(): Promise<void> {
    if (!info) return
    setBusy(true)
    const result = await api().downloadWhisperModel(info.whisperModel)
    setBusy(false)
    if (!result.ok) {
      onToast?.(result.error)
      return
    }
    onInfoChange?.(result.data)
    onToast?.(t('settingsModelReady'))
  }

  return (
    <section>
      <div className="page-head">
        <h1>{t('settingsTitle')}</h1>
      </div>
      <div className="settings-grid">
        <article className="settings-card">
          <h2>{t('accessTitle')}</h2>
          <p>{accessPlanLabel()}</p>
          <div className="setup-list">
            <div className="setup-row">
              <span>{t('accessStatus')}</span>
              <strong className={access?.state === 'active' || access?.state === 'grace_period' ? 'setup-ok' : 'setup-warn'}>
                {accessStatusLabel()}
              </strong>
            </div>
            <div className="setup-row">
              <span>{t('accessLeft')}</span>
              <strong>
                {access?.plan === 'admin'
                  ? t('accessUnlimited')
                  : access?.daysLeft != null
                    ? tf('accessDays', { count: access.daysLeft })
                    : '—'}
              </strong>
            </div>
            <div className="setup-row">
              <span>{t('accessUntil')}</span>
              <strong>{access?.plan === 'admin' ? t('accessNoExpiry') : formatUntil(access?.expiresAt)}</strong>
            </div>
            <div className="setup-row">
              <span>{t('accessKeyLabel')}</span>
              <strong>{access?.licenseKeyMasked ?? '—'}</strong>
            </div>
          </div>
          {access?.plan === 'trial' && access.state === 'expired' ? (
            <p className="muted" style={{ marginTop: 12 }}>
              {t('accessTrialExpiredBanner')}
            </p>
          ) : null}
          <div className="card-actions wrap" style={{ marginTop: 16 }}>
            <button type="button" className="ghost" disabled={accessBusy} onClick={() => void checkAccess()}>
              {accessBusy ? t('accessChecking') : t('accessCheck')}
            </button>
            {access?.state === 'expired' || access?.state === 'blocked' ? (
              <button type="button" className="primary" disabled={accessBusy} onClick={() => void enterAnotherKey()}>
                {t('accessEnterAnother')}
              </button>
            ) : null}
            {access?.state && access.state !== 'not_activated' ? (
              <button type="button" className="danger" disabled={accessBusy} onClick={() => setConfirmClearAccess(true)}>
                {t('accessClear')}
              </button>
            ) : null}
          </div>
        </article>
        <article className="settings-card">
          <h2>{t('setupTitle')}</h2>
          <p className="muted">{t('setupHint')}</p>
          <div className="setup-list">
            <div className="setup-row">
              <span>{t('setupFfmpeg')}</span>
              <strong className={info?.ffmpegReady ? 'setup-ok' : 'setup-bad'}>
                {info?.ffmpegReady ? t('setupReady') : t('setupMissing')}
              </strong>
            </div>
            <div className="setup-row">
              <span>{t('setupFfprobe')}</span>
              <strong className={info?.ffprobeReady ? 'setup-ok' : 'setup-bad'}>
                {info?.ffprobeReady ? t('setupReady') : t('setupMissing')}
              </strong>
            </div>
            <div className="setup-row">
              <span>{t('setupWhisper')}</span>
              <strong className={info?.whisperReady && info.whisperModelReady ? 'setup-ok' : 'setup-bad'}>
                {info?.whisperReady && info.whisperModelReady ? t('setupReady') : t('setupMissing')}
              </strong>
            </div>
            <div className="setup-row">
              <span>{t('setupRuntime')}</span>
              <strong className={info?.localRuntimeReady ? 'setup-ok' : 'setup-bad'}>
                {info?.localRuntimeReady ? t('setupReady') : t('setupMissing')}
              </strong>
            </div>
            <div className="setup-row">
              <span>
                {t('setupLlm')}
                {info?.localLlmLabel ? ` · ${info.localLlmLabel} (${info.localLlmSizeLabel})` : ''}
              </span>
              <strong className={info?.localLlmReady ? 'setup-ok' : 'setup-bad'}>
                {info?.localLlmReady ? t('setupReady') : t('setupMissing')}
              </strong>
            </div>
            <div className="setup-row">
              <span>{t('setupRam')}</span>
              <strong className={hardware?.ramOk ? 'setup-ok' : 'setup-warn'}>
                {hardware
                  ? `${tf('setupRamValue', { total: hardware.ramTotalGb, free: hardware.ramFreeGb })}${
                      hardware.ramOk ? '' : ` · ${t('setupNeedRam')}`
                    }`
                  : '—'}
              </strong>
            </div>
            <div className="setup-row">
              <span>{t('setupDisk')}</span>
              <strong className={hardware?.diskOk ? 'setup-ok' : 'setup-warn'}>
                {hardware
                  ? `${tf('setupDiskValue', { free: hardware.diskFreeGb })}${
                      hardware.diskOk ? '' : ` · ${t('setupNeedDisk')}`
                    }`
                  : '—'}
              </strong>
            </div>
            <div className="setup-row">
              <span>{t('setupGpu')}</span>
              <strong className="setup-ok">{hardware?.gpuName || t('setupGpuNone')}</strong>
            </div>
          </div>
          {setupBusy && setupProgress ? (
            <div style={{ marginTop: 12 }}>
              <p className="muted">{setupProgress.label}</p>
              <div className="progress-track">
                <div
                  className="progress-bar"
                  style={{ width: `${Math.max(6, Math.round(setupProgress.ratio * 100))}%` }}
                />
              </div>
            </div>
          ) : null}
          <div className="card-actions wrap" style={{ marginTop: 16 }}>
            <button type="button" className="primary" disabled={setupBusy} onClick={() => void installStack()}>
              {setupBusy ? t('setupInstalling') : t('setupInstall')}
            </button>
            {!info?.localLlmReady ? (
              <button type="button" className="ghost" disabled={setupBusy} onClick={() => void downloadLlm()}>
                {t('setupDownloadLlm')}
              </button>
            ) : null}
          </div>
          <p className="muted" style={{ marginTop: 14 }}>
            {t('setupLicense')}
          </p>
        </article>
        <article className="settings-card">
          <h2>{t('settingsVersion')}</h2>
          <p>{info ? betaProductLabel(info.version) : t('appName')}</p>
        </article>
        <article className="settings-card">
          <h2>{t('settingsPaths')}</h2>
          <p className="muted">{t('settingsNote')}</p>
          {rows.map((row) => (
            <div className="path-row" key={row.label}>
              <div>
                <strong>{row.label}</strong>
                <div>
                  <code>{row.path}</code>
                </div>
              </div>
              <button type="button" className="ghost" onClick={() => void api().openPath(row.path)}>
                {t('openFolder')}
              </button>
            </div>
          ))}
        </article>
        <article className="settings-card">
          <h2>{t('settingsApi')}</h2>
          <p className="muted">{t('settingsApiHint')}</p>
          {info?.openaiKeySet ? (
            <p>{tf('settingsApiMasked', { masked: info.openaiKeyMasked ?? '••••' })}</p>
          ) : null}
          <div className="settings-api-row">
            <input
              type="password"
              value={apiKey}
              autoComplete="off"
              placeholder={t('settingsApiPlaceholder')}
              onChange={(event) => setApiKey(event.target.value)}
            />
            <button
              type="button"
              className="text-link"
              onClick={() => void api().openExternalUrl('https://platform.openai.com/api-keys')}
            >
              {t('settingsApiOpenKeys')}
            </button>
          </div>
          <p className="settings-api-balance muted">
            <span>{t('settingsApiBalanceHint')}</span>
            <button
              type="button"
              className="text-link"
              onClick={() =>
                void api().openExternalUrl(
                  'https://platform.openai.com/settings/organization/billing/overview'
                )
              }
            >
              {t('settingsApiOpenBilling')}
            </button>
          </p>
          <div className="card-actions wrap" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="primary"
              disabled={keyBusy || !apiKey.trim()}
              onClick={() => void saveKey()}
            >
              {t('settingsApiSave')}
            </button>
            <button type="button" className="ghost" disabled={keyBusy} onClick={() => void testKey()}>
              {t('settingsApiTest')}
            </button>
            {info?.openaiKeySet ? (
              <button type="button" className="ghost" disabled={keyBusy} onClick={() => void clearKey()}>
                {t('settingsApiClear')}
              </button>
            ) : null}
          </div>
        </article>
        <article className="settings-card">
          <h2>Компоненты медиа</h2>
          <p>
            FFmpeg: {info?.ffmpegReady ? 'готов' : 'не найден'} · FFprobe:{' '}
            {info?.ffprobeReady ? 'готов' : 'не найден'}
          </p>
        </article>
        <article className="settings-card">
          <h2>{t('settingsSpeech')}</h2>
          <p className="muted">{t('settingsSpeechHint')}</p>
          <p>
            {t('settingsWhisperCli')}: {info?.whisperReady ? 'готов' : 'не найден'}
          </p>
          <p>
            {t('settingsWhisperModel')}: {info?.whisperModel ?? 'small'} ·{' '}
            {info?.whisperModelReady ? t('settingsModelReady') : t('settingsModelMissing')}
          </p>
          <div className="card-actions wrap" style={{ marginTop: 12 }}>
            <button
              type="button"
              className={info?.whisperModel === 'small' ? 'primary' : 'ghost'}
              onClick={() => void changeModel('small')}
            >
              {t('settingsModelSmall')}
            </button>
            <button
              type="button"
              className={info?.whisperModel === 'medium' ? 'primary' : 'ghost'}
              onClick={() => void changeModel('medium')}
            >
              {t('settingsModelMedium')}
            </button>
          </div>
          {!info?.whisperModelReady ? (
            <div style={{ marginTop: 12 }}>
              <button type="button" className="primary" disabled={busy} onClick={() => void downloadModel()}>
                {busy ? t('settingsDownloading') : t('settingsDownloadModel')}
              </button>
            </div>
          ) : null}
          <p className="muted" style={{ marginTop: 16 }}>
            {t('settingsComing')}
          </p>
        </article>
      </div>
      {confirmClearAccess ? (
        <ConfirmDialog
          title={t('accessClearTitle')}
          body={t('accessClearBody')}
          confirmLabel={t('accessClear')}
          onCancel={() => setConfirmClearAccess(false)}
          onConfirm={() => void clearAccess()}
        />
      ) : null}
    </section>
  )
}
