import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  Shield,
} from 'lucide-react';
import { useDepartments } from '../hooks/useDepartments';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useUserContext } from '../hooks/useUserContext';
import PageHeader from '../components/PageHeader';
import Spinner from '../components/Spinner';
import EmptyState from '../components/EmptyState';
import styles from './DepartmentsPage.module.css';

export default function DepartmentsPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();

  const { departments = [], loading } = useDepartments(workspaceId);
  const { workspaces = [] } = useWorkspaces();
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  const { isOwner, isSystemAdmin, isAdmin } = useUserContext(workspaceId);
  const canAdmin = isOwner || isSystemAdmin || isAdmin;

  if (loading) {
    return (
      <div className={styles.loadingContainer}>
        <Spinner size="lg" />
        <p>Loading departments…</p>
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <PageHeader
        title="Departments"
        subtitle={`Organizational department workspaces for ${currentWorkspace?.name || 'Workspace'}`}
        actions={
          canAdmin && (
            <Link
              to={`/workspace/${workspaceId}/admin/departments`}
              className={styles.adminLinkBtn}
            >
              <Shield size={16} /> Manage Departments
            </Link>
          )
        }
      />

      {departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments configured"
          description="Create organizational departments (e.g. Software & IT, Engineering, Operations) to enable departmental filtered views and RACI routing."
          actionLabel={canAdmin ? "Setup Departments" : undefined}
          onAction={canAdmin ? () => navigate(`/workspace/${workspaceId}/admin/departments`) : undefined}
        />
      ) : (
        <div className={styles.grid}>
          {departments.map((dept) => (
            <button
              key={dept.id}
              type="button"
              className={styles.card}
              onClick={() => navigate(`/workspace/${workspaceId}/department/${dept.id}`)}
            >
              <div
                className={styles.colorBar}
                style={{ background: dept.color || 'var(--yellow)' }}
              />

              <div className={styles.cardContent}>
                <div className={styles.cardTop}>
                  <span className={styles.codePill} style={{ borderColor: dept.color || 'var(--yellow)' }}>
                    {dept.code}
                  </span>
                  <ChevronRight size={16} className={styles.arrowIcon} />
                </div>

                <h3 className={styles.deptName}>{dept.name}</h3>

                {dept.description && (
                  <p className={styles.deptDesc}>{dept.description}</p>
                )}

                <div className={styles.cardFooter}>
                  <span className={styles.statusIndicator}>
                    <span
                      className={styles.statusDot}
                      style={{ background: dept.is_active ? 'var(--green)' : 'var(--muted-2)' }}
                    />
                    {dept.is_active ? 'Active Workspace' : 'Inactive'}
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
