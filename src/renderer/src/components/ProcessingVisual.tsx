interface ProcessingVisualProps {
  mode: 'download' | 'transcribe' | 'idle'
  progress?: number | null
  label: string
  etaLabel?: string | null
}

export function ProcessingVisual({
  mode,
  progress,
  label,
  etaLabel
}: ProcessingVisualProps): React.JSX.Element {
  const pct = progress == null ? null : Math.max(0, Math.min(100, Math.round(progress)))
  const tone = mode === 'download' ? 'download' : mode === 'transcribe' ? 'transcribe' : 'idle'

  return (
    <div className={`processing-visual tone-${tone}`} role="status" aria-live="polite">
      <div className="processing-visual-glow" aria-hidden="true" />
      <div className="processing-orbit" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="processing-film" aria-hidden="true">
        {Array.from({ length: 8 }).map((_, index) => (
          <i key={index} style={{ animationDelay: `${index * 0.12}s` }} />
        ))}
      </div>
      <div className="processing-wave" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, index) => (
          <b key={index} style={{ animationDelay: `${index * 0.08}s` }} />
        ))}
      </div>
      <div className="processing-copy">
        <strong>{label}</strong>
        {etaLabel ? <em className="processing-eta">{etaLabel}</em> : null}
        {pct != null ? <span>{pct}%</span> : <span className="processing-dots">···</span>}
      </div>
      <div className="progress-track large processing-track">
        <div className="progress-bar" style={{ width: `${Math.max(6, pct ?? 8)}%` }} />
      </div>
    </div>
  )
}
