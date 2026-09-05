// node tests/knock-booking.cjs — production save/rule/store/agenda + PinSheet
// interactions, with isolated memory storage and no device/customer records.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
process.env.TZ = 'America/New_York';
const root = path.resolve(__dirname, '..');
const cache = new Map();
const storage = new Map();
const memory = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
let states = [], cursor = 0, effects = [], mounted = false;
const hooks = {
  useState: init => { const i = cursor++; if (!(i in states)) states[i] = typeof init === 'function' ? init() : init; return [states[i], next => { states[i] = typeof next === 'function' ? next(states[i]) : next; }]; },
  useRef: init => hooks.useState(() => ({ current: init }))[0],
  useMemo: fn => fn(), useEffect: fn => { if (!mounted) effects.push(fn); },
};
const mocks = {
  'lib/env.ts': { env: {}, isApillowConfigured: false, isGoogleMapsConfigured: false },
  'lib/services/inspectionPersistence.ts': { inspectionStorage: memory },
  'lib/stores/doNotKnockStore.ts': { useDoNotKnockStore: Object.assign(selector => selector({ entries: [] }), { getState: () => ({ blockedAt: () => null }) }) },
  'lib/stores/propertyRecordStore.ts': { usePropertyRecordStore: selector => selector({ cached: () => null, lookup: async () => null }) },
  'lib/services/geocoding.ts': {},
  'components/pipeline/contact.ts': {},
  'components/knock/outcomeStyle.ts': { outcomeColor: () => 'brand', outcomeIcon: () => 'calendar' },
  'components/ui/BottomSheet.tsx': { BottomSheet: 'BottomSheet' },
  'components/ui/Pill.tsx': { Pill: 'Pill' },
  'components/PressableScale.tsx': { PressableScale: 'PressableScale' },
};
function load(file) {
  if (mocks[file]) return mocks[file];
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const resolve = id => {
    if (id === '@react-native-async-storage/async-storage') return memory;
    if (id === 'zustand' || id === 'zustand/middleware' || id === 'react/jsx-runtime') return require(id);
    if (id === 'react') return hooks;
    if (id === 'react-native') return { Platform: { OS: 'web', select: v => v.default }, StyleSheet: { create: v => v }, Text: 'Text', View: 'View', TextInput: 'TextInput', ScrollView: 'ScrollView', KeyboardAvoidingView: 'KeyboardAvoidingView' };
    if (id === '@expo/vector-icons') return { Ionicons: 'Ionicons' };
    if (id === 'expo-image') return { Image: 'Image' };
    if (id.startsWith('.') || id.startsWith('@/')) {
      const rel = id.startsWith('@/') ? id.slice(2) : path.normalize(path.join(path.dirname(file), id));
      return load(rel + (fs.existsSync(path.join(root, rel + '.ts')) ? '.ts' : '.tsx'));
    }
    throw new Error(`Unexpected dependency ${id} from ${file}`);
  };
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8')), { exports, require: resolve, console, Date, setTimeout, clearTimeout, queueMicrotask }, { filename: file });
  return exports;
}
const times = load('lib/services/appointmentTime.ts');
const auto = load('lib/services/automations.ts');
const { useInspectionStore: jobs } = load('lib/stores/inspectionStore.ts');
const { useLeadStore: leads } = load('lib/stores/leadStore.ts');
const { useKnockSessionStore: sessions } = load('lib/stores/knockSessionStore.ts');
const { saveKnock } = load('components/knock/saveKnock.ts');
const pipeline = load('lib/services/pipeline.ts');
const agenda = load('components/home/todayAgenda.ts');
auto.installAutomationEngine();
const rule = auto.ruleById('knock_booked_job');
const first = times.appointmentAt('2026-09-08', '14:30');
const next = times.appointmentAt('2026-09-10', '16:00');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function reset() {
  leads.setState({ leads: [] }); jobs.setState({ inspections: [], nextOrdinal: 1 });
  sessions.setState({ activeSession: null, archive: [] }); sessions.getState().start();
}
function book(date = first, options) {
  return saveKnock({ lat: 33, lng: -96, address: '102 Oak St', placedBy: 'map_tap', outcome: 'appointment', followUpAt: date, contactName: 'Owner' }, options);
}
test('local date and time preserve minutes and reject missing, impossible and DST-gap inputs', () => {
  assert.equal(new Date(first).getHours(), 14); assert.equal(new Date(first).getMinutes(), 30);
  for (const [date, time] of [['', '09:00'], ['2026-02-30', '09:00'], ['2026-09-08', '24:00'], ['2026-03-08', '02:30'], ['2026-09-08', '']]) assert.equal(times.appointmentAt(date, time), undefined);
  for (const value of [undefined, '', '2026-09-08', 'garbage', '2026-02-30T09:00:00Z']) assert.equal(times.isAppointmentTimestamp(value), false);
});
test('invalid Booked saves change no store and invalid external rule events produce no action', () => {
  reset(); assert.equal(book('2026-09-08'), null); assert.equal(leads.getState().leads.length, 0); assert.equal(sessions.getState().activeSession.knocks.length, 0);
  const ctx = { leadById: () => ({ id: 'lead' }), inspectionForLead: () => undefined };
  assert.equal(rule.evaluate({ type: 'knock_outcome', outcome: 'appointment', leadId: 'lead' }, ctx).length, 0);
  assert.equal(rule.evaluate({ type: 'knock_outcome', outcome: 'inspection_scheduled', leadId: 'lead', followUpAt: first }, ctx)[0].kind, 'create_job');
});
test('book then rebook creates one linked Pipeline card and one scheduled appointment', () => {
  reset(); const original = book(); const id = jobs.getState().inspections[0].id;
  book(next, { existingKnockId: original.knock.id });
  const inspections = jobs.getState().inspections; const customers = leads.getState().leads;
  assert.equal(inspections.length, 1); assert.equal(inspections[0].id, id); assert.equal(inspections[0].scheduledAt, next);
  assert.equal(customers[0].followUpAt, next); assert.equal(customers[0].inspectionId, id);
  const items = pipeline.buildPipeline({ leads: customers, inspections, proposals: [], estimates: [], tasks: [], now: Date.parse('2026-09-09T12:00:00Z') });
  assert.equal(items.length, 1); assert.equal(items[0].scheduledAt, next); assert.match(items[0].nextAction, /4:00/);
  assert.equal(agenda.inspectionsToday(inspections, new Date(first)).length, 0);
  assert.equal(agenda.inspectionsToday(inspections, new Date(next)).length, 1);
  assert.equal(agenda.followUpsDue(customers, new Date(next), inspections).length, 0);
  const rail = agenda.scheduleItemsFor({ inspections, followUps: customers, activeRoute: null, now: new Date(next) });
  assert.equal(rail.length, 1); assert.equal(rail[0].time, Date.parse(next));
});
test('started and completed inspections, stages and reminders survive Booked revisits', () => {
  for (const status of ['in_progress', 'complete']) {
    reset(); const original = book(); const id = jobs.getState().inspections[0].id;
    jobs.getState().setStatus(id, status);
    const before = JSON.stringify(jobs.getState().inspections[0]); const customer = leads.getState().leads[0];
    assert.equal(book(next, { existingKnockId: original.knock.id }).bookingSkipped, true);
    assert.equal(JSON.stringify(jobs.getState().inspections[0]), before);
    assert.equal(leads.getState().leads[0].stage, customer.stage);
    assert.equal(leads.getState().leads[0].followUpAt, customer.followUpAt);
    jobs.getState().setScheduledAt(id, next);
    assert.equal(JSON.stringify(jobs.getState().inspections[0]), before);
  }
});
test('a separately dated customer follow-up is retained alongside the appointment', () => {
  reset(); book(); const customers = leads.getState().leads.map(l => ({ ...l, followUpAt: next }));
  assert.equal(agenda.followUpsDue(customers, new Date(next), jobs.getState().inspections).length, 1);
});
test('store rejects invalid appointments and finalized scheduled work; explicit links win', () => {
  reset(); book(); const original = jobs.getState().inspections[0];
  jobs.getState().setScheduledAt(original.id, '2026-09-08');
  assert.equal(jobs.getState().inspections[0].scheduledAt, first);
  jobs.setState({ inspections: [{ ...original, id: 'another', status: 'in_progress' }, original] });
  assert.equal(auto.buildContext().inspectionForLead(leads.getState().leads[0].id).id, original.id);
  jobs.setState({ inspections: [{ ...original, reportFinalizedAt: first }] });
  const before = JSON.stringify(jobs.getState().inspections);
  jobs.getState().setScheduledAt(original.id, next);
  assert.equal(JSON.stringify(jobs.getState().inspections), before);
});
test('PinSheet requires date plus selectable time and preserves the selected appointment on save', () => {
  reset(); const { PinSheet } = load('components/knock/PinSheet.tsx');
  states = []; mounted = false; let saved;
  const props = { visible: true, mode: { kind: 'new', point: { lat: 33, lng: -96, placedBy: 'map_tap' }, nearby: null }, onClose() {}, onSaved: value => { saved = value; }, onRemove() {}, onOpenLead() {} };
  function render() { cursor = 0; effects = []; const tree = PinSheet(props); if (!mounted) { mounted = true; effects.forEach(fn => fn()); return render(); } return tree; }
  function nodes(value, out = []) { if (!value) return out; if (Array.isArray(value)) value.forEach(v => nodes(v, out)); else if (value.props) { out.push(value); nodes(value.props.children, out); if (value.type === 'BottomSheet') nodes(value.props.footer, out); } return out; }
  let tree = render(); const find = label => nodes(tree).find(n => n.props.accessibilityLabel === label);
  find('Inspection booked').props.onPress(); tree = render();
  assert.equal(find('Save knock').props.disabled, true); assert.equal(find('No date'), undefined);
  find('Inspection date, YYYY-MM-DD').props.onChangeText('2026-09-10'); tree = render();
  assert.equal(find('Save knock').props.disabled, true);
  find('Inspection at 4 PM').props.onPress(); tree = render(); assert.equal(find('Save knock').props.disabled, false);
  find('Inspection date, YYYY-MM-DD').props.onChangeText('2026-02-30'); tree = render(); assert.equal(find('Save knock').props.disabled, true);
  find('Inspection date, YYYY-MM-DD').props.onChangeText('2026-09-10'); tree = render(); find('Save knock').props.onPress();
  assert.equal(saved.knock.followUpAt, next);
});
test('unchanged fall-back 1:30 keeps its second-occurrence instant and sub-minute precision', () => {
  const originalIso = '2026-11-01T06:30:45.123Z'; // 1:30 EST, second occurrence
  for (const editTime of [false, true]) {
    reset(); const original = book(originalIso);
    const { PinSheet } = load('components/knock/PinSheet.tsx');
    states = []; mounted = false; let saved;
    const props = { visible: true, mode: { kind: 'edit', knock: original.knock }, onClose() {}, onSaved: value => { saved = value; }, onRemove() {}, onOpenLead() {} };
    function render() { cursor = 0; effects = []; const tree = PinSheet(props); if (!mounted) { mounted = true; effects.forEach(fn => fn()); return render(); } return tree; }
    function nodes(value, out = []) { if (!value) return out; if (Array.isArray(value)) value.forEach(v => nodes(v, out)); else if (value.props) { out.push(value); nodes(value.props.children, out); if (value.type === 'BottomSheet') nodes(value.props.footer, out); } return out; }
    let tree = render(); const find = label => nodes(tree).find(n => n.props.accessibilityLabel === label);
    assert.equal(find('Inspection time, HH:MM, 24-hour local time').props.value, '01:30');
    find('Notes').props.onChangeText('Confirmed at the door'); tree = render();
    // An unchanged text event must not reconstruct the ambiguous clock either.
    find('Inspection date, YYYY-MM-DD').props.onChangeText('2026-11-01'); tree = render();
    find('Inspection time, HH:MM, 24-hour local time').props.onChangeText(editTime ? '02:30' : '01:30'); tree = render();
    find('Update knock').props.onPress();
    const expected = editTime ? '2026-11-01T07:30:00.000Z' : originalIso;
    assert.equal(saved.knock.followUpAt, expected);
    assert.equal(leads.getState().leads[0].followUpAt, expected);
    assert.equal(jobs.getState().inspections[0].scheduledAt, expected);
  }
});
test('23- and 25-hour calendar days and weeks keep exactly their local appointments', () => {
  for (const [date, hours] of [['2026-03-08', 23], ['2026-11-01', 25]]) {
    const now = new Date(times.appointmentAt(date, '12:00'));
    const { start, end } = agenda.dayBounds(now);
    assert.equal((end - start) / 3600000, hours);
    const row = (id, milliseconds) => ({ id, status: 'scheduled', scheduledAt: new Date(milliseconds).toISOString() });
    const inspections = [row('before', start - 1), row('first', start), row('last', end - 1), row('tomorrow', end)];
    assert.equal(agenda.inspectionsToday(inspections, now).map(i => i.id).join(','), 'first,last');
    const reminders = inspections.map(ins => ({ id: ins.id, stage: 'contacted', followUpAt: ins.scheduledAt }));
    assert.equal(agenda.followUpsDue(reminders, now).map(l => l.id).join(','), 'before,first,last');
    const weekEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).getTime();
    assert.equal(agenda.inspectionsThisWeek([row('last', weekEnd - 1), row('nextWeek', weekEnd)], now).map(i => i.id).join(','), 'last');
  }
});
console.log(`${passed} booking fidelity regressions passed.`);
