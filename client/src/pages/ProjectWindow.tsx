import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Role, type ProgressStats } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { AccountMenu, ProgressBar, ThemeToggle } from '../components/common.js';
import { NotificationBell } from '../components/NotificationBell.js';
import { TabIcon } from '../components/TabIcon.js';
import { SourcesTab } from '../tabs/Sources.js';
import { MembersTab } from '../tabs/Members.js';
import { TranslationsTab } from '../tabs/Translations.js';
import { ScreenshotsTab } from '../tabs/Screenshots.js';
import { TasksTab } from '../tabs/Tasks.js';
import { QaTab } from '../tabs/Qa.js';
import { ActivityTab } from '../tabs/Activity.js';
import { SettingsTab } from '../tabs/Settings.js';
import { IntegrationsTab } from '../tabs/Integrations.js';

export interface ProjectDetail {
  id: string;
  name: string;
  sourceLanguage: string;
  targetLanguages: string[];
  role: Role;
  activityVisibleToAll: boolean;
  progress: ProgressStats;
  createdAt: string;
}

type TabKey =
  | 'dashboard'
  | 'sources'
  | 'translations'
  | 'screenshots'
  | 'tasks'
  | 'members'
  | 'integrations'
  | 'qa'
  | 'activity'
  | 'settings';

const TAB_ORDER: Array<{ key: TabKey; label: string }> = [
  { key: 'dashboard', label: el.tabs.dashboard },
  { key: 'sources', label: el.tabs.sources },
  { key: 'translations', label: el.tabs.translations },
  { key: 'screenshots', label: el.tabs.screenshots },
  { key: 'tasks', label: el.tabs.tasks },
  { key: 'members', label: el.tabs.members },
  { key: 'integrations', label: el.tabs.integrations },
  { key: 'qa', label: el.tabs.qa },
  { key: 'activity', label: el.tabs.activity },
  { key: 'settings', label: el.tabs.settings },
];

const TAB_KEYS = TAB_ORDER.map((t) => t.key);

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as string[]).includes(value);
}

export function ProjectWindow() {
  const { projectId } = useParams<{ projectId: string }>();
  const { logout } = useAuth();
  const [project, setProject] = useState<ProjectDetail | null>(null);
  // Το tab διαβάζεται από το URL (?tab=...) ώστε ένας σύνδεσμος ειδοποίησης να μπορεί
  // να ανοίγει κατευθείαν στη σωστή καρτέλα, όχι πάντα στο Dashboard.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const tab: TabKey = isTabKey(tabParam) ? tabParam : 'dashboard';

  function setTab(next: TabKey) {
    setSearchParams(next === 'dashboard' ? {} : { tab: next });
  }

  function reload() {
    if (projectId) api.get<ProjectDetail>(`/projects/${projectId}`).then(setProject).catch(() => {});
  }

  useEffect(reload, [projectId]);

  if (!projectId) return null;
  if (!project) return <div style={{ padding: '2rem' }}>{el.app.loading}</div>;

  const isManager = project.role === Role.MANAGER;
  // Η Δραστηριότητα είναι κρυφή από τους μη-διαχειριστές, εκτός αν το επιτρέψουν οι ρυθμίσεις.
  const visibleTabs = TAB_ORDER.filter(
    (t) => t.key !== 'activity' || isManager || project.activityVisibleToAll,
  );

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <div>
          <Link to="/" className="muted">
            ← {el.app.name}
          </Link>
          <h1 style={{ margin: '0.2rem 0 0' }}>{project.name}</h1>
        </div>
        <div className="row">
          <ThemeToggle />
          <NotificationBell />
          <AccountMenu />
          <button className="ghost" onClick={() => void logout()}>
            {el.auth.logout}
          </button>
        </div>
      </div>

      <div className="tabs" style={{ marginBottom: '1.25rem' }}>
        {visibleTabs.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            <TabIcon tabKey={t.key} />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'dashboard' && <DashboardTab project={project} />}
      {tab === 'sources' && <SourcesTab project={project} onChanged={reload} />}
      {tab === 'translations' && <TranslationsTab project={project} />}
      {tab === 'screenshots' && <ScreenshotsTab project={project} />}
      {tab === 'tasks' && <TasksTab project={project} />}
      {tab === 'members' && <MembersTab project={project} />}
      {tab === 'integrations' && <IntegrationsTab />}
      {tab === 'qa' && <QaTab project={project} />}
      {tab === 'activity' && <ActivityTab project={project} />}
      {tab === 'settings' && <SettingsTab project={project} onChanged={reload} />}
    </div>
  );
}

function DashboardTab({ project }: { project: ProjectDetail }) {
  return (
    <div className="stack">
      <div className="card">
        <h3>{el.dashboard.progress}</h3>
        <ProgressBar progress={project.progress} />
      </div>

      <div className="row" style={{ alignItems: 'stretch', flexWrap: 'wrap' }}>
        <Stat label={el.dashboard.totalStrings} value={project.progress.total} />
        <Stat label={el.dashboard.translatedStrings} value={project.progress.translated} />
        <Stat
          label={el.projects.sourceLanguage}
          value={project.sourceLanguage.toUpperCase()}
        />
        <Stat
          label={el.projects.targetLanguages}
          value={project.targetLanguages.map((t) => t.toUpperCase()).join(', ')}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ flex: '1 1 160px' }}>
      <div className="muted">{label}</div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>{value}</div>
    </div>
  );
}
