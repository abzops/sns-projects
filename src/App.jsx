import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './components/Toast';
import ProtectedRoute from './components/ProtectedRoute';
import AppLayout from './components/AppLayout';
import LoginPage from './pages/LoginPage';
import SignUpPage from './pages/SignUpPage';
import ChangePasswordPage from './pages/ChangePasswordPage';
import WorkspacesPage from './pages/WorkspacesPage';
import DashboardPage from './pages/DashboardPage';
import MyWorkPage from './pages/MyWorkPage';
import ProjectsPage from './pages/ProjectsPage';
import TasksPage from './pages/TasksPage';
import DepartmentsPage from './pages/DepartmentsPage';
import DepartmentWorkspacePage from './pages/DepartmentWorkspacePage';
import UsersAdminPage from './pages/UsersAdminPage';
import DepartmentsAdminPage from './pages/DepartmentsAdminPage';
import WorkspaceSettingsPage from './pages/WorkspaceSettingsPage';
import ProcessesPage from './pages/ProcessesPage';
import ProcessInstancePage from './pages/ProcessInstancePage';
import Spinner from './components/Spinner';
import { useWorkspaces } from './hooks/useWorkspaces';

const routerBasename = import.meta.env.BASE_URL === '/'
  ? undefined
  : import.meta.env.BASE_URL.replace(/\/$/, '');

function RootRedirect() {
  const { workspaces = [], loading } = useWorkspaces();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (workspaces.length > 0) {
    return <Navigate to={`/workspace/${workspaces[0].id}/dashboard`} replace />;
  }

  return <WorkspacesPage />;
}

function DashboardRedirect() {
  const { workspaces = [], loading } = useWorkspaces();

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '60vh' }}>
        <Spinner size="lg" />
      </div>
    );
  }

  if (workspaces.length > 0) {
    return <Navigate to={`/workspace/${workspaces[0].id}/dashboard`} replace />;
  }

  return <Navigate to="/workspaces" replace />;
}

function App() {
  return (
    <BrowserRouter basename={routerBasename}>
      <AuthProvider>
        <ToastProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignUpPage />} />
            <Route path="/change-password" element={<ChangePasswordPage />} />
            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                {/* Root Route: Automatically routes into active workspace context */}
                <Route path="/" element={<RootRedirect />} />
                <Route path="/workspaces" element={<WorkspacesPage />} />
                <Route path="/dashboard" element={<DashboardRedirect />} />

                {/* Workspace Context Routes */}
                <Route path="/workspace/:workspaceId" element={<ProjectsPage />} />
                <Route path="/workspace/:workspaceId/dashboard" element={<DashboardPage />} />
                <Route path="/workspace/:workspaceId/my-work" element={<MyWorkPage />} />
                <Route path="/workspace/:workspaceId/projects" element={<ProjectsPage />} />
                <Route path="/workspace/:workspaceId/processes" element={<ProcessesPage />} />
                <Route path="/workspace/:workspaceId/project/:projectId" element={<TasksPage />} />
                <Route path="/workspace/:workspaceId/project/:projectId/process/:taskListId" element={<ProcessInstancePage />} />
                <Route path="/workspace/:workspaceId/departments" element={<DepartmentsPage />} />
                <Route path="/workspace/:workspaceId/department/:departmentId" element={<DepartmentWorkspacePage />} />

                {/* Administration Routes */}
                <Route path="/workspace/:workspaceId/admin/users" element={<UsersAdminPage />} />
                <Route path="/workspace/:workspaceId/admin/departments" element={<DepartmentsAdminPage />} />
                <Route path="/workspace/:workspaceId/settings" element={<WorkspaceSettingsPage />} />
                <Route path="/workspace/:workspaceId/members" element={<WorkspaceSettingsPage defaultTab="members" />} />
              </Route>
            </Route>
            {/* Catch-all fallback */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
