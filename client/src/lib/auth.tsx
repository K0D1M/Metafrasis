import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SessionUser, LoginInput, RegisterInput } from '@metafrasis/shared';
import { api } from './api.js';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: SessionUser) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  // Ο έλεγχος συνεδρίας τρέχει μία φορά· το 401 είναι αναμενόμενο, όχι σφάλμα.
  useEffect(() => {
    api
      .get<SessionUser>('/auth/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const value: AuthState = {
    user,
    loading,
    login: async (input) => setUser(await api.post<SessionUser>('/auth/login', input)),
    register: async (input) => setUser(await api.post<SessionUser>('/auth/register', input)),
    logout: async () => {
      await api.post('/auth/logout');
      setUser(null);
    },
    setUser,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('Το useAuth πρέπει να είναι μέσα σε AuthProvider');
  return context;
}
