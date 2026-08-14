import { useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useWorkspaces } from '../hooks/useWorkspaces';
import { useMembers } from '../hooks/useMembers';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import { TaskRowSkeleton } from '../components/Skeleton';
import Spinner from '../components/Spinner';
import Avatar from '../components/Avatar';
import RoleBadge from '../components/RoleBadge';
import PageHeader from '../components/PageHeader';
import Modal from '../components/Modal';
import { getMemberDisplayName, getMemberEmail } from '../lib/identity';
import {
  Settings,
  Users,
  Plus,
  Trash2,
  Mail,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import styles from './WorkspaceSettingsPage.module.css';

export default function WorkspaceSettingsPage({ defaultTab = 'general' }) {
  const { workspaceId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const { workspaces, updateWorkspace, deleteWorkspace, loading: workspacesLoading } = useWorkspaces();
  const {
    members = [],
    inviteMember,
    updateRole,
    removeMember,
    loading: membersLoading,
    error: membersError,
    refetch: refetchMembers,
  } = useMembers(workspaceId);

  const [activeTab, setActiveTab] = useState(defaultTab);

  // Modals state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  // Forms state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [workspaceName, setWorkspaceName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const workspace = workspaces.find((w) => w.id === workspaceId);
  const currentUserMember = members.find((m) => m.user_id === user?.id);
  const currentUserRole = currentUserMember?.role || 'viewer';

  const isOwner = currentUserRole === 'owner';
  const isAdmin = currentUserRole === 'admin' || isOwner;

  // Initialize workspace name when data loads
  if (workspace && !workspaceName && !isSubmitting) {
    setWorkspaceName(workspace.name);
  }

  if (workspacesLoading && workspaces.length === 0) {
    return (
      <div className={styles.container}>
        <PageHeader
          title="Workspace Settings"
          subtitle="Loading workspace preferences…"
        />
        <TaskRowSkeleton count={3} />
      </div>
    );
  }

  if (!workspace) {
    return <div className={styles.notFound}>Workspace not found</div>;
  }

  const handleUpdateName = async (e) => {
    e.preventDefault();
    if (!workspaceName.trim()) return;

    setIsSubmitting(true);
    const { error } = await updateWorkspace(workspaceId, { name: workspaceName.trim() });
    setIsSubmitting(false);

    if (error) {
      showToast(error.message, 'error');
    } else {
      showToast('Workspace renamed successfully', 'success');
    }
  };

  const handleDeleteWorkspace = async () => {
    setIsSubmitting(true);
    const { error } = await deleteWorkspace(workspaceId);
    setIsSubmitting(false);

    if (error) {
      showToast(error.message, 'error');
      setIsDeleteModalOpen(false);
    } else {
      showToast('Workspace deleted', 'success');
      navigate('/workspaces');
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setIsSubmitting(true);
    const { error } = await inviteMember(inviteEmail.trim(), inviteRole);
    setIsSubmitting(false);

    if (error) {
      showToast(error.message, 'error');
    } else {
      showToast('Invitation sent', 'success');
      setIsInviteModalOpen(false);
      setInviteEmail('');
      setInviteRole('member');
    }
  };

  const handleRoleChange = async (memberId, newRole, currentRole) => {
    if (currentRole === 'owner') {
      showToast('Cannot change owner role', 'error');
      return;
    }

    const { error } = await updateRole(memberId, newRole);
    if (error) {
      showToast(error.message, 'error');
    } else {
      showToast('Role updated', 'success');
    }
  };

  const handleRemoveMember = async (memberId, memberName) => {
    if (confirm(`Are you sure you want to remove ${memberName || 'this user'}?`)) {
      const { error } = await removeMember(memberId);
      if (error) {
        showToast(error.message, 'error');
      } else {
        showToast('Member removed', 'success');
      }
    }
  };

  const roleWeights = { owner: 4, admin: 3, member: 2, viewer: 1 };

  return (
    <div className={styles.container}>
      <PageHeader
        title="Workspace Settings"
        subtitle={`Preferences, general configuration, and membership for ${workspace.name}`}
      />

      <div className={styles.tabs}>
        <button
          className={`${styles.tab} ${activeTab === 'general' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('general')}
          type="button"
        >
          <Settings size={18} />
          General
        </button>
        <button
          className={`${styles.tab} ${activeTab === 'members' ? styles.activeTab : ''}`}
          onClick={() => setActiveTab('members')}
          type="button"
        >
          <Users size={18} />
          Members ({members.length})
        </button>
      </div>

      <div className={styles.tabContent}>
        {activeTab === 'general' && (
          <div className={styles.section}>
            <div className={styles.card}>
              <h2>Workspace Profile</h2>
              <form onSubmit={handleUpdateName} className={styles.form}>
                <div className={styles.formGroup}>
                  <label>Workspace Name</label>
                  <input
                    type="text"
                    className={styles.input}
                    value={workspaceName}
                    onChange={(e) => setWorkspaceName(e.target.value)}
                    disabled={!isAdmin}
                    required
                  />
                </div>
                {isAdmin && (
                  <button
                    type="submit"
                    className={styles.primaryBtn}
                    disabled={isSubmitting || workspaceName === workspace.name}
                  >
                    {isSubmitting ? 'Saving…' : 'Save Changes'}
                  </button>
                )}
              </form>
            </div>

            {isOwner && (
              <div className={`${styles.card} ${styles.dangerZone}`}>
                <h2>Danger Zone</h2>
                <p>Once you delete a workspace, all projects and tasks will be permanently removed.</p>
                <button
                  className={styles.dangerBtn}
                  onClick={() => setIsDeleteModalOpen(true)}
                  type="button"
                >
                  <Trash2 size={16} />
                  Delete Workspace
                </button>
              </div>
            )}
          </div>
        )}

        {activeTab === 'members' && (
          <div className={styles.section}>
            <div className={styles.cardHeader}>
              <div>
                <h2>Workspace Members</h2>
                <p>Manage personnel who have access to this workspace</p>
              </div>
              <div className={styles.cardHeaderActions}>
                {isAdmin && (
                  <Link
                    to={`/workspace/${workspaceId}/admin/users`}
                    className={styles.manageRolesLink}
                  >
                    <ShieldCheck size={15} />
                    <span>Manage Users & System Roles</span>
                  </Link>
                )}
                {isAdmin && (
                  <button
                    className={styles.primaryBtn}
                    onClick={() => setIsInviteModalOpen(true)}
                    type="button"
                  >
                    <Plus size={16} />
                    Invite Member
                  </button>
                )}
              </div>
            </div>

            {membersLoading ? (
              <div className={styles.tabLoadingBox}>
                <Spinner size="md" />
                <span>Loading members…</span>
              </div>
            ) : membersError ? (
              <div className={styles.errorBox}>
                <AlertTriangle size={24} className={styles.errorIcon} />
                <p>Unable to load workspace members.</p>
                <button
                  type="button"
                  className={styles.retryBtn}
                  onClick={() => refetchMembers()}
                >
                  <RefreshCw size={14} /> Retry
                </button>
              </div>
            ) : members.length === 0 ? (
              <div className={styles.emptyBox}>
                <Users size={32} className={styles.emptyIcon} />
                <p>No workspace members found.</p>
              </div>
            ) : (
              <div className={styles.memberList}>
                {members.map((member) => {
                  const displayName = getMemberDisplayName(member, user);
                  const memberEmail = getMemberEmail(member, user);
                  const avatarSrc = member.profile?.avatar_url || member.profiles?.avatar_url;
                  const isCurrentUser = member.user_id === user?.id;

                  return (
                    <div key={member.id} className={styles.memberRow}>
                      <div className={styles.memberInfo}>
                        <Avatar name={displayName} src={avatarSrc} size="md" />
                        <div>
                          <div className={styles.memberName}>
                            <span>{displayName}</span>
                            {isCurrentUser && <span className={styles.youBadge}>You</span>}
                            {member.status === 'pending' && (
                              <span className={styles.pendingBadge}>Pending</span>
                            )}
                          </div>
                          <div className={styles.memberEmail}>
                            {memberEmail || (member.status === 'active' ? 'Active Member' : 'Invited User')}
                          </div>
                        </div>
                      </div>

                      <div className={styles.memberActions}>
                        <RoleBadge role={member.role} size="sm" />

                        {isAdmin && member.role !== 'owner' && (
                          <select
                            className={styles.roleSelect}
                            value={member.role}
                            onChange={(e) => handleRoleChange(member.id, e.target.value, member.role)}
                            disabled={roleWeights[currentUserRole] <= roleWeights[member.role] && !isOwner}
                          >
                            {isOwner && <option value="admin">Admin</option>}
                            <option value="member">Member</option>
                            <option value="viewer">Viewer</option>
                          </select>
                        )}

                        {isAdmin && member.role !== 'owner' && (
                          <button
                            className={styles.iconBtn}
                            onClick={() => handleRemoveMember(member.id, displayName)}
                            title="Remove member"
                            type="button"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Invite Modal */}
      <Modal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        title="Invite Team Member"
      >
        <form onSubmit={handleInvite}>
          <div className={styles.formGroup}>
            <label>Email Address</label>
            <div className={styles.inputWithIcon}>
              <Mail className={styles.inputIcon} size={18} />
              <input
                type="email"
                className={styles.input}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="colleague@stacknstock.in"
                required
                style={{ paddingLeft: '40px' }}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label>Role</label>
            <select
              className={styles.input}
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
            >
              <option value="viewer">Viewer - Can only view projects and tasks</option>
              <option value="member">Member - Can create and edit tasks/projects</option>
              {isOwner && <option value="admin">Admin - Can also manage members</option>}
            </select>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setIsInviteModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.primaryBtn}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Sending…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
        title="Delete Workspace"
      >
        <div className={styles.deleteConfirm}>
          <AlertTriangle size={48} className={styles.warningIcon} />
          <p>
            Are you sure you want to delete <strong>{workspace.name}</strong>? This action cannot be undone and will delete all associated projects and tasks.
          </p>
          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setIsDeleteModalOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.dangerBtn}
              onClick={handleDeleteWorkspace}
              disabled={isSubmitting}
            >
              {isSubmitting ? 'Deleting…' : 'Yes, Delete Workspace'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
