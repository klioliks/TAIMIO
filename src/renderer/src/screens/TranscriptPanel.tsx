import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, RefreshCw } from 'lucide-react'
import type { PipelineProgressEvent, ProjectSummary, TranscriptDocument, VideoItem } from '@shared/types'
import { displayTranscriptText, estimateTimeFromBodyOffset, findTextOffset } from '@shared/transcriptText'
import { ProcessingVisual } from '../components/ProcessingVisual'
import { VideoPlayer } from '../components/VideoPlayer'
import { api } from '../lib/api'
import { formatTimecode, videoStatusLabel } from '../lib/format'
import { t } from '../i18n/ru'

interface TranscriptPanelProps {
  project: ProjectSummary
  onToast: (message: string) => void
}

export function TranscriptPanel({ project, onToast }: TranscriptPanelProps): React.JSX.Element {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [doc, setDoc] = useState<TranscriptDocument | null>(null)
  const [bodyDraft, setBodyDraft] = useState('')
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [liveLabel, setLiveLabel] = useState<string | null>(null)
  const [liveProgress, setLiveProgress] = useState<number | null>(null)
  const [liveEta, setLiveEta] = useState<string | null>(null)
  const [senseBusy, setSenseBusy] = useState(false)
  const playerRef = useRef<HTMLVideoElement | null>(null)
  const textRef = useRef<HTMLTextAreaElement | null>(null)

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

  async function loadTranscript(videoId: string): Promise<void> {
    const result = await api().getTranscript(project.id, videoId)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setDoc(result.data)
    setBodyDraft(displayTranscriptText(result.data))
  }

  useEffect(() => {
    void refreshVideos()
  }, [project.id])

  useEffect(() => {
    if (!selectedId) {
      setDoc(null)
      setBodyDraft('')
      return
    }
    void loadTranscript(selectedId)
  }, [selectedId, project.id])

  useEffect(() => {
    return api().onPipelineProgress((event: PipelineProgressEvent) => {
      if (event.projectId !== project.id) return
      setVideos((prev) =>
        prev.map((item) =>
          item.id === event.videoId
            ? {
                ...item,
                status: event.status,
                progress: event.progress,
                currentStageLabel: event.label,
                hasTranscript: event.status === 'ready' ? item.hasTranscript : item.hasTranscript
              }
            : item
        )
      )
      if (event.videoId === selectedId) {
        setLiveLabel(event.label)
        setLiveProgress(event.progress)
        setLiveEta(event.etaLabel ?? null)
      }
      if (event.status === 'ready' || event.status === 'failed' || event.status === 'cancelled') {
        void refreshVideos().then((items) => {
          const current = selectedId ?? items[0]?.id
          if (current === event.videoId) {
            void loadTranscript(event.videoId)
            setLiveLabel(null)
            setLiveProgress(null)
            setLiveEta(null)
          }
        })
      }
    })
  }, [project.id, selectedId])

  const baseline = useMemo(() => displayTranscriptText(doc), [doc])
  const dirty = Boolean(doc) && bodyDraft.trim() !== baseline.trim()

  const searchHit = useMemo(() => findTextOffset(bodyDraft, query), [bodyDraft, query])

  const busy =
    selected?.status === 'probing' ||
    selected?.status === 'extracting_audio' ||
    selected?.status === 'transcribing'

  function seekTo(seconds: number): void {
    const player = playerRef.current
    if (!player) return
    player.currentTime = Math.max(0, seconds)
    void player.play().catch(() => undefined)
  }

  function seekFromCaret(): void {
    if (!doc || !textRef.current) return
    const offset = textRef.current.selectionStart ?? 0
    seekTo(estimateTimeFromBodyOffset(doc, offset, selected?.durationSec ?? null))
  }

  function jumpToSearch(): void {
    if (searchHit == null || !doc || !textRef.current) return
    const span = Math.max(2, Math.min(query.trim().length, 12))
    textRef.current.focus()
    textRef.current.setSelectionRange(searchHit, searchHit + span)
    seekTo(estimateTimeFromBodyOffset(doc, searchHit, selected?.durationSec ?? null))
  }

  async function jumpBySense(): Promise<void> {
    if (!selected || query.trim().length < 2) return
    setSenseBusy(true)
    const response = await api().searchProject(project.id, query.trim(), selected.id)
    setSenseBusy(false)
    if (!response.ok) {
      onToast(response.error)
      return
    }
    const hit = response.data.hits[0]
    if (!hit) {
      onToast(t('searchEmpty'))
      return
    }
    if (response.data.mode === 'lexical') {
      onToast(response.data.warning || t('searchFellBackLexical'))
    } else {
      onToast(`${t('searchAt')} ${formatTimecode(hit.start)}`)
    }
    seekTo(hit.start)
  }

  async function startStt(force = false): Promise<void> {
    if (!selected) return
    setStarting(true)
    setLiveLabel(t('transcriptStartHint'))
    setLiveProgress(4)
    setLiveEta(null)
    if (force) {
      setDoc(null)
      setBodyDraft('')
    }
    const result = await api().startPipeline(project.id, selected.id, { forceStt: force })
    setStarting(false)
    if (!result.ok) {
      onToast(result.error)
      setLiveLabel(null)
      setLiveProgress(null)
      setLiveEta(null)
      return
    }
    await refreshVideos()
  }

  async function stopStt(): Promise<void> {
    if (!selected) return
    const result = await api().cancelPipeline(project.id, selected.id)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setLiveLabel(null)
    setLiveProgress(null)
    setLiveEta(null)
    setStarting(false)
    await refreshVideos()
  }

  async function saveEdits(): Promise<void> {
    if (!selected || !doc) return
    setSaving(true)
    const result = await api().saveTranscript(project.id, selected.id, bodyDraft)
    setSaving(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setDoc(result.data)
    setBodyDraft(displayTranscriptText(result.data))
    onToast(t('transcriptSaved'))
    await refreshVideos()
  }

  async function rebuild(): Promise<void> {
    if (!selected) return
    const result = await api().rebuildAnalysis(project.id, selected.id)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    await loadTranscript(selected.id)
    onToast(t('transcriptRebuilt'))
    await refreshVideos()
  }

  function waitingCopy(): string {
    if (busy || starting) {
      if ((liveLabel || selected?.currentStageLabel || '').toLowerCase().includes('скач')) {
        return t('transcriptDownloading')
      }
      return t('transcriptWorking')
    }
    return t('transcriptStartHint')
  }

  function processingMode(): 'download' | 'transcribe' | 'idle' {
    if (!(busy || starting)) return 'idle'
    if ((liveLabel || selected?.currentStageLabel || '').toLowerCase().includes('скач')) return 'download'
    return 'transcribe'
  }

  const showProcessing = Boolean(selected && (busy || starting))

  return (
    <div className="videos-layout">
      <div className="videos-toolbar">
        <div>
          <h2>{t('transcriptTitle')}</h2>
          <p className="muted">{t('transcriptSeekHint')}</p>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="empty-state glass-card" style={{ padding: 32, borderRadius: 24 }}>
          <h2>{t('transcriptEmpty')}</h2>
          <p className="muted">{t('transcriptEmptyHint')}</p>
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
                  {video.analysisStale ? 'Есть правки · ' : ''}
                  {video.currentStageLabel || videoStatusLabel(video.status, video.hasTranscript)}
                </span>
                {(video.status === 'probing' ||
                  video.status === 'extracting_audio' ||
                  video.status === 'transcribing') && (
                  <div className="progress-track">
                    <div className="progress-bar" style={{ width: `${Math.max(4, video.progress)}%` }} />
                  </div>
                )}
              </button>
            ))}
          </div>

          <div className="video-detail glass-card transcript-detail">
            {selected ? (
              <>
                <div className="video-detail-head">
                  <h3>{selected.displayName}</h3>
                  <p className="muted">
                    {liveLabel ||
                      selected.currentStageLabel ||
                      videoStatusLabel(selected.status, selected.hasTranscript)}
                  </p>
                  {liveEta && (busy || starting) ? <p className="processing-eta-inline">{liveEta}</p> : null}
                </div>

                {showProcessing ? (
                  <div className="player-shell compact">
                    <ProcessingVisual
                      mode={processingMode()}
                      progress={liveProgress ?? selected.progress}
                      label={
                        processingMode() === 'download'
                          ? t('transcriptDownloadingShort')
                          : t('transcriptWorkingShort')
                      }
                      etaLabel={processingMode() === 'transcribe' ? liveEta : null}
                    />
                  </div>
                ) : selected.playableInApp && selected.mediaUrl ? (
                  <VideoPlayer key={selected.id} src={selected.mediaUrl} compact playerRef={playerRef} />
                ) : (
                  <div className="player-shell compact">
                    <div className="player-fallback">
                      <p>{selected.sourceExists ? t('videoNotPlayable') : t('videoMissing')}</p>
                    </div>
                  </div>
                )}

                {!showProcessing && (!doc || !selected.hasTranscript) ? (
                  <div className="transcript-waiting">
                    <p>{waitingCopy()}</p>
                    <div className="card-actions wrap">
                      <button
                        type="button"
                        className="primary"
                        disabled={starting || !selected.sourceExists}
                        onClick={() => void startStt(false)}
                      >
                        <RefreshCw size={14} style={{ marginRight: 6 }} />
                        {selected.status === 'cancelled' || selected.status === 'failed'
                          ? t('videoTranscribeAgain')
                          : t('videoTranscribe')}
                      </button>
                    </div>
                  </div>
                ) : null}

                {showProcessing ? (
                  <div className="transcript-waiting">
                    <div className="card-actions wrap">
                      <button type="button" className="ghost" onClick={() => void stopStt()}>
                        <Pause size={14} style={{ marginRight: 6 }} />
                        {t('videoCancel')}
                      </button>
                    </div>
                  </div>
                ) : null}

                {!showProcessing && doc && selected.hasTranscript ? (
                  <>
                    {doc.analysisStale ? <p className="stale-banner">{t('transcriptStale')}</p> : null}
                    <div className="transcript-toolbar">
                      <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t('transcriptSearch')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            event.preventDefault()
                            if (searchHit != null) jumpToSearch()
                            else void jumpBySense()
                          }
                        }}
                      />
                      {query.trim() ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={searchHit == null}
                          onClick={() => jumpToSearch()}
                        >
                          {t('transcriptFind')}
                        </button>
                      ) : null}
                      {query.trim() ? (
                        <button
                          type="button"
                          className="ghost"
                          disabled={senseBusy || !selected.hasTranscript}
                          onClick={() => void jumpBySense()}
                        >
                          {senseBusy ? t('searchWorking') : t('transcriptFindSense')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="ghost"
                        disabled={busy || starting || !selected.sourceExists}
                        onClick={() => void startStt(true)}
                      >
                        <RefreshCw size={14} style={{ marginRight: 6 }} />
                        {t('videoTranscribeAgain')}
                      </button>
                      {dirty ? (
                        <button
                          type="button"
                          className="primary"
                          disabled={saving}
                          onClick={() => void saveEdits()}
                        >
                          {t('transcriptSave')}
                        </button>
                      ) : null}
                      {doc.analysisStale ? (
                        <button type="button" className="ghost" onClick={() => void rebuild()}>
                          {t('transcriptRebuild')}
                        </button>
                      ) : null}
                    </div>
                    {doc.segments.length === 0 && !bodyDraft.trim() ? (
                      <p className="muted">{t('transcriptNoSpeech')}</p>
                    ) : (
                      <>
                        {query.trim() && searchHit == null ? (
                          <p className="muted">{t('transcriptSearchEmpty')}</p>
                        ) : null}
                        <textarea
                          ref={textRef}
                          className="transcript-body"
                          value={bodyDraft}
                          onChange={(event) => setBodyDraft(event.target.value)}
                          onDoubleClick={() => seekFromCaret()}
                          spellCheck
                        />
                      </>
                    )}
                  </>
                ) : null}
              </>
            ) : (
              <p className="muted">{t('videoSelectHint')}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
