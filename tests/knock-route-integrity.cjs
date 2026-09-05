// node tests/knock-route-integrity.cjs
// Production stores, tracker, PlanView handlers and Door Knocking footer.
// All storage/location/UI effects are isolated; no app data or real GPS used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX },
}).outputText;
function component(file, name) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  return { ast, node: ast.statements.find(item => ts.isFunctionDeclaration(item) && item.name?.text === name) };
}
const plan = component('components/knock/PlanView.tsx', 'PlanView');
const door = component('app/door-knocking.tsx', 'DoorKnockingScreen');
function handlers(source, names) {
  const nodes = source.node.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => names.includes(item.name.getText(source.ast))));
  assert.equal(nodes.length, names.length);
  return compile(nodes.map(node => node.getText(source.ast)).join('\n') + '\nexports.handlers = {' + names.join(',') + '};');
}
const planJS = handlers(plan, ['beginRoute', 'routeTo']);
const doorJS = handlers(door, ['retryLocation', 'onPinHere', 'dropPin', 'onMapPress', 'openSettings']);
let footer;
function visit(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(door.ast) === 'footer') footer = node.initializer.expression;
  ts.forEachChild(node, visit);
}
visit(door.node);
assert.ok(footer, 'Door Knocking footer exists');
const footerJS = compile('exports.render = () => (' + footer.getText(door.ast) + ');');

const A = { lat: 33, lng: -96, radiusMiles: 3, label: 'Area A', stormAlertId: 'alert-a' };
const B = { lat: 34, lng: -96, radiusMiles: 3, label: 'Area B' };
const C = { lat: 35, lng: -96, radiusMiles: 3, label: 'Area C' };
const D = { lat: 36, lng: -96, radiusMiles: 3, label: 'Area D' };
function fixture() {
  const cache = new Map(), storage = new Map(), toasts = [], paths = [], pins = [];
  let permission = { status: 'denied', canAskAgain: true }, watchFails = false, initial = null, listener;
  let settingsCalls = 0, requests = 0;
  const native = {
    Accuracy: { High: 4 },
    getForegroundPermissionsAsync: async () => permission,
    requestForegroundPermissionsAsync: async () => { requests++; return permission; },
    getCurrentPositionAsync: async () => initial,
    watchPositionAsync: async (_opts, callback) => {
      if (watchFails) throw new Error('Location service unavailable');
      listener = callback; return { remove: () => { listener = null; } };
    },
  };
  const asyncStorage = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  function load(file) {
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const resolve = id => {
      if (id === '@react-native-async-storage/async-storage') return asyncStorage;
      if (id === 'expo-location') return native;
      if (id === 'react' || id === 'zustand' || id === 'zustand/middleware') return require(id);
      if (id.startsWith('@/')) return load(id.slice(2) + '.ts');
      if (id.startsWith('.')) return load(path.normalize(path.join(path.dirname(file), id)) + '.ts');
      throw new Error('Unexpected module ' + id);
    };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8')), { exports, require: resolve, console }, { filename: file });
    return exports;
  }
  const ks = load('lib/stores/knockSessionStore.ts').useKnockSessionStore;
  const ms = load('lib/stores/mileageStore.ts').useMileageStore;
  const tracker = load('components/knock/sessionTracker.ts');
  const trip = load('lib/services/knockTrip.ts');
  function screen(overrides = {}) {
    const sandbox = {
      exports: {}, require, console, ...tracker, ...trip,
      activeSession: ks.getState().activeSession, startSession: ks.getState().start,
      setRouteTarget: ks.getState().setRouteTarget, KNOCK_ROUTE_RADIUS_MILES: 3,
      starting: false, setStarting: () => {}, gate: 'denied', fix: null, fixFresh: false,
      toast: value => toasts.push(value), router: { push: value => paths.push(value) },
      useCallback: fn => fn, knockNear: ks.getState().knockNear, openSheet: mode => pins.push(mode),
      Haptics: { selectionAsync: async () => {} }, Platform: { OS: 'ios' },
      Linking: { openSettings: async () => { settingsCalls++; } },
      styles: new Proxy({}, { get: () => ({}) }), colors: {},
      View: 'View', Text: 'Text', PressableScale: 'PressableScale', ActivityIndicator: 'ActivityIndicator',
      Ionicons: 'Ionicons', locationDenied: true, initialRegion: A,
      chrome: { setDetent: () => {} }, recentreRoute: () => {}, onStart: () => {},
      ...overrides,
    };
    vm.runInNewContext(planJS + '\nconst planHandlers = exports.handlers;\n' + doorJS + '\nexports.handlers = { ...planHandlers, ...exports.handlers };\n' + footerJS, sandbox);
    return { ...sandbox.exports, sandbox };
  }
  return {
    ks, ms, tracker, trip, storage, screen, toasts, paths, pins,
    allow: () => { permission = { status: 'granted', canAskAgain: true }; },
    denyForever: () => { permission = { status: 'denied', canAskAgain: false }; },
    failWatcher: value => { watchFails = value; },
    setFix: () => { initial = { coords: { latitude: 33, longitude: -96, accuracy: 5 }, timestamp: Date.now() }; },
    setNativeFix: value => { initial = value; },
    emitNativeFix: value => { assert.ok(listener, 'native watcher is running'); listener(value); },
    get settingsCalls() { return settingsCalls; }, get requests() { return requests; },
    get watching() { return !!listener; },
  };
}
function buttons(tree, all = []) {
  if (!tree || typeof tree !== 'object') return all;
  if (tree.props?.accessibilityRole === 'button') all.push(tree.props);
  const children = tree.props?.children;
  for (const child of Array.isArray(children) ? children.flat(Infinity) : [children]) buttons(child, all);
  return all;
}
function snapshotRoute(session) {
  const { routeStops, routeTarget, currentStopIndex, ...rest } = session;
  return JSON.stringify(rest);
}
const tests = [];
function test(name, run) { tests.push({ name, run }); }
test('Plan Route here inserts the target now and preserves the rest of the session', async () => {
  const f = fixture();
  f.ks.getState().start('alert-a', A, { routeStops: [A, B, C], mileageTripId: 'manual-trip', mileageTripOwned: false });
  f.ks.getState().setCurrentStop(1);
  f.ks.getState().logKnock({ lat: 34, lng: -96, outcome: 'no_answer', notes: 'Keep this door' });
  f.ks.getState().appendTrackPoint({ lat: 34, lng: -96 });
  const before = snapshotRoute(f.ks.getState().activeSession);
  await f.screen().handlers.routeTo(D);
  const active = f.ks.getState().activeSession;
  assert.equal(active.routeTarget.label, D.label);
  assert.equal(active.routeStops[active.currentStopIndex].label, D.label);
  assert.equal(active.routeStops.map(s => s.label).join(','), 'Area A,Area D,Area B,Area C');
  assert.equal(snapshotRoute(active), before);
  assert.equal(f.ks.getState().advanceStop().label, B.label);
  assert.equal(f.ks.getState().advanceStop().label, C.label);
  assert.equal(f.paths.at(-1), '/door-knocking');
  const persisted = JSON.parse(f.storage.get('roofwise.knockSessions.v1')).state.activeSession;
  assert.equal(persisted.knocks.length, 1);
  assert.equal(persisted.routeStops.length, 4);
});
test('legacy single-target sessions keep their original area after adding another', async () => {
  const f = fixture(); f.ks.getState().start('alert-a', A);
  await f.screen().handlers.routeTo(B);
  assert.equal(f.ks.getState().activeSession.routeStops.map(s => s.label).join(','), 'Area B,Area A');
  assert.equal(f.ks.getState().advanceStop().label, A.label);
});
test('selecting current, upcoming or earlier areas keeps one copy and metadata', () => {
  for (const target of [A, B, C]) {
    const f = fixture(); f.ks.getState().start(undefined, A, { routeStops: [A, B, C] });
    f.ks.getState().setCurrentStop(1);
    f.ks.getState().setRouteTarget(target);
    f.ks.getState().setRouteTarget(target);
    const active = f.ks.getState().activeSession;
    assert.equal(active.routeStops.length, 3);
    assert.equal(active.routeStops[active.currentStopIndex].label, target.label);
    assert.equal(new Set(active.routeStops.map(s => s.label)).size, 3);
    assert.equal(active.routeStops.find(s => s.label === A.label).stormAlertId, 'alert-a');
  }
});
test('permission-denied Plan start keeps every selected area and enables manual map taps', async () => {
  const f = fixture();
  assert.equal(await f.screen().handlers.beginRoute({ routeStops: [A, B] }), false);
  const active = f.ks.getState().activeSession;
  assert.equal(active.routeStops.length, 2);
  assert.equal(f.ms.getState().active, null);
  const ui = f.screen();
  const controls = buttons(ui.render());
  assert.ok(controls.some(b => b.accessibilityLabel === 'Retry location'));
  assert.ok(controls.some(b => b.accessibilityLabel === 'Open Settings'));
  assert.ok(controls.some(b => b.accessibilityLabel === 'Continue with map taps'));
  assert.ok(!controls.some(b => b.accessibilityLabel === 'Drop a pin at my location'));
  ui.handlers.onMapPress({ latitude: 33.001, longitude: -96.002 });
  assert.equal(f.pins[0].point.placedBy, 'map_tap');
  assert.equal(f.pins[0].point.lat, 33.001);
  assert.equal(f.ks.getState().activeSession.id, active.id);
});
test('all denied/unavailable states expose recovery on active and inactive routes', () => {
  for (const active of [true, false]) for (const gate of ['denied', 'denied_forever', 'unavailable']) for (const os of ['ios', 'android', 'web']) {
    const f = fixture(); if (active) f.ks.getState().start(undefined, A);
    const ui = f.screen({ gate, Platform: { OS: os }, locationDenied: true });
    const controls = buttons(ui.render());
    assert.ok(controls.some(b => b.accessibilityLabel === 'Retry location'), `${active}/${gate}/${os}`);
    assert.equal(controls.some(b => b.accessibilityLabel === 'Open Settings'), os !== 'web');
    assert.ok(controls.some(b => b.accessibilityLabel === (active ? 'Continue with map taps' : 'Choose a route area on Map')));
  }
});
test('location retry preserves route and knocks and starts one owned mileage trip', async () => {
  const f = fixture(); await f.screen().handlers.beginRoute({ routeStops: [A, B] });
  f.ks.getState().logKnock({ ...A, outcome: 'no_answer' });
  const before = f.ks.getState().activeSession;
  f.allow(); f.setFix();
  await f.screen().handlers.retryLocation();
  const active = f.ks.getState().activeSession;
  assert.equal(active.id, before.id);
  assert.equal(active.routeStops, before.routeStops);
  assert.equal(active.knocks, before.knocks);
  assert.equal(active.mileageTripId, f.ms.getState().active.id);
  assert.equal(active.mileageTripOwned, true);
  const tripId = active.mileageTripId;
  await f.screen().handlers.retryLocation();
  assert.equal(f.ms.getState().active.id, tripId);
  assert.equal(f.watching, true);
});
test('retry adopts an existing manual trip without replacing it', async () => {
  const f = fixture(); await f.screen().handlers.beginRoute({ routeStops: [A, B] });
  const trip = f.ms.getState().start({ ...A, purpose: 'User trip' });
  f.allow(); f.setFix(); await f.screen().handlers.retryLocation();
  assert.equal(f.ms.getState().active.id, trip.id);
  assert.equal(f.ks.getState().activeSession.mileageTripOwned, false);
  f.tracker.endRoute();
  assert.equal(f.ms.getState().active.id, trip.id);
});
test('hard denial and failed watcher can be retried without losing the route', async () => {
  const f = fixture(); f.denyForever();
  await f.screen().handlers.beginRoute({ routeStops: [A, B] });
  const before = JSON.stringify(f.ks.getState().activeSession);
  const ui = f.screen({ gate: 'denied_forever' });
  await ui.handlers.retryLocation(); await ui.handlers.openSettings();
  assert.equal(f.requests, 0);
  assert.equal(f.settingsCalls, 1);
  assert.equal(JSON.stringify(f.ks.getState().activeSession), before);
  f.allow(); f.failWatcher(true); await f.screen().handlers.retryLocation();
  assert.equal(JSON.stringify(f.ks.getState().activeSession), before);
  f.failWatcher(false); await f.screen().handlers.retryLocation();
  assert.equal(f.watching, true);
});
test('denied location never files a stale GPS fix; missing map offers area selection', () => {
  const f = fixture(); f.ks.getState().start();
  const ui = f.screen({ fix: { ...A }, gate: 'denied', initialRegion: undefined });
  ui.handlers.onPinHere();
  assert.equal(f.pins.length, 0);
  const choose = buttons(ui.render()).find(b => b.accessibilityLabel === 'Choose a route area on Map');
  assert.ok(choose); choose.onPress();
  assert.equal(f.paths.at(-1), '/(tabs)/map');
});
test('granted permission cannot file a retained hour-old GPS fix', () => {
  const f = fixture(); f.ks.getState().start(undefined, A, { routeStops: [A, B], mileageTripId: 'keep-trip', mileageTripOwned: false });
  const before = JSON.stringify(f.ks.getState().activeSession);
  const ui = f.screen({ fix: { ...A, ts: Date.now() - 3_600_000 }, gate: 'granted', locationDenied: false });
  ui.handlers.onPinHere();
  assert.equal(f.pins.length, 0);
  assert.equal(f.toasts.at(-1).title, 'Waiting for fresh GPS');
  assert.ok(buttons(ui.render()).some(b => b.accessibilityLabel === 'Waiting for fresh GPS; tap a house on the map'));
  ui.handlers.onMapPress({ latitude: 33.001, longitude: -96.002 });
  assert.equal(f.pins[0].point.placedBy, 'map_tap');
  assert.equal(JSON.stringify(f.ks.getState().activeSession), before);
});
test('GPS freshness is inclusive at 30 seconds and rejects clock anomalies', () => {
  const { trip } = fixture();
  const now = 1_800_000_000_000;
  for (const [timestamp, accepted] of [
    [now, true], [now - 1, true], [now - 29_999, true], [now - 30_000, true],
    [now - 30_001, false], [now + 1, false], [now + 3_600_000, false],
    [NaN, false], [Infinity, false], [-Infinity, false], [0, false], [-1, false],
  ]) assert.equal(trip.isFreshKnockFix({ ts: timestamp }, now), accepted, String(timestamp));
  for (const clock of [NaN, Infinity, -Infinity, 0, -1]) assert.equal(trip.isFreshKnockFix({ ts: now }, clock), false);
  assert.equal(trip.isFreshKnockFix(null, now), false);
  assert.equal(trip.isFreshKnockFix({}, now), false);
});
test('fresh GPS still files the exact fix and ages out at action time', () => {
  const f = fixture(); f.ks.getState().start(undefined, A);
  const fix = { ...A, ts: Date.now() };
  const ui = f.screen({ fix, gate: 'granted', locationDenied: false, fixFresh: true });
  ui.handlers.onPinHere();
  assert.equal(f.pins.length, 1);
  assert.equal(f.pins[0].point.placedBy, 'gps');
  assert.equal(f.pins[0].point.lat, A.lat);
  assert.ok(buttons(ui.render()).some(b => b.accessibilityLabel === 'Drop a pin at my location'));
  fix.ts = Date.now() - 30_001; // displayed button still came from the fresh render
  ui.handlers.onPinHere();
  assert.equal(f.pins.length, 1, 'tap rechecks age instead of trusting rendered freshness');
  fix.ts = Date.now() + 3_600_000;
  ui.handlers.onPinHere();
  assert.equal(f.pins.length, 1, 'a clock reversal cannot make future data current');
});
test('native ingress never invents timestamps for initial or watched locations', async () => {
  for (const value of [undefined, null, String(Date.now())]) {
    const f = fixture();
    f.ks.getState().start(undefined, A, { routeStops: [A, B] });
    f.ks.getState().logKnock({ ...A, outcome: 'no_answer' });
    const original = f.ks.getState().activeSession;
    const nativeFix = { coords: { latitude: 33, longitude: -96, accuracy: 5 }, timestamp: value };
    f.allow(); f.setNativeFix(nativeFix);
    await f.tracker.startWatching();
    assert.equal(f.tracker.latestFix().ts, null);
    assert.equal(f.trip.isFreshKnockFix(f.tracker.latestFix()), false);
    f.screen({ gate: 'granted', fix: f.tracker.latestFix() }).handlers.onPinHere();
    assert.equal(f.pins.length, 0);
    const active = f.ks.getState().activeSession;
    assert.equal(active.id, original.id);
    assert.equal(active.routeStops, original.routeStops);
    assert.equal(active.knocks, original.knocks);
    // Timestamp validation belongs to GPS pins; existing mileage sample
    // collection and ownership are unchanged by the new gate.
    const mileageId = active.mileageTripId;
    assert.equal(mileageId, f.ms.getState().active.id);
    const observedAt = Date.now();
    f.emitNativeFix({ ...nativeFix, timestamp: observedAt });
    assert.equal(f.tracker.latestFix().ts, observedAt);
    f.screen({ gate: 'granted', fix: f.tracker.latestFix() }).handlers.onPinHere();
    assert.equal(f.pins.length, 1);
    assert.equal(f.pins[0].point.placedBy, 'gps');
    f.emitNativeFix(nativeFix);
    assert.equal(f.tracker.latestFix().ts, null, 'invalid callback cannot retain the prior valid timestamp');
    f.screen({ gate: 'granted', fix: f.tracker.latestFix() }).handlers.onPinHere();
    assert.equal(f.pins.length, 1);
    assert.equal(f.ks.getState().activeSession.mileageTripId, mileageId);
  }
});
(async () => {
  for (const { name, run } of tests) { await run(); console.log('PASS ' + name); }
  console.log(`${tests.length} route integrity scenarios passed (including 18 recovery UI states).`);
})().catch(error => { console.error(error); process.exitCode = 1; });
