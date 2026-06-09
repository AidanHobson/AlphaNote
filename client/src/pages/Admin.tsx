import { useEffect, useState } from 'react';
import { getJSON } from '../lib/api';
import Card from '../components/Card';
import { SkeletonLines } from '../components/Skeleton';

interface AdminUser { id: number; username: string; createdAt: number; isAdmin: boolean; }

export default function Admin() {
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getJSON<{ users: AdminUser[] }>('/api/admin/users').then((d) => setUsers(d.users)).catch((e) => setError(e.message));
  }, []);

  return (
    <div>
      <div className="page-head">
        <h1>Admin</h1>
        <p>Registered accounts. Admin status is granted only via the server's <code>ADMIN_USERNAMES</code> config — never through the app.</p>
      </div>

      <Card title="Users" sub={users ? `${users.length} total` : ''}>
        {error ? <div className="error-banner">{error}</div>
          : !users ? <SkeletonLines lines={5} />
          : (
            <table className="mtable">
              <thead>
                <tr><th>User</th><th>Role</th><th className="num">Joined</th></tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ cursor: 'default' }}>
                    <td><span style={{ fontWeight: 700 }}>{u.username}</span></td>
                    <td>{u.isAdmin ? <span className="admin-badge">admin</span> : <span style={{ color: 'var(--color-text-muted)' }}>member</span>}</td>
                    <td className="num">{new Date(u.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </Card>
    </div>
  );
}
