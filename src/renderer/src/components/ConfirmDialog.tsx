import { t } from '../i18n/ru'

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel?: string
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  onCancel,
  onConfirm
}: ConfirmDialogProps): React.JSX.Element {
  return (
    <div className="overlay" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
        <h2>{title}</h2>
        <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>
          {body}
        </p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onCancel}>
            {t('cancel')}
          </button>
          <button type="button" className="danger" onClick={onConfirm}>
            {confirmLabel ?? t('delete')}
          </button>
        </div>
      </div>
    </div>
  )
}
