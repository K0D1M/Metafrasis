import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { el } from './i18n/el.js';
import { AuthProvider, useAuth } from './lib/auth.js';
import { ThemeProvider } from './lib/theme.js';
import { Login } from './pages/Login.js';
import { Register } from './pages/Register.js';
import { ForgotPassword } from './pages/ForgotPassword.js';
import { ResetPassword } from './pages/ResetPassword.js';
import { ProjectList } from './pages/ProjectList.js';
import { ProjectWindow } from './pages/ProjectWindow.js';
import { StringEditor } from './pages/StringEditor.js';

/** Κρατά τον χρήστη στη σελίδα σύνδεσης όσο δεν υπάρχει συνεδρία. */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '2rem' }}>{el.app.loading}</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** Συνδεδεμένος χρήστης δεν χρειάζεται τις σελίδες σύνδεσης/εγγραφής. */
function RedirectIfAuthed({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: '2rem' }}>{el.app.loading}</div>;
  if (user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route
              path="/login"
              element={
                <RedirectIfAuthed>
                  <Login />
                </RedirectIfAuthed>
              }
            />
            <Route
              path="/register"
              element={
                <RedirectIfAuthed>
                  <Register />
                </RedirectIfAuthed>
              }
            />
            <Route
              path="/forgot-password"
              element={
                <RedirectIfAuthed>
                  <ForgotPassword />
                </RedirectIfAuthed>
              }
            />
            <Route
              path="/reset-password"
              element={
                <RedirectIfAuthed>
                  <ResetPassword />
                </RedirectIfAuthed>
              }
            />
            <Route
              path="/"
              element={
                <RequireAuth>
                  <ProjectList />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId"
              element={
                <RequireAuth>
                  <ProjectWindow />
                </RequireAuth>
              }
            />
            <Route
              path="/projects/:projectId/files/:fileId"
              element={
                <RequireAuth>
                  <StringEditor />
                </RequireAuth>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </ThemeProvider>
  );
}
