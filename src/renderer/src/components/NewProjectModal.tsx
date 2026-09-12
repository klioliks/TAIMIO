import type { FormEvent } from 'react'
import { useState } from 'react'
import type { AiMode } from '@shared/types'
import { t } from '../i18n/ru'

interface NewProjectModalProps {
  error: string | null
  busy: boolean
  onClose: () => void
  onCreate: (name: string, aiMode: AiMode) => Promise<void>
}

export function NewProjectModal({
  error,
  busy,
  onClose,
  onCreate
}: NewProjectModalProps): React.JSX.Element {
  const [name, setName] = useState('')
  const [aiMode, setAiMode] = useState<AiMode>('cloud')

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault()
    await onCreate(name, aiMode)
  }

  return (
    <div className="overlay" onMouseDown={onClose}>
      <form
        className="modal"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => void submit(event)}
      >
        <h2>{t('createTitle')}</h2>
        <div className="field">
          <label htmlFor="project-name">{t('createName')}</label>
          <input
            id="project-name"
            autoFocus
            value={name}
            maxLength={120}
            placeholder={t('createNamePlaceholder')}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <span>{t('createMode')}</span>
          <div className="mode-grid">
            <button
              type="button"
              className={aiMode === 'cloud' ? 'mode-card selected' : 'mode-card'}
              onClick={() => setAiMode('cloud')}
            >
              <strong>{t('modeCloud')}</strong>
              <p className="muted">{t('modeCloudHint')}</p>
            </button>
            <button
              type="button"
              className={aiMode === 'local' ? 'mode-card selected' : 'mode-card'}
              onClick={() => setAiMode('local')}
            >
              <strong>{t('modeLocal')}</strong>
              <p className="muted">{t('modeLocalHint')}</p>
            </button>
          </div>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </button>
          <button type="submit" className="primary" disabled={busy || !name.trim()}>
            {t('create')}
          </button>
        </div>
      </form>
    </div>
  )
}
