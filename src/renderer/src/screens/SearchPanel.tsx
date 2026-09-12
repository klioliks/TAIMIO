import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import type { ProjectSummary, SearchHit, SearchResponse, VideoItem } from '@shared/types'
import { VideoPlayer } from '../components/VideoPlayer'
import { api } from '../lib/api'
import { formatTimecode } from '../lib/format'
import { t } from '../i18n/ru'

interface SearchPanelProps {
  project: ProjectSummary
  onToast: (message: string) => void
}

function relevanceLabel(score: number): string {
  if (score >= 0.62) return t('searchRelHigh')
  if (score >= 0.38) return t('searchRelMid')
  return t('searchRelLow')
}

export function SearchPanel({ project, onToast }: SearchPanelProps): React.JSX.Element {
  const [videos, setVideos] = useState<VideoItem[]>([])
  const [filterId, setFilterId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SearchResponse | null>(null)
  const [active, setActive] = useState<SearchHit | null>(null)

  useEffect(() => {
    void api()
      .listVideos(project.id)
      .then((response) => {
        if (!response.ok) {
          onToast(response.error)
          return
        }
        setVideos(response.data)
      })
  }, [project.id, onToast])

  const activeVideo = useMemo(
    () => videos.find((item) => item.id === active?.videoId) ?? null,
    [videos, active]
  )

  async function runSearch(): Promise<void> {
    const q = query.trim()
    if (q.length < 2) {
      onToast(t('searchNeedQuery'))
      return
    }
    setBusy(true)
    const response = await api().searchProject(project.id, q, filterId)
    setBusy(false)
    if (!response.ok) {
      onToast(response.error)
      return
    }
    setResult(response.data)
    setActive(response.data.hits[0] ?? null)
    if (response.data.warning) onToast(response.data.warning)
  }

  function jump(hit: SearchHit): void {
    setActive(hit)
  }

  const readyCount = videos.filter((item) => item.hasTranscript).length

  return (
    <div className="videos-layout">
      <div className="videos-toolbar">
        <div>
          <h2>{t('searchTitle')}</h2>
          <p className="muted">
            {project.aiMode === 'cloud' ? t('searchHintCloud') : t('searchHintLocal')}
          </p>
          {result ? (
            <p className="muted">
              {result.mode === 'semantic' ? t('searchModeSemantic') : t('searchModeLexical')}
            </p>
          ) : null}
        </div>
      </div>

      <div className="search-filters">
        <button
          type="button"
          className={!filterId ? 'primary' : 'ghost'}
          onClick={() => setFilterId(null)}
        >
          {t('searchAllVideos')}
        </button>
        {videos.map((video) => (
          <button
            key={video.id}
            type="button"
            className={filterId === video.id ? 'primary' : 'ghost'}
            onClick={() => setFilterId(video.id)}
          >
            {video.displayName}
          </button>
        ))}
      </div>

      <form
        className="search-bar"
        onSubmit={(event) => {
          event.preventDefault()
          void runSearch()
        }}
      >
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('searchPlaceholder')}
        />
        <button type="submit" className="primary" disabled={busy || readyCount === 0}>
          <Search size={16} style={{ marginRight: 6 }} />
          {busy ? t('searchWorking') : t('searchRun')}
        </button>
      </form>

      {readyCount === 0 ? <p className="muted">{t('searchNeedTranscript')}</p> : null}

      <div className="search-grid">
        <div className="search-hits">
          {result && result.hits.length === 0 ? <p className="muted">{t('searchEmpty')}</p> : null}
          {result?.hits.map((hit) => (
            <article
              key={`${hit.videoId}-${hit.start}-${hit.rank}`}
              className={
                active && active.videoId === hit.videoId && active.start === hit.start
                  ? 'search-hit active'
                  : 'search-hit'
              }
            >
              <div className="search-hit-top">
                <strong>{hit.videoName}</strong>
                <span className="search-rel">
                  {formatTimecode(hit.start)} · {relevanceLabel(hit.score)}
                </span>
              </div>
              <p>{hit.snippet}</p>
              <p className="muted">{hit.explanation}</p>
              <button type="button" className="ghost" onClick={() => jump(hit)}>
                {t('searchJump')}
              </button>
            </article>
          ))}
        </div>

        <div className="video-detail glass-card">
          {activeVideo?.playableInApp && activeVideo.mediaUrl && active ? (
            <>
              <div className="video-detail-head">
                <h3>{activeVideo.displayName}</h3>
                <p className="muted">
                  {t('searchAt')} {formatTimecode(active.start)}
                </p>
              </div>
              <VideoPlayer
                key={`${active.videoId}-${active.start}`}
                src={activeVideo.mediaUrl}
                compact
                startAt={active.start}
              />
            </>
          ) : (
            <p className="muted">{result ? t('searchPickHit') : t('searchIdle')}</p>
          )}
        </div>
      </div>
    </div>
  )
}
