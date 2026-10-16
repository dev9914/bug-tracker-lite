import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { RequireAuth } from './auth/RequireAuth'
import { AppLayout } from './components/AppLayout'
import { AuthLayout } from './components/AuthLayout'
import { BugDetailPage } from './pages/BugDetailPage'
import { CreateBugPage } from './pages/CreateBugPage'
import { DashboardPage } from './pages/DashboardPage'
import { EditBugPage } from './pages/EditBugPage'
import { LoginPage } from './pages/LoginPage'
import { RegisterPage } from './pages/RegisterPage'

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public: signed-out shell for sign in / sign up. */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
          </Route>

          {/* Protected: RequireAuth redirects to /login when there is no token. */}
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/bugs/new" element={<CreateBugPage />} />
              <Route path="/bugs/:id" element={<BugDetailPage />} />
              <Route path="/bugs/:id/edit" element={<EditBugPage />} />
            </Route>
          </Route>

          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
