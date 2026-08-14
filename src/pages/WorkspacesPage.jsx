import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { Plus, Building2, Users, FolderOpen, Calendar, Loader2, ArrowRight } from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
import { CardGridSkeleton } from '../components/Skeleton';
import styles from './WorkspacesPage.module.css';

export default function WorkspacesPage() {
  const { workspaces = [], loading, createWorkspace } = useWorkspaces();
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const { data } = await createWorkspace({ name: newName.trim() });
      setNewName('');
      setShowModal(false);
      if (data?.id) {
        navigate(`/workspace/${data.id}/dashboard`);
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
    } finally {
      setCreating(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className={styles.page}>
      <PageHeader
        title="Workspaces"
        subtitle="Organizations and operational tenants under your account"
        actions={
          <button type="button" className={styles.createBtn} onClick={() => setShowModal(true)}>
            <Plus size={16} />
            Create Workspace
          </button>
        }
      />

      {loading && workspaces.length === 0 ? (
        <CardGridSkeleton count={2} />
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No workspaces yet"
          description="Create your first organization workspace to start managing projects, departments, and RACI matrices."
          actionLabel="Create Workspace"
          onAction={() => setShowModal(true)}
        />
      ) : (
        <div className={styles.grid}>
          {workspaces.map((ws, i) => (
            <div
              key={ws.id}
              className={styles.card}
              onClick={() => navigate(`/workspace/${ws.id}/dashboard`)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && navigate(`/workspace/${ws.id}/dashboard`)}
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <div className={styles.cardTop}>
                <div className={styles.cardIcon}>
                  <Building2 size={20} />
                </div>
                <div className={styles.cardTitleWrap}>
                  <h3 className={styles.cardName}>{ws.name}</h3>
                  <span className={styles.cardSub}>Command Center</span>
                </div>
                <ArrowRight size={16} className={styles.arrowIcon} />
              </div>

              <div className={styles.cardMeta}>
                <span className={styles.badge}>
                  <Users size={13} />
                  {ws.member_count ?? 0} member{(ws.member_count ?? 0) !== 1 ? 's' : ''}
                </span>
                <span className={styles.badge}>
                  <FolderOpen size={13} />
                  {ws.project_count ?? 0} project{(ws.project_count ?? 0) !== 1 ? 's' : ''}
                </span>
              </div>

              <div className={styles.cardFooter}>
                <Calendar size={12} />
                <span>Created {formatDate(ws.created_at)}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Workspace Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Workspace">
        <form onSubmit={handleCreate}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="wsName">
              Workspace / Organization Name
            </label>
            <input
              id="wsName"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. Stack n Stock Core Operations"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              required
              autoFocus
              disabled={creating}
            />
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setShowModal(false)}
              disabled={creating}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={creating || !newName.trim()}
            >
              {creating ? (
                <>
                  <Loader2 size={16} className={styles.spinner} />
                  Creating…
                </>
              ) : (
                'Create Workspace'
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
