import {
  Clapperboard,
  FileText,
  FolderOpen,
  Home,
  Image,
  ScrollText,
  Search,
  Settings
} from 'lucide-react'
import { t } from '../i18n/ru'
import type { AppView, WorkspaceTab } from '../appState'

interface SidebarProps {
  view: AppView
  workspaceTab: WorkspaceTab
  compact: boolean
  onNavigate: (view: AppView, tab?: WorkspaceTab) => void
}

export function Sidebar({ view, workspaceTab, compact, onNavigate }: SidebarProps): React.JSX.Element {
  const items = [
    { id: 'home', label: t('navHome'), icon: Home, action: () => onNavigate('home') },
    { id: 'projects', label: t('navProjects'), icon: FolderOpen, action: () => onNavigate('projects') },
    {
      id: 'analysis',
      label: t('navAnalysis'),
      icon: Clapperboard,
      action: () => onNavigate('workspace', 'video')
    },
    {
      id: 'search',
      label: t('navSearch'),
      icon: Search,
      action: () => onNavigate('workspace', 'search')
    },
    {
      id: 'visuals',
      label: t('navVisuals'),
      icon: Image,
      action: () => onNavigate('workspace', 'visuals')
    },
    {
      id: 'settings',
      label: t('navSettings'),
      icon: Settings,
      action: () => onNavigate('settings')
    }
  ]

  const workspaceItems = [
    { id: 'home', label: t('navHome'), icon: Home, action: () => onNavigate('home') },
    { id: 'projects', label: t('navProjects'), icon: FolderOpen, action: () => onNavigate('projects') },
    { id: 'video', label: t('navVideo'), icon: Clapperboard, action: () => onNavigate('workspace', 'video') },
    { id: 'search', label: t('navSearch'), icon: Search, action: () => onNavigate('workspace', 'search') },
    { id: 'visuals', label: t('navVisuals'), icon: Image, action: () => onNavigate('workspace', 'visuals') },
    {
      id: 'transcript',
      label: t('navTranscript'),
      icon: ScrollText,
      action: () => onNavigate('workspace', 'transcript')
    },
    { id: 'outline', label: t('navOutline'), icon: FileText, action: () => onNavigate('workspace', 'outline') },
    { id: 'settings', label: t('navProjectSettings'), icon: Settings, action: () => onNavigate('workspace', 'project-settings') }
  ]

  const nav = compact ? workspaceItems : items

  return (
    <aside className="sidebar">
      <nav className="sidebar-nav">
        {nav.map((item) => {
          const Icon = item.icon
          const active =
            item.id === 'home'
              ? view === 'home'
              : item.id === 'projects'
                ? view === 'projects'
                : item.id === 'settings' && !compact
                  ? view === 'settings'
                  : view === 'workspace' &&
                    (workspaceTab === item.id ||
                      (item.id === 'analysis' && workspaceTab === 'video') ||
                      (item.id === 'settings' && workspaceTab === 'project-settings'))
          return (
            <button
              key={item.id}
              type="button"
              className={active ? 'nav-item active' : 'nav-item'}
              onClick={item.action}
              title={item.label}
            >
              <Icon size={20} />
              {compact ? null : <span>{item.label}</span>}
            </button>
          )
        })}
      </nav>
      {compact ? null : (
        <div className="sidebar-quote">
          {t('quote')}
          <span>♡</span>
        </div>
      )}
    </aside>
  )
}
