// node tests/knock-lead-identity.cjs
// Production save path, stores and Pipeline projection; isolated in-memory
// storage only. No user records, device storage or network calls are touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const cache = new Map();
const storage = new Map();
const events = [];
const asyncStorage = {
  getItem: key => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: key => storage.delete(key),
};
function load(file) {
  if (cache.has(file)) return cache.get(file);
  if (file === 'lib/env.ts') return { env: {}, isApillowConfigured: false };
  if (file === 'lib/services/automations.ts') return { emitPipelineEvent: event => events.push(event) };
  if (file === 'lib/stores/inspectionStore.ts') return { useInspectionStore: { getState: () => ({ inspections: [] }) } };
  if (file === 'lib/stores/doNotKnockStore.ts') return { useDoNotKnockStore: { getState: () => ({ blockedAt: () => null }) } };
  const exports = {};
  cache.set(file, exports);
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const resolve = id => {
    if (id === '@react-native-async-storage/async-storage') return asyncStorage;
    if (id === 'zustand' || id === 'zustand/middleware') return require(id);
    if (id.startsWith('@/')) return load(id.slice(2) + '.ts');
    if (id.startsWith('.')) return load(path.normalize(path.join(path.dirname(file), id)) + '.ts');
    throw new Error('Unexpected dependency: ' + id);
  };
  vm.runInNewContext(compiled, { exports, require: resolve, console }, { filename: file });
  return exports;
}
const { saveKnock } = load('components/knock/saveKnock.ts');
const { useLeadStore } = load('lib/stores/leadStore.ts');
const { useKnockSessionStore } = load('lib/stores/knockSessionStore.ts');
const { buildPipeline } = load('lib/services/pipeline.ts');
// Execute the production sheet callback so archived identity must actually
// travel through the UI options, not merely work when passed by a test.
const pinSource = fs.readFileSync(path.join(root, 'components/knock/PinSheet.tsx'), 'utf8');
const pinAst = ts.createSourceFile('PinSheet.tsx', pinSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const pinComponent = pinAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PinSheet');
const saveDeclaration = pinComponent.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(pinAst) === 'save'));
assert.ok(saveDeclaration, 'PinSheet save handler exists');
const pinSaveJS = ts.transpileModule(saveDeclaration.getText(pinAst) + '\nglobalThis.save = save;', {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const location = { lat: 33.0198, lng: -96.6989 };
function reset() {
  useLeadStore.setState({ leads: [] });
  useKnockSessionStore.setState({ activeSession: null, archive: [] });
  useKnockSessionStore.getState().start();
  events.length = 0;
}
function lead(address, overrides = {}) {
  return useLeadStore.getState().create({
    customerName: 'Existing customer', customerPhone: '555-0100', address,
    stage: 'new', ...location, ...overrides,
  });
}
function save(overrides = {}, options) {
  return saveKnock({
    ...location, placedBy: 'map_tap', address: '102 Oak St', outcome: 'interested',
    contactName: 'New customer', contactPhone: '555-0102', followUpAt: '2026-09-07T14:00:00Z',
    ...overrides,
  }, options);
}
function revisit(archived, outcome = 'interested') {
  let result;
  const sandbox = {
    saveKnock, canSave: true, outcome, archived, editing: null,
    point: { lat: archived.lat, lng: archived.lng, placedBy: archived.placedBy ?? 'map_tap' },
    addressReal: !!archived.address, address: archived.address ?? '', notes: 'Second visit',
    contactName: '', contactPhone: '', record: undefined, damageNoted: null, comeBackWhen: null,
    resolvedFollowUpAt: () => '2026-09-09T14:00:00Z', setSaving: () => {}, onClose: () => {},
    onSaved: saved => { result = saved; },
  };
  vm.runInNewContext(pinSaveJS, sandbox);
  sandbox.save();
  assert.ok(result, 'Archived visit saved through PinSheet');
  return result;
}
function archive(knock) {
  useKnockSessionStore.getState().end();
  useKnockSessionStore.getState().start();
  return knock;
}
let passed = 0;
function test(name, run) {
  reset(); run(); passed++; console.log('PASS ' + name);
}
test('a different street number inside 15 m creates its own Pipeline lead', () => {
  const neighbour = lead('100 Oak St', { lng: location.lng + 0.00005 });
  const before = JSON.stringify(neighbour);
  const result = save({ outcome: 'signed' });
  assert.equal(result.leadCreated, true);
  assert.notEqual(result.lead.id, neighbour.id);
  assert.equal(JSON.stringify(useLeadStore.getState().leads.find(l => l.id === neighbour.id)), before);
  assert.equal(result.knock.createdLeadId, result.lead.id);
  const items = buildPipeline({ leads: useLeadStore.getState().leads, inspections: [], proposals: [], estimates: [], tasks: [] });
  assert.equal(items.length, 2);
  assert.equal(items.find(item => item.id === neighbour.id).stage, 'new');
  assert.equal(items.find(item => item.id === result.lead.id).stage, 'signed');
  assert.equal(events.filter(event => event.type === 'stage_changed' && event.leadId === neighbour.id).length, 0);
});
test('different apartment units at identical coordinates stay separate', () => {
  const neighbour = lead('102 Oak St Apt 1');
  const result = save({ address: '102 Oak St Apt 2' });
  assert.equal(result.leadCreated, true);
  assert.notEqual(result.lead.id, neighbour.id);
});
test('normalized exact address outranks proximity and upgrades only that lead', () => {
  const same = lead('102 Oak St, USA', { lat: location.lat + 0.001 });
  const neighbour = lead('100 Oak St');
  const result = save({ address: '102 OAK ST' });
  assert.equal(result.leadCreated, false);
  assert.equal(result.lead.id, same.id);
  assert.equal(useLeadStore.getState().leads.find(l => l.id === neighbour.id).stage, 'new');
});
test('one nearby GPS-only lead can gain its actual address and contact', () => {
  const same = lead('33.01980, -96.69890', { customerName: 'Walk-in lead', customerPhone: undefined });
  const result = save();
  assert.equal(result.lead.id, same.id);
  assert.equal(result.lead.address, '102 Oak St');
  assert.equal(result.lead.customerName, 'New customer');
  assert.equal(result.lead.customerPhone, '555-0102');
});
test('multiple GPS candidates cannot choose a customer by array order', () => {
  const a = lead('Address pending');
  const b = lead('33.01980, -96.69890');
  const original = JSON.stringify(useLeadStore.getState().leads);
  const result = save();
  assert.equal(result.leadCreated, true);
  assert.notEqual(result.lead.id, a.id);
  assert.notEqual(result.lead.id, b.id);
  assert.equal(JSON.stringify(useLeadStore.getState().leads.filter(l => l.id !== result.lead.id)), original);
});
test('an unnamed pin near two addressed customers preserves both', () => {
  lead('100 Oak St'); lead('102 Oak St');
  const original = JSON.stringify(useLeadStore.getState().leads);
  const result = save({ address: undefined });
  assert.equal(result.leadCreated, true);
  assert.equal(result.gpsOnly, true);
  assert.equal(JSON.stringify(useLeadStore.getState().leads.filter(l => l.id !== result.lead.id)), original);
});
test('the existing knock link remains authoritative after customer corrections', () => {
  const same = lead('104 Oak St', { stage: 'signed', lat: location.lat + 0.001 });
  lead('102 Oak St');
  const existing = useKnockSessionStore.getState().logKnock({ ...location, outcome: 'signed', createdLeadId: same.id });
  const result = save({}, { existingKnockId: existing.id });
  assert.equal(result.lead.id, same.id);
  assert.equal(result.lead.stage, 'signed');
  assert.equal(result.knock.id, existing.id);
  assert.equal(result.knock.history[0].outcome, 'signed');
  assert.equal(useKnockSessionStore.getState().activeSession.knocks.length, 1);
});
test('a sole nearby candidate still links a GPS-only door', () => {
  const same = lead('102 Oak St');
  assert.equal(save({ address: undefined }).lead.id, same.id);
});
test('no-answer still records the door without changing the Pipeline', () => {
  const existing = lead('100 Oak St');
  const result = save({ outcome: 'no_answer' });
  assert.equal(result.lead, null);
  assert.equal(useLeadStore.getState().leads.length, 1);
  assert.equal(useLeadStore.getState().leads[0], existing);
});
test('archived Knock again retains corrected customer identity and one Pipeline card', () => {
  const first = save({ notes: 'First visit' });
  const archived = archive(first.knock);
  const beforeArchive = JSON.stringify(useKnockSessionStore.getState().archive);
  useLeadStore.getState().updateDetails(first.lead.id, { address: 'Corrected 500 Pine St', lat: 34, lng: -97 });
  const result = revisit(archived);
  assert.equal(result.lead.id, first.lead.id);
  assert.equal(result.lead.address, 'Corrected 500 Pine St');
  assert.equal(result.leadCreated, false);
  assert.notEqual(result.knock.id, archived.id);
  assert.notEqual(result.knock.sessionId, archived.sessionId);
  assert.equal(result.knock.createdLeadId, first.lead.id);
  assert.equal(result.knock.history.at(-1).notes, 'First visit');
  assert.equal(JSON.stringify(useKnockSessionStore.getState().archive), beforeArchive);
  assert.equal(buildPipeline({ leads: useLeadStore.getState().leads, inspections: [], proposals: [], estimates: [], tasks: [] }).length, 1);
});
test('archived no-answer retains customer link without stage/contact mutations', () => {
  const first = save({ outcome: 'signed' });
  const archived = archive(first.knock);
  const before = JSON.stringify(useLeadStore.getState().leads);
  const result = revisit(archived, 'no_answer');
  assert.equal(result.lead, null);
  assert.equal(result.knock.createdLeadId, first.lead.id);
  assert.equal(JSON.stringify(useLeadStore.getState().leads), before);
});
test('deleted archived link safely falls back to an exact address match', () => {
  const first = save();
  const archived = archive(first.knock);
  useLeadStore.getState().remove(first.lead.id);
  const replacement = lead('102 Oak St');
  const result = revisit(archived);
  assert.equal(result.lead.id, replacement.id);
  assert.equal(result.knock.createdLeadId, replacement.id);
  assert.equal(useLeadStore.getState().leads.length, 1);
});
test('deleted archived link cannot fall back to a conflicting neighbour', () => {
  const first = save();
  const archived = archive(first.knock);
  useLeadStore.getState().remove(first.lead.id);
  const neighbour = lead('100 Oak St');
  const before = JSON.stringify(neighbour);
  const result = revisit(archived);
  assert.equal(result.leadCreated, true);
  assert.notEqual(result.lead.id, first.lead.id);
  assert.notEqual(result.lead.id, neighbour.id);
  assert.equal(JSON.stringify(useLeadStore.getState().leads.find(l => l.id === neighbour.id)), before);
});
test('missing archived link uses the ordinary safe match', () => {
  const same = lead('102 Oak St');
  const archived = archive(useKnockSessionStore.getState().logKnock({ ...location, address: same.address, outcome: 'no_answer' }));
  const result = revisit(archived);
  assert.equal(result.lead.id, same.id);
  assert.equal(result.knock.createdLeadId, same.id);
});
test('a deleted archived link is not copied into a no-answer revisit', () => {
  const first = save();
  const archived = archive(first.knock);
  useLeadStore.getState().remove(first.lead.id);
  const result = revisit(archived, 'no_answer');
  assert.equal(result.knock.createdLeadId, undefined);
  assert.equal(useLeadStore.getState().leads.length, 0);
});
test('active no-answer edit clears a deleted lead link without reviving the customer', () => {
  const first = save({ notes: 'Original conversation' });
  useLeadStore.getState().remove(first.lead.id);
  const result = save({ outcome: 'no_answer' }, { existingKnockId: first.knock.id });
  assert.equal(result.knock.createdLeadId, undefined);
  assert.equal(result.knock.id, first.knock.id);
  assert.equal(result.knock.history.at(-1).notes, 'Original conversation');
  assert.equal(useLeadStore.getState().leads.length, 0);
  assert.equal(useKnockSessionStore.getState().activeSession.knocks.length, 1);
  assert.equal(JSON.parse(storage.get('roofwise.knockSessions.v1')).state.activeSession.knocks[0].createdLeadId, undefined);
});
test('active no-answer edit retains a live lead link without customer mutation', () => {
  const first = save({ outcome: 'signed' });
  const before = JSON.stringify(useLeadStore.getState().leads);
  const result = save({ outcome: 'no_answer' }, { existingKnockId: first.knock.id });
  assert.equal(result.knock.createdLeadId, first.lead.id);
  assert.equal(result.lead, null);
  assert.equal(JSON.stringify(useLeadStore.getState().leads), before);
});
test('active deleted link falls back to an exact address without adding a door', () => {
  const first = save();
  useLeadStore.getState().remove(first.lead.id);
  const replacement = lead('102 Oak St');
  const result = save({}, { existingKnockId: first.knock.id });
  assert.equal(result.lead.id, replacement.id);
  assert.equal(result.knock.createdLeadId, replacement.id);
  assert.equal(result.knock.id, first.knock.id);
  assert.equal(useLeadStore.getState().leads.length, 1);
});
test('active deleted link cannot mutate a conflicting neighbour during fallback', () => {
  const first = save();
  useLeadStore.getState().remove(first.lead.id);
  const neighbour = lead('100 Oak St');
  const before = JSON.stringify(neighbour);
  const result = save({}, { existingKnockId: first.knock.id });
  assert.equal(result.leadCreated, true);
  assert.notEqual(result.lead.id, first.lead.id);
  assert.notEqual(result.lead.id, neighbour.id);
  assert.equal(result.knock.createdLeadId, result.lead.id);
  assert.equal(JSON.stringify(useLeadStore.getState().leads.find(l => l.id === neighbour.id)), before);
});
console.log(`${passed} knock-to-Pipeline identity regressions passed.`);
