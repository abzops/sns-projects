import { useState, useMemo } from 'react';
import {
  Search,
  Check,
  UserRoundPlus,
  Building2,
  Shield,
  X,
  AlertCircle,
} from 'lucide-react';
import Modal from '../Modal';
import Avatar from '../Avatar';
import styles from './RaciUserPicker.module.css';
import { getRaciRoleLabel } from '../../utils/raciPresentation';

export default function RaciUserPicker({
  isOpen,
  onClose,
  title,
  role,
  currentAssignments = [],
  activeMembers = [],
  onSave,
}) {
  const [search, setSearch] = useState('');

  // Initial selection state
  const initialProcessStarter = useMemo(() => {
    return currentAssignments.some((a) => a.actor_type === 'process_starter');
  }, [currentAssignments]);

  const initialUserMap = useMemo(() => {
    const map = new Map(); // userId -> { response_required }
    currentAssignments.forEach((a) => {
      if (a.user_id) {
        map.set(a.user_id, { response_required: Boolean(a.response_required) });
      }
    });
    return map;
  }, [currentAssignments]);

  const [selectedProcessStarter, setSelectedProcessStarter] = useState(initialProcessStarter);
  const [selectedUsers, setSelectedUsers] = useState(initialUserMap);

  // Filter members
  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (activeMembers || []).filter((m) => {
      if (m.status !== 'active') return false;
      if (!q) return true;
      const name = (m.full_name || m.profiles?.full_name || '').toLowerCase();
      const email = (m.email || m.profiles?.email || '').toLowerCase();
      const dept = (m.department_name || m.departments?.name || '').toLowerCase();
      return name.includes(q) || email.includes(q) || dept.includes(q);
    });
  }, [activeMembers, search]);

  const handleToggleProcessStarter = () => {
    if (role !== 'R') return;
    setSelectedProcessStarter((prev) => !prev);
  };

  const handleToggleUser = (userId) => {
    if (role === 'A') {
      // Single select for Accountable
      const next = new Map();
      if (selectedUsers.has(userId)) {
        // deselect
      } else {
        next.set(userId, { response_required: false });
      }
      setSelectedUsers(next);
      return;
    }

    // Multi-select for R, C, I
    setSelectedUsers((prev) => {
      const next = new Map(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.set(userId, { response_required: false });
      }
      return next;
    });
  };

  const handleToggleResponseRequired = (userId, e) => {
    e.stopPropagation();
    setSelectedUsers((prev) => {
      const next = new Map(prev);
      const cur = next.get(userId);
      if (cur) {
        next.set(userId, { ...cur, response_required: !cur.response_required });
      }
      return next;
    });
  };

  const handleApply = () => {
    const results = [];

    // Add Process Starter if selected and role is R
    if (role === 'R' && selectedProcessStarter) {
      results.push({
        raci_role: 'R',
        actor_type: 'process_starter',
        user_id: null,
        response_required: false,
      });
    }

    // Add selected concrete users
    selectedUsers.forEach((data, userId) => {
      results.push({
        raci_role: role,
        actor_type: 'user',
        user_id: userId,
        response_required: role === 'C' ? Boolean(data.response_required) : false,
      });
    });

    onSave(results);
    onClose();
  };

  const isSingleSelect = role === 'A';
  const roleName = getRaciRoleLabel(role, { group: role === 'R' });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={title || `Assign ${roleName} (${role})`}
      size="md"
    >
      <div className={styles.container}>
        {/* Search Bar */}
        <div className={styles.searchWrapper}>
          <Search size={16} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search active team members by name, email, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
          {search && (
            <button
              type="button"
              className={styles.clearSearchBtn}
              onClick={() => setSearch('')}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Info Banner for Role */}
        <div className={styles.roleHint}>
          {role === 'R' && (
            <span>
              <strong>Assignees (R):</strong> People who do the work to achieve the step. Multi-select. Can include <em>Process Starter</em>.
            </span>
          )}
          {role === 'A' && (
            <span>
              <strong>Owner (A):</strong> The single individual with final decision authority. Single-select only.
            </span>
          )}
          {role === 'C' && (
            <span>
              <strong>Consulted (C):</strong> Subject matter experts consulted for two-way input. Optional.
            </span>
          )}
          {role === 'I' && (
            <span>
              <strong>Informed (I):</strong> People kept updated on progress. Optional.
            </span>
          )}
        </div>

        {/* Member List */}
        <div className={styles.list}>
          {/* Dynamic Actor: Process Starter (Only for R) */}
          {role === 'R' && (
            <div
              className={`${styles.item} ${styles.processStarterItem} ${
                selectedProcessStarter ? styles.itemSelected : ''
              }`}
              onClick={handleToggleProcessStarter}
            >
              <div className={styles.checkboxWrapper}>
                <div
                  className={`${styles.checkbox} ${
                    selectedProcessStarter ? styles.checkboxChecked : ''
                  }`}
                >
                  {selectedProcessStarter && <Check size={12} />}
                </div>
              </div>

              <div className={styles.avatarWrapper}>
                <div className={styles.processStarterAvatar}>
                  <UserRoundPlus size={16} />
                </div>
              </div>

              <div className={styles.userInfo}>
                <div className={styles.userNameRow}>
                  <span className={styles.processStarterTitle}>Process Starter</span>
                  <span className={styles.dynamicBadge}>Dynamic Actor</span>
                </div>
                <span className={styles.userSubtext}>
                  Whoever initiates the process instance becomes an Assignee at runtime
                </span>
              </div>
            </div>
          )}

          {filteredMembers.length === 0 ? (
            <div className={styles.emptyResults}>
              <AlertCircle size={24} />
              <p>No active workspace members found matching "{search}"</p>
            </div>
          ) : (
            filteredMembers.map((member) => {
              const userId = member.user_id || member.id;
              const isSelected = selectedUsers.has(userId);
              const userData = selectedUsers.get(userId);
              const name = member.full_name || member.profiles?.full_name || 'Team Member';
              const email = member.email || member.profiles?.email || '';
              const deptName = member.department_name || member.departments?.name;

              return (
                <div
                  key={userId}
                  className={`${styles.item} ${isSelected ? styles.itemSelected : ''}`}
                  onClick={() => handleToggleUser(userId)}
                >
                  <div className={styles.checkboxWrapper}>
                    <div
                      className={`${isSingleSelect ? styles.radio : styles.checkbox} ${
                        isSelected ? (isSingleSelect ? styles.radioChecked : styles.checkboxChecked) : ''
                      }`}
                    >
                      {isSelected && !isSingleSelect && <Check size={12} />}
                      {isSelected && isSingleSelect && <div className={styles.radioDot} />}
                    </div>
                  </div>

                  <div className={styles.avatarWrapper}>
                    <Avatar name={name} src={member.avatar_url || member.profiles?.avatar_url} size="sm" />
                  </div>

                  <div className={styles.userInfo}>
                    <div className={styles.userNameRow}>
                      <span className={styles.userName}>{name}</span>
                      {deptName && (
                        <span className={styles.deptPill}>
                          <Building2 size={11} /> {deptName}
                        </span>
                      )}
                      {member.role && (
                        <span className={styles.rolePill}>
                          <Shield size={10} /> {member.role}
                        </span>
                      )}
                    </div>
                    <span className={styles.userEmail}>{email}</span>
                  </div>

                  {/* For Consulted: Optional Response Required toggle */}
                  {role === 'C' && isSelected && (
                    <div
                      className={styles.respReqWrapper}
                      onClick={(e) => handleToggleResponseRequired(userId, e)}
                      title="Require formal response from this consulted person before advancing"
                    >
                      <label className={styles.respReqLabel}>
                        <input
                          type="checkbox"
                          checked={Boolean(userData?.response_required)}
                          onChange={() => {}}
                        />
                        <span>Response Req.</span>
                      </label>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div className={styles.footer}>
          <div className={styles.selectionSummary}>
            <span>
              {role === 'R' && selectedProcessStarter
                ? `${selectedUsers.size + 1} selected (incl. Process Starter)`
                : `${selectedUsers.size} selected`}
            </span>
          </div>
          <div className={styles.btnGroup}>
            <button
              type="button"
              className={styles.cancelBtn}
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className={styles.applyBtn}
              onClick={handleApply}
            >
              Apply Selection
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
