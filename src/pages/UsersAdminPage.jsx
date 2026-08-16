import { useState, useMemo, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  Search,
  Crown,
  Users,
  Building2,
  ShieldCheck,
  UserCheck,
  Edit2,
  Trash2,
  Sparkles,
  Info,
  Copy,
  Key,
  CheckCheck,
  Eye,
  EyeOff,
  UserPlus,
  ShieldAlert,
} from 'lucide-react';
import { FunctionsHttpError, FunctionsRelayError, FunctionsFetchError } from '@supabase/supabase-js';
import { useMembers } from '../hooks/useMembers';
import { useUserSystemRoles } from '../hooks/useUserSystemRoles';
import { useDepartments } from '../hooks/useDepartments';
import { useUserContext } from '../hooks/useUserContext';
import { useAuth } from '../contexts/AuthContext';
import { useProfile } from '../hooks/useProfile';
import { useToast } from '../components/Toast';
import PageHeader from '../components/PageHeader';
import Avatar from '../components/Avatar';
import RoleBadge from '../components/RoleBadge';
import Modal from '../components/Modal';
import { TaskRowSkeleton } from '../components/Skeleton';
import { supabase } from '../lib/supabase';
import { getMemberEmail } from '../lib/identity';
import styles from './UsersAdminPage.module.css';

// ---------------------------------------------------------------------------
// Parse a structured error message from Edge Function invocation responses.
// Handles FunctionsHttpError (non-2xx), FunctionsRelayError, FunctionsFetchError,
// and plain Error objects. Never exposes JWT, service keys, DB credentials, or
// raw SQL stack traces.
// ---------------------------------------------------------------------------
async function parseEdgeFunctionError(err) {
  if (err instanceof FunctionsHttpError) {
    try {
      const payload = await err.context.json();
      if (payload?.error) return payload.error;
    } catch {
      // JSON parse failed — use status text
    }
    return err.message || 'The administration service returned an error. Please retry.';
  }
  if (err instanceof FunctionsRelayError) {
    return 'The administration service relay is temporarily unavailable. Please retry.';
  }
  if (err instanceof FunctionsFetchError) {
    return 'Could not reach the administration service. Check your connection and retry.';
  }
  // Plain Error from assertNoError or other throw
  return err?.message || 'An unexpected error occurred. Please retry.';
}



// ══════════════════════════════════════════════════════════════════════════════
// FROZEN ONBOARDING MAPPING (V1-01)
// ══════════════════════════════════════════════════════════════════════════════
export const FROZEN_ONBOARDING_MEMBERS = [
  {
    fullName: 'Abhijith T Gopi',
    email: 'abhijith.gopi@stacknstock.in',
    deptCode: 'ENG',
    deptName: 'Engineering',
    deptRole: 'head',
    workspaceRole: 'admin',
    systemRoles: ['cto'],
    designation: 'CTO / Head of Engineering',
  },
  {
    fullName: 'Hari P',
    email: 'hari@stacknstock.in',
    deptCode: 'COMM',
    deptName: 'Commercials & Partnerships',
    deptRole: 'member',
    workspaceRole: 'viewer',
    systemRoles: [],
    designation: 'Intern',
  },
  {
    fullName: 'Jazeel Muhammed',
    email: 'ops@stacknstock.in',
    deptCode: 'OPS',
    deptName: 'Operations',
    deptRole: 'head',
    workspaceRole: 'member',
    systemRoles: [],
    designation: 'Head of Operations',
  },
  {
    fullName: 'Jithin Stalin',
    email: 'jithinstalin@stacknstock.in',
    deptCode: 'COMM',
    deptName: 'Commercials & Partnerships',
    deptRole: 'head',
    workspaceRole: 'admin',
    systemRoles: ['ceo'],
    designation: 'CEO',
  },
  {
    fullName: 'Joseph George',
    email: 'joseph.george@stacknstock.in',
    deptCode: 'FIN',
    deptName: 'Finance',
    deptRole: 'lead',
    workspaceRole: 'member',
    systemRoles: [],
    designation: 'Finance Lead',
  },
  {
    fullName: 'Samson Jose',
    email: 'projects@stacknstock.in',
    deptCode: 'SWIT',
    deptName: 'Software & IT',
    deptRole: 'member',
    workspaceRole: 'viewer',
    systemRoles: [],
    designation: 'Software & IT Member',
  },
  {
    fullName: 'Saravana P',
    email: 'saravana@stacknstock.in',
    deptCode: 'ENG',
    deptName: 'Engineering',
    deptRole: 'lead',
    workspaceRole: 'member',
    systemRoles: [],
    designation: 'Senior Engineer / ASRS Lead',
  },
  {
    fullName: 'Siva Sankar',
    email: 'siva@stacknstock.in',
    deptCode: 'SCM',
    deptName: 'Supply Chain',
    deptRole: 'lead',
    workspaceRole: 'member',
    systemRoles: [],
    designation: 'Supply Chain Manager',
  },
  {
    fullName: 'Sourav Sangeeth',
    email: 'sourav@stacknstock.in',
    deptCode: 'ENG',
    deptName: 'Engineering',
    deptRole: 'member',
    workspaceRole: 'member',
    systemRoles: [],
    designation: 'Engineering Member',
  },
  {
    fullName: 'Suryajith K M',
    email: 'surya@stacknstock.in',
    deptCode: 'COMM',
    deptName: 'Commercials & Partnerships',
    deptRole: 'lead',
    workspaceRole: 'viewer',
    systemRoles: [],
    designation: 'Commercials Lead',
  },
  {
    fullName: 'Vaishnav PV',
    email: 'sourcing@stacknstock.in',
    deptCode: 'OPS',
    deptName: 'Operations',
    deptRole: 'member',
    workspaceRole: 'viewer',
    systemRoles: [],
    designation: 'Procurement / Sourcing (Viewer)',
  },
];

const SYSTEM_ROLE_KEYS = [
  { key: 'ceo', label: 'CEO', desc: 'Executive portfolio access' },
  { key: 'cto', label: 'CTO', desc: 'Technical operations command' },
  { key: 'project_admin', label: 'Project Admin', desc: 'Operational project administration' },
  { key: 'system_admin', label: 'System Admin', desc: 'Full workspace & user administration' },
];

export default function UsersAdminPage() {
  const { workspaceId } = useParams();
  const { user } = useAuth();
  const { profile, updateProfile } = useProfile();
  const { showToast } = useToast();

  const { members = [], loading: membersLoading, refetch: refetchMembers, removeMember } = useMembers(workspaceId);
  const { roles: systemRoles = [], assignRole, removeRole, refetch: refetchRoles } = useUserSystemRoles(workspaceId);
  const { departments = [] } = useDepartments(workspaceId);
  const { isOwner, isSystemAdmin, isWorkspaceAdmin } = useUserContext(workspaceId);

  const canAdminUsers = isOwner || isSystemAdmin || isWorkspaceAdmin;
  const canManageSystemRoles = isOwner || isSystemAdmin;

  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('ALL');
  const [roleFilter, setRoleFilter] = useState('ALL');

  // Workspace-wide department memberships state
  const [deptMemberships, setDeptMemberships] = useState([]);
  const [deptMembershipsLoading, setDeptMembershipsLoading] = useState(true);

  // Modals state
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editingMember, setEditingMember] = useState(null);

  // Credentials Display Modal State (Temporary Password shown once upon provision)
  const [createdUserCredentials, setCreatedUserCredentials] = useState(null);
  const [showTempPassword, setShowTempPassword] = useState(true);
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  // User Provisioning Form State
  const [inviteFullName, setInviteFullName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteWorkspaceRole, setInviteWorkspaceRole] = useState('member');
  const [invitePrimaryDeptId, setInvitePrimaryDeptId] = useState('');
  const [invitePrimaryDeptRole, setInvitePrimaryDeptRole] = useState('member');
  const [inviteAdditionalDepts, setInviteAdditionalDepts] = useState([]); // [{ department_id, role }]
  const [inviteSystemRoles, setInviteSystemRoles] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  // Profile Edit State
  const [profileFullName, setProfileFullName] = useState('');

  // Fetch all department memberships in workspace
  const fetchDeptMemberships = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setDeptMembershipsLoading(true);
      const { data, error } = await supabase
        .from('department_memberships')
        .select(`
          id,
          workspace_id,
          department_id,
          user_id,
          role,
          is_primary,
          is_active,
          departments:department_id (
            id,
            code,
            name,
            color
          )
        `)
        .eq('workspace_id', workspaceId)
        .eq('is_active', true);

      if (error) throw error;
      setDeptMemberships(data || []);
    } catch (err) {
      console.error('Error fetching department memberships:', err);
    } finally {
      setDeptMembershipsLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    fetchDeptMemberships();
  }, [fetchDeptMemberships]);

  // Set default primary department when departments load
  useEffect(() => {
    if (departments.length > 0 && !invitePrimaryDeptId) {
      setInvitePrimaryDeptId(departments[0].id);
    }
  }, [departments, invitePrimaryDeptId]);

  // Index department memberships by user_id
  const deptMembershipsByUserId = useMemo(() => {
    const map = new Map();
    for (const dm of deptMemberships) {
      if (!map.has(dm.user_id)) map.set(dm.user_id, []);
      map.get(dm.user_id).push(dm);
    }
    return map;
  }, [deptMemberships]);

  // Index system roles by user_id
  const systemRolesByUserId = useMemo(() => {
    const map = new Map();
    for (const r of systemRoles) {
      if (!map.has(r.user_id)) map.set(r.user_id, []);
      map.get(r.user_id).push(r);
    }
    return map;
  }, [systemRoles]);

  // Existing member emails set
  const existingMemberEmails = useMemo(() => {
    const emails = new Set();
    for (const m of members) {
      const email = getMemberEmail(m, user);
      if (email) emails.add(email.toLowerCase().trim());
      if (m.invited_email) emails.add(m.invited_email.toLowerCase().trim());
    }
    return emails;
  }, [members, user]);

  // Pending Onboarding List (Frozen members not yet invited)
  const pendingOnboardingList = useMemo(() => {
    return FROZEN_ONBOARDING_MEMBERS.filter(
      (m) => !existingMemberEmails.has(m.email.toLowerCase().trim())
    );
  }, [existingMemberEmails]);

  // Top Stats calculations
  const stats = useMemo(() => {
    const totalPeople = members.length;
    const totalDepts = departments.length;
    const deptHeads = deptMemberships.filter((dm) => dm.role === 'head').length;
    const projectAdmins = systemRoles.filter((r) => r.role === 'project_admin').length;
    const sysAdmins = systemRoles.filter((r) => r.role === 'system_admin').length;

    return {
      totalPeople,
      totalDepts,
      deptHeads,
      projectAdmins,
      sysAdmins,
    };
  }, [members, departments, deptMemberships, systemRoles]);

  // Filtered Members
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      const profileName = m.profile?.full_name || m.profiles?.full_name || '';
      const email = getMemberEmail(m, user) || '';
      const q = search.toLowerCase().trim();

      const matchesSearch =
        !q ||
        profileName.toLowerCase().includes(q) ||
        email.toLowerCase().includes(q) ||
        m.role.toLowerCase().includes(q);

      const matchesRole = roleFilter === 'ALL' || m.role === roleFilter;

      let matchesDept = true;
      if (deptFilter !== 'ALL') {
        const userDepts = m.user_id ? deptMembershipsByUserId.get(m.user_id) || [] : [];
        matchesDept = userDepts.some((d) => d.departments?.code === deptFilter);
      }

      return matchesSearch && matchesRole && matchesDept;
    });
  }, [members, search, roleFilter, deptFilter, user, deptMembershipsByUserId]);

  // Prepare Invite from Onboarding List
  const handlePrepareInvite = (onboardingItem) => {
    setInviteFullName(onboardingItem.fullName);
    setInviteEmail(onboardingItem.email);
    setInviteWorkspaceRole(
      onboardingItem.workspaceRole === 'admin' && !canManageSystemRoles
        ? 'member'
        : onboardingItem.workspaceRole
    );

    const targetDept = departments.find((d) => d.code === onboardingItem.deptCode);
    if (targetDept) {
      setInvitePrimaryDeptId(targetDept.id);
      setInvitePrimaryDeptRole(onboardingItem.deptRole);
    }

    setInviteAdditionalDepts([]);
    setInviteSystemRoles(canManageSystemRoles ? onboardingItem.systemRoles : []);
    setShowInviteModal(true);
  };

  // Submit User Provisioning
  const handleSendInvite = async (e) => {
    e.preventDefault();
    if (!inviteEmail.trim() || !inviteFullName.trim() || !invitePrimaryDeptId) {
      showToast('Please fill all required fields.', 'error');
      return;
    }

    if (inviteWorkspaceRole === 'admin' && !canManageSystemRoles) {
      showToast('Only Workspace Owners and System Administrators can appoint Admins.', 'error');
      return;
    }

    setSubmitting(true);
    try {
      const primaryDept = {
        department_id: invitePrimaryDeptId,
        role: invitePrimaryDeptRole,
        is_primary: true,
      };

      const departmentsPayload = [
        primaryDept,
        ...inviteAdditionalDepts.map((d) => ({
          department_id: d.department_id,
          role: d.role,
          is_primary: false,
        })),
      ];

      const payload = {
        action: 'provision',
        workspace_id: workspaceId,
        full_name: inviteFullName.trim(),
        email: inviteEmail.trim().toLowerCase(),
        workspace_role: inviteWorkspaceRole,
        departments: departmentsPayload,
        system_roles: canManageSystemRoles ? inviteSystemRoles : [],
      };

      // Invoke Edge function exclusively (no privileged client fallback).
      // supabase-js throws FunctionsHttpError on non-2xx, FunctionsRelayError on
      // relay failures, and FunctionsFetchError on network errors — all caught below.
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke(
        'admin-manage-workspace-user',
        { body: payload }
      );

      if (edgeErr) {
        // Re-throw so the catch handler can parse it with parseEdgeFunctionError
        throw edgeErr;
      }

      if (!edgeData?.success) {
        throw new Error(edgeData?.error || 'Organization administration service unavailable.');
      }

      // Display credentials modal containing the temporary password
      if (edgeData?.temporary_password) {
        setCreatedUserCredentials({
          fullName: inviteFullName.trim(),
          email: inviteEmail.trim().toLowerCase(),
          temporaryPassword: edgeData.temporary_password,
        });
      }

      showToast(`User ${inviteFullName.trim()} provisioned successfully!`, 'success');

      // Reset form & reload
      setShowInviteModal(false);
      setInviteFullName('');
      setInviteEmail('');
      setInviteWorkspaceRole('member');
      setInviteAdditionalDepts([]);
      setInviteSystemRoles([]);
      await Promise.all([refetchMembers(), fetchDeptMemberships(), refetchRoles()]);
    } catch (err) {
      console.error('Error provisioning user:', err);
      const errorMsg = await parseEdgeFunctionError(err);
      showToast(errorMsg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Open Edit Modal
  const handleOpenEditModal = (member) => {
    setEditingMember(member);
    const userId = member.user_id;
    const userDepts = userId ? deptMembershipsByUserId.get(userId) || [] : [];
    const primary = userDepts.find((d) => d.is_primary) || userDepts[0] || null;
    const additional = userDepts.filter((d) => d.id !== primary?.id);

    setInviteFullName(member.profile?.full_name || member.profiles?.full_name || '');
    setInviteWorkspaceRole(member.role);
    setInvitePrimaryDeptId(primary?.department_id || departments[0]?.id || '');
    setInvitePrimaryDeptRole(primary?.role || 'member');
    setInviteAdditionalDepts(
      additional.map((a) => ({ department_id: a.department_id, role: a.role }))
    );

    const userSysRoles = userId ? systemRolesByUserId.get(userId) || [] : [];
    setInviteSystemRoles(userSysRoles.map((r) => r.role));

    setShowEditModal(true);
  };

  // Submit Edit Member
  const handleSaveEditMember = async (e) => {
    e.preventDefault();
    if (!editingMember) return;

    setSubmitting(true);
    try {
      const primaryDept = invitePrimaryDeptId
        ? {
            department_id: invitePrimaryDeptId,
            role: invitePrimaryDeptRole,
            is_primary: true,
          }
        : null;

      const departmentsPayload = primaryDept
        ? [
            primaryDept,
            ...inviteAdditionalDepts.map((d) => ({
              department_id: d.department_id,
              role: d.role,
              is_primary: false,
            })),
          ]
        : [];

      const payload = {
        action: 'update',
        workspace_id: workspaceId,
        user_id: editingMember.user_id,
        full_name: inviteFullName.trim(),
        workspace_role: editingMember.role === 'owner' ? 'owner' : inviteWorkspaceRole,
        departments: departmentsPayload,
        system_roles: canManageSystemRoles ? inviteSystemRoles : undefined,
      };

      // Invoke Edge function exclusively (no privileged client fallback).
      // supabase-js throws FunctionsHttpError on non-2xx, FunctionsRelayError on
      // relay failures, and FunctionsFetchError on network errors — all caught below.
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke(
        'admin-manage-workspace-user',
        { body: payload }
      );

      if (edgeErr) {
        throw edgeErr;
      }

      if (!edgeData?.success) {
        throw new Error(edgeData?.error || 'Organization administration service unavailable.');
      }

      showToast(`Updated member details for ${editingMember.profile?.full_name || 'user'}.`, 'success');
      setShowEditModal(false);
      setEditingMember(null);
      await Promise.all([refetchMembers(), fetchDeptMemberships(), refetchRoles()]);
    } catch (err) {
      console.error('Error updating member:', err);
      const errorMsg = await parseEdgeFunctionError(err);
      showToast(errorMsg, 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Reissue Temporary Password for pending member
  const handleReissueTempPassword = async (member) => {
    const rawName = member.profile?.full_name || '';
    const email = getMemberEmail(member, user);
    if (!confirm(`Reissue a new temporary password for ${rawName || email}?`)) {
      return;
    }

    try {
      const { data: edgeData, error: edgeErr } = await supabase.functions.invoke(
        'admin-manage-workspace-user',
        {
          body: {
            action: 'reissue_temp_password',
            workspace_id: workspaceId,
            user_id: member.user_id,
          },
        }
      );

      if (edgeErr) throw edgeErr;
      if (!edgeData?.success) {
        throw new Error(edgeData?.error || 'Failed to reissue temporary password');
      }

      if (edgeData?.temporary_password) {
        setCreatedUserCredentials({
          fullName: rawName || email,
          email: email,
          temporaryPassword: edgeData.temporary_password,
        });
      }

      showToast(`Temporary password reissued for ${rawName || email}`, 'success');
    } catch (err) {
      console.error('Error reissuing temporary password:', err);
      const errorMsg = await parseEdgeFunctionError(err);
      showToast(errorMsg, 'error');
    }
  };

  // Save own profile name
  const handleSaveOwnProfile = async (e) => {
    e.preventDefault();
    if (!profileFullName.trim()) return;

    setSubmitting(true);
    try {
      const { error } = await updateProfile({ full_name: profileFullName.trim() });
      if (error) throw error;
      showToast('Profile updated successfully!', 'success');
      setShowProfileModal(false);
      setProfileFullName('');
      await refetchMembers();
    } catch (err) {
      showToast(err.message || 'Failed to update profile', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.container}>
      <PageHeader
        title="Organization & Personnel"
        subtitle="Manage workspace personnel, departmental structures, and executive system authorities"
        actions={
          canAdminUsers && (
            <button
              type="button"
              className={styles.inviteBtn}
              onClick={() => {
                setInviteFullName('');
                setInviteEmail('');
                setInviteWorkspaceRole('member');
                setInviteAdditionalDepts([]);
                setInviteSystemRoles([]);
                setShowInviteModal(true);
              }}
            >
              <UserPlus size={16} /> Create User
            </button>
          )
        }
      />

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* TOP STATS CARDS                                                       */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard}>
          <div className={styles.statIconWrap} style={{ color: 'var(--yellow)' }}>
            <Users size={20} />
          </div>
          <div className={styles.statMeta}>
            <span className={styles.statLabel}>Total Personnel</span>
            <span className={styles.statVal}>{stats.totalPeople}</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIconWrap} style={{ color: '#8cc9ff' }}>
            <Building2 size={20} />
          </div>
          <div className={styles.statMeta}>
            <span className={styles.statLabel}>Departments</span>
            <span className={styles.statVal}>{stats.totalDepts}</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIconWrap} style={{ color: '#60d394' }}>
            <UserCheck size={20} />
          </div>
          <div className={styles.statMeta}>
            <span className={styles.statLabel}>Department Heads</span>
            <span className={styles.statVal}>{stats.deptHeads}</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIconWrap} style={{ color: '#ffb020' }}>
            <ShieldCheck size={20} />
          </div>
          <div className={styles.statMeta}>
            <span className={styles.statLabel}>Project Admins</span>
            <span className={styles.statVal}>{stats.projectAdmins}</span>
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statIconWrap} style={{ color: '#ff6666' }}>
            <Crown size={20} />
          </div>
          <div className={styles.statMeta}>
            <span className={styles.statLabel}>System Admins</span>
            <span className={styles.statVal}>{stats.sysAdmins}</span>
          </div>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* FROZEN ONBOARDING QUEUE (Approved Team Members)                       */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {canAdminUsers && pendingOnboardingList.length > 0 && (
        <div className={styles.onboardingCard}>
          <div className={styles.onboardingHeader}>
            <div className={styles.onboardingTitleWrap}>
              <Sparkles size={18} className={styles.sparkleIcon} />
              <div>
                <h3 className={styles.onboardingTitle}>
                  Organization Setup — Approved Personnel Onboarding ({pendingOnboardingList.length})
                </h3>
                <p className={styles.onboardingSubtitle}>
                  Direct user provisioning with temporary password credentials. The user will be required to set their own password upon first login.
                </p>
              </div>
            </div>
          </div>

          <div className={styles.onboardingTableWrap}>
            <table className={styles.onboardingTable}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>Dept Role</th>
                  <th>Workspace Role</th>
                  <th>System Roles</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingOnboardingList.map((emp) => (
                  <tr key={emp.email} className={styles.onboardingRow}>
                    <td>
                      <div className={styles.empInfo}>
                        <strong>{emp.fullName}</strong>
                        <span className={styles.empEmail}>{emp.email}</span>
                      </div>
                    </td>
                    <td>
                      <span className={styles.deptCodePill}>{emp.deptCode}</span>
                      <span className={styles.deptNameText}>{emp.deptName}</span>
                    </td>
                    <td>
                      <span className={`${styles.deptRolePill} ${styles['role_' + emp.deptRole]}`}>
                        {emp.deptRole.toUpperCase()}
                      </span>
                    </td>
                    <td>
                      <RoleBadge role={emp.workspaceRole} size="sm" />
                    </td>
                    <td>
                      {emp.systemRoles.length > 0 ? (
                        <div className={styles.sysRolePillGroup}>
                          {emp.systemRoles.map((sr) => (
                            <span key={sr} className={styles.sysRolePill}>
                              {sr.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={styles.noneMuted}>None</span>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        className={styles.prepareInviteBtn}
                        onClick={() => handlePrepareInvite(emp)}
                      >
                        <UserPlus size={13} /> Provision User
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* FILTER & SEARCH BAR                                                  */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <div className={styles.filterBar}>
        <div className={styles.searchBox}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            placeholder="Search active personnel by name, email, or role…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.filterControls}>
          <select
            value={deptFilter}
            onChange={(e) => setDeptFilter(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="ALL">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.code}>
                {d.name} ({d.code})
              </option>
            ))}
          </select>

          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className={styles.filterSelect}
          >
            <option value="ALL">All Workspace Roles</option>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="member">Member</option>
            <option value="viewer">Viewer</option>
          </select>
        </div>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ACTIVE MEMBERS TABLE                                                 */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {membersLoading && members.length === 0 ? (
        <TaskRowSkeleton count={4} />
      ) : (
        <div className={styles.tableCard}>
          <table className={styles.usersTable}>
            <thead>
              <tr>
                <th>Personnel</th>
                <th>Workspace Role</th>
                <th>Primary Department</th>
                <th>Additional Departments</th>
                <th>System Roles</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredMembers.map((member) => {
                const isCurrentUser = member.user_id === user?.id;
                const rawName = member.profile?.full_name || member.profiles?.full_name;
                const email = getMemberEmail(member, user);
                const avatarSrc = member.profile?.avatar_url || member.profiles?.avatar_url;
                const userId = member.user_id;

                const userDepts = userId ? deptMembershipsByUserId.get(userId) || [] : [];
                const primaryDept = userDepts.find((d) => d.is_primary) || userDepts[0] || null;
                const additionalDepts = userDepts.filter((d) => d.id !== primaryDept?.id);

                const userRoles = userId ? systemRolesByUserId.get(userId) || [] : [];
                const userRoleKeys = userRoles.map((r) => r.role);
                const isMemberOwner = member.role === 'owner';

                return (
                  <tr key={member.id} className={styles.userRow}>
                    {/* Personnel Info */}
                    <td className={styles.userCell}>
                      <div className={styles.userWrap}>
                        <Avatar name={rawName || email || 'Member'} src={avatarSrc} size="md" />
                        <div className={styles.metaWrap}>
                          <div className={styles.nameRow}>
                            {rawName ? (
                              <strong>{rawName}</strong>
                            ) : isCurrentUser ? (
                              <button
                                type="button"
                                className={styles.completeProfileBtn}
                                onClick={() => {
                                  setProfileFullName(profile?.full_name || '');
                                  setShowProfileModal(true);
                                }}
                                title="Click to complete your profile name"
                              >
                                <Info size={13} /> Complete your profile
                              </button>
                            ) : (
                              <span className={styles.unnamedUser}>Unnamed User</span>
                            )}

                            {isMemberOwner && (
                              <span className={styles.ownerStar} title="Workspace Owner">
                                <Crown size={14} />
                              </span>
                            )}
                          </div>
                          {email && <span className={styles.emailText}>{email}</span>}
                        </div>
                      </div>
                    </td>

                    {/* Workspace Role */}
                    <td>
                      <RoleBadge role={member.role} size="sm" />
                    </td>

                    {/* Primary Department */}
                    <td>
                      {primaryDept ? (
                        <div className={styles.deptBadgeWrap}>
                          <span
                            className={styles.deptCodeBadge}
                            style={{
                              borderColor: primaryDept.departments?.color || 'var(--yellow)',
                              background: `${primaryDept.departments?.color || '#FDE215'}18`,
                            }}
                          >
                            {primaryDept.departments?.code || 'DEPT'}
                          </span>
                          <span className={`${styles.deptRolePill} ${styles['role_' + primaryDept.role]}`}>
                            {primaryDept.role.toUpperCase()}
                          </span>
                        </div>
                      ) : (
                        <span className={styles.noneMuted}>Unassigned</span>
                      )}
                    </td>

                    {/* Additional Departments */}
                    <td>
                      {additionalDepts.length > 0 ? (
                        <div className={styles.additionalDeptWrap}>
                          {additionalDepts.map((ad) => (
                            <span key={ad.id} className={styles.additionalDeptPill}>
                              {ad.departments?.code} ({ad.role})
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={styles.noneMuted}>—</span>
                      )}
                    </td>

                    {/* System Roles */}
                    <td>
                      {userRoleKeys.length > 0 ? (
                        <div className={styles.sysRolePillGroup}>
                          {userRoleKeys.map((sr) => (
                            <span key={sr} className={styles.sysRolePill}>
                              {sr.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className={styles.noneMuted}>None</span>
                      )}
                    </td>

                    {/* Account Status */}
                    <td>
                      {member.status === 'active' ? (
                        <span className={`${styles.statusBadge} ${styles.statusActive}`}>
                          Active
                        </span>
                      ) : (
                        <span
                          className={`${styles.statusBadge} ${styles.statusSetupRequired}`}
                          title="First login password setup required"
                        >
                          PASSWORD SETUP REQUIRED
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td>
                      <div className={styles.actionBtnGroup}>
                        {canAdminUsers && (
                          <button
                            type="button"
                            className={styles.editBtn}
                            onClick={() => handleOpenEditModal(member)}
                            title="Edit member"
                          >
                            <Edit2 size={14} /> Edit
                          </button>
                        )}

                        {canAdminUsers && member.status === 'pending' && (
                          <button
                            type="button"
                            className={styles.reissueBtn}
                            onClick={() => handleReissueTempPassword(member)}
                            title="Reissue temporary password"
                          >
                            <Key size={14} /> Reissue Password
                          </button>
                        )}

                        {!isMemberOwner && canAdminUsers && (
                          <button
                            type="button"
                            className={styles.removeBtn}
                            onClick={async () => {
                              if (confirm(`Remove ${rawName || email || 'this user'} from this workspace?`)) {
                                await removeMember(member.id);
                                showToast('Member removed from workspace', 'success');
                                await Promise.all([refetchMembers(), fetchDeptMemberships()]);
                              }
                            }}
                            title="Remove member"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* CREATE USER / PROVISION MODAL                                         */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <Modal
        isOpen={showInviteModal}
        onClose={() => setShowInviteModal(false)}
        title="Create Organization User"
      >
        <form onSubmit={handleSendInvite} className={styles.modalForm}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel}>Full Name *</label>
            <input
              type="text"
              placeholder="e.g. Abhijith T Gopi"
              value={inviteFullName}
              onChange={(e) => setInviteFullName(e.target.value)}
              required
              className={styles.modalInput}
              disabled={submitting}
            />
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel}>Corporate Email Address *</label>
            <input
              type="email"
              placeholder="colleague@stacknstock.in"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className={styles.modalInput}
              disabled={submitting}
            />
          </div>

          <div className={styles.modalRow}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Workspace Role *</label>
              <select
                value={inviteWorkspaceRole}
                onChange={(e) => setInviteWorkspaceRole(e.target.value)}
                className={styles.modalSelect}
                disabled={submitting}
              >
                {canManageSystemRoles && <option value="admin">Admin (Manage Projects & Members)</option>}
                <option value="member">Member (Standard Access)</option>
                <option value="viewer">Viewer (Read-Only)</option>
              </select>
              {!canManageSystemRoles && (
                <span className={styles.fieldHint}>Only Owners & System Admins can appoint Admins</span>
              )}
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Primary Department *</label>
              <select
                value={invitePrimaryDeptId}
                onChange={(e) => setInvitePrimaryDeptId(e.target.value)}
                className={styles.modalSelect}
                required
                disabled={submitting}
              >
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.modalField}>
            <label className={styles.modalLabel}>Department Role in Primary Department *</label>
            <select
              value={invitePrimaryDeptRole}
              onChange={(e) => setInvitePrimaryDeptRole(e.target.value)}
              className={styles.modalSelect}
              disabled={submitting}
            >
              <option value="member">Member</option>
              <option value="lead">Department Lead</option>
              <option value="head">Department Head</option>
            </select>
          </div>

          {/* System Roles (Gated to Owner & System Admin) */}
          {canManageSystemRoles && (
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Executive System Roles</label>
              <div className={styles.systemRolesPicker}>
                {SYSTEM_ROLE_KEYS.map(({ key, label, desc }) => {
                  const isChecked = inviteSystemRoles.includes(key);
                  return (
                    <label key={key} className={styles.sysRoleCheckLabel}>
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setInviteSystemRoles([...inviteSystemRoles, key]);
                          } else {
                            setInviteSystemRoles(inviteSystemRoles.filter((r) => r !== key));
                          }
                        }}
                      />
                      <div>
                        <strong>{label}</strong>
                        <span className={styles.sysRoleDesc}>{desc}</span>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>
          )}

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
              disabled={submitting || !inviteEmail.trim() || !inviteFullName.trim()}
            >
              {submitting ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </Modal>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* CREATED USER CREDENTIALS MODAL                                         */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {createdUserCredentials && (
        <Modal
          isOpen={!!createdUserCredentials}
          onClose={() => setCreatedUserCredentials(null)}
          title="User Created Successfully"
        >
          <div className={styles.credentialsWrap}>
            <div className={styles.credentialsWarning}>
              <ShieldAlert size={20} style={{ flexShrink: 0 }} />
              <div>
                <strong>Temporary Password Generated</strong>
                <span>
                  This temporary password is shown only once. Store or share it securely with the employee. The employee will be required to set their own password upon first login.
                </span>
              </div>
            </div>

            <div className={styles.credentialsCard}>
              <div className={styles.credentialRow}>
                <span className={styles.credentialLabel}>Employee Name</span>
                <span className={styles.credentialValue}>{createdUserCredentials.fullName}</span>
              </div>

              <div className={styles.credentialRow}>
                <span className={styles.credentialLabel}>Corporate Email</span>
                <div className={styles.credentialValueRow}>
                  <span className={styles.credentialValue}>{createdUserCredentials.email}</span>
                  <button
                    type="button"
                    className={styles.copySmallBtn}
                    onClick={() => {
                      navigator.clipboard.writeText(createdUserCredentials.email);
                      setCopiedEmail(true);
                      setTimeout(() => setCopiedEmail(false), 2000);
                    }}
                  >
                    {copiedEmail ? <CheckCheck size={13} color="#60d394" /> : <Copy size={13} />}
                    {copiedEmail ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className={styles.credentialRow}>
                <span className={styles.credentialLabel}>Temporary Password</span>
                <div className={styles.credentialValueRow}>
                  <span className={`${styles.credentialValue} ${styles.passwordBox}`}>
                    {showTempPassword ? createdUserCredentials.temporaryPassword : '••••••••••••••••'}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      className={styles.copySmallBtn}
                      onClick={() => setShowTempPassword(!showTempPassword)}
                      title={showTempPassword ? 'Hide password' : 'Show password'}
                    >
                      {showTempPassword ? <EyeOff size={13} /> : <Eye size={13} />}
                    </button>
                    <button
                      type="button"
                      className={styles.copySmallBtn}
                      onClick={() => {
                        navigator.clipboard.writeText(createdUserCredentials.temporaryPassword);
                        setCopiedPassword(true);
                        setTimeout(() => setCopiedPassword(false), 2000);
                      }}
                    >
                      {copiedPassword ? <CheckCheck size={13} color="#60d394" /> : <Copy size={13} />}
                      {copiedPassword ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className={styles.credentialActions}>
              <button
                type="button"
                className={styles.copyAllBtn}
                onClick={() => {
                  const details = `SNS Projects Login Details\nEmail: ${createdUserCredentials.email}\nTemporary Password: ${createdUserCredentials.temporaryPassword}\nLogin URL: https://abzops.github.io/sns-projects/`;
                  navigator.clipboard.writeText(details);
                  setCopiedAll(true);
                  setTimeout(() => setCopiedAll(false), 2000);
                }}
              >
                {copiedAll ? <CheckCheck size={16} color="#60d394" /> : <Copy size={16} />}
                <span>{copiedAll ? 'Login Details Copied!' : 'Copy All Login Details'}</span>
              </button>
              <button
                type="button"
                className={styles.doneBtn}
                onClick={() => setCreatedUserCredentials(null)}
              >
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* EDIT MEMBER MODAL                                                     */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {editingMember && (
        <Modal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setEditingMember(null);
          }}
          title={`Edit Personnel — ${editingMember.profile?.full_name || getMemberEmail(editingMember, user)}`}
        >
          <form onSubmit={handleSaveEditMember} className={styles.modalForm}>
            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Full Name</label>
              <input
                type="text"
                value={inviteFullName}
                onChange={(e) => setInviteFullName(e.target.value)}
                className={styles.modalInput}
                disabled={submitting}
              />
            </div>

            <div className={styles.modalField}>
              <label className={styles.modalLabel}>Workspace Role</label>
              {editingMember.role === 'owner' ? (
                <div className={styles.ownerLockedBox}>
                  <Crown size={15} color="var(--yellow)" />
                  <span>Workspace Owner (Protected — Cannot be demoted)</span>
                </div>
              ) : (
                <select
                  value={inviteWorkspaceRole}
                  onChange={(e) => setInviteWorkspaceRole(e.target.value)}
                  className={styles.modalSelect}
                  disabled={submitting}
                >
                  {canManageSystemRoles && <option value="admin">Admin</option>}
                  <option value="member">Member</option>
                  <option value="viewer">Viewer</option>
                </select>
              )}
            </div>

            <div className={styles.modalRow}>
              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Primary Department</label>
                <select
                  value={invitePrimaryDeptId}
                  onChange={(e) => setInvitePrimaryDeptId(e.target.value)}
                  className={styles.modalSelect}
                  disabled={submitting}
                >
                  {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.code})
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.modalField}>
                <label className={styles.modalLabel}>Primary Department Role</label>
                <select
                  value={invitePrimaryDeptRole}
                  onChange={(e) => setInvitePrimaryDeptRole(e.target.value)}
                  className={styles.modalSelect}
                  disabled={submitting}
                >
                  <option value="member">Member</option>
                  <option value="lead">Department Lead</option>
                  <option value="head">Department Head</option>
                </select>
              </div>
            </div>

            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={() => {
                  setShowEditModal(false);
                  setEditingMember(null);
                }}
                disabled={submitting}
              >
                Cancel
              </button>
              <button
                type="submit"
                className={styles.confirmBtn}
                disabled={submitting}
              >
                {submitting ? 'Saving…' : 'Save Changes'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* EDIT OWN PROFILE MODAL                                                */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      <Modal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
        title="Complete Your Profile"
      >
        <form onSubmit={handleSaveOwnProfile} className={styles.modalForm}>
          <div className={styles.modalField}>
            <label className={styles.modalLabel}>Your Full Name *</label>
            <input
              type="text"
              placeholder="e.g. Abhinand"
              value={profileFullName}
              onChange={(e) => setProfileFullName(e.target.value)}
              required
              autoFocus
              className={styles.modalInput}
              disabled={submitting}
            />
            <span className={styles.fieldHint}>
              This will be displayed across project tasks, RACI assignments, and audit trails.
            </span>
          </div>

          <div className={styles.modalActions}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={() => setShowProfileModal(false)}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.confirmBtn}
              disabled={submitting || !profileFullName.trim()}
            >
              {submitting ? 'Saving…' : 'Save Profile'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
