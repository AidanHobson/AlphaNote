import { useCallback, useEffect, useState } from 'react';
import { getJSON, postJSON } from '../lib/api';
import Card from '../components/Card';
import { SkeletonLines } from '../components/Skeleton';

type Status = 'pending' | 'active' | 'disabled';
interface AdminUser { id: number; username: string; createdAt: number; status: Status; isAdmin: boolean; }
interface Backup { name: string; bytes: number; createdAt: number; }
interface ErrEntry { t: number; scope: string; message: string; path?: string; status?: number; }
interface SourceHealth {
  name: string; status: 'ok' | 'degraded' | 'failing' | 'stale' | 'unknown';
  lastOkAt: number | null; lastFailAt: number | null; lastError: string | null;
  successes: number; failures: number; recentFailRate: number;
}

const SOURCE_LABEL: Record<string, string> = {
  hackernews: 'Hacker News', polymarket: 'Polymarket', reddit: 'Reddit',
  finra: 'FINRA short volume', websearch: 'Web search (market sizes)',
};
const sourceStatusStyle: Record<SourceHealth['status'], React.CSSProperties> = {
  ok: { color: 'var(--color-up)' },
  degraded: { color: 'var(--color-warn)' },
  failing: { color: 'var(--color-down)' },
  stale: { color: 'var(--color-warn)' },
  unknown: { color: 'var(--color-text-muted)' },
};

const fmtBytes = (b: number) => (b >= 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

const statusStyle: Record<Status, React.CSSProperties> = {
  pending: { color: 'var(--color-warn)' },
  active: { color: 'var(--color-up)' },
  disabled: { color: 'var(--color-down)' },
};

export default function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);
  const [backups, setBackups] = useState<Backup[] | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupErr, setBackupErr] = useState('');

  const [errors, setErrors] = useState<ErrEntry[] | null>(null);
  const [sources, setSources] = useState<SourceHealth[] | null>(null);

  const load = useCallback(() => {
    getJSON<{ sources: SourceHealth[] }>('/api/admin/sources').then((d) => setSources(d.sources)).catch(() => setSources([]));
    getJSON<{ users: AdminUser[] }>('/api/admin/users').then((d) => setUsers(d.users)).catch((e) => setError(e.message));
    getJSON<{ backups: Backup[] }>('/api/admin/backups').then((d) => setBackups(d.backups)).catch((e) => setBackupErr(e.message));
    getJSON<{ errors: ErrEntry[] }>('/api/admin/errors').then((d) => setErrors(d.errors)).catch(() => setErrors([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const backupNow = async () => {
    setBackupBusy(true);
    setBackupErr('');
    try {
      const d = await postJSON<{ backups: Backup[] }>('/api/admin/backups/run', {});
      setBackups(d.backups);
    } catch (e) {
      setBackupErr(e instanceof Error ? e.message : 'Backup failed.');
    } finally {
      setBackupBusy(false);
    }
  };

  const act = async (id: number, action: 'approve' | 'disable') => {
    setBusyId(id);
    setError('');
    try {
      await postJSON(`/api/admin/users/${id}/${action}`, {});
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Action failed.');
    } finally {
      setBusyId(null);
    }
  };

  const pending = users?.filter((u) => u.status === 'pending').length || 0;

  return (
    <div>
      <div className="page-head">
        <h1>Admin</h1>
        <p>New sign-ups stay <b>pending</b> until you approve them. Admin status is granted only via the server's <code>ADMIN_USERNAMES</code> config — never through the app.</p>
      </div>

      <Card title="Users" sub={users ? `${users.length} total${pending ? ` · ${pending} pending` : ''}` : ''}>
        {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
        {!users ? <SkeletonLines lines={5} /> : (
          <table className="mtable">
            <thead>
              <tr><th>User</th><th>Role</th><th>Status</th><th className="num">Joined</th><th className="num">Actions</th></tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} style={{ cursor: 'default' }}>
                  <td><span style={{ fontWeight: 700 }}>{u.username}</span></td>
                  <td>{u.isAdmin ? <span className="admin-badge">admin</span> : <span style={{ color: 'var(--color-text-muted)' }}>member</span>}</td>
                  <td><span style={{ fontWeight: 600, ...statusStyle[u.status] }}>{u.status}</span></td>
                  <td className="num">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="num">
                    {u.isAdmin ? <span style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>—</span>
                      : u.status === 'active'
                        ? <button className="btn sm danger" disabled={busyId === u.id} onClick={() => act(u.id, 'disable')}>Disable</button>
                        : <button className="btn sm primary" disabled={busyId === u.id} onClick={() => act(u.id, 'approve')}>Approve</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <div style={{ marginTop: 18 }}>
        <Card
          title="Database backups"
          sub="daily · keeps 7 · snapshots live on the same disk as the database — download a copy periodically for offsite safety"
          right={<button className="btn sm primary" disabled={backupBusy} onClick={backupNow}>{backupBusy ? 'Backing up…' : 'Back up now'}</button>}
        >
          {backupErr && <div className="error-banner" style={{ marginBottom: 12 }}>{backupErr}</div>}
          {!backups ? <SkeletonLines lines={3} /> : backups.length === 0 ? (
            <div className="empty" style={{ border: 'none' }}>No snapshots yet — the first daily backup runs shortly after boot, or take one now.</div>
          ) : (
            <table className="mtable">
              <thead><tr><th>Snapshot</th><th className="num">Size</th><th className="num">Created</th><th className="num"></th></tr></thead>
              <tbody>
                {backups.map((b) => (
                  <tr key={b.name} style={{ cursor: 'default' }}>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>{b.name}</td>
                    <td className="num">{fmtBytes(b.bytes)}</td>
                    <td className="num">{new Date(b.createdAt).toLocaleString()}</td>
                    <td className="num"><a className="btn sm" href={`/api/admin/backups/${encodeURIComponent(b.name)}/download`}>Download</a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 10 }}>
            Snapshots live on the server's persistent disk. Download one periodically for an off-site copy — restoring is just replacing the DB file with a snapshot.
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 18 }}>
        <Card title="Recent server errors" sub={errors ? `last ${errors.length} since boot` : ''}>
          {!errors ? <SkeletonLines lines={3} /> : errors.length === 0 ? (
            <div className="empty" style={{ border: 'none' }}>No errors recorded since the server started. 🎉</div>
          ) : (
            <table className="mtable">
              <thead><tr><th>When</th><th>Scope</th><th>Message</th></tr></thead>
              <tbody>
                {errors.slice(0, 30).map((e, i) => (
                  <tr key={`${e.t}-${i}`} style={{ cursor: 'default' }}>
                    <td style={{ whiteSpace: 'nowrap' }}>{new Date(e.t).toLocaleString()}</td>
                    <td><span className="pill">{e.scope}</span>{e.path && <div style={{ color: 'var(--color-text-muted)', fontSize: 11.5 }}>{e.path}</div>}</td>
                    <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ color: 'var(--color-text-muted)', fontSize: 12, marginTop: 10 }}>
            Persisted to SQLite (last 500, secrets redacted) — survives restarts.
          </div>
        </Card>
      </div>

      <div style={{ marginTop: 18 }}>
        <Card title="Data source health" sub="keyless scrapers the speculative layer depends on — third-party markup or IP blocks can degrade a source silently">
          {!sources ? <SkeletonLines lines={3} /> : sources.length === 0 ? (
            <div className="empty" style={{ border: 'none' }}>No sources exercised yet — generate an outlook or open the trending board to populate this.</div>
          ) : (
            <table className="mtable">
              <thead><tr><th>Source</th><th>Status</th><th className="num">Last OK</th><th className="num">Recent fail rate</th><th>Last error</th></tr></thead>
              <tbody>
                {sources.map((s) => (
                  <tr key={s.name} style={{ cursor: 'default' }}>
                    <td style={{ fontWeight: 600 }}>{SOURCE_LABEL[s.name] || s.name}</td>
                    <td style={{ fontWeight: 700, ...sourceStatusStyle[s.status] }}>{s.status.toUpperCase()}</td>
                    <td className="num" style={{ whiteSpace: 'nowrap' }}>{s.lastOkAt ? new Date(s.lastOkAt).toLocaleTimeString() : '—'}</td>
                    <td className="num">{s.recentFailRate > 0 ? `${Math.round(s.recentFailRate * 100)}%` : '0%'}</td>
                    <td style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>{s.lastError || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
