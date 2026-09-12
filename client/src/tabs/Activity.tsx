import { useEffect, useState } from 'react';
import type { ActivityView } from '@metafrasis/shared';
import { el } from '../i18n/el.js';
import { api, ApiRequestError } from '../lib/api.js';
import { Avatar, EmptyState } from '../components/common.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

/** Πλήρης ημερομηνία και ώρα: σε ένα log, η ώρα έχει σημασία. */
function formatMoment(iso: string): string {
  return new Date(iso).toLocaleString('el-GR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function ActivityTab({ project }: { project: ProjectDetail }) {
  const [rows, setRows] = useState<ActivityView[] | null>(null);
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    api
      .get<ActivityView[]>(`/projects/${project.id}/activity`)
      .then(setRows)
      .catch((err) => {
        if (err instanceof ApiRequestError && err.status === 403) setDenied(true);
        setRows([]);
      });
  }, [project.id]);

  if (!rows) return <div className="card muted">{el.app.loading}</div>;

  if (denied) {
    return (
      <div className="card">
        <EmptyState title={el.activity.restricted} />
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="card">
        <EmptyState title={el.activity.empty} hint={el.activity.emptyHint} />
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ marginBottom: '1rem' }}>{el.activity.title}</h2>
      <div className="card stack" style={{ gap: '0.75rem' }}>
        {rows.map((row) => (
          <div key={row.id} className="row" style={{ alignItems: 'flex-start' }}>
            <Avatar username={row.user.username} avatarUrl={row.user.avatarUrl} size={28} />
            <div style={{ flex: 1 }}>
              <div>
                <strong>{row.user.username}</strong>{' '}
                {/* Άγνωστος τύπος ενέργειας εμφανίζεται ως έχει, αντί να χαθεί η γραμμή. */}
                {el.activityActions[row.action] ?? row.action}
                {row.target && <> «{row.target}»</>}
              </div>
              <span className="muted" style={{ fontSize: '0.85em' }}>
                {formatMoment(row.createdAt)}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
