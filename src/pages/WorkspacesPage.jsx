import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { Plus, Briefcase, Users, FolderOpen, Calendar, Loader2 } from 'lucide-react'
import Modal from '../components/Modal'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import styles from './WorkspacesPage.module.css'

export default function WorkspacesPage() {
  const { workspaces, loading, createWorkspace } = useWorkspaces()
  const [showModal, setShowModal] = useState(false)
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const navigate = useNavigate()

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!newName.trim()) return
    setCreating(true)
    try {
      await createWorkspace({ name: newName.trim() })
      setNewName('')
      setShowModal(false)
    } catch (err) {
      console.error('Failed to create workspace:', err)
    } finally {
      setCreating(false)
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spinner size="lg" />
        <p>Loading workspaces…</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>Your Workspaces</h1>
          <p className={styles.pageSubtitle}>
            {workspaces.length} workspace{workspaces.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button className={styles.createBtn} onClick={() => setShowModal(true)}>
          <Plus size={18} />
          Create Workspace
        </button>
      </div>

      {workspaces.length === 0 ? (
        <EmptyState 
          icon={Briefcase}
          title="No workspaces yet"
          description="Create your first workspace to start organizing projects and collaborating with your team."
          actionLabel="Create Workspace"
          onAction={() => setShowModal(true)}
        />
      ) : (
        <div className={styles.grid}>
          {workspaces.map((ws, i) => (
            <button
              key={ws.id}
              className={styles.card}
              onClick={() => navigate(`/workspace/${ws.id}`)}
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <div className={styles.cardTop}>
                <div className={styles.cardIcon}>
                  <Briefcase size={20} />
                </div>
                <h3 className={styles.cardName}>{ws.name}</h3>
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
            </button>
          ))}
        </div>
      )}

      {/* Create Workspace Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="Create Workspace">
        <form onSubmit={handleCreate}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="wsName">
              Workspace Name
            </label>
            <input
              id="wsName"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. Design Team, Engineering"
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
                'Create'
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
