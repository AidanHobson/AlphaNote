import { useState, type FormEvent } from 'react';
import { useAuth } from '../lib/auth';

export default function Login() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(username, password);
      else await register(username, password);
      // success → AuthProvider flips to the app
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><span className="mark">α</span> AlphaNote</div>
        <h1>{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
        <p className="login-sub">
          {mode === 'login' ? 'Welcome back to your markets research.' : 'Pick a username and a password (8+ characters).'}
        </p>

        {error && <div className="error-banner" role="alert">{error}</div>}

        <label className="login-field">
          <span>Username</span>
          <input
            autoFocus autoComplete="username" value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="3–32 chars · letters, digits, . _ -"
          />
        </label>
        <label className="login-field">
          <span>Password</span>
          <input
            type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === 'login' ? 'Your password' : 'At least 8 characters'}
          />
        </label>

        <button className="btn primary login-submit" type="submit" disabled={busy || !username || !password}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        <div className="login-toggle">
          {mode === 'login' ? "Don't have an account? " : 'Already have an account? '}
          <button type="button" className="linklike" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </div>

        <div className="login-foot">AI-assisted markets research · not financial advice</div>
      </form>
    </div>
  );
}
