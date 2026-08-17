# Architecture Decision Records (ADRs) — SNS Projects

## Overview
This document records the authoritative architectural decisions governing SNS Projects V2, spanning data hierarchy, security models, process execution, and system lifecycles.

---

## Decision Log

### ADR-01: Five-Level Core Project Hierarchy
- **Status**: APPROVED / IMPLEMENTED
- **Context**: Projects require structured categorization across phases, functional lists, tasks, and process step breakdowns.
- **Decision**: The canonical hierarchy is defined as:
  $$\text{Workspace} \longrightarrow \text{Project} \longrightarrow \text{Phase} \longrightarrow \text{Task List} \longrightarrow \text{Task} \longrightarrow \text{Child Task (Process Step)}$$
- **Implementation**: `public.milestones` (transitioning to `public.phases`), `public.task_lists`, `public.tasks` with `parent_task_id`.

---

### ADR-02: Phase Terminology Cutover via Dual-Sync Compatibility Layer
- **Status**: APPROVED / IMPLEMENTED (Package 1)
- **Context**: The existing application relies heavily on `milestones` and `milestone_id`. An immediate destructive rename would cause frontend regressions.
- **Decision**: Introduce `phase_id` as a first-class column alongside `milestone_id` with bidirectional database trigger synchronization (`sync_milestone_phase_id()`) and check constraints (`phase_id IS NOT DISTINCT FROM milestone_id`). Provide `public.phases` as a `security_invoker` view over `public.milestones`.
- **Cutover Plan**: Physical table rename and column cleanup will occur after frontend components complete the transition.

---

### ADR-03: Standalone Task & Process Support
- **Status**: APPROVED / IMPLEMENTED (Schema Foundation)
- **Context**: Organizations perform ad-hoc processes and standalone tasks outside of structured projects.
- **Decision**: Make `public.tasks.project_id` nullable (`ALTER TABLE public.tasks ALTER COLUMN project_id DROP NOT NULL;`).
- **Security Rule**: Standalone tasks remain fail-closed and invisible to general workspace queries until Package 2 introduces dedicated standalone authorization RPCs.

---

### ADR-04: Explicit Process Instance Entity
- **Status**: APPROVED / IMPLEMENTED (Package 1)
- **Context**: Previously, Defined Process executions were coupled directly to `task_lists` with `task_list_type = 'defined'`, limiting one process per list and restricting placement options.
- **Decision**: Introduce `public.process_instances` as a dedicated runtime container tracking `workspace_id`, `defined_process_id`, `defined_process_version_id`, `started_by`, `owner_id`, `placement_type`, and lifecycle timestamps.
- **Placement Modes**: `standalone`, `project`, `phase`, `task_list`, `task`.

---

### ADR-05: Process Instance Fail-Closed Access Model (P1-01A)
- **Status**: APPROVED / IMPLEMENTED
- **Context**: Initial draft considered general workspace-member SELECT visibility on `public.process_instances`. However, standalone and confidential processes should only be visible to participants, owners, starters, and workspace executives.
- **Decision**: Revoke all direct table privileges (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) on `public.process_instances` from `PUBLIC`, `anon`, and `authenticated`. Drop broad workspace-wide SELECT policies. Access will be managed exclusively via controlled backend RPCs and placement-aware RLS rules introduced in P1-02.

---

### ADR-06: Task RACI Matrix & Single-Accountable Constraint
- **Status**: APPROVED / IMPLEMENTED
- **Context**: Clear responsibility assignment is mandatory for industrial execution.
- **Decision**: Every task and defined process step supports Responsible (R), Accountable (A), Consulted (C), and Informed (I). Exactly one Accountable party is strictly enforced per task.

---

### ADR-32: Overall Process Business Status Model — PARKED
- **Status**: **PARKED / UNRESOLVED**
- **Context**: Business stakeholders proposed complex rolling process health states (e.g. *On Track*, *At Risk*, *Blocked*, *Delayed*, *Needs Attention*).
- **Decision**: Decision 32 remains **intentionally unresolved**. The database schema is restricted strictly to minimal technical lifecycle states:
  - `running`
  - `completed`
  - `cancelled`
- **Constraint**: No heuristic or speculative business status algorithms may be committed to production until formal stakeholder alignment is reached.
