import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useProjects } from '../hooks/useProjects'
import { useWorkspaces } from '../hooks/useWorkspaces'
import { Plus, FolderKanban, ListTodo, Loader2, ChevronLeft, Palette } from 'lucide-react'
import Modal from '../components/Modal'
import EmptyState from '../components/EmptyState'
import Spinner from '../components/Spinner'
import styles from './ProjectsPage.module.css'

const PRESET_COLORS = [
  '#FDE215', '#60d394', '#8cc9ff', '#ff6666', '#c084fc', '#ff8c42',
]

export default function ProjectsPage() {
  const { workspaceId } = useParams()
  const navigate = useNavigate()
  const { projects, loading, createProject } = useProjects(workspaceId)
  const { workspaces } = useWorkspaces()
  const workspace = workspaces?.find((w) => w.id === workspaceId)

  const [showModal, setShowModal] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [customColor, setCustomColor] = useState('')
  const [creating, setCreating] = useState(false)

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    try {
      await createProject({
        name: name.trim(),
        description: description.trim(),
        color: customColor || color,
      })
      setName('')
      setDescription('')
      setColor(PRESET_COLORS[0])
      setCustomColor('')
      setShowModal(false)
    } catch (err) {
      console.error('Failed to create project:', err)
    } finally {
      setCreating(false)
    }
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })
  }

  if (loading) {
    return (
      <div className={styles.loadingState}>
        <Spinner size="lg" />
        <p>Loading projects…</p>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button
            className={styles.backBtn}
            onClick={() => navigate('/')}
            aria-label="Back to workspaces"
          >
            <ChevronLeft size={18} />
          </button>
          <div>
            <h1 className={styles.pageTitle}>
              {workspace?.name || 'Workspace'}
            </h1>
            <p className={styles.pageSubtitle}>
              {projects.length} project{projects.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <button className={styles.createBtn} onClick={() => setShowModal(true)}>
          <Plus size={18} />
          New Project
        </button>
      </div>

      {projects.length === 0 ? (
        <EmptyState 
          icon={FolderKanban}
          title="No projects yet"
          description="Create your first project to start tracking tasks and progress."
          actionLabel="New Project"
          onAction={() => setShowModal(true)}
        />
      ) : (
        <div className={styles.grid}>
          {projects.map((project, i) => (
            <button
              key={project.id}
              className={styles.card}
              onClick={() =>
                navigate(`/workspace/${workspaceId}/project/${project.id}`)
              }
              style={{ animationDelay: `${i * 0.06}s` }}
            >
              <div
                className={styles.colorBar}
                style={{ background: project.color || '#FDE215' }}
              />
              <div className={styles.cardContent}>
                <h3 className={styles.cardName}>{project.name}</h3>
                {project.description && (
                  <p className={styles.cardDesc}>{project.description}</p>
                )}
                <div className={styles.cardMeta}>
                  <span className={styles.badge}>
                    <ListTodo size={12} />
                    {project.task_count ?? 0} task{(project.task_count ?? 0) !== 1 ? 's' : ''}
                  </span>
                  {project.created_at && (
                    <span className={styles.metaDate}>
                      {formatDate(project.created_at)}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Create Project Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New Project">
        <form onSubmit={handleCreate}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="projName">
              Project Name
            </label>
            <input
              id="projName"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. Website Redesign"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              disabled={creating}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="projDesc">
              Description
            </label>
            <textarea
              id="projDesc"
              className={styles.modalTextarea}
              placeholder="Brief description of this project…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={creating}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel}>
              <Palette size={14} style={{ verticalAlign: '-2px' }} />
              {' '}Color
            </label>
            <div className={styles.colorPicker}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorSwatch} ${
                    color === c && !customColor ? styles.colorSwatchActive : ''
                  }`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c)
                    setCustomColor('')
                  }}
                  aria-label={`Color ${c}`}
                />
              ))}
              <div className={styles.customColorWrap}>
                <input
                  type="color"
                  className={styles.customColorInput}
                  value={customColor || color}
                  onChange={(e) => setCustomColor(e.target.value)}
                  title="Custom color"
                />
              </div>
            </div>
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
              disabled={creating || !name.trim()}
            >
              {creating ? (
                <>
                  <Loader2 size={16} className={styles.spinner} />
                  Creating…
                </>
              ) : (
                'Create Project'
              )}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
