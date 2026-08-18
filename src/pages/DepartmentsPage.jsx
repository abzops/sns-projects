import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Building2,
  ChevronRight,
  Shield,
  AlertCircle,
} from 'lucide-react';
import { useDepartments } from '../hooks/useDepartments';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useUserContext } from '../hooks/useUserContext';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import { CardGridSkeleton } from '../components/Skeleton';
import styles from './DepartmentsPage.module.css';

export default function DepartmentsPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();

  const { departments = [], loading, error } = useDepartments(workspaceId);
  const { workspaces = [] } = useWorkspaces();
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  const userContext = useUserContext(workspaceId);
  const canAdmin = userContext.canAdministerWorkspace;
  const isInitialLoading = userContext.loading || (loading && departments.length === 0);

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

      {isInitialLoading ? (
        <CardGridSkeleton count={4} />
      ) : error && departments.length === 0 ? (
        <EmptyState
          icon={AlertCircle}
          title="Unable to load departments"
          description={typeof error === 'string' ? error : error.message || 'Please check your access and connection, then retry.'}
        />
      ) : departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments configured"
          description="Create organizational departments (e.g. Software & IT, Engineering, Operations) to enable departmental filtered views and responsibility routing."
          actionLabel={canAdmin ? "Setup Departments" : undefined}
          onAction={canAdmin ? () => navigate(`/workspace/${workspaceId}/admin/departments`) : undefined}
        />
      ) : (
        <div className={styles.grid}>
          {departments.map((dept) => {
            const headName = dept.head?.profiles?.full_name || (dept.head ? 'Assigned' : 'Unassigned');
            const leadsCount = dept.leads?.length || 0;

            return (
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

                  {/* Leadership & Personnel Summary */}
                  <div className={styles.leadershipRow}>
                    <div className={styles.leaderItem}>
                      <span className={styles.leaderLabel}>Head:</span>
                      <span className={styles.leaderVal}>{headName}</span>
                    </div>
                    {leadsCount > 0 && (
                      <div className={styles.leaderItem}>
                        <span className={styles.leaderLabel}>Leads:</span>
                        <span className={styles.leaderVal}>{leadsCount}</span>
                      </div>
                    )}
                  </div>

                  <div className={styles.cardFooter}>
                    <span className={styles.statusIndicator}>
                      <span
                        className={styles.statusDot}
                        style={{ background: dept.is_active ? 'var(--green)' : 'var(--muted-2)' }}
                      />
                      {dept.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span className={styles.memberCountBadge}>
                      {dept.member_count || 0} {(dept.member_count === 1) ? 'Member' : 'Members'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
