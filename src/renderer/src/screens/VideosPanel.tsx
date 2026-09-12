import { useEffect, useMemo, useState } from 'react'
import { Download, Film, FolderOpen, Pause, Plus, RefreshCw, Trash2 } from 'lucide-react'
import type { PipelineProgressEvent, ProjectSummary, VideoItem } from '@shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { VideoPlayer } from '../components/VideoPlayer'
import { api } from '../lib/api'
import { formatBytes, formatDuration, videoStatusLabel } from '../lib/format'
import { t, tf } from '../i18n/ru'

interface VideosPanelProps {
  project: ProjectSummary
  onToast: (message: string) => void
  onProjectStatsMaybeChanged: () => void
}

export function VideosPanel({
  project,
  onToast,
  onProjectStatsMaybeChanged
}: VideosPanelProps): React.JSX.Element {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [pendingDelete, setPendingDelete] = useState<VideoItem | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportBusy, setExportBusy] = useState(false)
  const [exportIds, setExportIds] = useState<string[]>([])

  const selected = useMemo(
    () => videos.find((item) => item.id === selectedId) ?? null,
    [videos, selectedId]
  )

  async function refresh(): Promise<void> {
    const result = await api().listVideos(project.id)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setVideos(result.data)
    setSelectedId((current) => {
      if (current && result.data.some((item) => item.id === current)) return current
      return result.data[0]?.id ?? null
    })
  }

  useEffect(() => {
    void refresh()
  }, [project.id])

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
                currentStageLabel: event.label
              }
            : item
        )
      )
      if (
        event.status === 'ready' ||
        event.status === 'failed' ||
        event.status === 'cancelled' ||
        event.status === 'missing_source'
      ) {
        void refresh().then(() => onProjectStatsMaybeChanged())
      }
    })
  }, [project.id, onProjectStatsMaybeChanged])

  async function importPaths(paths: string[]): Promise<void> {
    if (paths.length === 0) return
    setBusy(true)
    const result = await api().importVideos(project.id, paths)
    setBusy(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    await refresh()
    onProjectStatsMaybeChanged()
    if (result.data[0]) setSelectedId(result.data[0].id)
  }

  async function onAddClick(): Promise<void> {
    const picked = await api().pickVideoFiles()
    if (!picked.ok) {
      onToast(picked.error)
      return
    }
    await importPaths(picked.data)
  }

  function onDrop(event: React.DragEvent<HTMLElement>): void {
    event.preventDefault()
    setDragging(false)
    const files = [...event.dataTransfer.files]
    const paths = files
      .map((file) => {
        try {
          return api().getPathForFile(file)
        } catch {
          return ''
        }
      })
      .filter(Boolean)
    void importPaths(paths)
  }

  async function saveRename(): Promise<void> {
    if (!renameId) return
    const result = await api().renameVideo(project.id, renameId, renameValue)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    setRenameId(null)
    await refresh()
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return
    const id = pendingDelete.id
    setPendingDelete(null)
    const result = await api().deleteVideo(project.id, id)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    await refresh()
    onProjectStatsMaybeChanged()
  }

  async function exportReport(videoIds: string[]): Promise<void> {
    setExportBusy(true)
    const result = await api().exportReportDocx(project.id, videoIds)
    setExportBusy(false)
    if (!result.ok) {
      onToast(result.error)
      return
    }
    if (result.data.canceled) return
    setExportOpen(false)
    onToast(t('reportExported'))
  }

  function startReportExport(): void {
    if (videos.length === 0) {
      onToast(t('reportExportEmpty'))
      return
    }
    if (videos.length === 1) {
      void exportReport([videos[0].id])
      return
    }
    setExportIds(selected ? [selected.id] : videos.map((item) => item.id))
    setExportOpen(true)
  }

  function toggleExportId(videoId: string): void {
    setExportIds((current) =>
      current.includes(videoId) ? current.filter((id) => id !== videoId) : [...current, videoId]
    )
  }

  function confirmReportExport(): void {
    if (exportIds.length === 0) {
      onToast(t('outlineExportNeedPick'))
      return
    }
    const ordered = videos.map((item) => item.id).filter((id) => exportIds.includes(id))
    void exportReport(ordered)
  }

  return (
    <div
      className={dragging ? 'videos-layout drop-active' : 'videos-layout'}
      onDragOver={(event) => {
        event.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="videos-toolbar">
        <div>
          <h2>{t('videoTitle')}</h2>
          <p className="muted">{videos.length} файл(ов) в проекте</p>
        </div>
        <div className="card-actions wrap">
          <button
            type="button"
            className="ghost"
            disabled={exportBusy || videos.length === 0}
            onClick={startReportExport}
          >
            <Download size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {t('reportDownload')}
          </button>
          <button type="button" className="primary" disabled={busy} onClick={() => void onAddClick()}>
            <Plus size={16} style={{ marginRight: 8, verticalAlign: 'middle' }} />
            {t('videoAdd')}
          </button>
        </div>
      </div>

      {videos.length === 0 ? (
        <div className="empty-state glass-card" style={{ padding: 32, borderRadius: 24 }}>
          <Film size={28} />
          <h2>{t('videoEmpty')}</h2>
          <p className="muted">{dragging ? t('videoDrop') : t('videoEmptyHint')}</p>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="primary" onClick={() => void onAddClick()}>
              {t('videoAdd')}
            </button>
          </div>
        </div>
      ) : (
        <div className="videos-grid">
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
                  {videoStatusLabel(video.status, video.hasTranscript)}
                  {video.durationSec != null ? ` · ${formatDuration(video.durationSec)}` : ''}
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

          <div className="video-detail glass-card">
            {selected ? (
              <>
                <div className="video-detail-head">
                  {renameId === selected.id ? (
                    <div className="rename-row">
                      <input
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        autoFocus
                      />
                      <button type="button" className="primary" onClick={() => void saveRename()}>
                        {t('save')}
                      </button>
                      <button type="button" className="ghost" onClick={() => setRenameId(null)}>
                        {t('cancel')}
                      </button>
                    </div>
                  ) : (
                    <h3>{selected.displayName}</h3>
                  )}
                  <p className="muted">{selected.fileName}</p>
                </div>

                {selected.playableInApp && selected.mediaUrl ? (
                  <VideoPlayer key={selected.id} src={selected.mediaUrl} />
                ) : (
                  <div className="player-shell">
                    <div className="player-fallback">
                      <p>{selected.sourceExists ? t('videoNotPlayable') : t('videoMissing')}</p>
                      {selected.sourceExists ? (
                        <button
                          type="button"
                          className="ghost"
                          onClick={() => void api().openExternalPath(selected.sourcePath)}
                        >
                          <FolderOpen size={16} style={{ marginRight: 8 }} />
                          {t('videoOpenExternal')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}

                <div className="meta-grid">
                  <div>
                    <span className="muted">{t('videoDuration')}</span>
                    <strong>{formatDuration(selected.durationSec)}</strong>
                  </div>
                  <div>
                    <span className="muted">{t('videoSize')}</span>
                    <strong>{formatBytes(selected.sizeBytes)}</strong>
                  </div>
                  <div>
                    <span className="muted">{t('videoFormat')}</span>
                    <strong>
                      {[selected.container, selected.videoCodec].filter(Boolean).join(' / ') || '—'}
                    </strong>
                  </div>
                  <div>
                    <span className="muted">Статус</span>
                    <strong>
                      {selected.currentStageLabel ||
                        videoStatusLabel(selected.status, selected.hasTranscript)}
                    </strong>
                  </div>
                </div>

                {(selected.status === 'probing' ||
                  selected.status === 'extracting_audio' ||
                  selected.status === 'transcribing') && (
                  <div className="progress-track large">
                    <div className="progress-bar" style={{ width: `${Math.max(4, selected.progress)}%` }} />
                  </div>
                )}

                <div className="card-actions wrap">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      setRenameId(selected.id)
                      setRenameValue(selected.displayName)
                    }}
                  >
                    {t('videoRename')}
                  </button>
                  {(selected.status === 'failed' ||
                    selected.status === 'cancelled' ||
                    selected.status === 'registered' ||
                    selected.status === 'ready') && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        void api()
                          .startPipeline(project.id, selected.id, {
                            forceStt: selected.hasTranscript
                          })
                          .then(refresh)
                      }
                    >
                      <RefreshCw size={14} style={{ marginRight: 6 }} />
                      {selected.hasTranscript ? t('videoTranscribeAgain') : t('videoTranscribe')}
                    </button>
                  )}
                  {(selected.status === 'probing' ||
                    selected.status === 'extracting_audio' ||
                    selected.status === 'transcribing') && (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        void api()
                          .cancelPipeline(project.id, selected.id)
                          .then(refresh)
                      }
                    >
                      <Pause size={14} style={{ marginRight: 6 }} />
                      {t('videoCancel')}
                    </button>
                  )}
                  {selected.status === 'missing_source' || !selected.sourceExists ? (
                    <button
                      type="button"
                      className="ghost"
                      onClick={() =>
                        void api()
                          .relinkVideo(project.id, selected.id)
                          .then(refresh)
                      }
                    >
                      {t('videoRelink')}
                    </button>
                  ) : null}
                  <button type="button" className="ghost" onClick={() => setPendingDelete(selected)}>
                    <Trash2 size={14} style={{ marginRight: 6 }} />
                    {t('delete')}
                  </button>
                </div>
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
            <h2>{t('reportExportTitle')}</h2>
            <p className="muted">{t('reportExportHint')}</p>
            <div className="mode-grid" style={{ marginTop: 16 }}>
              <button
                type="button"
                className={exportIds.length === videos.length ? 'mode-card selected' : 'mode-card'}
                onClick={() =>
                  setExportIds(exportIds.length === videos.length ? [] : videos.map((item) => item.id))
                }
              >
                <strong>{t('outlineExportAll')}</strong>
                <p className="muted">{t('outlineExportAllHint')}</p>
              </button>
              {videos.map((video) => {
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
                onClick={confirmReportExport}
              >
                {t('outlineExportConfirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          title={t('videoDeleteTitle')}
          body={tf('videoDeleteBody', { path: pendingDelete.sourcePath })}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </div>
  )
}
