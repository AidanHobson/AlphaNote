import { useState, type FormEvent } from 'react';
import { postJSON } from '../lib/api';
import { useAuth } from '../lib/auth';
import Card from '../components/Card';

export default function Account() {
  const { user, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setMsg(''); setError('');
    if (next !== confirm) { setError('New passwords do not match.'); return; }
    setBusy(true);
    try {
      const d = await postJSON<{ message: string }>('/api/auth/change-password', { currentPassword: current, newPassword: next });
      setMsg(d.message || 'Password changed.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const logoutEverywhere = async () => {
    try { await postJSON('/api/auth/logout-all', {}); } catch { /* session already gone */ }
    await logout(); // clears local state → back to the login screen
  };

  return (
    <div>
      <div className="page-head">
        <h1>Account</h1>
        <p>Signed in as <b>{user?.username}</b>{user?.isAdmin ? ' · admin' : ''}.</p>
      </div>

      <div className="grid grid-2">
        <Card title="Change password">
          <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 380 }}>
            {msg && <div className="login-notice" role="status">{msg}</div>}
            {error && <div className="error-banner" role="alert">{error}</div>}
            <label className="login-field">
              <span>Current password</span>
              <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            </label>
            <label className="login-field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" placeholder="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} />
            </label>
            <label className="login-field">
              <span>Confirm new password</span>
              <input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </label>
            <button className="btn primary" type="submit" disabled={busy || !current || !next || !confirm}>
              {busy ? 'Changing…' : 'Change password'}
            </button>
            <div style={{ color: 'var(--color-text-muted)', fontSize: 12 }}>
              Changing your password signs you out everywhere else; this browser stays signed in.
            </div>
          </form>
        </Card>

        <Card title="Sessions">
          <p style={{ color: 'var(--color-text-secondary)', fontSize: 13.5, marginTop: 0 }}>
            Worried a session is open on another device? This revokes every session for your account — including this one — and returns you to the sign-in screen.
          </p>
          <button className="btn sm danger" onClick={logoutEverywhere}>Log out everywhere</button>
        </Card>
      </div>
    </div>
  );
}
