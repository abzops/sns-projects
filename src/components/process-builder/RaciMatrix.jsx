import React from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  Plus,
  Layers,
  AlertTriangle,
} from 'lucide-react';
import RaciMatrixRow from './RaciMatrixRow';
import styles from './RaciMatrix.module.css';

export default function RaciMatrix({
  steps = [],
  activeMembers = [],
  onAddStep,
  onDuplicateStep,
  onDeleteStep,
  onReorderSteps,
  onUpdateStep,
  onUpdateStepRaci,
  readonly = false,
  isCustomFlow = false,
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 4,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = steps.findIndex((s) => s.id === active.id);
    const newIndex = steps.findIndex((s) => s.id === over.id);

    if (oldIndex !== -1 && newIndex !== -1) {
      onReorderSteps(oldIndex, newIndex);
    }
  };

  const stepIds = steps.map((s) => s.id);

  return (
    <div className={styles.container}>
      {/* Header bar */}
      <div className={styles.headerBar}>
        <div className={styles.titleGroup}>
          <Layers size={16} className={styles.sectionIcon} />
          <h3 className={styles.sectionTitle}>Workflow Ownership & Assignments</h3>
          <span className={styles.stepBadge}>
            {steps.length} {steps.length === 1 ? 'Step' : 'Steps'}
          </span>
        </div>

        {isCustomFlow && (
          <div className={styles.customFlowBanner} title="Custom dependency flow: structural edits locked">
            <AlertTriangle size={14} />
            <span>Custom Flow (Dependencies Preserved)</span>
          </div>
        )}
      </div>

      {/* Table Container */}
      <div className={styles.tableWrapper}>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.thDrag}></th>
                <th className={styles.thSeq}>#</th>
                <th className={styles.thCode}>Step ID</th>
                <th className={styles.thTitle}>Step / Procedure</th>
                <th className={styles.thR} title="Assignees: Who does the work">
                  R <span className={styles.thSub}>Assignees</span>
                </th>
                <th className={styles.thA} title="Owner: Single decision maker">
                  A <span className={styles.thSub}>Owner</span>
                </th>
                <th className={styles.thC} title="Consulted: Two-way input">
                  C <span className={styles.thSub}>Consulted</span>
                </th>
                <th className={styles.thI} title="Informed: Kept updated">
                  I <span className={styles.thSub}>Informed</span>
                </th>
                <th className={styles.thDays} title="Expected working days duration">
                  Days
                </th>
                <th className={styles.thActions}>Actions</th>
              </tr>
            </thead>
            <tbody>
              <SortableContext items={stepIds} strategy={verticalListSortingStrategy}>
                {steps.map((step, index) => (
                  <RaciMatrixRow
                    key={step.id}
                    step={step}
                    index={index}
                    totalSteps={steps.length}
                    activeMembers={activeMembers}
                    onUpdateStep={onUpdateStep}
                    onUpdateStepRaci={onUpdateStepRaci}
                    onDuplicate={onDuplicateStep}
                    onDelete={onDeleteStep}
                    readonly={readonly}
                    isCustomFlow={isCustomFlow}
                  />
                ))}
              </SortableContext>
            </tbody>
          </table>
        </DndContext>
      </div>

      {/* Add Step Button */}
      {!readonly && !isCustomFlow && (
        <div className={styles.addStepFooter}>
          <button
            type="button"
            className={styles.addStepBtn}
            onClick={() => onAddStep(null)}
          >
            <Plus size={15} />
            <span>Add Step</span>
          </button>
        </div>
      )}
    </div>
  );
}
