import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import {
  Plus,
  Check,
  Search,
  Crown,
} from 'lucide-react';
import { useMembers } from '../hooks/useMembers';
import { useUserSystemRoles } from '../hooks/useUserSystemRoles';
import { useUserContext } from '../hooks/useUserContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../components/Toast';
import PageHeader from '../components/PageHeader';
import Avatar from '../components/Avatar';
import RoleBadge from '../components/RoleBadge';
import Modal from '../components/Modal';
import { TaskRowSkeleton } from '../components/Skeleton';
import { getMemberDisplayName, getMemberEmail } from '../lib/identity';
import styles from './UsersAdminPage.module.css';

const SYSTEM_ROLE_KEYS = [
  { key: 'ceo', label: 'CEO', desc: 'Executive portfolio access' },
  { key: 'cto', label: 'CTO', desc: 'Technical operations command' },
  { key: 'project_admin', label: 'Project Admin', desc: 'Operational project administration' },
  { key: 'system_admin', label: 'System Admin', desc: 'Full workspace & user administration' },
];

export default function UsersAdminPage() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const { showToast } = useToast();

  const { members = [], loading: membersLoading, inviteMember, updateRole, removeMember } = useMembers(workspaceId);
  const { roles: systemRoles = [], loading: rolesLoading, assignRole, removeRole } = useUserSystemRoles(workspaceId);
  const { isOwner, isSystemAdmin } = useUserContext(workspaceId);

  const [search, setSearch] = useState('');
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [submitting, setSubmitting] = useState(false);

  // Group system roles by user_id
  const systemRolesByUserId = useMemo(() => {
    const map = new Map();
    for (const r of systemRoles) {
      if (!map.has(r.user_id)) map.set(r.user_id, []);
      map.get(r.user_id).push(r);
    }
    return map;
  }, [systemRoles]);

  // Filtered members list
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const name = getMemberDisplayName(m, user);
      const email = getMemberEmail(m, user) || '';
      const q = search.toLowerCase();
      return name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
    });
  }, [members, search, user]);

  const handleToggleSystemRole = async (userId, roleKey) => {
    if (!isOwner && !isSystemAdmin) {
      showToast('Only workspace owners and system administrators can modify system roles', 'error');
      return;
    }

    const userRoles = systemRolesByUserId.get(userId) || [];
    const existingRoleObj = userRoles.find((r) => r.role === roleKey);

    try {
      if (existingRoleObj) {
        // Safety: check if this is the last system_admin being removed
        if (roleKey === 'system_admin') {
          const totalSysAdmins = systemRoles.filter((r) => r.role === 'system_admin').length;
          if (totalSysAdmins <= 1 && !isOwner) {
            showToast('Cannot remove the last system administrator', 'error');
            return;
          }
        }
        await removeRole(existingRoleObj.id);
        showToast(`Revoked ${roleKey.toUpperCase()} role`, 'success');
      } else {
        await assignRole(userId, roleKey);
        showToast(`Granted ${roleKey.toUpperCase()} role`, 'success');
      }
    } catch (err) {
      console.error('Error toggling system role:', err);
      showToast(err.message || 'Failed to update system role', 'error');
    }
  };

  const handleWorkspaceRoleChange = async (memberId, newRole, member) => {
    if (member.role === 'owner') {
      showToast('Workspace owner role cannot be changed directly', 'error');
      return;
    }

    try {
      const { error } = await updateRole(memberId, newRole);
      if (error) throw error;
      showToast(`Updated workspace role to ${newRole}`, 'success');
    } catch (err) {
      showToast(err.message || 'Failed to update role', 'error');
    }
  };

  const handleSendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;

    setSubmitting(true);
    try {
      const { error } = await inviteMember(inviteEmail.trim(), inviteRole);
      if (error) throw error;
      showToast('Invitation sent successfully', 'success');
      setInviteEmail('');
      setInviteRole('member');
      setShowInviteModal(false);
    } catch (err) {
      showToast(err.message || 'Failed to send invite', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <PageHeader
        title="Users & System Roles"
        subtitle="Manage organization personnel, workspace roles, and executive system privileges"
        actions={
          <button
            type="button"
            className={styles.inviteBtn}
            onClick={() => setShowInviteModal(true)}
          >
            <Plus size={16} /> Invite Member
          </button>
        }
      />

      {/* Search Bar */}
      <div className={styles.searchBar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search by name or email…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>
        <span className={styles.memberCountBadge}>
          {filteredMembers.length} member{filteredMembers.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Users Table */}
      {membersLoading && members.length === 0 ? (
        <TaskRowSkeleton count={4} />
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.usersTable}>
            <thead>
              <tr>
                <th>Personnel</th>
                <th>Workspace Role</th>
                <th>System Roles (Executive / Admin)</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
          <tbody>
            {filteredMembers.map((member) => {
              const displayName = getMemberDisplayName(member, user);
              const email = getMemberEmail(member, user);
              const avatarSrc = member.profile?.avatar_url || member.profiles?.avatar_url;
              const userId = member.user_id;
              const userRoles = userId ? systemRolesByUserId.get(userId) || [] : [];
              const userRoleKeys = userRoles.map((r) => r.role);
              const isMemberOwner = member.role === 'owner';

              return (
                <tr key={member.id} className={styles.userRow}>
                  {/* User Info */}
                  <td className={styles.userCell}>
                    <div className={styles.userWrap}>
                      <Avatar
                        name={displayName}
                        src={avatarSrc}
                        size="md"
                      />
                      <div className={styles.metaWrap}>
                        <div className={styles.nameRow}>
                          <strong>{displayName}</strong>
                          {isMemberOwner && (
                            <span className={styles.ownerStar} title="Workspace Owner">
                              <Crown size={13} />
                            </span>
                          )}
                        </div>
                        {email && <span className={styles.emailText}>{email}</span>}
                      </div>
                    </div>
                  </td>

                  {/* Workspace Role */}
                  <td>
                    {isMemberOwner ? (
                      <RoleBadge role="owner" size="sm" />
                    ) : (
                      <select
                        value={member.role}
                        onChange={(e) => handleWorkspaceRoleChange(member.id, e.target.value, member)}
                        className={styles.roleSelect}
                        disabled={!isOwner && !isSystemAdmin}
                      >
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}
                  </td>

                  {/* System Roles Toggles */}
                  <td>
                    {userId ? (
                      <div className={styles.systemRolesGroup}>
                        {SYSTEM_ROLE_KEYS.map(({ key, label }) => {
                          const hasRole = userRoleKeys.includes(key);
                          return (
                            <button
                              key={key}
                              type="button"
                              className={`${styles.systemRoleToggle} ${hasRole ? styles.hasRoleActive : ''}`}
                              onClick={() => handleToggleSystemRole(userId, key)}
                              title={`${hasRole ? 'Revoke' : 'Grant'} ${label} role`}
                              disabled={!isOwner && !isSystemAdmin}
                            >
                              <span className={styles.toggleIndicator}>
                                {hasRole ? <Check size={11} /> : null}
                              </span>
                              <span>{label}</span>
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <span className={styles.pendingHint}>Pending invite</span>
                    )}
                  </td>

                  {/* Status */}
                  <td>
                    <span
                      className={`${styles.statusBadge} ${
                        member.status === 'active' ? styles.statusActive : styles.statusPending
                      }`}
                    >
                      {member.status === 'active' ? 'Active' : 'Invited'}
                    </span>
                  </td>

                  {/* Actions */}
                  <td>
                    {!isMemberOwner && (isOwner || isSystemAdmin) && (
                      <button
                        type="button"
                        className={styles.removeBtn}
                        onClick={async () => {
                          if (confirm(`Remove ${displayName} from this workspace?`)) {
                            await removeMember(member.id);
                            showToast('Member removed', 'success');
                          }
                        }}
                        title="Remove member"
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}

      {/* Invite Member Modal */}
      <Modal isOpen={showInviteModal} onClose={() => setShowInviteModal(false)} title="Invite Team Member">
        <form onSubmit={handleSendInvite}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="inviteEmail">
              Email Address
            </label>
            <input
              id="inviteEmail"
              type="email"
              placeholder="colleague@stacknstock.in"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              autoFocus
              className={styles.modalInput}
              disabled={submitting}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel} htmlFor="inviteRole">
              Workspace Role
            </label>
            <select
              id="inviteRole"
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              className={styles.modalSelect}
              disabled={submitting}
            >
              <option value="member">Member (Standard Access)</option>
              <option value="admin">Admin (Manage Projects & Members)</option>
              <option value="viewer">Viewer (Read-Only)</option>
            </select>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setShowInviteModal(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={submitting || !inviteEmail.trim()}
            >
              {submitting ? 'Sending…' : 'Send Invitation'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
