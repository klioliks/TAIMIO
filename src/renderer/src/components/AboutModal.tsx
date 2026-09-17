import { t, tf } from '../i18n/ru'
import { betaProductLabel } from '@shared/betaVersion'

interface AboutModalProps {
  onClose: () => void
  version: string
}

export function AboutModal({ onClose, version }: AboutModalProps): React.JSX.Element {
  return (
    <div className="overlay" onMouseDown={onClose}>
      <div className="about-modal" onMouseDown={(event) => event.stopPropagation()}>
        <p className="about-name">{t('aboutTitle')}</p>
        <p className="about-tagline">{t('aboutTagline')}</p>
        {version ? <p className="about-version">{tf('aboutVersion', { label: betaProductLabel(version) })}</p> : null}
        <p className="about-author">{t('aboutAuthor')}</p>
        <p>{t('aboutCreated')}</p>
        <p>{t('aboutUsed')}</p>
        <ul>
          <li>{t('aboutChatgpt')}</li>
          <li>{t('aboutCursor')}</li>
        </ul>
        <p className="about-line">{t('aboutControl')}</p>
        <p className="about-copy">{t('aboutCopy')}</p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
