import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getJSON, postJSON } from './api';
import { hydrateUserState, resetUserState } from './storage';

export interface User { username: string; isAdmin: boolean; }

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>(null!);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // Set the user and (de)hydrate their saved watchlist/notes together.
  const apply = async (u: User | null) => {
    setUser(u);
    if (u) await hydrateUserState();
    else resetUserState();
  };

  useEffect(() => {
    getJSON<{ user: User }>('/api/auth/me')
      .then((d) => apply(d.user))
      .catch(() => apply(null))
      .finally(() => setLoading(false));

    // A 401 from any data call (session expired) drops us back to the login screen.
    const onUnauth = () => { setUser(null); resetUserState(); };
    window.addEventListener('alphanote:unauthorized', onUnauth);
    return () => window.removeEventListener('alphanote:unauthorized', onUnauth);
  }, []);

  const login = async (username: string, password: string) => {
    const d = await postJSON<{ user: User }>('/api/auth/login', { username, password });
    await apply(d.user);
  };
  const register = async (username: string, password: string) => {
    const d = await postJSON<{ user: User }>('/api/auth/register', { username, password });
    await apply(d.user);
  };
  const logout = async () => {
    try { await postJSON('/api/auth/logout', {}); } catch { /* ignore */ }
    await apply(null);
  };

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}
