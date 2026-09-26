import { useEffect, useState } from 'react';
import { el } from '../i18n/el.js';
import { api } from '../lib/api.js';
import { EmptyState, ProgressBar } from '../components/common.js';
import { Icon } from '../components/Icon.js';
import type { ProjectDetail } from '../pages/ProjectWindow.js';

interface SummaryResponse {
  language: string;
  files: Array<{ id: string; name: string; total: number; translated: number; percent: number }>;
}

export function TranslationsTab({ project }: { project: ProjectDetail }) {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<SummaryResponse>(`/projects/${project.id}/translations/summary`)
      .then(setData)
      .catch(() => setData({ language: 'el', files: [] }));
  }, [project.id]);

  /**
   * Το cookie συνεδρίας είναι httpOnly, οπότε χρειάζεται fetch με credentials·
   * ένα σκέτο <a download> δεν θα περνούσε τον έλεγχο πρόσβασης.
   */
  async function download() {
    setError(null);
    setDownloading(true);
    try {
      const res = await fetch(`/api/projects/${project.id}/translations/download`, {
        credentials: 'include',
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? el.app.error);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name}_${data?.language ?? 'el'}.zip`;
      link.click();
      // Χωρίς revoke, το blob μένει στη μνήμη μέχρι να κλείσει η καρτέλα.
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : el.app.error);
    } finally {
      setDownloading(false);
    }
  }

  if (!data) return <div className="card muted">{el.app.loading}</div>;

  if (data.files.length === 0) {
    return (
      <div className="card">
        <EmptyState title={el.translationsTab.empty} hint={el.translationsTab.emptyHint} />
      </div>
    );
  }

  return (
    <div>
      <div className="spread" style={{ marginBottom: '1rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>{el.translationsTab.title}</h2>
          <span className="muted">{el.translationsTab.hint}</span>
        </div>
        <button className="primary icon-btn" onClick={() => void download()} disabled={downloading}>
          <Icon name="download" />
          {downloading ? el.translationsTab.downloading : el.translationsTab.download}
        </button>
      </div>

      {error && <div className="field-error" style={{ marginBottom: '0.75rem' }}>{error}</div>}

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>{el.translationsTab.file}</th>
              <th>{el.translationsTab.completed}</th>
              <th style={{ minWidth: 160 }}>{el.dashboard.progress}</th>
            </tr>
          </thead>
          <tbody>
            {data.files.map((file) => (
              <tr key={file.id}>
                <td>{file.name}</td>
                <td className="muted">
                  {file.translated} / {file.total}
                </td>
                <td>
                  <ProgressBar
                    progress={{
                      total: file.total,
                      translated: file.translated,
                      percent: file.percent,
                    }}
                    showLabel={false}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
