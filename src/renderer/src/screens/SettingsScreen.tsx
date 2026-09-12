import { useState } from 'react'
import type { AppInfo, WhisperModelId } from '@shared/types'
import { t, tf } from '../i18n/ru'
import { api } from '../lib/api'

interface SettingsScreenProps {
  info: AppInfo | null
  onInfoChange?: (info: AppInfo) => void
  onToast?: (message: string) => void
}

export function SettingsScreen({ info, onInfoChange, onToast }: SettingsScreenProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
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
          <h2>{t('settingsVersion')}</h2>
          <p>
            {t('appName')} {info?.version ?? '0.1.0'}
          </p>
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
    </section>
  )
}
