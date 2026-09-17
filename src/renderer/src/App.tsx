import { useCallback, useEffect, useState } from 'react'
import type { AiMode, AppInfo, LicenseSnapshot, ProjectSummary } from '@shared/types'
import workspaceBg from './assets/taimio-workspace-background.png'
import type { AppView, WorkspaceTab } from './appState'
import { TitleBar } from './components/TitleBar'
import { Sidebar } from './components/Sidebar'
import { NewProjectModal } from './components/NewProjectModal'
import { ConfirmDialog } from './components/ConfirmDialog'
import { ActivateScreen } from './screens/ActivateScreen'
import { WelcomeScreen } from './screens/WelcomeScreen'
import { ProjectsScreen } from './screens/ProjectsScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'
import { api } from './lib/api'
import { t, tf } from './i18n/ru'

export default function App(): React.JSX.Element {
  const [view, setView] = useState<AppView>('home')
  const [tab, setTab] = useState<WorkspaceTab>('video')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [projects, setProjects] = useState<ProjectSummary[]>([])
  const [current, setCurrent] = useState<ProjectSummary | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [access, setAccess] = useState<LicenseSnapshot | null>(null)
  const [accessReady, setAccessReady] = useState(false)

  const refreshAccess = useCallback(async () => {
    const result = await api().getLicenseStatus()
    if (result.ok) setAccess(result.data.snapshot)
    setAccessReady(true)
  }, [])

  const refresh = useCallback(async () => {
    const [infoResult, listResult] = await Promise.all([api().getAppInfo(), api().listProjects()])
    if (infoResult.ok) setInfo(infoResult.data)
    if (listResult.ok) setProjects(listResult.data)
    if (!infoResult.ok) setToast(infoResult.error)
    else if (!listResult.ok) setToast(listResult.error)
    await refreshAccess()
  }, [refreshAccess])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4200)
    return () => window.clearTimeout(timer)
  }, [toast])

  async function openProject(id: string, nextTab: WorkspaceTab = 'video'): Promise<void> {
    const result = await api().openProject(id)
    if (!result.ok) {
      setToast(result.error)
      return
    }
    setCurrent(result.data)
    setTab(nextTab)
    setView('workspace')
    await refresh()
  }

  async function navigate(nextView: AppView, nextTab?: WorkspaceTab): Promise<void> {
    if (nextView === 'workspace') {
      const desiredTab = nextTab ?? 'video'
      if (current) {
        setTab(desiredTab)
        setView('workspace')
        return
      }
      const fallbackId = info?.lastProjectId ?? projects[0]?.id
      if (fallbackId) {
        await openProject(fallbackId, desiredTab)
        return
      }
      setToast(t('needProject'))
      return
    }
    setView(nextView)
  }

  async function createProject(name: string, aiMode: AiMode): Promise<void> {
    setCreating(true)
    setCreateError(null)
    const result = await api().createProject({ name, aiMode })
    setCreating(false)
    if (!result.ok) {
      setCreateError(result.error)
      return
    }
    setShowCreate(false)
    setCurrent(result.data)
    setTab('video')
    setView('workspace')
    await refresh()
  }

  async function confirmDelete(): Promise<void> {
    if (!pendingDelete) return
    const id = pendingDelete.id
    const result = await api().deleteProject(id)
    setPendingDelete(null)
    if (!result.ok) {
      setToast(result.error)
      return
    }
    if (current?.id === id) {
      setCurrent(null)
      setView('projects')
    }
    await refresh()
  }

  return (
    <div
      className="app-root"
      style={{ ['--film-bg' as string]: `url(${workspaceBg})` }}
    >
      <div className="film-deco" aria-hidden="true" />
      <TitleBar />
      {accessReady && access?.state === 'not_activated' ? (
        <ActivateScreen onActivated={() => void refresh()} />
      ) : (
      <div className={view === 'workspace' ? 'shell workspace' : 'shell'}>
        <Sidebar view={view} workspaceTab={tab} compact={view === 'workspace'} onNavigate={(next, nextTab) => void navigate(next, nextTab)} />
        <main className="main">
          {access && (access.state === 'expired' || access.state === 'blocked') ? (
            <p className="access-banner">
              {access.plan === 'trial' && access.state === 'expired'
                ? t('accessTrialExpiredBanner')
                : access.state === 'blocked'
                  ? t('accessStatusBlocked')
                  : t('accessExpiredBanner')}{' '}
              {access.plan === 'trial' && access.state === 'expired' ? null : t('accessReadOnly')}
            </p>
          ) : null}
          {view === 'home' ? (
            <WelcomeScreen
              version={info?.version ?? null}
              onNewProject={() => setShowCreate(true)}
              onOpenProjects={() => setView('projects')}
            />
          ) : null}
          {view === 'projects' ? (
            <ProjectsScreen
              projects={projects}
              onNewProject={() => setShowCreate(true)}
              onOpen={(id) => void openProject(id)}
              onDelete={setPendingDelete}
            />
          ) : null}
          {view === 'settings' ? (
            <SettingsScreen
              info={info}
              access={access}
              onInfoChange={setInfo}
              onAccessChange={setAccess}
              onToast={setToast}
            />
          ) : null}
          {view === 'workspace' && current ? (
            <WorkspaceScreen
              project={current}
              info={info}
              tab={tab}
              onTab={setTab}
              onToast={setToast}
              onProjectChange={setCurrent}
              onProjectStatsMaybeChanged={() => void refresh()}
            />
          ) : null}
        </main>
      </div>
      )}
      {showCreate ? (
        <NewProjectModal
          error={createError}
          busy={creating}
          onClose={() => {
            setShowCreate(false)
            setCreateError(null)
          }}
          onCreate={createProject}
        />
      ) : null}
      {pendingDelete ? (
        <ConfirmDialog
          title={t('deleteTitle')}
          body={tf('deleteBody', { path: pendingDelete.folderPath })}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
