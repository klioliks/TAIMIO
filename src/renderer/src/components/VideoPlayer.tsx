import { useEffect, useRef, useState, type Ref } from 'react'
import { Pause, Play } from 'lucide-react'
import { formatTimecode } from '../lib/format'
import { t } from '../i18n/ru'

interface VideoPlayerProps {
  src: string
  compact?: boolean
  startAt?: number
  playerRef?: Ref<HTMLVideoElement | null>
}

function assignRef(ref: Ref<HTMLVideoElement | null> | undefined, node: HTMLVideoElement | null): void {
  if (!ref) return
  if (typeof ref === 'function') {
    ref(node)
    return
  }
  ref.current = node
}

export function VideoPlayer({ src, compact, startAt, playerRef }: VideoPlayerProps): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const dragging = useRef(false)
  const [playing, setPlaying] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)

  function bind(node: HTMLVideoElement | null): void {
    videoRef.current = node
    assignRef(playerRef, node)
  }

  function togglePlay(): void {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      void video.play().catch(() => undefined)
      return
    }
    video.pause()
  }

  function seek(seconds: number): void {
    const video = videoRef.current
    if (!video) return
    const next = Math.max(0, Math.min(seconds, duration || video.duration || seconds))
    video.currentTime = next
    setCurrent(next)
  }

  useEffect(() => {
    if (startAt == null) return
    seek(startAt)
  }, [startAt, src])

  const total = duration > 0 ? duration : 0.1

  return (
    <div className={compact ? 'player-block compact' : 'player-block'}>
      <div className={compact ? 'player-shell compact' : 'player-shell'}>
        <video
          ref={bind}
          src={src}
          preload="metadata"
          onClick={() => togglePlay()}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(event) => {
            if (!dragging.current) setCurrent(event.currentTarget.currentTime)
          }}
          onLoadedMetadata={(event) => {
            setDuration(event.currentTarget.duration || 0)
            if (startAt != null) {
              event.currentTarget.currentTime = Math.max(0, startAt)
              setCurrent(startAt)
              return
            }
            setCurrent(event.currentTarget.currentTime || 0)
          }}
          onDurationChange={(event) => {
            if (Number.isFinite(event.currentTarget.duration)) {
              setDuration(event.currentTarget.duration)
            }
          }}
          onEnded={() => setPlaying(false)}
        />
      </div>
      <div className="player-chrome">
        <button
          type="button"
          className="player-chrome-play"
          aria-label={playing ? t('videoPause') : t('videoPlay')}
          onClick={() => togglePlay()}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <input
          type="range"
          min={0}
          max={total}
          step={0.1}
          value={Math.min(current, total)}
          aria-label={t('videoSeek')}
          onPointerDown={() => {
            dragging.current = true
          }}
          onPointerUp={() => {
            dragging.current = false
          }}
          onChange={(event) => seek(Number(event.target.value))}
        />
        <span>
          {formatTimecode(current)} / {formatTimecode(duration)}
        </span>
      </div>
    </div>
  )
}
