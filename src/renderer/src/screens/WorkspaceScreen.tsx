import type { ProjectSummary } from '@shared/types'
import type { WorkspaceTab } from '../appState'
import { t } from '../i18n/ru'
import { VideosPanel } from './VideosPanel'
import { TranscriptPanel } from './TranscriptPanel'
import { OutlinePanel } from './OutlinePanel'
import { ProjectSettingsPanel } from './ProjectSettingsPanel'
import { SearchPanel } from './SearchPanel'

interface WorkspaceScreenProps {
  project: ProjectSummary
  tab: WorkspaceTab
  onTab: (tab: WorkspaceTab) => void
  onToast: (message: string) => void
  onProjectChange: (project: ProjectSummary) => void
  onProjectStatsMaybeChanged: () => void
}

const stubs: Record<Exclude<WorkspaceTab, 'video' | 'transcript' | 'outline' | 'project-settings' | 'search'>, { title: string; body: string }> = {
  visuals: { title: t('navVisuals'), body: t('workspaceStubVisuals') }
}

export function WorkspaceScreen({
  project,
  tab,
  onTab,
  onToast,
  onProjectChange,
  onProjectStatsMaybeChanged
}: WorkspaceScreenProps): React.JSX.Element {
  const tabs: WorkspaceTab[] = ['video', 'outline', 'transcript', 'search', 'visuals', 'project-settings']
  const titles: Record<WorkspaceTab, string> = {
    video: t('navVideo'),
    outline: t('navOutline'),
    transcript: t('navTranscript'),
    search: t('navSearch'),
    visuals: t('navVisuals'),
    'project-settings': t('navProjectSettings')
  }

  return (
    <section className="workspace-frame">
      <div className="workspace-top">
        <div>
          <p className="muted">{t('appName')}</p>
          <h1>{project.name}</h1>
        </div>
        <div className="pipeline-h" aria-hidden="true">
          <span>{t('pipelineVideo')}</span>
          <span>{t('pipelineMeanings')}</span>
          <span>{t('pipelineKnowledge')}</span>
          <span>{t('pipelineYou')}</span>
        </div>
      </div>
      <div className="badge-row" style={{ margin: '0 8px 16px' }}>
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            className={item === tab ? 'primary' : 'ghost'}
            onClick={() => onTab(item)}
          >
            {titles[item]}
          </button>
        ))}
      </div>
      {tab === 'video' ? (
        <VideosPanel
          project={project}
          onToast={onToast}
          onProjectStatsMaybeChanged={onProjectStatsMaybeChanged}
        />
      ) : tab === 'transcript' ? (
        <TranscriptPanel project={project} onToast={onToast} />
      ) : tab === 'outline' ? (
        <OutlinePanel project={project} onToast={onToast} />
      ) : tab === 'search' ? (
        <SearchPanel project={project} onToast={onToast} />
      ) : tab === 'project-settings' ? (
        <ProjectSettingsPanel
          project={project}
          onProjectChange={onProjectChange}
          onToast={onToast}
        />
      ) : (
        <article className="stub-card">
          <h2>{stubs[tab].title}</h2>
          <p className="muted">{t('workspaceStubTitle')}</p>
          <p>{stubs[tab].body}</p>
        </article>
      )}
    </section>
  )
}
