import { useState } from 'react'
import { t } from '../i18n/ru'
import { api } from '../lib/api'

interface ActivateScreenProps {
  onActivated: () => void
}

export function ActivateScreen({ onActivated }: ActivateScreenProps): React.JSX.Element {
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function activate(): Promise<void> {
    setBusy(true)
    setError(null)
    const result = await api().activateAccessKey(key)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    if (result.data.snapshot.state === 'not_activated') {
      setError(t('accessNotFound'))
      return
    }
    onActivated()
  }

  return (
    <section className="activate-screen">
      <article className="activate-card">
        <p className="muted">{t('accessBetaName')}</p>
        <h1>{t('accessWelcome')}</h1>
        <label className="activate-label" htmlFor="access-key">
          {t('accessEnter')}
        </label>
        <input
          id="access-key"
          value={key}
          autoComplete="off"
          spellCheck={false}
          placeholder={t('accessPlaceholder')}
          onChange={(event) => setKey(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && key.trim()) void activate()
          }}
        />
        {error ? <p className="activate-error">{error}</p> : null}
        <button
          type="button"
          className="primary"
          disabled={busy || !key.trim()}
          onClick={() => void activate()}
        >
          {busy ? t('accessActivating') : t('accessActivate')}
        </button>
        <p className="muted activate-hint">{t('accessHint')}</p>
      </article>
    </section>
  )
}
