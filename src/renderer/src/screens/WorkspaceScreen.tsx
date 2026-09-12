import type { AppInfo, ProjectSummary } from '@shared/types'
import type { WorkspaceTab } from '../appState'
import { t } from '../i18n/ru'
import { VideosPanel } from './VideosPanel'
import { TranscriptPanel } from './TranscriptPanel'
import { OutlinePanel } from './OutlinePanel'
import { ProjectSettingsPanel } from './ProjectSettingsPanel'
import { SearchPanel } from './SearchPanel'
import { VisualsPanel } from './VisualsPanel'

interface WorkspaceScreenProps {
  project: ProjectSummary
  info: AppInfo | null
  tab: WorkspaceTab
  onTab: (tab: WorkspaceTab) => void
  onToast: (message: string) => void
  onProjectChange: (project: ProjectSummary) => void
  onProjectStatsMaybeChanged: () => void
}

export function WorkspaceScreen({
  project,
  info,
  tab,
  onTab,
  onToast,
  onProjectChange,
  onProjectStatsMaybeChanged
}: WorkspaceScreenProps): React.JSX.Element {
  const tabs: WorkspaceTab[] = ['video', 'transcript', 'outline', 'search', 'visuals', 'project-settings']
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
        <OutlinePanel project={project} info={info} onToast={onToast} />
      ) : tab === 'search' ? (
        <SearchPanel project={project} onToast={onToast} />
      ) : tab === 'visuals' ? (
        <VisualsPanel project={project} onToast={onToast} />
      ) : tab === 'project-settings' ? (
        <ProjectSettingsPanel
          project={project}
          info={info}
          onProjectChange={onProjectChange}
          onToast={onToast}
        />
      ) : null}
    </section>
  )
}
