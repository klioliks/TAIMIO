import { useEffect, useMemo, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import type { ProjectSummary, VideoItem, VisualDocument, VisualItem } from '@shared/types'
import { VideoPlayer } from '../components/VideoPlayer'
import { api } from '../lib/api'
import { formatTimecode, videoStatusLabel } from '../lib/format'
import { t } from '../i18n/ru'

interface VisualsPanelProps {
  project: ProjectSummary
  onToast: (message: string) => void
}

export function VisualsPanel({ project, onToast }: VisualsPanelProps): React.JSX.Element {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [doc, setDoc] = useState<VisualDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [active, setActive] = useState<VisualItem | null>(null)
  const [preview, setPreview] = useState<VisualItem | null>(null)
  const playerRef = useRef<HTMLVideoElement | null>(null)

  const selected = useMemo(
    () => videos.find((item) => item.id === selectedId) ?? null,
    [videos, selectedId]
  )

  async function refreshVideos(): Promise<VideoItem[]> {
    const result = await api().listVideos(project.id)
    if (!result.ok) {
      onToast(result.error)
      return []
    }
    setVideos(result.data)
    setSelectedId((current) => {
      if (current && result.data.some((item) => item.id === current)) return current
      return result.data[0]?.id ?? null
    })
    return result.data
  }

  async function loadVisuals(videoId: string): Promise<void> {
    const result = await api().getVisuals(project.id, videoId)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setDoc(result.data)
    setActive(result.data?.items[0] ?? null)
  }

  useEffect(() => {
    void refreshVideos()
  }, [project.id])

  useEffect(() => {
    if (!selectedId) {
      setDoc(null)
      setActive(null)
      return
    }
    void loadVisuals(selectedId)
  }, [selectedId, project.id])

  async function build(): Promise<void> {
    if (!selected) return
    setBusy(true)
    const result = await api().rebuildVisuals(project.id, selected.id)
    setBusy(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setDoc(result.data)
    setActive(result.data.items[0] ?? null)
    onToast(t('visualsReady'))
    await refreshVideos()
  }

  function seekTo(item: VisualItem): void {
    setActive(item)
    const player = playerRef.current
    if (!player) return
    player.currentTime = Math.max(0, item.start)
    void player.play().catch(() => undefined)
  }

  const items = doc?.items ?? []

  return (
    <div className="videos-layout">
      <div className="videos-toolbar">
        <div>
          <h2>{t('visualsTitle')}</h2>
          <p className="muted">{t('visualsHint')}</p>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="empty-state glass-card" style={{ padding: 32, borderRadius: 24 }}>
          <h2>{t('visualsEmpty')}</h2>
          <p className="muted">{t('visualsEmptyHint')}</p>
        </div>
      ) : (
        <div className="videos-grid transcript-grid">
          <div className="video-list">
            {videos.map((video) => (
              <button
                key={video.id}
                type="button"
                className={video.id === selectedId ? 'video-row active' : 'video-row'}
                onClick={() => setSelectedId(video.id)}
              >
                <strong>{video.displayName}</strong>
                <span className="muted">
                  {video.hasVisuals ? t('visualsReady') : videoStatusLabel(video.status, video.hasTranscript)}
                </span>
              </button>
            ))}
          </div>

          <div className="video-detail glass-card transcript-detail">
            {selected ? (
              <>
                <div className="video-detail-head">
                  <h3>{selected.displayName}</h3>
                  <p className="muted">{videoStatusLabel(selected.status, selected.hasTranscript)}</p>
                </div>

                {selected.playableInApp && selected.mediaUrl ? (
                  <VideoPlayer key={selected.id} src={selected.mediaUrl} compact playerRef={playerRef} />
                ) : (
                  <div className="player-shell compact">
                    <div className="player-fallback">
                      <p>{selected.sourceExists ? t('videoNotPlayable') : t('videoMissing')}</p>
                    </div>
                  </div>
                )}

                <div className="card-actions wrap" style={{ marginBottom: 14 }}>
                  <button
                    type="button"
                    className="primary"
                    disabled={busy || !selected.sourceExists}
                    onClick={() => void build()}
                  >
                    <ImagePlus size={14} style={{ marginRight: 6 }} />
                    {busy ? t('visualsWorking') : selected.hasVisuals ? t('visualsRebuild') : t('visualsBuild')}
                  </button>
                </div>

                {items.length > 0 ? (
                  <div className="visuals-grid">
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className={active?.id === item.id ? 'visual-card active' : 'visual-card'}
                        onClick={() => seekTo(item)}
                      >
                        {item.imageUrl ? (
                          <img
                            src={item.imageUrl}
                            alt={item.description}
                            onDoubleClick={(event) => {
                              event.stopPropagation()
                              setPreview(item)
                            }}
                          />
                        ) : (
                          <div className="visual-fallback">{t('visualsMissingFrame')}</div>
                        )}
                        <span className="visual-time">{formatTimecode(item.start)}</span>
                        <span className="muted">{item.description}</span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="muted">{busy ? t('visualsWorking') : t('visualsEmptyHint')}</p>
                )}
              </>
            ) : (
              <p className="muted">{t('videoSelectHint')}</p>
            )}
          </div>
        </div>
      )}

      {preview ? (
        <div className="overlay" onMouseDown={() => setPreview(null)}>
          <div className="visual-preview" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="ghost visual-preview-close" onClick={() => setPreview(null)}>
              <X size={16} />
            </button>
            {preview.imageUrl ? <img src={preview.imageUrl} alt={preview.description} /> : null}
            <p>
              <strong>{formatTimecode(preview.start)}</strong> · {preview.description}
            </p>
            <button
              type="button"
              className="primary"
              onClick={() => {
                seekTo(preview)
                setPreview(null)
              }}
            >
              {t('visualsJump')}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
