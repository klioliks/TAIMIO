import {
  FileText,
  FolderOpen,
  FolderPlus,
  Image,
  ListTree,
  Search,
  ShieldCheck
} from 'lucide-react'
import { useState } from 'react'
import logo from '../assets/taimio-logo.png'
import { AboutModal } from '../components/AboutModal'
import { t } from '../i18n/ru'

interface WelcomeScreenProps {
  onNewProject: () => void
  onOpenProjects: () => void
}

export function WelcomeScreen({ onNewProject, onOpenProjects }: WelcomeScreenProps): React.JSX.Element {
  const [aboutOpen, setAboutOpen] = useState(false)
  const features = [
    { title: t('featureTranscript'), hint: t('featureTranscriptHint'), icon: FileText },
    { title: t('featureOutline'), hint: t('featureOutlineHint'), icon: ListTree },
    { title: t('featureSearch'), hint: t('featureSearchHint'), icon: Search },
    { title: t('featureVisuals'), hint: t('featureVisualsHint'), icon: Image },
    { title: t('featureLocal'), hint: t('featureLocalHint'), icon: ShieldCheck }
  ]

  return (
    <section className="welcome">
      <p className="handwritten top-right">{t('handwrittenKnowledge')}</p>
      <img className="welcome-logo" src={logo} alt={t('appName')} />
      <h1 className="welcome-name">
        TAIM<span className="io">IO</span>
      </h1>
      <p className="welcome-slogan">{t('slogan')}</p>
      <div className="cta-row">
        <button type="button" className="cta-card" onClick={onNewProject}>
          <span className="cta-icon">
            <FolderPlus size={22} />
          </span>
          <span>
            <h2>{t('newProject')}</h2>
            <p>{t('newProjectHint')}</p>
          </span>
        </button>
        <button type="button" className="cta-card" onClick={onOpenProjects}>
          <span className="cta-icon">
            <FolderOpen size={22} />
          </span>
          <span>
            <h2>{t('openProject')}</h2>
            <p>{t('openProjectHint')}</p>
          </span>
        </button>
      </div>
      <div className="features">
        {features.map((feature) => {
          const Icon = feature.icon
          return (
            <div className="feature" key={feature.title}>
              <span className="feature-icon">
                <Icon size={20} />
              </span>
              <strong>{feature.title}</strong>
              <p>{feature.hint}</p>
            </div>
          )
        })}
      </div>
      <div className="pipeline" aria-hidden="true">
        <span>{t('pipelineVideo')}</span>
        <span>{t('pipelineMeanings')}</span>
        <span className="active">{t('pipelineKnowledge')}</span>
        <span>{t('pipelineYou')}</span>
      </div>
      <div className="welcome-footer">
        <button type="button" className="welcome-script welcome-about" onClick={() => setAboutOpen(true)}>
          {t('aboutOpen')}
        </button>
        <p className="welcome-script welcome-time">{t('handwrittenTime')}</p>
        <p className="welcome-beta">{t('welcomeBeta')}</p>
      </div>
      {aboutOpen ? <AboutModal onClose={() => setAboutOpen(false)} /> : null}
    </section>
  )
}
