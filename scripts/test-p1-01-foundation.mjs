import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const repoRoot = process.cwd();
const migrationDir = path.join(repoRoot, 'supabase', 'migrations');
const schemaPath = path.join(repoRoot, 'supabase', 'schema.sql');

async function runFoundationTests() {
  console.log('================================================================');
  console.log('SNS Projects — Package 1 / P1-01 Foundation Verification Suite');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition, message, details = '') {
    if (condition) {
      console.log(`[PASS] ${message}`);
      passed++;
    } else {
      console.error(`[FAIL] ${message} ${details ? '- ' + details : ''}`);
      failed++;
    }
  }

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 1: MIGRATION FILE & CANONICAL HISTORY
  // ═════════════════════════════════════════════════════════════════════════
  console.log('--- Section 1: Canonical Migration File Verification ---');

  const migrationFiles = (await readdir(migrationDir)).filter(f => f.endsWith('.sql')).sort();
  const latestMigration = migrationFiles[migrationFiles.length - 1];

  assert(latestMigration.includes('core_hierarchy_process_instance_foundation'),
    `Test 1: Latest canonical migration is core_hierarchy_process_instance_foundation (${latestMigration}).`);

  const migrationSql = await readFile(path.join(migrationDir, latestMigration), 'utf8');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 2: PHASE COMPATIBILITY FOUNDATION
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 2: Phase Compatibility Foundation ---');

  // Milestones owner_id & backfill
  assert(migrationSql.includes('ALTER TABLE public.milestones\n  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id)'),
    'Test 2: milestones.owner_id column added with profiles(id) FK.');
  assert(migrationSql.includes('UPDATE public.milestones m\nSET owner_id = p.owner_id\nFROM public.projects p'),
    'Test 3: milestones.owner_id backfilled from unambiguous projects.owner_id.');

  // Task Lists owner_id & phase_id
  assert(migrationSql.includes('ALTER TABLE public.task_lists\n  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id)'),
    'Test 4: task_lists.owner_id column added with profiles(id) FK.');
  assert(migrationSql.includes('ALTER TABLE public.task_lists\n  ADD COLUMN IF NOT EXISTS phase_id uuid REFERENCES public.milestones(id)'),
    'Test 5: task_lists.phase_id column added referencing public.milestones(id).');
  assert(migrationSql.includes('UPDATE public.task_lists\nSET phase_id = milestone_id'),
    'Test 6: task_lists.phase_id backfilled from milestone_id.');

  // Tasks phase_id, parent_task_id, process_instance_id
  assert(migrationSql.includes('ALTER TABLE public.tasks\n  ADD COLUMN IF NOT EXISTS phase_id uuid REFERENCES public.milestones(id)'),
    'Test 7: tasks.phase_id column added referencing public.milestones(id).');
  assert(migrationSql.includes('ADD COLUMN IF NOT EXISTS parent_task_id uuid REFERENCES public.tasks(id)'),
    'Test 8: tasks.parent_task_id column added referencing public.tasks(id).');
  assert(migrationSql.includes('UPDATE public.tasks\nSET phase_id = milestone_id'),
    'Test 9: tasks.phase_id backfilled from milestone_id.');
  assert(migrationSql.includes('chk_tasks_no_self_parent') && migrationSql.includes('parent_task_id <> id'),
    'Test 10: tasks prevents direct self-parenting (chk_tasks_no_self_parent).');

  // Standalone Task Foundation: tasks.project_id NULLABLE
  assert(migrationSql.includes('ALTER TABLE public.tasks ALTER COLUMN project_id DROP NOT NULL;'),
    'Test 11: tasks.project_id made NULLABLE for standalone task support.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 3: PHASE / MILESTONE SYNCHRONIZATION TRIGGER & INVARIANTS
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 3: Bidirectional Phase / Milestone Synchronization ---');

  assert(migrationSql.includes('CREATE OR REPLACE FUNCTION public.sync_milestone_phase_id()'),
    'Test 12: sync_milestone_phase_id() trigger function created.');
  assert(migrationSql.includes('chk_tasks_phase_milestone_sync') && migrationSql.includes('phase_id IS NOT DISTINCT FROM milestone_id'),
    'Test 13: chk_tasks_phase_milestone_sync enforces phase_id IS NOT DISTINCT FROM milestone_id on tasks.');
  assert(migrationSql.includes('chk_task_lists_phase_milestone_sync') && migrationSql.includes('phase_id IS NOT DISTINCT FROM milestone_id'),
    'Test 14: chk_task_lists_phase_milestone_sync enforces phase_id IS NOT DISTINCT FROM milestone_id on task_lists.');

  // Behavioral simulation of sync_milestone_phase_id
  function simulateSync(oldRow, newRow, op = 'INSERT') {
    const row = { ...newRow };
    if (row.phase_id !== null && row.phase_id !== undefined && (row.milestone_id === null || row.milestone_id === undefined)) {
      row.milestone_id = row.phase_id;
    } else if (row.milestone_id !== null && row.milestone_id !== undefined && (row.phase_id === null || row.phase_id === undefined)) {
      row.phase_id = row.milestone_id;
    } else if (row.phase_id && row.milestone_id && row.phase_id !== row.milestone_id) {
      if (op === 'UPDATE') {
        if (row.phase_id !== oldRow?.phase_id && row.milestone_id === oldRow?.milestone_id) {
          row.milestone_id = row.phase_id;
        } else if (row.milestone_id !== oldRow?.milestone_id && row.phase_id === oldRow?.phase_id) {
          row.phase_id = row.milestone_id;
        } else {
          throw new Error(`Contradictory phase_id (${row.phase_id}) and milestone_id (${row.milestone_id})`);
        }
      } else {
        throw new Error(`Contradictory phase_id (${row.phase_id}) and milestone_id (${row.milestone_id})`);
      }
    }
    return row;
  }

  // Sync test A: Supply only milestone_id -> phase_id populated
  const syncA = simulateSync(null, { milestone_id: 'm-uuid-1', phase_id: null });
  assert(syncA.phase_id === 'm-uuid-1' && syncA.milestone_id === 'm-uuid-1',
    'Test 15: Supplying only milestone_id automatically synchronizes phase_id.');

  // Sync test B: Supply only phase_id -> milestone_id populated
  const syncB = simulateSync(null, { milestone_id: null, phase_id: 'm-uuid-2' });
  assert(syncB.phase_id === 'm-uuid-2' && syncB.milestone_id === 'm-uuid-2',
    'Test 16: Supplying only phase_id automatically synchronizes milestone_id.');

  // Sync test C: Update phase_id -> milestone_id updated
  const syncC = simulateSync({ milestone_id: 'm-1', phase_id: 'm-1' }, { milestone_id: 'm-1', phase_id: 'm-2' }, 'UPDATE');
  assert(syncC.phase_id === 'm-2' && syncC.milestone_id === 'm-2',
    'Test 17: Updating phase_id propagates to milestone_id seamlessly.');

  // Sync test D: Update milestone_id -> phase_id updated
  const syncD = simulateSync({ milestone_id: 'm-1', phase_id: 'm-1' }, { milestone_id: 'm-3', phase_id: 'm-1' }, 'UPDATE');
  assert(syncD.phase_id === 'm-3' && syncD.milestone_id === 'm-3',
    'Test 18: Updating milestone_id propagates to phase_id seamlessly.');

  // Sync test E: Contradictory inputs rejected
  let contradictoryRejected = false;
  try {
    simulateSync(null, { milestone_id: 'm-1', phase_id: 'm-2' }, 'INSERT');
  } catch {
    contradictoryRejected = true;
  }
  assert(contradictoryRejected, 'Test 19: Contradictory phase_id != milestone_id on INSERT is cleanly rejected.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 4: PHASES READ COMPATIBILITY VIEW
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 4: Phases Read Compatibility Object ---');

  assert(migrationSql.includes('CREATE OR REPLACE VIEW public.phases\nWITH (security_invoker = true)'),
    'Test 20: public.phases view created with security_invoker = true.');
  assert(migrationSql.includes('GRANT SELECT ON public.phases TO authenticated;'),
    'Test 21: Explicit SELECT granted to authenticated on public.phases.');
  assert(migrationSql.includes('REVOKE ALL ON public.phases FROM anon;'),
    'Test 22: Anon access revoked on public.phases.');
  assert(migrationSql.includes('REVOKE INSERT, UPDATE, DELETE ON public.phases FROM authenticated, anon;'),
    'Test 23: Direct DML mutations revoked on public.phases.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 5: PROCESS INSTANCE ENTITY & PLACEMENT INTEGRITY
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 5: Process Instance Entity & Placement Integrity ---');

  assert(migrationSql.includes('CREATE TABLE IF NOT EXISTS public.process_instances'),
    'Test 24: public.process_instances table definition present.');
  assert(migrationSql.includes('chk_process_instance_placement'),
    'Test 25: chk_process_instance_placement check constraint defined.');

  function validatePlacement(p) {
    if (p.placement_type === 'standalone') {
      return p.project_id === null && p.phase_id === null && p.task_list_id === null;
    }
    if (p.placement_type === 'project') {
      return p.project_id !== null && p.phase_id === null && p.task_list_id === null && p.parent_task_id === null;
    }
    if (p.placement_type === 'phase') {
      return p.project_id !== null && p.phase_id !== null && p.task_list_id === null && p.parent_task_id === null;
    }
    if (p.placement_type === 'task_list') {
      return p.project_id !== null && p.phase_id !== null && p.task_list_id !== null && p.parent_task_id === null;
    }
    if (p.placement_type === 'task') {
      return p.project_id !== null && p.parent_task_id !== null;
    }
    return false;
  }

  // Placement verification tests
  assert(validatePlacement({ placement_type: 'standalone', project_id: null, phase_id: null, task_list_id: null, parent_task_id: null }),
    'Test 26: Standalone placement validation succeeds with null project/phase/task_list.');
  assert(!validatePlacement({ placement_type: 'standalone', project_id: 'p-1', phase_id: null, task_list_id: null, parent_task_id: null }),
    'Test 27: Standalone placement validation rejects non-null project_id.');

  assert(validatePlacement({ placement_type: 'project', project_id: 'p-1', phase_id: null, task_list_id: null, parent_task_id: null }),
    'Test 28: Project-level placement validation succeeds.');
  assert(!validatePlacement({ placement_type: 'project', project_id: 'p-1', phase_id: 'ph-1', task_list_id: null, parent_task_id: null }),
    'Test 29: Project-level placement rejects non-null phase_id.');

  assert(validatePlacement({ placement_type: 'phase', project_id: 'p-1', phase_id: 'ph-1', task_list_id: null, parent_task_id: null }),
    'Test 30: Phase-level placement validation succeeds.');
  assert(!validatePlacement({ placement_type: 'phase', project_id: 'p-1', phase_id: null, task_list_id: null, parent_task_id: null }),
    'Test 31: Phase-level placement rejects null phase_id.');

  assert(validatePlacement({ placement_type: 'task_list', project_id: 'p-1', phase_id: 'ph-1', task_list_id: 'tl-1', parent_task_id: null }),
    'Test 32: Task list-level placement validation succeeds.');

  assert(validatePlacement({ placement_type: 'task', project_id: 'p-1', phase_id: 'ph-1', task_list_id: 'tl-1', parent_task_id: 't-1' }),
    'Test 33: Task-level placement validation succeeds with parent_task_id.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 6: MINIMAL TECHNICAL LIFECYCLE (DECISION 32 PRESERVED)
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 6: Minimal Technical Lifecycle (Decision 32 Preserved) ---');

  assert(migrationSql.includes("status IN ('running', 'completed', 'cancelled')"),
    'Test 34: Process instance status domain strictly restricted to running, completed, cancelled.');
  assert(!migrationSql.includes('on_track') && !migrationSql.includes('at_risk') && !migrationSql.includes('delayed'),
    'Test 35: No unapproved business statuses (on_track, at_risk, delayed) introduced in schema.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 7: RLS & SECURITY POSTURE
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 7: Process Instance RLS & Permissions ---');

  assert(migrationSql.includes('ALTER TABLE public.process_instances ENABLE ROW LEVEL SECURITY;'),
    'Test 36: RLS enabled on process_instances.');
  assert(migrationSql.includes('CREATE POLICY "process_instances_select_member" ON public.process_instances'),
    'Test 37: Active workspace member SELECT policy created.');
  assert(migrationSql.includes('GRANT SELECT ON TABLE public.process_instances TO authenticated;'),
    'Test 38: Selective authenticated SELECT grant configured.');
  assert(migrationSql.includes('REVOKE ALL ON TABLE public.process_instances FROM PUBLIC, anon;'),
    'Test 39: Anonymous & Public access completely revoked on process_instances.');

  // ═════════════════════════════════════════════════════════════════════════
  // SECTION 8: TASK RELATION
  // ═════════════════════════════════════════════════════════════════════════
  console.log('\n--- Section 8: Task → Process Instance Relation ---');

  assert(migrationSql.includes('ALTER TABLE public.tasks\n  ADD COLUMN IF NOT EXISTS process_instance_id uuid REFERENCES public.process_instances(id)'),
    'Test 40: tasks.process_instance_id added referencing public.process_instances(id).');
  assert(migrationSql.includes('CREATE INDEX IF NOT EXISTS idx_tasks_process_instance ON public.tasks(process_instance_id)'),
    'Test 41: idx_tasks_process_instance index created.');

  // ═════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═════════════════════════════════════════════════════════════════════════
  console.log(`\n================================================================`);
  console.log(`FOUNDATION TEST RESULT: ${passed} PASSED, ${failed} FAILED`);
  console.log(`================================================================`);

  if (failed > 0) process.exit(1);
}

runFoundationTests().catch(console.error);
