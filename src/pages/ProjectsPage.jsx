import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useProjects } from '../hooks/useProjects';
import { useMembers } from '../hooks/useMembers';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useUserContext } from '../hooks/useUserContext';
import { getMemberDisplayName } from '../lib/identity';
import {
  Plus,
  FolderKanban,
  ListTodo,
  Calendar,
  Palette,
  Search,
  ChevronRight,
} from 'lucide-react';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import Avatar from '../components/Avatar';
import EmptyState from '../components/EmptyState';
import { CardGridSkeleton } from '../components/Skeleton';
import styles from './ProjectsPage.module.css';

const PRESET_COLORS = [
  '#FDE215', '#60d394', '#8cc9ff', '#ff6666', '#c084fc', '#ff8c42',
];

const PROJECT_STATUSES = [
  { value: 'active', label: 'Active' },
  { value: 'planned', label: 'Planned' },
  { value: 'draft', label: 'Draft' },
  { value: 'on_hold', label: 'On Hold' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PROJECT_PRIORITIES = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

function isOverdue(dateStr, status) {
  if (!dateStr || status === 'completed' || status === 'cancelled') return false;
  const d = new Date(dateStr);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d < today;
}

export default function ProjectsPage() {
  const { workspaceId } = useParams();
  const navigate = useNavigate();

  const { projects = [], loading, createProject } = useProjects(workspaceId);
  const { members = [] } = useMembers(workspaceId);
  const { workspaces = [] } = useWorkspaces();
  const currentWorkspace = workspaces.find((w) => w.id === workspaceId);

  const { isOwner, isSystemAdmin, isProjectAdmin, isAdmin, user } = useUserContext(workspaceId);
  const canCreate = isOwner || isSystemAdmin || isProjectAdmin || isAdmin;

  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');

  // Form State
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [ownerId, setOwnerId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [targetEndDate, setTargetEndDate] = useState('');
  const [projectStatus, setProjectStatus] = useState('active');
  const [projectPriority, setProjectPriority] = useState('medium');
  const [creating, setCreating] = useState(false);

  const handleOpenModal = () => {
    setName('');
    setDescription('');
    setColor(PRESET_COLORS[0]);
    setOwnerId(user?.id || '');
    setStartDate('');
    setTargetEndDate('');
    setProjectStatus('active');
    setProjectPriority('medium');
    setShowModal(true);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;

    setCreating(true);
    try {
      await createProject({
        name: name.trim(),
        description: description.trim(),
        color,
        owner_id: ownerId || user?.id,
        start_date: startDate || null,
        target_end_date: targetEndDate || null,
        project_status: projectStatus,
        project_priority: projectPriority,
      });
      setShowModal(false);
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setCreating(false);
    }
  };

  const filteredProjects = useMemo(() => {
    return projects.filter((p) => {
      if (filterStatus && p.project_status !== filterStatus) return false;
      if (filterPriority && p.project_priority !== filterPriority) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = p.name?.toLowerCase().includes(q);
        const matchDesc = p.description?.toLowerCase().includes(q);
        if (!matchName && !matchDesc) return false;
      }
      return true;
    });
  }, [projects, filterStatus, filterPriority, search]);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  return (
    <div className={styles.container}>
      <PageHeader
        title="Projects Portfolio"
        subtitle={`Active initiatives and task execution boards for ${currentWorkspace?.name || 'Workspace'}`}
        badge={<span className={styles.totalBadge}>{projects.length} Projects</span>}
        actions={
          canCreate && (
            <button type="button" className={styles.createBtn} onClick={handleOpenModal}>
              <Plus size={16} /> New Project
            </button>
          )
        }
      />

      {/* Filter and Search Controls */}
      <div className={styles.filterBar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search projects by name or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.filterGroup}>
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Statuses</option>
            {PROJECT_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <select
            value={filterPriority}
            onChange={(e) => setFilterPriority(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="">All Priorities</option>
            {PROJECT_PRIORITIES.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Project Grid */}
      {loading && projects.length === 0 ? (
        <CardGridSkeleton count={3} />
      ) : filteredProjects.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title={search || filterStatus || filterPriority ? "No matching projects" : "No projects yet"}
          description={
            search || filterStatus || filterPriority
              ? "Try clearing your search or status filters."
              : "Create your first project to start tracking milestones, RACI matrix, and Kanban boards."
          }
          actionLabel={canCreate && !search && !filterStatus ? "Create Project" : undefined}
          onAction={canCreate ? handleOpenModal : undefined}
        />
      ) : (
        <div className={styles.grid}>
          {filteredProjects.map((project) => {
            const overdue = isOverdue(project.target_end_date, project.project_status);

            return (
              <div
                key={project.id}
                className={styles.card}
                onClick={() => navigate(`/workspace/${workspaceId}/project/${project.id}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/workspace/${workspaceId}/project/${project.id}`)}
              >
                <div
                  className={styles.colorBar}
                  style={{ background: project.color || 'var(--yellow)' }}
                />

                <div className={styles.cardBody}>
                  <div className={styles.cardHeader}>
                    <div className={styles.tagsRow}>
                      <span className={`${styles.statusPill} ${styles[`status_${project.project_status || 'active'}`]}`}>
                        {project.project_status || 'active'}
                      </span>
                      <span className={`${styles.priorityPill} ${styles[`priority_${project.project_priority || 'medium'}`]}`}>
                        {project.project_priority || 'medium'}
                      </span>
                    </div>
                    <ChevronRight size={16} className={styles.arrowIcon} />
                  </div>

                  <h3 className={styles.cardTitle}>{project.name}</h3>

                  {project.description && (
                    <p className={styles.cardDesc}>{project.description}</p>
                  )}

                  {/* Progress Bar */}
                  <div className={styles.progressContainer}>
                    <div className={styles.progressTop}>
                      <span className={styles.progressLabel}>Completion</span>
                      <span className={styles.progressPercent}>{project.progress || 0}%</span>
                    </div>
                    <div className={styles.progressBar}>
                      <div
                        className={styles.progressFill}
                        style={{ width: `${project.progress || 0}%` }}
                      />
                    </div>
                  </div>

                  {/* Footer Meta */}
                  <div className={styles.cardFooter}>
                    <div className={styles.ownerWrap}>
                      {project.owner ? (
                        <>
                          <Avatar
                            name={project.owner.full_name || 'Owner'}
                            src={project.owner.avatar_url}
                            size="xs"
                          />
                          <span className={styles.ownerName}>{project.owner.full_name}</span>
                        </>
                      ) : (
                        <span className={styles.unassignedText}>Unassigned Owner</span>
                      )}
                    </div>

                    <div className={styles.rightMeta}>
                      <span className={styles.taskCountBadge}>
                        <ListTodo size={12} />
                        {project.task_count || 0} tasks
                      </span>

                      {project.target_end_date && (
                        <span className={`${styles.dateBadge} ${overdue ? styles.dateOverdue : ''}`}>
                          <Calendar size={12} />
                          {formatDate(project.target_end_date)}
                          {overdue && <span className={styles.overdueDot} title="Target date overdue" />}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Enhanced Create Project Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title="New Project" size="lg">
        <form onSubmit={handleCreate}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="projName">
              Project Name
            </label>
            <input
              id="projName"
              type="text"
              className={styles.modalInput}
              placeholder="e.g. Automated Warehouse Dispatch System"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              autoFocus
              disabled={creating}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="projDesc">
              Description & Objectives
            </label>
            <textarea
              id="projDesc"
              className={styles.modalTextarea}
              placeholder="Define project goals, scope, and target outcomes…"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              disabled={creating}
            />
          </div>

          <div className={styles.modalRow}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="projOwner">
                Project Owner
              </label>
              <select
                id="projOwner"
                value={ownerId}
                onChange={(e) => setOwnerId(e.target.value)}
                className={styles.modalSelect}
                disabled={creating}
              >
                <option value="">Select Owner…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.user_id || ''}>
                    {getMemberDisplayName(m, user)}
                  </option>
                ))}
              </select>
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="projPriority">
                Priority
              </label>
              <select
                id="projPriority"
                value={projectPriority}
                onChange={(e) => setProjectPriority(e.target.value)}
                className={styles.modalSelect}
                disabled={creating}
              >
                {PROJECT_PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.modalRow}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="projStart">
                Start Date
              </label>
              <input
                id="projStart"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className={styles.modalInput}
                disabled={creating}
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel} htmlFor="projTarget">
                Target End Date
              </label>
              <input
                id="projTarget"
                type="date"
                value={targetEndDate}
                onChange={(e) => setTargetEndDate(e.target.value)}
                className={styles.modalInput}
                disabled={creating}
              />
            </div>
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel}>
              <Palette size={14} style={{ verticalAlign: '-2px' }} /> Accent Color
            </label>
            <div className={styles.colorPalette}>
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`${styles.colorBtn} ${color === c ? styles.colorActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                />
              ))}
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
              {creating ? 'Creating…' : 'Create Project'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
