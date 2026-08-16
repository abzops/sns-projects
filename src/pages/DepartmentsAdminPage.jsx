import { useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Building2,
  Plus,
  Edit2,
  Trash2,
  Users,
  X,
  Palette,
  UserPlus,
  Sparkles,
} from 'lucide-react';
import { useDepartments } from '../hooks/useDepartments';
import { useDepartmentMembers } from '../hooks/useDepartmentMembers';
import { useMembers } from '../hooks/useMembers';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import PageHeader from '../components/PageHeader';
import Avatar from '../components/Avatar';
import Modal from '../components/Modal';
import Spinner from '../components/Spinner';
import { CardGridSkeleton } from '../components/Skeleton';
import EmptyState from '../components/EmptyState';
import { getMemberDisplayName } from '../lib/identity';
import styles from './DepartmentsAdminPage.module.css';

const SUGGESTED_DEPTS = [
  { code: 'COMM', name: 'Commercials & Partnerships', color: '#ffb020', description: 'Business development, client relationships, and commercial agreements' },
  { code: 'ENG', name: 'Engineering', color: '#60d394', description: 'Hardware, robotics, mechanical, and technical design' },
  { code: 'FIN', name: 'Finance', color: '#ff8c42', description: 'Financial planning, accounting, budgets, and fiscal compliance' },
  { code: 'OPS', name: 'Operations', color: '#fde215', description: 'Field operations, facilities, and process execution' },
  { code: 'PROC', name: 'Procurement', color: '#c084fc', description: 'Vendor management, sourcing, and purchasing' },
  { code: 'SCM', name: 'Supply Chain', color: '#2dd4bf', description: 'Supply chain management, logistics, warehousing, and inventory distribution' },
  { code: 'SWIT', name: 'Software & IT', color: '#8cc9ff', description: 'Software engineering, internal tooling, and cloud infrastructure' },
];

const PRESET_COLORS = [
  '#FDE215', '#60d394', '#8cc9ff', '#ff6666', '#c084fc', '#ff8c42',
];

// Department Members Manager Sub-Component
function DepartmentMembersManager({ department, onClose }) {
  const { user } = useAuth();
  const { members = [], loading, addMember, updateMember, removeMember } = useDepartmentMembers(department.id);
  const { members: workspaceMembers = [] } = useMembers(department.workspace_id);
  const { showToast } = useToast();

  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState('member');
  const [isPrimary, setIsPrimary] = useState(false);
  const [adding, setAdding] = useState(false);

  // Available users not yet in department
  const existingUserIds = new Set(members.map((m) => m.user_id));
  const availableUsers = workspaceMembers.filter((m) => m.user_id && !existingUserIds.has(m.user_id));

  const handleAddMember = async (e) => {
    e.preventDefault();
    if (!selectedUserId) return;

    setAdding(true);
    try {
      await addMember({
        workspaceId: department.workspace_id,
        userId: selectedUserId,
        role: selectedRole,
        isPrimary,
      });
      showToast('Department member added', 'success');
      setSelectedUserId('');
      setSelectedRole('member');
      setIsPrimary(false);
    } catch (err) {
      showToast(err.message || 'Failed to add department member', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleRoleChange = async (membershipId, newRole) => {
    try {
      await updateMember(membershipId, { role: newRole });
      showToast(`Role updated to ${newRole}`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update role', 'error');
    }
  };

  const handleTogglePrimary = async (membershipId, currentPrimary) => {
    try {
      await updateMember(membershipId, { is_primary: !currentPrimary });
      showToast(currentPrimary ? 'Primary designation removed' : 'Set as primary department', 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update primary status', 'error');
    }
  };

  const handleRemove = async (membershipId, memberName) => {
    if (confirm(`Remove ${memberName || 'this user'} from ${department.name}?`)) {
      try {
        await removeMember(membershipId);
        showToast('Member removed from department', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to remove member', 'error');
      }
    }
  };

  return (
    <div className={styles.deptMembersContainer}>
      {/* Add Member Form */}
      <form onSubmit={handleAddMember} className={styles.addMemberBox}>
        <h4 className={styles.addMemberTitle}>Add Person to {department.name}</h4>
        <div className={styles.addMemberRow}>
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            required
            className={styles.memberSelect}
          >
            <option value="">Select Team Member…</option>
            {availableUsers.map((m) => (
              <option key={m.id} value={m.user_id}>
                {getMemberDisplayName(m, user)}
              </option>
            ))}
          </select>

          <select
            value={selectedRole}
            onChange={(e) => setSelectedRole(e.target.value)}
            className={styles.roleSelect}
          >
            <option value="member">Member</option>
            <option value="lead">Dept Lead</option>
            <option value="head">Dept Head</option>
          </select>

          <label className={styles.primaryCheck}>
            <input
              type="checkbox"
              checked={isPrimary}
              onChange={(e) => setIsPrimary(e.target.checked)}
            />
            <span>Primary</span>
          </label>

          <button
            type="submit"
            className={styles.addBtn}
            disabled={adding || !selectedUserId}
          >
            <UserPlus size={14} /> Add
          </button>
        </div>
      </form>

      {/* Existing Members List */}
      <div className={styles.membersListWrap}>
        <h4 className={styles.listTitle}>Current Members ({members.length})</h4>
        {loading ? (
          <Spinner size="sm" />
        ) : members.length === 0 ? (
          <p className={styles.emptyMembers}>No members assigned to this department yet.</p>
        ) : (
          <div className={styles.membersList}>
            {members.map((m) => {
              const name = getMemberDisplayName(m, user);
              return (
                <div key={m.id} className={styles.memberRow}>
                  <div className={styles.memberInfo}>
                    <Avatar name={name} src={m.profiles?.avatar_url} size="sm" />
                    <div>
                      <strong>{name}</strong>
                      {m.is_primary && (
                        <span className={styles.primaryTag}>Primary</span>
                      )}
                    </div>
                  </div>

                  <div className={styles.memberActions}>
                    <select
                      value={m.role}
                      onChange={(e) => handleRoleChange(m.id, e.target.value)}
                      className={styles.inlineRoleSelect}
                    >
                      <option value="head">Dept Head</option>
                      <option value="lead">Dept Lead</option>
                      <option value="member">Member</option>
                    </select>

                    <button
                      type="button"
                      className={styles.primaryToggleBtn}
                      onClick={() => handleTogglePrimary(m.id, m.is_primary)}
                      title={m.is_primary ? 'Unset as primary' : 'Set as primary department'}
                    >
                      {m.is_primary ? 'Unset 1°' : 'Set 1°'}
                    </button>

                    <button
                      type="button"
                      className={styles.removeMemberBtn}
                      onClick={() => handleRemove(m.id, name)}
                      title="Remove from department"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={styles.modalFooter}>
        <button type="button" className={styles.doneBtn} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}

export default function DepartmentsAdminPage() {
  const { workspaceId } = useParams();
  const { showToast } = useToast();

  const { departments = [], loading, createDepartment, updateDepartment, deleteDepartment } = useDepartments(workspaceId);

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingDept, setEditingDept] = useState(null);
  const [managingMembersDept, setManagingMembersDept] = useState(null);

  // Form state
  const [deptCode, setDeptCode] = useState('');
  const [deptName, setDeptName] = useState('');
  const [deptDesc, setDeptDesc] = useState('');
  const [deptColor, setDeptColor] = useState(PRESET_COLORS[0]);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = () => {
    setDeptCode('');
    setDeptName('');
    setDeptDesc('');
    setDeptColor(PRESET_COLORS[0]);
    setEditingDept(null);
  };

  const handleOpenCreate = () => {
    resetForm();
    setShowCreateModal(true);
  };

  const handleOpenEdit = (dept) => {
    setEditingDept(dept);
    setDeptCode(dept.code);
    setDeptName(dept.name);
    setDeptDesc(dept.description || '');
    setDeptColor(dept.color || PRESET_COLORS[0]);
    setShowCreateModal(true);
  };

  const handleApplySuggestion = (sug) => {
    setDeptCode(sug.code);
    setDeptName(sug.name);
    setDeptDesc(sug.description);
    setDeptColor(sug.color);
  };

  const handleSaveDepartment = async (e) => {
    e.preventDefault();
    if (!deptCode.trim() || !deptName.trim()) return;

    setSubmitting(true);
    try {
      if (editingDept) {
        await updateDepartment(editingDept.id, {
          code: deptCode.trim().toUpperCase(),
          name: deptName.trim(),
          description: deptDesc.trim() || null,
          color: deptColor,
        });
        showToast('Department updated successfully', 'success');
      } else {
        await createDepartment({
          code: deptCode.trim().toUpperCase(),
          name: deptName.trim(),
          description: deptDesc.trim(),
          color: deptColor,
        });
        showToast('Department created successfully', 'success');
      }
      setShowCreateModal(false);
      resetForm();
    } catch (err) {
      showToast(err.message || 'Failed to save department', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeleteDepartment = async (dept) => {
    if (confirm(`Are you sure you want to delete the "${dept.name}" department? This will remove all department memberships.`)) {
      try {
        await deleteDepartment(dept.id);
        showToast('Department deleted', 'success');
      } catch (err) {
        showToast(err.message || 'Failed to delete department', 'error');
      }
    }
  };

  const handleToggleActive = async (dept) => {
    try {
      await updateDepartment(dept.id, { is_active: !dept.is_active });
      showToast(`Department marked ${!dept.is_active ? 'active' : 'inactive'}`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update status', 'error');
    }
  };

  return (
    <div className={styles.container}>
      <PageHeader
        title="Department Management"
        subtitle="Configure organizational departments, assign department heads, and manage personnel assignments"
        backTo={`/workspace/${workspaceId}/departments`}
        actions={
          <button
            type="button"
            className={styles.createBtn}
            onClick={handleOpenCreate}
          >
            <Plus size={16} /> New Department
          </button>
        }
      />

      {/* Suggested Quick-Setup Chips (if few departments exist) */}
      {departments.length < 5 && (
        <div className={styles.suggestionsCard}>
          <div className={styles.sugHeader}>
            <Sparkles size={16} className={styles.sugIcon} />
            <strong>Standard Stack n Stock Departments</strong>
            <span>Click to pre-fill</span>
          </div>
          <div className={styles.sugChips}>
            {SUGGESTED_DEPTS.filter(
              (sug) => !departments.some((d) => d.code.toUpperCase() === sug.code.toUpperCase())
            ).map((sug) => (
              <button
                key={sug.code}
                type="button"
                className={styles.sugChip}
                onClick={() => {
                  handleApplySuggestion(sug);
                  setShowCreateModal(true);
                }}
              >
                <span className={styles.sugDot} style={{ background: sug.color }} />
                <span>{sug.name} ({sug.code})</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Departments Grid */}
      {loading && departments.length === 0 ? (
        <CardGridSkeleton count={4} />
      ) : departments.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No departments configured"
          description="Create departments to organize projects and enable RACI delegation."
          actionLabel="Create First Department"
          onAction={handleOpenCreate}
        />
      ) : (
        <div className={styles.grid}>
          {departments.map((dept) => (
            <div key={dept.id} className={`${styles.deptCard} ${!dept.is_active ? styles.cardInactive : ''}`}>
              <div className={styles.deptCardTop}>
                <div className={styles.deptHeaderLeft}>
                  <span className={styles.codeTag} style={{ borderColor: dept.color || 'var(--yellow)', color: dept.color || 'var(--yellow)' }}>
                    {dept.code}
                  </span>
                  <h3 className={styles.deptTitle}>{dept.name}</h3>
                </div>

                <div className={styles.cardActions}>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => handleOpenEdit(dept)}
                    title="Edit details"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    type="button"
                    className={styles.iconBtn}
                    onClick={() => handleDeleteDepartment(dept)}
                    title="Delete department"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {dept.description && (
                <p className={styles.deptDescription}>{dept.description}</p>
              )}

              <div className={styles.deptCardFooter}>
                <button
                  type="button"
                  className={styles.manageMembersBtn}
                  onClick={() => setManagingMembersDept(dept)}
                >
                  <Users size={14} /> Manage Members
                </button>

                <button
                  type="button"
                  className={`${styles.statusToggle} ${dept.is_active ? styles.statusActive : styles.statusInactive}`}
                  onClick={() => handleToggleActive(dept)}
                >
                  {dept.is_active ? 'Active' : 'Inactive'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create / Edit Department Modal */}
      <Modal
        isOpen={showCreateModal}
        onClose={() => {
          setShowCreateModal(false);
          resetForm();
        }}
        title={editingDept ? 'Edit Department' : 'Create Department'}
      >
        <form onSubmit={handleSaveDepartment}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="deptCode">
              Department Code (Short ID)
            </label>
            <input
              id="deptCode"
              type="text"
              placeholder="e.g. SW, ENG, OPS"
              value={deptCode}
              onChange={(e) => setDeptCode(e.target.value.toUpperCase())}
              maxLength={8}
              required
              autoFocus
              className={styles.modalInput}
              disabled={submitting}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="deptName">
              Department Name
            </label>
            <input
              id="deptName"
              type="text"
              placeholder="e.g. Software & IT"
              value={deptName}
              onChange={(e) => setDeptName(e.target.value)}
              required
              className={styles.modalInput}
              disabled={submitting}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="deptDesc">
              Description
            </label>
            <textarea
              id="deptDesc"
              placeholder="Operational responsibilities and function…"
              value={deptDesc}
              onChange={(e) => setDeptDesc(e.target.value)}
              rows={3}
              className={styles.modalTextarea}
              disabled={submitting}
            />
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
                  className={`${styles.colorBtn} ${deptColor === c ? styles.colorActive : ''}`}
                  style={{ background: c }}
                  onClick={() => setDeptColor(c)}
                  aria-label={`Color ${c}`}
                />
              ))}
            </div>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => {
                setShowCreateModal(false);
                resetForm();
              }}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={submitting || !deptCode.trim() || !deptName.trim()}
            >
              {submitting ? 'Saving…' : editingDept ? 'Save Changes' : 'Create Department'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Manage Members Modal */}
      {managingMembersDept && (
        <Modal
          isOpen={!!managingMembersDept}
          onClose={() => setManagingMembersDept(null)}
          title={`Manage ${managingMembersDept.name} Members`}
          size="lg"
        >
          <DepartmentMembersManager
            department={managingMembersDept}
            onClose={() => setManagingMembersDept(null)}
          />
        </Modal>
      )}
    </div>
  );
}
