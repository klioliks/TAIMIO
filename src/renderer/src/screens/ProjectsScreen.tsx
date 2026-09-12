import type { ProjectSummary } from '@shared/types'
import { t, tf } from '../i18n/ru'
import { formatDateTime, statusLabel, videoCountLabel } from '../lib/format'

interface ProjectsScreenProps {
  projects: ProjectSummary[]
  onNewProject: () => void
  onOpen: (id: string) => void
  onDelete: (project: ProjectSummary) => void
}

export function ProjectsScreen({
  projects,
  onNewProject,
  onOpen,
  onDelete
}: ProjectsScreenProps): React.JSX.Element {
  return (
    <section>
      <div className="page-head">
        <h1>{t('projectsTitle')}</h1>
        <button type="button" className="primary" onClick={onNewProject}>
          {t('newProject')}
        </button>
      </div>
      {projects.length === 0 ? (
        <div className="empty-state glass-card" style={{ padding: 32, borderRadius: 24 }}>
          <h2>{t('projectsEmpty')}</h2>
          <p className="muted">{t('projectsEmptyHint')}</p>
          <div style={{ marginTop: 16 }}>
            <button type="button" className="primary" onClick={onNewProject}>
              {t('newProject')}
            </button>
          </div>
        </div>
      ) : (
        <div className="project-grid">
          {projects.map((project) => (
            <article className="project-card" key={project.id}>
              <h3>{project.name}</h3>
              <div className="badge-row">
                <span className={project.aiMode === 'local' ? 'badge local' : 'badge'}>
                  {project.aiMode === 'local' ? t('modeLocal') : t('modeCloud')}
                </span>
                <span className="badge">{statusLabel(project.processingStatus)}</span>
              </div>
              <p className="muted">{videoCountLabel(project.videoCount)}</p>
              <p className="muted">{tf('lastOpened', { date: formatDateTime(project.lastOpenedAt) })}</p>
              <div className="card-actions">
                <button type="button" className="primary" onClick={() => onOpen(project.id)}>
                  {t('open')}
                </button>
                <button type="button" className="ghost" onClick={() => onDelete(project)}>
                  {t('delete')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
