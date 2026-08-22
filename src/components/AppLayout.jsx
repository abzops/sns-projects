import { useState } from 'react';
import { NavLink, useParams, useNavigate, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  CheckSquare,
  FolderKanban,
  Building2,
  Users,
  Shield,
  Settings,
  LogOut,
  Menu,
  X,
  ChevronDown,
  Layers,
  Workflow,
  WalletCards,
} from 'lucide-react';
import Avatar from './Avatar';
import RoleBadge from './RoleBadge';
import BrandLogo from './BrandLogo';
import NotificationBell from './NotificationBell';
import { useAuth } from '../contexts/AuthContext';
import { useUserContext } from '../hooks/useUserContext';
import { useFinanceAccess } from '../hooks/useFinanceAccess';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useDepartments } from '../hooks/useDepartments';
import styles from './AppLayout.module.css';

export default function AppLayout() {
  const { workspaceId: paramWorkspaceId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth?.() || {};
  const { user, signOut } = auth;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [wsDropdownOpen, setWsDropdownOpen] = useState(false);

  const { workspaces = [] } = useWorkspaces();

  // Determine active workspace ID
  const activeWorkspaceId = paramWorkspaceId || workspaces[0]?.id || null;
  const currentWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) || workspaces[0] || null;

  // Fetch user role & system context
  const {
    workspaceRole,
    primaryDepartment,
    isOwner,
    isCEO,
    isCTO,
    isProjectAdmin,
    isSystemAdmin,
    canAdministerWorkspace,
  } = useUserContext(activeWorkspaceId);

  // Derive Finance Overview access for navigation
  const {
    canViewWorkspaceFinance,
    financeAccessLoading,
  } = useFinanceAccess(activeWorkspaceId);

  // Fetch departments for navigation
  const { departments = [] } = useDepartments(activeWorkspaceId);
  const activeDepartments = departments.filter((d) => d.is_active);

  const userName = user?.user_metadata?.full_name || user?.email || 'User';

  const closeSidebar = () => {
    setSidebarOpen(false);
    setWsDropdownOpen(false);
  };

  const handleSwitchWorkspace = (wsId) => {
    setWsDropdownOpen(false);
    navigate(`/workspace/${wsId}/dashboard`);
    closeSidebar();
  };

  // Determine primary badge to show for user
  const primaryRole = isCEO
    ? 'ceo'
    : isCTO
    ? 'cto'
    : isSystemAdmin
    ? 'system_admin'
    : isProjectAdmin
    ? 'project_admin'
    : isOwner
    ? 'owner'
    : workspaceRole || 'member';

  const canAdminUsers = canAdministerWorkspace;
  const canAdminDepts = canAdministerWorkspace;
  const canAdminSettings = canAdministerWorkspace;
  const hasAdminSection = canAdminUsers || canAdminDepts || canAdminSettings || isProjectAdmin;

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
        {/* Top Brand Header */}
        <div className={styles.brand}>
          <div className={styles.logoRow}>
            <BrandLogo height={28} />
          </div>

          {/* Workspace Switcher */}
          {activeWorkspaceId && currentWorkspace && (
            <div className={styles.wsSelectorWrapper}>
              <button
                type="button"
                className={styles.wsSelectorBtn}
                onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
                aria-expanded={wsDropdownOpen}
              >
                <div className={styles.wsIcon}>
                  <Building2 size={16} />
                </div>
                <div className={styles.wsInfo}>
                  <span className={styles.wsName}>{currentWorkspace.name}</span>
                  <span className={styles.wsSub}>Command Center</span>
                </div>
                {workspaces.length > 1 && (
                  <ChevronDown
                    size={14}
                    className={`${styles.wsChevron} ${wsDropdownOpen ? styles.chevronRotated : ''}`}
                  />
                )}
              </button>

              {wsDropdownOpen && workspaces.length > 1 && (
                <div className={styles.wsDropdown}>
                  <div className={styles.dropdownHeader}>Switch Workspace</div>
                  {workspaces.map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      className={`${styles.dropdownItem} ${ws.id === activeWorkspaceId ? styles.dropdownItemActive : ''}`}
                      onClick={() => handleSwitchWorkspace(ws.id)}
                    >
                      <Building2 size={14} />
                      <span>{ws.name}</span>
                    </button>
                  ))}
                  <div className={styles.dropdownDivider} />
                  <NavLink
                    to="/workspaces"
                    className={styles.dropdownManage}
                    onClick={closeSidebar}
                  >
                    <Layers size={14} /> Manage All Workspaces
                  </NavLink>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Navigation Sections */}
        <nav className={styles.nav}>
          {activeWorkspaceId ? (
            <>
              {/* Operations */}
              <div className={styles.navGroup}>
                <span className={styles.navGroupTitle}>OPERATIONS</span>

                <NavLink
                  to={`/workspace/${activeWorkspaceId}/dashboard`}
                  className={({ isActive }) =>
                    `${styles.navLink} ${isActive ? styles.active : ''}`
                  }
                  onClick={closeSidebar}
                >
                  <LayoutDashboard size={18} />
                  <span>Dashboard</span>
                </NavLink>

                <NavLink
                  to={`/workspace/${activeWorkspaceId}/my-work`}
                  className={({ isActive }) =>
                    `${styles.navLink} ${isActive ? styles.active : ''}`
                  }
                  onClick={closeSidebar}
                >
                  <CheckSquare size={18} />
                  <span>My Work</span>
                </NavLink>

                <NavLink
                  to={`/workspace/${activeWorkspaceId}/projects`}
                  className={({ isActive }) =>
                    `${styles.navLink} ${isActive ? styles.active : ''}`
                  }
                  onClick={closeSidebar}
                >
                  <FolderKanban size={18} />
                  <span>Projects</span>
                </NavLink>

                <NavLink
                  to={`/workspace/${activeWorkspaceId}/processes`}
                  className={({ isActive }) =>
                    `${styles.navLink} ${isActive ? styles.active : ''}`
                  }
                  onClick={closeSidebar}
                >
                  <Workflow size={18} />
                  <span>Processes</span>
                </NavLink>

                <NavLink
                  to={`/workspace/${activeWorkspaceId}/departments`}
                  className={({ isActive }) =>
                    `${styles.navLink} ${isActive ? styles.active : ''}`
                  }
                  onClick={closeSidebar}
                >
                  <Building2 size={18} />
                  <span>Departments</span>
                </NavLink>

                {canViewWorkspaceFinance && !financeAccessLoading && (
                  <NavLink
                    to={`/workspace/${activeWorkspaceId}/finance`}
                    className={({ isActive }) =>
                      `${styles.navLink} ${isActive ? styles.active : ''}`
                    }
                    onClick={closeSidebar}
                  >
                    <WalletCards size={18} />
                    <span>Finance</span>
                  </NavLink>
                )}
              </div>

              {/* My Organization - Dynamic Department Links */}
              {activeDepartments.length > 0 && (
                <div className={styles.navGroup}>
                  <span className={styles.navGroupTitle}>ORGANIZATION</span>
                  {activeDepartments.map((dept) => (
                    <NavLink
                      key={dept.id}
                      to={`/workspace/${activeWorkspaceId}/department/${dept.id}`}
                      className={({ isActive }) =>
                        `${styles.navLink} ${styles.deptNavLink} ${isActive ? styles.active : ''}`
                      }
                      onClick={closeSidebar}
                    >
                      <span
                        className={styles.deptColorDot}
                        style={{ background: dept.color || 'var(--yellow)' }}
                      />
                      <span className={styles.deptNavName}>{dept.name}</span>
                      <span className={styles.deptNavCode}>{dept.code}</span>
                    </NavLink>
                  ))}
                </div>
              )}

              {/* Administration Section */}
              {hasAdminSection && (
                <div className={styles.navGroup}>
                  <span className={styles.navGroupTitle}>ADMINISTRATION</span>

                  {canAdminUsers && (
                    <NavLink
                      to={`/workspace/${activeWorkspaceId}/admin/users`}
                      className={({ isActive }) =>
                        `${styles.navLink} ${isActive ? styles.active : ''}`
                      }
                      onClick={closeSidebar}
                    >
                      <Users size={18} />
                      <span>Users & Roles</span>
                    </NavLink>
                  )}

                  {canAdminDepts && (
                    <NavLink
                      to={`/workspace/${activeWorkspaceId}/admin/departments`}
                      className={({ isActive }) =>
                        `${styles.navLink} ${isActive ? styles.active : ''}`
                      }
                      onClick={closeSidebar}
                    >
                      <Shield size={18} />
                      <span>Dept Management</span>
                    </NavLink>
                  )}

                  {canAdminSettings && (
                    <NavLink
                      to={`/workspace/${activeWorkspaceId}/settings`}
                      className={({ isActive }) =>
                        `${styles.navLink} ${isActive ? styles.active : ''}`
                      }
                      onClick={closeSidebar}
                    >
                      <Settings size={18} />
                      <span>Settings</span>
                    </NavLink>
                  )}
                </div>
              )}
            </>
          ) : (
            <NavLink
              to="/workspaces"
              className={({ isActive }) =>
                `${styles.navLink} ${isActive ? styles.active : ''}`
              }
              onClick={closeSidebar}
            >
              <Building2 size={18} />
              <span>Workspaces</span>
            </NavLink>
          )}
        </nav>

        {/* User Section Bottom */}
        <div className={styles.userSection}>
          <div className={styles.userInfo}>
            <Avatar name={userName} size="md" />
            <div className={styles.userMeta}>
              <span className={styles.userName}>{userName}</span>
              <div className={styles.roleBadgesRow}>
                <RoleBadge role={primaryRole} size="xs" />
                {primaryDepartment && (
                  <span className={styles.deptPill} title={`Primary Dept: ${primaryDepartment.name}`}>
                    {primaryDepartment.code}
                  </span>
                )}
              </div>
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
        <header className={styles.topbar}>
          <div className={styles.topbarLeft}>
            {currentWorkspace && (
              <span className={styles.workspaceBreadcrumb}>
                {currentWorkspace.name}
              </span>
            )}
          </div>
          <div className={styles.topbarRight}>
            <NotificationBell workspaceId={activeWorkspaceId} />
          </div>
        </header>

        <div className={styles.contentContainer}>
          <Outlet />
        </div>
      </main>
    </div>
  );
}
