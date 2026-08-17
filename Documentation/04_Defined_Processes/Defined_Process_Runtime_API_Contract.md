# SNS Projects — Defined Process Engine MVP Runtime API Contract
## Phase 2 Frontend Integration Guide

This document defines the exact PostgreSQL RPC interfaces, authorization models, payload structures, return contracts, state transitions, and error behaviors for the SNS Projects Defined Process Engine MVP.

---

### Authentication & Authorization Model
All RPCs are exposed under the `public` schema and require an active user session (`auth.uid()`).
Direct browser `INSERT`, `UPDATE`, and `DELETE` operations on Defined Process runtime tables (`task_lists` with `task_list_type='defined'`, `tasks` with `process_step_id IS NOT NULL`, `task_responsible_completions`, `task_consultation_responses`, `task_evidence_submissions`, `task_approval_cycles`, `process_audit_events`) are prohibited via database-level triggers and RLS policies. All mutations **MUST** occur through these transactional RPCs.

---

### 1. `publish_defined_process_version`

Publishes a draft process version after verifying structural DAG validity, step sequence ordering, RACI completeness, duration constraints, and workspace membership.

#### RPC Signature
```sql
public.publish_defined_process_version(p_version_id uuid) RETURNS jsonb
```

#### Client Call (Supabase JS)
```javascript
const { data, error } = await supabase.rpc('publish_defined_process_version', {
  p_version_id: '7e8b8390-1c09-4d69-8bc4-9d58a5d7c3b2'
});
```

#### Authorization
- Owning Department Head (`department_memberships.role = 'head'`), OR
- System Admin / Project Admin (`user_system_roles`), OR
- Workspace Owner / Admin (`workspace_members`).

#### Preconditions & Validation Rules
- Version status must be `'draft'`.
- Step count $\ge 1$.
- Exactly 1 root step (0 dependencies) with `sequence_order = 1`.
- All steps reachable from root (no cycles, valid DAG).
- Every step has `expected_duration_days >= 1`.
- Every step has $\ge 1$ Responsible (`R`).
- Every step has exactly 1 Accountable (`A`).
- If `approval_required = true`, Accountable user cannot be in the Responsible user set.
- If `consultation_required = true`, at least one Consulted (`C`) must have `response_required = true`.
- All assigned RACI users must be active members of the workspace.

#### Success Response
```json
{
  "success": true,
  "version_id": "7e8b8390-1c09-4d69-8bc4-9d58a5d7c3b2",
  "status": "published"
}
```

#### Error Codes & Messages
- `42501`: `'Authentication required.'`
- `P0001`: `'Defined process version not found.'`
- `P0001`: `'Only draft process versions can be published.'`
- `42501`: `'Insufficient authority to publish this process version.'`
- `P0001`: `'Process version must contain at least one step.'`
- `P0001`: `'Process version must have exactly one root step (found N)'`
- `P0001`: `'Root step must have sequence_order = 1.'`
- `P0001`: `'Every step in the process must be reachable from the root step without cycles.'`
- `P0001`: `'Step <CODE> requires approval, so Accountable cannot be in the Responsible set.'`
- `P0001`: `'Step <CODE> requires consultation, so at least one Consulted (C) must have response_required = true.'`
- `P0001`: `'RACI user <NAME> is not an active workspace member.'`

---

### 2. `start_defined_process`

Instantiates a published Defined Process version as a live project Task List and generates all Step execution Tasks immediately.

#### RPC Signature
```sql
public.start_defined_process(
  p_version_id      uuid,
  p_project_id      uuid,
  p_milestone_id    uuid,
  p_instance_name   text,
  p_raci_overrides  jsonb DEFAULT NULL
) RETURNS jsonb
```

#### Client Call (Supabase JS)
```javascript
const { data, error } = await supabase.rpc('start_defined_process', {
  p_version_id: '7e8b8390-1c09-4d69-8bc4-9d58a5d7c3b2',
  p_project_id: '4c431b9d-5bc9-4fe5-a4f6-ef775a28b0f1',
  p_milestone_id: 'bf76e93e-2fca-443b-a5d6-d0ea321d497c',
  p_instance_name: 'Procurement Order PO-2026-001',
  p_raci_overrides: null
});
```

#### Authorization & Start Rule
- **CRITICAL**: Caller `auth.uid()` **MUST** be an assigned Responsible (`R`) user on the **Root Step** of the process.
- System Admin / Project Admin do NOT bypass this rule.

#### State Transitions & Artifacts Created
1. `task_lists` row created: `task_list_type = 'defined'`, `process_state = 'active'`, `started_by = auth.uid()`.
2. Root Task created: `workflow_state = 'ready'`, `status = 'todo'`, `current_cycle_number = 1`, `ready_at = now()`, `due_date = add_working_days(...)`.
3. Downstream Tasks created: `workflow_state = 'waiting'`, `status = 'todo'`, `current_cycle_number = 1`, `ready_at = NULL`, `due_date = NULL`.
4. Template RACI copied to live `task_raci_assignments` (with `response_required`).
5. Notifications: Emitted for Root Task RACI participants (`'process_task_ready'`). Downstream waiting tasks remain silent.
6. Audit Events: `PROCESS_STARTED` and `TASK_READY` recorded.

#### Success Response
```json
{
  "task_list_id": "9a38f712-42da-4705-87de-4bf639433d9c",
  "root_task_id": "8f8b8390-1c09-4d69-8bc4-9d58a5d7c3b2",
  "task_count": 5
}
```

#### Error Codes & Messages
- `P0001`: `'Process instance name is required.'`
- `P0001`: `'Process version must be published to be started.'`
- `P0001`: `'Project workspace does not match defined process workspace.'`
- `P0001`: `'Milestone does not belong to target project.'`
- `P0001`: `'Working calendar is not configured for this workspace.'`
- `P0001`: `'Caller must be an assigned Responsible user for the root step of this process.'`

---

### 2A. `start_process_instance` (Package 1 Placement-Aware Runtime Engine)

Instantiates a published Defined Process version within the explicit `public.process_instances` entity across 5 placement scopes: `standalone`, `project`, `phase`, `task_list`, or `task`.

#### RPC Signature
```sql
public.start_process_instance(
  p_version_id       uuid,
  p_instance_name    text,
  p_overall_due_date date DEFAULT NULL,
  p_placement_type   text DEFAULT 'standalone',
  p_project_id       uuid DEFAULT NULL,
  p_phase_id         uuid DEFAULT NULL,
  p_task_list_id     uuid DEFAULT NULL,
  p_parent_task_id   uuid DEFAULT NULL,
  p_raci_overrides   jsonb DEFAULT NULL,
  p_owner_id         uuid DEFAULT NULL
) RETURNS jsonb
```

#### Client Call (Supabase JS)
```javascript
const { data, error } = await supabase.rpc('start_process_instance', {
  p_version_id: '7e8b8390-1c09-4d69-8bc4-9d58a5d7c3b2',
  p_instance_name: 'Factory Acceptance Testing #01',
  p_overall_due_date: '2026-09-30',
  p_placement_type: 'standalone'
});
```

#### Authorization & Placement Rules
- **Starter Authorization**: Caller must be assigned Responsible (`R`) on the root step (explicit user or dynamic `process_starter`) OR possess Workspace Executive authority (`owner`, `admin`, `system_admin`, `ceo`, `cto`).
- **Placement Validation**:
  - `standalone`: Requires `p_project_id`, `p_phase_id`, `p_task_list_id`, `p_parent_task_id` to be `NULL`. Creates a standalone parent task in `public.tasks` with `project_id = NULL`.
  - `project`: Requires `p_project_id`. Steps attached to project.
  - `phase`: Requires `p_project_id` and `p_phase_id`. Validates phase belongs to project.
  - `task_list`: Requires `p_project_id`, `p_phase_id`, and `p_task_list_id`. Validates task list belongs to phase and project.
  - `task`: Requires `p_parent_task_id`. Authoritatively derives hierarchy from parent task. Parent task RACI is strictly preserved (Decision 39).
- **Due Date Model (Decisions 33 & 42)**: Single overall due date stored on `process_instances.due_date`. Step tasks receive `due_date = NULL`.

#### Success Response
```json
{
  "process_instance_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "placement_type": "standalone",
  "root_task_id": "8f8b8390-1c09-4d69-8bc4-9d58a5d7c3b2",
  "parent_task_id": "e3b0c442-98fc-1c14-9afb-4c8996fb9242",
  "task_count": 5
}
```

---

### 2B. `get_process_instance_progress` (Equal-Weight Step Progress Calculation)

Calculates the equal-weight completion percentage of a Process Instance based on its constituent step tasks.

#### RPC Signature
```sql
public.get_process_instance_progress(p_instance_id uuid) RETURNS numeric
```

#### Client Call (Supabase JS)
```javascript
const { data: progressPercent, error } = await supabase.rpc('get_process_instance_progress', {
  p_instance_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
});
```

#### Success Response
`numeric` value from `0.00` to `100.00` rounded to 2 decimal places.

---

### 3. `submit_task_evidence`

Allows a Responsible user to submit link or text evidence for a Defined Task.

#### RPC Signature
```sql
public.submit_task_evidence(
  p_task_id         uuid,
  p_evidence_def_id uuid DEFAULT NULL,
  p_evidence_type   text DEFAULT 'text',
  p_payload         jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
```

#### Client Call (Supabase JS)
```javascript
const { data, error } = await supabase.rpc('submit_task_evidence', {
  p_task_id: '8f8b8390-1c09-4d69-8bc4-9d58a5d7c3b2',
  p_evidence_def_id: '3c8b8390-1c09-4d69-8bc4-9d58a5d7c3b2',
  p_evidence_type: 'text',
  p_payload: {
    doc_url: 'https://docs.google.com/spreadsheets/d/12345',
    vendor: 'Supplier ACME',
    total_quote: 45000
  }
});
```

#### Authorization
- Caller must be an assigned Responsible (`R`) user on the task.

#### Success Response
```json
{
  "success": true,
  "submission_id": "1e8b8390-1c09-4d69-8bc4-9d58a5d7c3b2"
}
```

---

### 4. `complete_responsible_part`

Records completion for an individual Responsible user. When all assigned Responsible users have completed their part, validates subtasks and mandatory evidence, then advances workflow to `awaiting_consultation`, `awaiting_approval`, or `completed`.

#### RPC Signature
```sql
public.complete_responsible_part(
  p_task_id uuid,
  p_note    text DEFAULT NULL
) RETURNS jsonb
```

#### Client Call (Supabase JS)
```javascript
const { data, error } = await supabase.rpc('complete_responsible_part', {
  p_task_id: '8f8b8390-1c09-4d69-8bc4-9d58a5d7c3b2',
  p_note: 'Quotation verified with vendor and ready for review.'
});
```

#### Authorization
- Caller must be an assigned Responsible (`R`) user on the task.
- Task `workflow_state` must be `'ready'`, `'active'`, or `'rework_required'`.

#### Return Contract Scenarios
1. **Multi-R Partial Completion (Other R users pending)**:
   ```json
   {
     "completed": false,
     "workflow_state": "active",
     "remaining_responsible": 1
   }
   ```
2. **All R complete $\rightarrow$ Consultation Required**:
   ```json
   {
     "completed": false,
     "workflow_state": "awaiting_consultation",
     "pending_consultations": 1
   }
   ```
3. **All R complete $\rightarrow$ Approval Required**:
   ```json
   {
     "completed": false,
     "workflow_state": "awaiting_approval"
   }
   ```
4. **All R complete $\rightarrow$ Direct Completion (No C/A needed)**:
   ```json
   {
     "completed": true,
     "workflow_state": "completed"
   }
   ```

#### Error Codes & Messages
- `P0001`: `'Caller is not an assigned Responsible user for this task.'`
- `P0001`: `'Task is not in an actionable state (current state: <STATE>).'`
- `P0001`: `'Responsible completion already submitted for this cycle.'`
- `P0001`: `'All subtasks must be completed before completing the task (N pending).'`
- `P0001`: `'Required evidence submission missing (N definitions pending).'`

---

### 5. `submit_task_consultation`

Submits required consultation response feedback.

#### RPC Signature
```sql
public.submit_task_consultation(
  p_task_id   uuid,
  p_response  text
) RETURNS jsonb
```

#### Client Call (Supabase JS)
```javascript
const { data, error } = await supabase.rpc('submit_task_consultation', {
  p_task_id: '8f8b8390-1c09-4d69-8bc4-9d58a5d7c3b2',
  p_response: 'Technical specifications approved. Complies with safety regulations.'
});
```

#### Authorization
- Caller must be an assigned Consulted (`C`) user on the task.
- Task `workflow_state` must be `'awaiting_consultation'`.

#### Return Contract Scenarios
1. **Pending additional Consultations**:
   ```json
   {
     "consultation_complete": false,
     "remaining_consultations": 1
   }
   ```
2. **Consultations Finished $\rightarrow$ Awaiting Approval**:
   ```json
   {
     "consultation_complete": true,
     "workflow_state": "awaiting_approval"
   }
   ```
3. **Consultations Finished $\rightarrow$ Task Completed (No A needed)**:
   ```json
   {
     "consultation_complete": true,
     "workflow_state": "completed"
   }
   ```

---

### 6. `approve_process_task`

Approves a task currently awaiting approval, marks it completed, unlocks downstream dependencies, and checks for automatic process completion.

#### RPC Signature
```sql
public.approve_process_task(p_task_id uuid) RETURNS jsonb
```

#### Client Call (Supabase JS)
```javascript
const { data, error } = await supabase.rpc('approve_process_task', {
  p_task_id: '8f8b8390-1c09-4d69-8bc4-9d58a5d7c3b2'
});
```

#### Authorization
- Caller must be the assigned Accountable (`A`) user on the task.
- Task `workflow_state` must be `'awaiting_approval'`.

#### Success Response
```json
{
  "success": true,
  "workflow_state": "completed"
}
```

---

### 7. `reject_process_task`

Rejects a task awaiting approval, increments the workflow cycle number, resets state to `rework_required`, and updates due date.

#### RPC Signature
```sql
public.reject_process_task(
  p_task_id      uuid,
  p_reason       text,
  p_new_due_date date
) RETURNS jsonb
```

#### Client Call (Supabase JS)
```javascript
const { data, error } = await supabase.rpc('reject_process_task', {
  p_task_id: '8f8b8390-1c09-4d69-8bc4-9d58a5d7c3b2',
  p_reason: 'Vendor pricing exceeds budget threshold. Re-negotiate discount.',
  p_new_due_date: '2026-08-25'
});
```

#### Authorization
- Caller must be the assigned Accountable (`A`) user on the task.
- Task `workflow_state` must be `'awaiting_approval'`.

#### Success Response
```json
{
  "success": true,
  "workflow_state": "rework_required",
  "new_cycle_number": 2
}
```

---

### 8. Live Query Reference for UI Components

#### A. Fetching Process Instance History & State
```javascript
// Fetch active Defined Task Lists for a project
const { data: definedLists } = await supabase
  .from('task_lists')
  .select(`
    id, name, process_state, started_at, completed_at,
    defined_processes ( id, name, code ),
    defined_process_versions ( id, version_number )
  `)
  .eq('project_id', projectId)
  .eq('task_list_type', 'defined');
```

#### B. Fetching Defined Task Workflow State & RACI
```javascript
const { data: definedTasks } = await supabase
  .from('tasks')
  .select(`
    id, title, description, workflow_state, current_cycle_number, due_date, ready_at,
    task_statuses ( id, name, color, system_code ),
    task_raci_assignments ( id, raci_role, response_required, profiles ( id, full_name, avatar_url ) ),
    task_responsible_completions ( id, cycle_number, completed_at, profiles ( id, full_name ) ),
    task_consultation_responses ( id, cycle_number, response_text, responded_at, profiles ( id, full_name ) ),
    task_approval_cycles ( id, cycle_number, status, rejection_reason, decided_at, profiles:decided_by ( id, full_name ) ),
    task_evidence_submissions ( id, cycle_number, evidence_type, payload, submitted_at, profiles:submitted_by ( id, full_name ) )
  `)
  .eq('task_list_id', taskListId)
  .order('position', { ascending: true });
```
