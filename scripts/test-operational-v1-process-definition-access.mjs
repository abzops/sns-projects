import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const read = (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const {
  canManageProcessDraft,
  canPublishProcessDraft,
  getProcessCardCapabilities,
  isLinearProcessFlow,
} = await import(pathToFileURL(path.join(root, 'src/utils/processVersionAccess.js')));

const published = { id: 'published-v1', version_number: 1, status: 'published', step_count: 3 };
const draft = { id: 'draft-v2', version_number: 2, status: 'draft', step_count: 4 };
const baseProcess = {
  id: 'process-1',
  department_id: 'dept-1',
  process_owner_id: 'owner-1',
};

const publishedOnly = getProcessCardCapabilities({ ...baseProcess, published_version: published }, {});
assert.equal(publishedOnly.canViewPublished, true, 'Published-only process exposes its definition.');
assert.equal(publishedOnly.canStart, true, 'Published-only process remains startable.');
assert.equal(publishedOnly.hasDraft, false, 'Published-only process does not invent a draft.');

const draftOnly = getProcessCardCapabilities(
  { ...baseProcess, draft_version: draft },
  { canEditDraft: true, canPublishDraft: true }
);
assert.equal(draftOnly.canViewDraft, true, 'Draft-only process exposes draft information.');
assert.equal(draftOnly.canEditDraft, true, 'Authorized user can edit a real draft.');
assert.equal(draftOnly.canPublishDraft, true, 'Authorized user can publish a real draft.');
assert.equal(draftOnly.canStart, false, 'Draft-only process cannot be started.');

const coexistence = getProcessCardCapabilities(
  { ...baseProcess, published_version: published, draft_version: draft },
  { canEditDraft: true, canPublishDraft: true }
);
assert.equal(coexistence.hasPublished, true, 'Coexistence retains the Live version.');
assert.equal(coexistence.hasDraft, true, 'Coexistence retains the newer Draft.');
assert.equal(coexistence.publishedVersion.id, 'published-v1');
assert.equal(coexistence.draftVersion.id, 'draft-v2');

const flowSteps = [
  { id: 's1', sequence_order: 1 },
  { id: 's2', sequence_order: 2 },
  { id: 's3', sequence_order: 3 },
];
assert.equal(isLinearProcessFlow(flowSteps, [
  { step_id: 's2', depends_on_step_id: 's1' },
  { step_id: 's3', depends_on_step_id: 's2' },
]), true, 'Exact predecessor chain is presented as linear.');
assert.equal(isLinearProcessFlow(flowSteps, [
  { step_id: 's2', depends_on_step_id: 's1' },
  { step_id: 's3', depends_on_step_id: 's1' },
]), false, 'Branching dependency graph is not presented as linear.');

const viewerContext = {
  user: { id: 'viewer-1' },
  workspaceRole: 'viewer',
  isOwner: false,
  isAdmin: false,
  isProjectAdmin: false,
  isSystemAdmin: false,
  departmentMemberships: [],
};
assert.equal(canManageProcessDraft(baseProcess, viewerContext), false, 'Viewer cannot edit a draft.');
assert.equal(canPublishProcessDraft(baseProcess, viewerContext), false, 'Viewer cannot publish a draft.');

const ownerContext = { ...viewerContext, user: { id: 'owner-1' }, workspaceRole: 'member' };
assert.equal(canManageProcessDraft(baseProcess, ownerContext), true, 'Process owner retains draft edit authority.');
assert.equal(canPublishProcessDraft(baseProcess, ownerContext), false, 'Process ownership alone does not grant publish authority.');

const departmentHeadContext = {
  ...viewerContext,
  user: { id: 'head-1' },
  workspaceRole: 'member',
  departmentMemberships: [{ role: 'head', is_active: true, departments: { id: 'dept-1' } }],
};
assert.equal(canManageProcessDraft(baseProcess, departmentHeadContext), true, 'Owning Department Head can edit.');
assert.equal(canPublishProcessDraft(baseProcess, departmentHeadContext), true, 'Owning Department Head can publish.');

const [
  catalogSource,
  definitionHook,
  definitionPage,
  definitionWorkflow,
  definitionCss,
  startModal,
  definedProcessesHook,
  appSource,
] = await Promise.all([
  read('src/pages/ProcessesPage.jsx'),
  read('src/hooks/useProcessDefinition.js'),
  read('src/pages/ProcessDefinitionPage.jsx'),
  read('src/components/process-builder/ProcessDefinitionWorkflow.jsx'),
  read('src/pages/ProcessDefinitionPage.module.css'),
  read('src/components/StartProcessModal.jsx'),
  read('src/hooks/useDefinedProcesses.js'),
  read('src/App.jsx'),
]);

assert.match(catalogSource, /View Definition/);
assert.match(catalogSource, /View Live Definition/);
assert.match(catalogSource, /View Draft/);
assert.match(catalogSource, /Live v\{publishedVer\.version_number\}/);
assert.match(catalogSource, /Draft v\{draftVer\.version_number\}/);
assert.match(catalogSource, /capabilities\.hasPublished[\s\S]*capabilities\.hasDraft/,
  'Published and Draft action groups render independently.');

assert.match(definitionHook, /\.eq\('id', versionId\)[\s\S]*\.eq\('defined_process_id', processId\)/,
  'Viewer loads the explicitly requested version scoped to its process.');
assert.doesNotMatch(definitionHook, /\.eq\('status',\s*['"]draft['"]\)/,
  'Exact-version viewer does not force or fall back to Draft.');
assert.doesNotMatch(definitionHook, /published_version|draft_version|active_version/,
  'Exact-version viewer has no status fallback path.');
assert.match(definitionHook, /defined_process_steps/);
assert.match(definitionHook, /defined_process_step_raci/);
assert.match(definitionHook, /defined_process_step_dependencies/);
assert.match(definitionHook, /Promise\.all/,
  'Definition sub-entities are loaded in bulk rather than per-step N+1 queries.');

assert.match(definitionPage, /Read-only definition snapshot/);
assert.match(definitionPage, /No changes can be made here/);
assert.doesNotMatch(definitionPage, /saveDraft|publishVersion|startProcess|onUpdateStep/,
  'Read-only viewer contains no mutation handlers.');
assert.match(definitionWorkflow, /response_required/);
assert.match(definitionWorkflow, /Custom dependency flow/);
assert.match(definitionWorkflow, /Depends on/);
assert.match(definitionWorkflow, /Approval/);
assert.match(definitionWorkflow, /Consultation/);
assert.match(definitionWorkflow, /Evidence/);

assert.match(startModal, /const publishedVersion = selectedProcess\?\.published_version \|\| null/,
  'Start modal resolves only the published version.');
assert.match(startModal, /p_version_id: publishedVersion\.id/,
  'Start RPC always receives the published version ID.');
assert.match(definedProcessesHook, /publish_defined_process_version/);
assert.match(definedProcessesHook, /start_defined_process/);

assert.match(appSource, /processes\/:processId\/versions\/:versionId/);
assert.match(definitionCss, /@media\s*\(max-width:\s*900px\)/);
assert.match(definitionCss, /@media\s*\(max-width:\s*620px\)/);
assert.match(definitionCss, /grid-template-columns:\s*1fr/);

console.log('Operational V1 Process Definition access: PASS (10 required version/view/permission/runtime contracts)');
