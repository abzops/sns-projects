import { useState } from 'react';
import { NavLink, useParams, Outlet } from 'react-router-dom';
import {
  Home,
  FolderKanban,
  Users,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import Avatar from './Avatar';
import { useAuth } from '../contexts/AuthContext';
import styles from './AppLayout.module.css';

export default function AppLayout() {
  const { workspaceId } = useParams();
  const auth = useAuth?.() || {};
  const { user, signOut } = auth;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const userName = user?.user_metadata?.full_name || user?.email || 'User';

  const closeSidebar = () => setSidebarOpen(false);

  return (
    <div className={styles.layout}>
      {/* Mobile hamburger */}
      <button
        className={styles.hamburger}
        onClick={() => setSidebarOpen(!sidebarOpen)}
        type="button"
        aria-label="Toggle sidebar"
      >
        {sidebarOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className={styles.mobileOverlay} onClick={closeSidebar} />
      )}

      {/* Sidebar */}
      <aside
        className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ''}`}
      >
        {/* Brand */}
        <div className={styles.brand}>
          <img
            src="/stacknstock-horizontal.png"
            alt="Stack n Stock"
            className={styles.horizontalLogo}
          />
          <div className={styles.productMeta}>
            <span>SNS Projects</span>
            <strong>Command Center</strong>
          </div>
        </div>

        {/* Navigation */}
        <nav className={styles.nav}>
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `${styles.navLink} ${isActive ? styles.active : ''}`
            }
            onClick={closeSidebar}
          >
            <Home size={18} />
            <span>Workspaces</span>
          </NavLink>

          {workspaceId && (
            <>
              <div className={styles.navDivider} />
              <NavLink
                to={`/workspace/${workspaceId}`}
                end
                className={({ isActive }) =>
                  `${styles.navLink} ${isActive ? styles.active : ''}`
                }
                onClick={closeSidebar}
              >
                <FolderKanban size={18} />
                <span>Projects</span>
              </NavLink>
              <NavLink
                to={`/workspace/${workspaceId}/members`}
                className={({ isActive }) =>
                  `${styles.navLink} ${isActive ? styles.active : ''}`
                }
                onClick={closeSidebar}
              >
                <Users size={18} />
                <span>Members</span>
              </NavLink>
              <NavLink
                to={`/workspace/${workspaceId}/settings`}
                className={({ isActive }) =>
                  `${styles.navLink} ${isActive ? styles.active : ''}`
                }
                onClick={closeSidebar}
              >
                <Settings size={18} />
                <span>Settings</span>
              </NavLink>
            </>
          )}
        </nav>

        <div className={styles.statusCard}>
          <span className={styles.statusDot} />
          <div className={styles.statusText}>
            <strong>Live Workspace</strong>
            <small>Supabase secure sync</small>
          </div>
        </div>

        <div className={styles.userSection}>
          <div className={styles.userInfo}>
            <Avatar name={userName} size="md" />
            <div className={styles.userMeta}>
              <span className={styles.userName}>{userName}</span>
              {user?.email && user.email !== userName && (
                <span className={styles.userEmail}>{user.email}</span>
              )}
            </div>
          </div>
          {signOut && (
            <button
              className={styles.signOutBtn}
              onClick={signOut}
              type="button"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>

      {/* Main content */}
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
