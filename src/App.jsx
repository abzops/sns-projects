import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import { ToastProvider } from './components/Toast'
import ProtectedRoute from './components/ProtectedRoute'
import AppLayout from './components/AppLayout'
import LoginPage from './pages/LoginPage'
import SignUpPage from './pages/SignUpPage'
import WorkspacesPage from './pages/WorkspacesPage'
import ProjectsPage from './pages/ProjectsPage'
import TasksPage from './pages/TasksPage'
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage'

const routerBasename = import.meta.env.BASE_URL === '/'
  ? undefined
  : import.meta.env.BASE_URL.replace(/\/$/, '')

function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<WorkspacesPage />} />
                <Route path="/workspace/:workspaceId" element={<ProjectsPage />} />
                <Route path="/workspace/:workspaceId/project/:projectId" element={<TasksPage />} />
                <Route path="/workspace/:workspaceId/settings" element={<WorkspaceSettingsPage />} />
                <Route path="/workspace/:workspaceId/members" element={<WorkspaceSettingsPage defaultTab="members" />} />
              </Route>
            </Route>
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
