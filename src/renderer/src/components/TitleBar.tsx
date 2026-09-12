import { Minus, Square, X } from 'lucide-react'
import { t } from '../i18n/ru'
import logo from '../assets/taimio-logo.png'
import { api } from '../lib/api'

export function TitleBar(): React.JSX.Element {
  return (
    <header className="titlebar">
      <div className="titlebar-brand">
        <img src={logo} alt="" />
        <span>{t('appName')}</span>
      </div>
      <div className="titlebar-controls">
        <button type="button" onClick={() => void api().windowMinimize()} aria-label="Свернуть">
          <Minus size={18} strokeWidth={2.25} />
        </button>
        <button type="button" onClick={() => void api().windowMaximize()} aria-label="Развернуть">
          <Square size={15} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          className="close"
          onClick={() => void api().windowClose()}
          aria-label="Закрыть"
        >
          <X size={18} strokeWidth={2.25} />
        </button>
      </div>
    </header>
  )
}
