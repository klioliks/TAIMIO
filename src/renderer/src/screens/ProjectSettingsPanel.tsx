import { useState } from 'react'
import type { AiMode, ProjectSummary } from '@shared/types'
import { api } from '../lib/api'
import { t } from '../i18n/ru'

interface ProjectSettingsPanelProps {
  project: ProjectSummary
  onProjectChange: (project: ProjectSummary) => void
  onToast: (message: string) => void
}

export function ProjectSettingsPanel({
  project,
  onProjectChange,
  onToast
}: ProjectSettingsPanelProps): React.JSX.Element {
  const [busy, setBusy] = useState(false)

  async function setMode(aiMode: AiMode): Promise<void> {
    if (aiMode === project.aiMode) return
    setBusy(true)
    const result = await api().setProjectAiMode(project.id, aiMode)
    setBusy(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    onProjectChange(result.data)
    onToast(t('projectSettingsSaved'))
  }

  return (
    <div className="settings-grid">
      <article className="settings-card">
        <h2>{t('projectSettingsTitle')}</h2>
        <p className="muted">{t('projectSettingsWarn')}</p>
        <div className="mode-grid" style={{ marginTop: 16 }}>
          <button
            type="button"
            className={project.aiMode === 'cloud' ? 'mode-card selected' : 'mode-card'}
            disabled={busy}
            onClick={() => void setMode('cloud')}
          >
            <strong>{t('modeCloud')}</strong>
            <p className="muted">{t('projectSettingsCloudWarn')}</p>
          </button>
          <button
            type="button"
            className={project.aiMode === 'local' ? 'mode-card selected' : 'mode-card'}
            disabled={busy}
            onClick={() => void setMode('local')}
          >
            <strong>{t('modeLocal')}</strong>
            <p className="muted">{t('projectSettingsLocalWarn')}</p>
          </button>
        </div>
      </article>

      <article className="settings-card">
        <h2>{t('privacyTitle')}</h2>
        <table className="privacy-table">
          <tbody>
            <tr>
              <td>{t('privacyVideo')}</td>
              <td>{t('privacyLocal')}</td>
            </tr>
            <tr>
              <td>{t('privacyAudio')}</td>
              <td>{t('privacyLocal')}</td>
            </tr>
            <tr>
              <td>{t('privacyFrames')}</td>
              <td>{t('privacyLocal')}</td>
            </tr>
            <tr>
              <td>{t('privacyTranscript')}</td>
              <td>{t('privacyLocal')}</td>
            </tr>
            <tr>
              <td>{t('privacyText')}</td>
              <td>{project.aiMode === 'cloud' ? t('privacyCloud') : t('privacyLocal')}</td>
            </tr>
            <tr>
              <td>{t('privacyResults')}</td>
              <td>{t('privacyStay')}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  )
}
