/**
 * SNS Projects — V1-03A Defined Process Draft Validator
 * Validates process metadata, dynamic steps, and RACI matrices.
 */

export function validateProcessDraft(draft, activeMembers = []) {
  const issues = [];
  const activeUserIds = new Set(
    (activeMembers || [])
      .filter((m) => m.status === 'active')
      .map((m) => m.user_id || m.id)
  );

  const process = draft?.process || {};
  const steps = draft?.steps || [];

  // 1. Process Metadata Validation
  if (!process.name || !process.name.trim()) {
    issues.push({
      type: 'process',
      field: 'name',
      message: 'Process Name is required.',
    });
  }

  if (!process.code || !process.code.trim()) {
    issues.push({
      type: 'process',
      field: 'code',
      message: 'Process Code is required.',
    });
  }

  if (!process.department_id) {
    issues.push({
      type: 'process',
      field: 'department_id',
      message: 'Department is required.',
    });
  }

  if (!process.process_owner_id) {
    issues.push({
      type: 'process',
      field: 'process_owner_id',
      message: 'Process Owner is required.',
    });
  } else if (activeUserIds.size > 0 && !activeUserIds.has(process.process_owner_id)) {
    issues.push({
      type: 'process',
      field: 'process_owner_id',
      message: 'Process Owner must be an active member of this workspace.',
    });
  }

  // 2. Steps Count Validation
  if (!steps || steps.length === 0) {
    issues.push({
      type: 'steps',
      field: 'steps',
      message: 'Process must contain at least one step.',
    });
  }

  const seenCodes = new Map(); // code -> stepIndex
  let validCodesCount = 0;
  let withResponsibleCount = 0;
  let withAccountableCount = 0;

  // 3. Step & RACI Validation
  steps.forEach((step, idx) => {
    const stepNum = idx + 1;
    const stepCode = (step.step_code || '').trim();
    const stepTitle = (step.title || '').trim();

    // Step Code
    if (!stepCode) {
      issues.push({
        type: 'step',
        stepIndex: idx,
        stepNum,
        stepCode: stepCode || `Step ${stepNum}`,
        title: stepTitle,
        field: 'step_code',
        message: `Step ${stepNum}: Step Code is missing.`,
      });
    } else {
      if (seenCodes.has(stepCode.toUpperCase())) {
        issues.push({
          type: 'step',
          stepIndex: idx,
          stepNum,
          stepCode,
          title: stepTitle,
          field: 'step_code',
          message: `Step ${stepNum}: Duplicate Step Code "${stepCode}" (already used in Step ${seenCodes.get(stepCode.toUpperCase()) + 1}).`,
        });
      } else {
        seenCodes.set(stepCode.toUpperCase(), idx);
        validCodesCount++;
      }
    }

    // Step Title / Procedure Name
    if (!stepTitle) {
      issues.push({
        type: 'step',
        stepIndex: idx,
        stepNum,
        stepCode: stepCode || `Step ${stepNum}`,
        title: stepTitle,
        field: 'title',
        message: `Step ${stepNum} (${stepCode || 'Uncoded'}): Step Name / Procedure is required.`,
      });
    }

    // Duration
    const duration = parseInt(step.expected_duration_days, 10);
    if (isNaN(duration) || duration < 1) {
      issues.push({
        type: 'step',
        stepIndex: idx,
        stepNum,
        stepCode: stepCode || `Step ${stepNum}`,
        title: stepTitle,
        field: 'expected_duration_days',
        message: `Step ${stepNum}: Expected duration must be at least 1 day.`,
      });
    }

    // RACI Matrix
    const raci = step.raci || [];
    const rAssignments = raci.filter((item) => item.raci_role === 'R');
    const aAssignments = raci.filter((item) => item.raci_role === 'A');
    const cAssignments = raci.filter((item) => item.raci_role === 'C');
    const iAssignments = raci.filter((item) => item.raci_role === 'I');

    // Check Responsible (>= 1)
    if (rAssignments.length > 0) {
      withResponsibleCount++;
    } else {
      issues.push({
        type: 'step_raci',
        stepIndex: idx,
        stepNum,
        stepCode: stepCode || `Step ${stepNum}`,
        title: stepTitle,
        field: 'raci_R',
        message: `Step ${stepNum} (${stepCode || 'STP'}): Missing Assignee. At least one is required.`,
      });
    }

    // Check Accountable (exactly 1)
    if (aAssignments.length === 1) {
      withAccountableCount++;
    } else if (aAssignments.length === 0) {
      issues.push({
        type: 'step_raci',
        stepIndex: idx,
        stepNum,
        stepCode: stepCode || `Step ${stepNum}`,
        title: stepTitle,
        field: 'raci_A',
        message: `Step ${stepNum} (${stepCode || 'STP'}): Missing Owner. Exactly one is required.`,
      });
    } else {
      issues.push({
        type: 'step_raci',
        stepIndex: idx,
        stepNum,
        stepCode: stepCode || `Step ${stepNum}`,
        title: stepTitle,
        field: 'raci_A',
        message: `Step ${stepNum} (${stepCode || 'STP'}): Multiple Owners found (${aAssignments.length}). Exactly one is allowed.`,
      });
    }

    // Process Starter rules & Active User membership
    const assignedUserIds = new Set();

    raci.forEach((item) => {
      const isProcessStarter = item.actor_type === 'process_starter';
      const userId = item.user_id;

      if (isProcessStarter) {
        if (item.raci_role !== 'R') {
          issues.push({
            type: 'step_raci',
            stepIndex: idx,
            stepNum,
            stepCode: stepCode || `Step ${stepNum}`,
            title: stepTitle,
            field: 'process_starter',
            message: `Step ${stepNum}: "Process Starter" is only permitted as an Assignee. It cannot use role ${item.raci_role}.`,
          });
        }
      } else if (userId) {
        // Concrete user check
        const tupleKey = `${item.raci_role}:${userId}`;
        if (assignedUserIds.has(tupleKey)) {
          issues.push({
            type: 'step_raci',
            stepIndex: idx,
            stepNum,
            stepCode: stepCode || `Step ${stepNum}`,
            title: stepTitle,
            field: 'duplicate_assignment',
            message: `Step ${stepNum}: Duplicate ${item.raci_role} assignment for the same user.`,
          });
        }
        assignedUserIds.add(tupleKey);

        if (activeUserIds.size > 0 && !activeUserIds.has(userId)) {
          issues.push({
            type: 'step_raci',
            stepIndex: idx,
            stepNum,
            stepCode: stepCode || `Step ${stepNum}`,
            title: stepTitle,
            field: 'inactive_user',
            message: `Step ${stepNum}: Assigned user (${item.raci_role}) is not an active workspace member.`,
          });
        }
      }
    });

    // Approval requirement check: Accountable cannot be in concrete Responsible set
    if (step.approval_required && aAssignments.length === 1) {
      const aUserId = aAssignments[0].user_id;
      const rConcreteMatches = rAssignments.filter(
        (r) => r.actor_type !== 'process_starter' && r.user_id === aUserId
      );

      if (rConcreteMatches.length > 0) {
        issues.push({
          type: 'step_raci',
          stepIndex: idx,
          stepNum,
          stepCode: stepCode || `Step ${stepNum}`,
          title: stepTitle,
          field: 'approval_separation',
          message: `Step ${stepNum}: Approval is required, so the Owner cannot also be a named Assignee.`,
        });
      }
    }
  });

  const totalSteps = steps.length;
  const issueCount = issues.length;
  const isValid = issueCount === 0;

  return {
    isValid,
    summary: {
      totalSteps,
      validCodes: validCodesCount,
      withResponsible: withResponsibleCount,
      withAccountable: withAccountableCount,
      issueCount,
    },
    issues,
  };
}
