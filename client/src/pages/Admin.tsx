import { useCallback, useEffect, useState } from 'react';
import { getJSON, postJSON } from '../lib/api';
import Card from '../components/Card';
import { SkeletonLines } from '../components/Skeleton';

type Status = 'pending' | 'active' | 'disabled';
interface AdminUser { id: number; username: string; createdAt: number; status: Status; isAdmin: boolean; }

const statusStyle: Record<Status, React.CSSProperties> = {
  pending: { color: 'var(--color-warn)' },
  active: { color: 'var(--color-up)' },
  disabled: { color: 'var(--color-down)' },
};

export default function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(() => {
    getJSON<{ users: AdminUser[] }>('/api/admin/users').then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

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
    </div>
  );
}
