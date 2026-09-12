import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, RefreshCw } from 'lucide-react'
import type { AnalysisDocument, ProjectSummary, VideoItem } from '@shared/types'
import { assembleBlockText } from '@shared/outlineText'
import { VideoPlayer } from '../components/VideoPlayer'
import { api } from '../lib/api'
import { formatTimecode, videoStatusLabel } from '../lib/format'
import { t } from '../i18n/ru'

interface OutlinePanelProps {
  project: ProjectSummary
  onToast: (message: string) => void
}

export function OutlinePanel({ project, onToast }: OutlinePanelProps): React.JSX.Element {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [doc, setDoc] = useState<AnalysisDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportChoice, setExportChoice] = useState<'all' | string>('all')
  const playerRef = useRef<HTMLVideoElement | null>(null)

  const selected = useMemo(
    () => videos.find((item) => item.id === selectedId) ?? null,
    [videos, selectedId]
  )
  const analyzedVideos = useMemo(() => videos.filter((item) => item.hasAnalysis), [videos])

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

  async function loadAnalysis(videoId: string): Promise<void> {
    const result = await api().getAnalysis(project.id, videoId)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setDoc(result.data)
  }

  useEffect(() => {
    void refreshVideos()
  }, [project.id])

  useEffect(() => {
    if (!selectedId) {
      setDoc(null)
      return
    }
    void loadAnalysis(selectedId)
  }, [selectedId, project.id])

  async function build(): Promise<void> {
    if (!selected) return
    setBusy(true)
    const result = await api().rebuildAnalysis(project.id, selected.id)
    setBusy(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setDoc(result.data)
    onToast(t('outlineReady'))
    await refreshVideos()
  }

  function seekTo(seconds: number): void {
    const player = playerRef.current
    if (!player) return
    player.currentTime = Math.max(0, seconds)
    void player.play().catch(() => undefined)
  }

  async function exportDocx(videoIds: string[]): Promise<void> {
    setExportBusy(true)
    const result = await api().exportOutlineDocx(project.id, videoIds)
    setExportBusy(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    if (result.data.canceled) return
    setExportOpen(false)
    onToast(t('outlineExported'))
  }

  function startExport(): void {
    if (analyzedVideos.length === 0) {
      onToast(t('outlineExportEmpty'))
      return
    }
    if (analyzedVideos.length === 1) {
      void exportDocx([analyzedVideos[0].id])
      return
    }
    setExportChoice(selected?.hasAnalysis ? selected.id : 'all')
    setExportOpen(true)
  }

  function confirmExport(): void {
    if (exportChoice === 'all') {
      void exportDocx(analyzedVideos.map((item) => item.id))
      return
    }
    void exportDocx([exportChoice])
  }

  function hint(): string {
    if (project.aiMode !== 'cloud') return t('outlineNeedCloud')
    if (!selected?.hasTranscript) return t('outlineNeedTranscript')
    if (selected.analysisStale && selected.hasAnalysis) return t('outlineStale')
    return t('outlinePrivacy')
  }

  return (
    <div className="videos-layout">
      <div className="videos-toolbar">
        <div>
          <h2>{t('outlineTitle')}</h2>
          <p className="muted">{hint()}</p>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="empty-state glass-card" style={{ padding: 32, borderRadius: 24 }}>
          <h2>{t('outlineEmpty')}</h2>
          <p className="muted">{t('outlineEmptyHint')}</p>
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
                  {video.hasAnalysis
                    ? video.analysisStale
                      ? t('outlineStale')
                      : t('outlineReady')
                    : videoStatusLabel(video.status, video.hasTranscript)}
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
                    disabled={busy || !selected.hasTranscript || project.aiMode !== 'cloud'}
                    onClick={() => void build()}
                  >
                    <RefreshCw size={14} style={{ marginRight: 6 }} />
                    {busy
                      ? t('outlineWorking')
                      : selected.hasAnalysis
                        ? t('outlineRebuild')
                        : t('outlineBuild')}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={exportBusy || analyzedVideos.length === 0}
                    onClick={startExport}
                  >
                    <Download size={14} style={{ marginRight: 6 }} />
                    {t('outlineDownload')}
                  </button>
                </div>

                {doc && doc.blocks.length > 0 ? (
                  <>
                    <details className="outline-plan">
                      <summary>
                        <span>{t('outlinePlan')}</span>
                        <ChevronDown size={16} />
                      </summary>
                      <div className="outline-plan-body">
                        {doc.blocks.map((block) => (
                          <article key={block.id} className="outline-block">
                            <button
                              type="button"
                              className="outline-time"
                              onClick={() => seekTo(block.start)}
                            >
                              {formatTimecode(block.start)}–{formatTimecode(block.end)}
                            </button>
                            <div>
                              <strong>{block.title}</strong>
                              {block.theses.length > 0 ? (
                                <ul>
                                  {block.theses.map((line) => (
                                    <li key={line}>{line}</li>
                                  ))}
                                </ul>
                              ) : null}
                              <button type="button" className="ghost" onClick={() => seekTo(block.start)}>
                                {t('outlineJump')}
                              </button>
                            </div>
                          </article>
                        ))}
                      </div>
                    </details>

                    <div className="outline-assembled">
                      <p className="muted outline-assembled-hint">{t('outlineClickHint')}</p>
                      {doc.blocks.map((block) => (
                        <p
                          key={block.id}
                          className="outline-assembled-block"
                          onClick={() => seekTo(block.start)}
                        >
                          {assembleBlockText(block)}
                        </p>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">{busy ? t('outlineWorking') : t('outlineEmptyHint')}</p>
                )}
              </>
            ) : (
              <p className="muted">{t('videoSelectHint')}</p>
            )}
          </div>
        </div>
      )}

      {exportOpen ? (
        <div className="overlay" onMouseDown={() => setExportOpen(false)}>
          <div className="modal" onMouseDown={(event) => event.stopPropagation()}>
            <h2>{t('outlineExportTitle')}</h2>
            <p className="muted">{t('outlineExportHint')}</p>
            <div className="mode-grid" style={{ marginTop: 16 }}>
              <button
                type="button"
                className={exportChoice === 'all' ? 'mode-card selected' : 'mode-card'}
                onClick={() => setExportChoice('all')}
              >
                <strong>{t('outlineExportAll')}</strong>
                <p className="muted">{analyzedVideos.map((item) => item.displayName).join(', ')}</p>
              </button>
              {analyzedVideos.map((video) => (
                <button
                  key={video.id}
                  type="button"
                  className={exportChoice === video.id ? 'mode-card selected' : 'mode-card'}
                  onClick={() => setExportChoice(video.id)}
                >
                  <strong>{video.displayName}</strong>
                  <p className="muted">{t('outlineExportPick')}</p>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setExportOpen(false)}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={exportBusy}
                onClick={confirmExport}
              >
                {t('outlineExportConfirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
