import { useState } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  GripVertical,
  Copy,
  Trash2,
  Plus,
} from 'lucide-react';
import RaciUserChip from './RaciUserChip';
import ProcessStarterChip from './ProcessStarterChip';
import RaciUserPicker from './RaciUserPicker';
import styles from './RaciMatrixRow.module.css';

export default function RaciMatrixRow({
  step,
  index,
  totalSteps,
  activeMembers = [],
  onUpdateStep,
  onUpdateStepRaci,
  onDuplicate,
  onDelete,
  readonly = false,
  isCustomFlow = false,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: step.id,
    disabled: readonly || isCustomFlow,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    zIndex: isDragging ? 2 : 1,
  };

  const [activePickerRole, setActivePickerRole] = useState(null); // 'R' | 'A' | 'C' | 'I' | null

  // Group RACI assignments
  const rAssignments = (step.raci || []).filter((r) => r.raci_role === 'R');
  const aAssignments = (step.raci || []).filter((r) => r.raci_role === 'A');
  const cAssignments = (step.raci || []).filter((r) => r.raci_role === 'C');
  const iAssignments = (step.raci || []).filter((r) => r.raci_role === 'I');

  // Member map
  const memberMap = new Map();
  activeMembers.forEach((m) => {
    const uId = m.user_id || m.id;
    memberMap.set(uId, m);
  });

  const handleOpenPicker = (role) => {
    if (readonly) return;
    setActivePickerRole(role);
  };

  const handleSavePicker = (newRoleAssignments) => {
    if (!activePickerRole) return;
    onUpdateStepRaci(index, activePickerRole, newRoleAssignments);
    setActivePickerRole(null);
  };

  const handleRemoveSingleAssignment = (role, itemToRemove) => {
    if (readonly) return;
    const currentForRole = (step.raci || []).filter((r) => r.raci_role === role);
    const updatedForRole = currentForRole.filter((r) => {
      if (itemToRemove.actor_type === 'process_starter') {
        return r.actor_type !== 'process_starter';
      }
      return r.user_id !== itemToRemove.user_id;
    });
    onUpdateStepRaci(index, role, updatedForRole);
  };

  const renderRaciCell = (role, assignments, label) => {
    return (
      <div
        className={`${styles.raciCell} ${assignments.length === 0 ? styles.raciCellEmpty : ''}`}
        onClick={() => handleOpenPicker(role)}
        title={`Click to edit ${label} (${role})`}
      >
        <div className={styles.chipContainer}>
          {assignments.map((item, i) => {
            if (item.actor_type === 'process_starter') {
              return (
                <ProcessStarterChip
                  key={`ps-${i}`}
                  onRemove={() => handleRemoveSingleAssignment(role, item)}
                  readonly={readonly}
                />
              );
            }
            const member = memberMap.get(item.user_id);
            return (
              <RaciUserChip
                key={item.user_id || `u-${i}`}
                user={member || { id: item.user_id, full_name: 'Unknown User' }}
                onRemove={() => handleRemoveSingleAssignment(role, item)}
                readonly={readonly}
              />
            );
          })}
          {assignments.length === 0 && !readonly && (
            <span className={styles.addPlaceholder}>
              <Plus size={11} /> {role}
            </span>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <tr ref={setNodeRef} style={style} className={`${styles.row} ${isDragging ? styles.rowDragging : ''}`}>
        {/* 1. Drag Handle */}
        <td className={styles.dragCell}>
          {!readonly && !isCustomFlow ? (
            <button
              type="button"
              className={styles.dragHandle}
              {...attributes}
              {...listeners}
              title="Drag to reorder step"
            >
              <GripVertical size={14} />
            </button>
          ) : (
            <span className={styles.dragHandleDisabled}>
              <GripVertical size={14} />
            </span>
          )}
        </td>

        {/* 2. Sequence # */}
        <td className={styles.seqCell}>
          <span className={styles.seqBadge}>{index + 1}</span>
        </td>

        {/* 3. Step Code */}
        <td className={styles.codeCell}>
          <input
            type="text"
            className={styles.codeInput}
            value={step.step_code || ''}
            onChange={(e) => onUpdateStep(index, { step_code: e.target.value.toUpperCase() })}
            placeholder="STP-001"
            disabled={readonly}
          />
        </td>

        {/* 4. Step Title / Procedure */}
        <td className={styles.titleCell}>
          <input
            type="text"
            className={styles.titleInput}
            value={step.title || ''}
            onChange={(e) => onUpdateStep(index, { title: e.target.value })}
            placeholder="Describe procedure or process step..."
            disabled={readonly}
          />
        </td>

        {/* 5. R Cell */}
        <td className={styles.rCell}>
          {renderRaciCell('R', rAssignments, 'Assignees')}
        </td>

        {/* 6. A Cell */}
        <td className={styles.aCell}>
          {renderRaciCell('A', aAssignments, 'Owner')}
        </td>

        {/* 7. C Cell */}
        <td className={styles.cCell}>
          {renderRaciCell('C', cAssignments, 'Consulted')}
        </td>

        {/* 8. I Cell */}
        <td className={styles.iCell}>
          {renderRaciCell('I', iAssignments, 'Informed')}
        </td>

        {/* 9. Expected Days */}
        <td className={styles.daysCell}>
          <input
            type="number"
            min="1"
            max="365"
            className={styles.daysInput}
            value={step.expected_duration_days || 1}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              onUpdateStep(index, { expected_duration_days: isNaN(val) ? 1 : Math.max(1, val) });
            }}
            disabled={readonly}
          />
        </td>

        {/* 10. Actions */}
        <td className={styles.actionsCell}>
          <div className={styles.actionBtnGroup}>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={() => onDuplicate(index)}
              title="Duplicate this step"
              disabled={readonly || isCustomFlow}
            >
              <Copy size={13} />
            </button>
            <button
              type="button"
              className={`${styles.actionBtn} ${styles.deleteActionBtn}`}
              onClick={() => {
                if (step.title && step.title.trim().length > 0) {
                  if (window.confirm(`Delete step ${step.step_code || index + 1}: "${step.title}"?`)) {
                    onDelete(index);
                  }
                } else {
                  onDelete(index);
                }
              }}
              title="Delete this step"
              disabled={readonly || isCustomFlow || totalSteps <= 1}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </td>
      </tr>

      {/* Raci User Picker Modal for this cell */}
      {activePickerRole && (
        <RaciUserPicker
          isOpen={Boolean(activePickerRole)}
          onClose={() => setActivePickerRole(null)}
          title={`Assign ${
            activePickerRole === 'R'
              ? 'Assignees (R)'
              : activePickerRole === 'A'
              ? 'Owner (A)'
              : activePickerRole === 'C'
              ? 'Consulted (C)'
              : 'Informed (I)'
          } — Step ${index + 1} (${step.step_code || 'STP'})`}
          role={activePickerRole}
          currentAssignments={(step.raci || []).filter((r) => r.raci_role === activePickerRole)}
          activeMembers={activeMembers}
          onSave={handleSavePicker}
        />
      )}
    </>
  );
}
