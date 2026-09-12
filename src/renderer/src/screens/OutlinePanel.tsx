import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import type {
  AnalysisDocument,
  AppInfo,
  ProjectSummary,
  RetellDocument,
  TranscriptDocument,
  VideoItem
} from '@shared/types'
import { findOutlineSeekTime, rematchOutlineBlocks } from '@shared/outlineAlign'
import { VideoPlayer } from '../components/VideoPlayer'
import { api } from '../lib/api'
import { videoStatusLabel } from '../lib/format'
import { t } from '../i18n/ru'

interface OutlinePanelProps {
  project: ProjectSummary
  info: AppInfo | null
  onToast: (message: string) => void
}

export function OutlinePanel({ project, info, onToast }: OutlinePanelProps): React.JSX.Element {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [doc, setDoc] = useState<AnalysisDocument | null>(null)
  const [retell, setRetell] = useState<RetellDocument | null>(null)
  const [transcript, setTranscript] = useState<TranscriptDocument | null>(null)
  const [busy, setBusy] = useState(false)
  const [retellBusy, setRetellBusy] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportIds, setExportIds] = useState<string[]>([])
  const [exportKind, setExportKind] = useState<'plan' | 'conspect'>('plan')
  const playerRef = useRef<HTMLVideoElement | null>(null)

  const selected = useMemo(
    () => videos.find((item) => item.id === selectedId) ?? null,
    [videos, selectedId]
  )
  const analyzedVideos = useMemo(() => videos.filter((item) => item.hasAnalysis), [videos])
  const alignedBlocks = useMemo(() => {
    if (!doc?.blocks.length) return []
    if (!transcript?.segments.length) return doc.blocks
    return rematchOutlineBlocks(doc.blocks, transcript.segments)
  }, [doc, transcript])

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
    const [analysisResult, retellResult, transcriptResult] = await Promise.all([
      api().getAnalysis(project.id, videoId),
      api().getRetell(project.id, videoId),
      api().getTranscript(project.id, videoId)
    ])
    if (!analysisResult.ok) {
      onToast(analysisResult.error)
      return
    }
    if (!retellResult.ok) {
      onToast(retellResult.error)
      return
    }
    if (!transcriptResult.ok) {
      onToast(transcriptResult.error)
      return
    }
    setDoc(analysisResult.data)
    setRetell(retellResult.data)
    setTranscript(transcriptResult.data)
  }

  useEffect(() => {
    void refreshVideos()
  }, [project.id])

  useEffect(() => {
    if (!selectedId) {
      setDoc(null)
      setRetell(null)
      setTranscript(null)
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
    const transcriptResult = await api().getTranscript(project.id, selected.id)
    if (transcriptResult.ok) setTranscript(transcriptResult.data)
  }

  async function buildRetell(): Promise<void> {
    if (!selected) return
    setRetellBusy(true)
    const result = await api().rebuildRetell(project.id, selected.id)
    setRetellBusy(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setRetell(result.data)
    onToast(t('retellReady'))
    await refreshVideos()
    const transcriptResult = await api().getTranscript(project.id, selected.id)
    if (transcriptResult.ok) setTranscript(transcriptResult.data)
  }

  function seekTo(seconds: number): void {
    const player = playerRef.current
    if (!player) return
    player.currentTime = Math.max(0, seconds)
    void player.play().catch(() => undefined)
  }

  function seekByText(text: string, fallback: number): void {
    const matched = transcript?.segments.length
      ? findOutlineSeekTime(text, transcript.segments)
      : null
    seekTo(matched ?? fallback)
  }

  async function exportDocx(videoIds: string[], kind: 'plan' | 'conspect'): Promise<void> {
    setExportBusy(true)
    const result = await api().exportOutlineDocx(project.id, videoIds, kind)
    setExportBusy(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    if (result.data.canceled) return
    setExportOpen(false)
    onToast(kind === 'conspect' ? t('conspectExported') : t('outlineExported'))
  }

  function startExport(kind: 'plan' | 'conspect'): void {
    if (analyzedVideos.length === 0) {
      onToast(t('outlineExportEmpty'))
      return
    }
    if (analyzedVideos.length === 1) {
      void exportDocx([analyzedVideos[0].id], kind)
      return
    }
    const initial =
      selected?.hasAnalysis ? [selected.id] : analyzedVideos.map((item) => item.id)
    setExportKind(kind)
    setExportIds(initial)
    setExportOpen(true)
  }

  function toggleExportId(videoId: string): void {
    setExportIds((current) =>
      current.includes(videoId)
        ? current.filter((id) => id !== videoId)
        : [...current, videoId]
    )
  }

  function toggleExportAll(): void {
    setExportIds((current) =>
      current.length === analyzedVideos.length
        ? []
        : analyzedVideos.map((item) => item.id)
    )
  }

  function confirmExport(): void {
    if (exportIds.length === 0) {
      onToast(t('outlineExportNeedPick'))
      return
    }
    const ordered = analyzedVideos
      .map((item) => item.id)
      .filter((id) => exportIds.includes(id))
    void exportDocx(ordered, exportKind)
  }

  const localReady = Boolean(info?.localLlmReady)
  const canAnalyze =
    Boolean(selected?.hasTranscript) &&
    (project.aiMode === 'cloud' || (project.aiMode === 'local' && localReady))

  function hint(): string {
    if (!selected?.hasTranscript) return t('outlineNeedTranscript')
    if (project.aiMode === 'local' && !localReady) return t('outlineNeedLocal')
    if (project.aiMode === 'cloud' && !info?.openaiKeySet) return t('outlineNeedKey')
    if (selected.analysisStale && selected.hasAnalysis) return t('outlineStale')
    if (selected.retellStale && selected.hasRetell) return t('retellStale')
    return t('retellHint')
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
                    disabled={busy || !canAnalyze}
                    onClick={() => void build()}
                  >
                    <RefreshCw size={14} style={{ marginRight: 6 }} />
                    {busy
                      ? project.aiMode === 'local'
                        ? t('outlineWorkingLocal')
                        : t('outlineWorking')
                      : selected.hasAnalysis
                        ? t('outlineRebuild')
                        : t('outlineBuild')}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={retellBusy || !canAnalyze}
                    onClick={() => void buildRetell()}
                  >
                    <RefreshCw size={14} style={{ marginRight: 6 }} />
                    {retellBusy
                      ? project.aiMode === 'local'
                        ? t('retellWorkingLocal')
                        : t('retellWorking')
                      : selected.hasRetell
                        ? t('retellRebuild')
                        : t('retellBuild')}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={exportBusy || analyzedVideos.length === 0}
                    onClick={() => startExport('plan')}
                  >
                    <Download size={14} style={{ marginRight: 6 }} />
                    {t('outlineDownload')}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    disabled={exportBusy || analyzedVideos.length === 0}
                    onClick={() => startExport('conspect')}
                  >
                    <Download size={14} style={{ marginRight: 6 }} />
                    {t('conspectDownload')}
                  </button>
                </div>

                {project.aiMode === 'local' ? (
                  <p className="search-local-note outline-local-note">
                    {localReady ? t('outlineLocalBanner') : t('outlineLocalMissing')}
                  </p>
                ) : null}

                <section className="retell-card">
                  <h4>{t('retellTitle')}</h4>
                  {selected.retellStale && retell?.text ? (
                    <p className="stale-banner">{t('retellStale')}</p>
                  ) : null}
                  {retell?.text ? (
                    retell.text.split(/\n+/).map((paragraph, index) => (
                      <p key={`${index}-${paragraph.slice(0, 24)}`}>{paragraph}</p>
                    ))
                  ) : (
                    <p className="muted">{retellBusy ? t('retellWorking') : t('retellEmpty')}</p>
                  )}
                </section>

                {alignedBlocks.length > 0 ? (
                  <div className="outline-assembled">
                    <h4>{t('outlineTitle')}</h4>
                    <p className="muted outline-assembled-hint">{t('outlineClickHint')}</p>
                    {alignedBlocks.map((block) => (
                      <article
                        key={block.id}
                        className="outline-assembled-block"
                        onClick={() =>
                          seekByText(`${block.title}. ${block.theses.join(' ')}`, block.start)
                        }
                      >
                        <h4>{block.title}</h4>
                        {block.theses.length > 0 ? (
                          <ul>
                            {block.theses.map((line) => (
                              <li
                                key={line}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  seekByText(line, block.start)
                                }}
                              >
                                {line}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </article>
                    ))}
                  </div>
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
            <h2>{exportKind === 'conspect' ? t('conspectExportTitle') : t('outlineExportTitle')}</h2>
            <p className="muted">
              {exportKind === 'conspect' ? t('conspectExportHint') : t('outlineExportHint')}
            </p>
            <div className="mode-grid" style={{ marginTop: 16 }}>
              <button
                type="button"
                className={
                  exportIds.length === analyzedVideos.length ? 'mode-card selected' : 'mode-card'
                }
                onClick={toggleExportAll}
              >
                <strong>{t('outlineExportAll')}</strong>
                <p className="muted">{t('outlineExportAllHint')}</p>
              </button>
              {analyzedVideos.map((video) => {
                const checked = exportIds.includes(video.id)
                return (
                  <button
                    key={video.id}
                    type="button"
                    className={checked ? 'mode-card selected' : 'mode-card'}
                    onClick={() => toggleExportId(video.id)}
                  >
                    <span className="outline-export-row">
                      <span className={checked ? 'outline-check on' : 'outline-check'} aria-hidden="true">
                        {checked ? '✓' : ''}
                      </span>
                      <strong>{video.displayName}</strong>
                    </span>
                  </button>
                )
              })}
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setExportOpen(false)}>
                {t('cancel')}
              </button>
              <button
                type="button"
                className="primary"
                disabled={exportBusy || exportIds.length === 0}
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
