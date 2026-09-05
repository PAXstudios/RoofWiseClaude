// node tests/sync-mutation-races.cjs [--baseline]
// Actual stores/sync services, held Supabase boundaries and isolated persisted
// storage. --baseline loads HEAD's sync/business persistence files for the
// original network-race cases; no user data/network touched.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const baseline = process.argv.includes('--baseline');
const baselineFiles = new Set(['lib/stores/leadStore.ts', 'lib/stores/inspectionSyncStore.ts', 'lib/services/leadSync.ts', 'lib/services/inspectionSync.ts', 'lib/stores/inspectionStore.ts', 'lib/services/inspectionPersistence.ts']);
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const fixedTime = Date.parse('2026-09-04T12:00:00.000Z');
class SameMillisecond extends Date { constructor(...args) { super(...(args.length ? args : [fixedTime])); } static now() { return fixedTime; } }
const compiled = new Map();
async function fixture(kind, disk = new Map(), remote = new Map(), options = {}) {
  const cache = new Map(), holds = new Map(), calls = [], failures = new Map();
  let backupText;
  const readHolds = new Map(), writeHolds = new Map(), readCounts = new Map(), writeCounts = new Map();
  const readFailures = new Map(Object.entries(options.readFailures ?? {}));
  const writeFailures = new Map(Object.entries(options.writeFailures ?? {}));
  if (options.holdRead) readHolds.set(options.holdRead, { ...deferred(), entered: deferred() });
  const initialRead = readHolds.get(options.holdRead);
  if (options.holdWrite) writeHolds.set(options.holdWrite, { ...deferred(), entered: deferred() });
  const initialWrite = writeHolds.get(options.holdWrite);
  const storage = options.asyncPersistence ? {
    getItem: async key => {
      readCounts.set(key, (readCounts.get(key) ?? 0) + 1);
      const snapshot = disk.get(key) ?? null;
      const hold = readHolds.get(key);
      if (hold) { readHolds.delete(key); hold.entered.resolve(); await hold.promise; }
      if (readFailures.get(key) > 0) { readFailures.set(key, readFailures.get(key) - 1); throw new Error('Injected storage read failure'); }
      await Promise.resolve(); return snapshot;
    },
    setItem: async (key, value) => {
      await Promise.resolve(); writeCounts.set(key, (writeCounts.get(key) ?? 0) + 1);
      const hold = writeHolds.get(key);
      if (hold) { writeHolds.delete(key); hold.entered.resolve(); await hold.promise; }
      if (writeFailures.get(key) > 0) { writeFailures.set(key, writeFailures.get(key) - 1); throw new Error('Injected storage write failure'); }
      disk.set(key, value);
    },
    removeItem: async key => { await Promise.resolve(); disk.delete(key); },
  } : { getItem: key => disk.get(key) ?? null, setItem: (key, value) => disk.set(key, value), removeItem: key => disk.delete(key) };
  async function request(phase, rows, ids) {
    calls.push({ phase, rows: rows && plain(rows), ids });
    const read = phase === 'peek' ? plain([...remote.values()].filter(row => ids.includes(row.id))) : phase === 'pull' ? plain([...remote.values()]) : null;
    const hold = holds.get(phase);
    if (hold) { holds.delete(phase); hold.entered.resolve(); await hold.promise; }
    if (failures.has(phase)) { const error = failures.get(phase); failures.delete(phase); return { error: { message: error } }; }
    if (phase === 'upsert') for (const row of rows) remote.set(row.id, plain(row));
    if (phase === 'delete') for (const id of ids) remote.delete(id);
    return { data: read, error: null };
  }
  const supabase = { from: () => {
    let deleting = false;
    const query = {
      select: () => query, eq: () => query, order: () => query,
      delete: () => { deleting = true; return query; },
      in: (_, ids) => request(deleting ? 'delete' : 'peek', null, ids),
      upsert: rows => request('upsert', rows), limit: () => request('pull'),
    };
    return query;
  } };
  const stubs = {
    'lib/supabase.ts': { supabase },
    'lib/auth/authStore.ts': { useAuthStore: { getState: () => ({ user: { id: 'test-user' } }) } },
    'lib/services/propertyRecord.ts': { roofAgePrefill: () => ({}) },
    'lib/services/propertyIntel.ts': { squaresFacing: () => undefined },
    'lib/services/inspectionPersistence.ts': { inspectionStorage: storage },
    'lib/services/automations.ts': { emitPipelineEvent: () => {} },
    'lib/stores/activityStore.ts': { useActivityStore: { getState: () => ({ log: () => {} }) } },
  };
  if (options.asyncPersistence) delete stubs['lib/services/inspectionPersistence.ts'];
  function load(file) {
    if (stubs[file]) return stubs[file];
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    if (!compiled.has(file)) {
      const source = baseline && baselineFiles.has(file)
        ? execFileSync('git', ['show', 'HEAD:' + file], { cwd: root, encoding: 'utf8' })
        : fs.readFileSync(path.join(root, file), 'utf8');
      compiled.set(file, ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText);
    }
    const resolve = id => {
      if (id === '@react-native-async-storage/async-storage') return storage;
      if (id === 'zustand' || id === 'zustand/middleware') return require(id);
      if (id === 'expo-file-system/legacy') return { EncodingType: { UTF8: 'utf8' }, readAsStringAsync: async () => backupText };
      if (id === 'expo-sharing') return {};
      if (id.startsWith('@/')) return load(id.slice(2) + '.ts');
      if (id.startsWith('.')) return load(path.normalize(path.join(path.dirname(file), id)) + '.ts');
      throw new Error('Unexpected dependency ' + id);
    };
    new Function('exports', 'require', 'Date', '__DEV__', compiled.get(file))(exports, resolve, SameMillisecond, false);
    return exports;
  }
  const store = load(kind === 'inspection' ? 'lib/stores/inspectionStore.ts' : 'lib/stores/leadStore.ts')[kind === 'inspection' ? 'useInspectionStore' : 'useLeadStore'];
  const syncStore = kind === 'inspection' ? load('lib/stores/inspectionSyncStore.ts').useInspectionSyncStore : store;
  const service = load(kind === 'inspection' ? 'lib/services/inspectionSync.ts' : 'lib/services/leadSync.ts');
  if (kind === 'inspection') service.startInspectionWatcher();
  if (!options.startup) {
    await store.persist.rehydrate();
    await syncStore.persist.rehydrate();
  }
  const sync = kind === 'inspection' ? service.syncInspections : service.syncLeads;
  const records = () => kind === 'inspection' ? store.getState().inspections : store.getState().leads;
  const pending = id => kind === 'inspection' ? !!syncStore.getState().dirty[id] : records().find(r => r.id === id)?.syncStatus !== 'synced';
  const controls = {
    kind, store, syncStore, sync, records, pending, disk, remote, calls, initialRead, initialWrite, readCounts, writeCounts,
    holdRead: key => { const hold = { ...deferred(), entered: deferred() }; readHolds.set(key, hold); return hold; },
    holdWrite: key => { const hold = { ...deferred(), entered: deferred() }; writeHolds.set(key, hold); return hold; },
    failStorageWrites: (key, count) => writeFailures.set(key, count),
    restore: blob => {
      backupText = JSON.stringify(blob);
      for (const name of ['Proposal', 'ProposalLink', 'Estimate', 'ServiceArea', 'StormAlert', 'KnockSession', 'Mileage', 'Activity', 'Corrections', 'TrainingQueue', 'InspectorProfile']) {
        const file = name[0].toLowerCase() + name.slice(1) + 'Store';
        stubs['lib/stores/' + file + '.ts'] = { ['use' + name + 'Store']: { setState: () => {}, getState: () => ({ trips: [] }) } };
      }
      return load('lib/services/backup.ts').restoreFromUri('isolated-backup.json');
    },
    create: () => store.getState().create({ customerName: 'Original', address: 'Test address', material: 'asphalt_architectural', stage: 'new' }),
    edit: (id, name = 'Newer edit') => store.getState().updateDetails(id, { customerName: name }),
    remove: id => store.getState().remove(id),
    revision: id => syncStore.getState().revisions?.[id] ?? 0,
    hold: phase => { const h = { ...deferred(), entered: deferred() }; holds.set(phase, h); return h; },
    fail: (phase, error = 'Injected offline failure') => failures.set(phase, error),
    seedRemote: (record, newer = false) => remote.set(record.id, kind === 'inspection'
      ? { id: record.id, payload: { ...plain(record), customerName: 'Remote' }, report_id: record.reportId, updated_at: newer ? '2026-09-04T13:00:00Z' : record.createdAt }
      : { id: record.id, customer_name: 'Remote', address: record.address, stage: 'new', created_at: record.createdAt, updated_at: newer ? '2026-09-04T13:00:00Z' : record.createdAt }),
  };
  options.beforeHydration?.(controls);
  return controls;
}
let passed = 0, failed = 0;
async function test(name, run) {
  let timeout;
  try {
    await Promise.race([run(), new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Unreached network boundary')), 5000); })]);
    console.log('PASS ' + name); passed++;
  }
  catch (error) { console.error('FAIL ' + name + '\n' + error.stack); failed++; }
  finally { clearTimeout(timeout); }
}
async function main() {
  for (const kind of ['inspection', 'lead']) {
    for (const phase of ['peek', 'upsert', 'pull']) {
      for (const mutation of ['edit', 'delete']) {
        await test(`${kind}: ${mutation} during ${phase}, same millisecond`, async () => {
          const f = await fixture(kind); const record = f.create(); f.seedRemote(record);
          const hold = f.hold(phase); const run = f.sync(); await hold.entered.promise;
          const revision = f.revision(record.id);
          if (mutation === 'edit') f.edit(record.id); else f.remove(record.id);
          hold.resolve(); await run;
          if (mutation === 'edit') {
            assert.equal(f.records().find(r => r.id === record.id)?.customerName, 'Newer edit', 'in-flight response must preserve latest local payload');
            assert.equal(f.pending(record.id), true, 'newer revision must remain pending');
            assert.ok(f.revision(record.id) > revision, 'same timestamp still advances mutation revision');
            await f.sync();
            assert.equal(f.pending(record.id), false);
            const row = f.remote.get(record.id);
            assert.equal(kind === 'inspection' ? row.payload.customerName : row.customer_name, 'Newer edit');
          } else {
            assert.equal(f.records().some(r => r.id === record.id), false, 'deletion cannot be resurrected by in-flight pull');
            assert.ok(f.revision(record.id) > revision);
            await f.sync();
            assert.equal(f.records().some(r => r.id === record.id), false, 'delete suppression survives another run');
            if (kind === 'inspection') assert.equal(f.remote.has(record.id), false);
          }
        });
      }
    }
    for (const mutation of ['edit', 'delete']) {
      await test(`${kind}: newer remote peek cannot replace concurrent ${mutation}`, async () => {
        const f = await fixture(kind); const record = f.create(); f.seedRemote(record, true);
        const hold = f.hold('peek'); const run = f.sync(); await hold.entered.promise;
        if (mutation === 'edit') f.edit(record.id); else f.remove(record.id);
        hold.resolve(); const result = await run;
        assert.equal(result.conflicts, 0, 'stale snapshot cannot acknowledge a conflict for a newer mutation');
        assert.equal(f.records().find(r => r.id === record.id)?.customerName, mutation === 'edit' ? 'Newer edit' : undefined);
        if (mutation === 'edit') assert.equal(f.pending(record.id), true);
      });
    }
    await test(`${kind}: unchanged clean path and legitimate remote conflict`, async () => {
      const f = await fixture(kind); const record = f.create();
      assert.equal((await f.sync()).pushed, 1); assert.equal(f.pending(record.id), false);
      assert.equal((await f.sync()).pushed, 0);
      f.edit(record.id); f.seedRemote(record, true);
      assert.equal((await f.sync()).conflicts, 1);
      assert.equal(f.records().find(r => r.id === record.id).customerName, 'Remote');
      assert.equal(f.pending(record.id), false);
    });
    await test(`${kind}: concurrent callers share one run and latest edit retries after failure`, async () => {
      const f = await fixture(kind); const record = f.create();
      const hold = f.hold('upsert'); f.fail('upsert'); const run = f.sync();
      assert.equal(f.sync(), run); await hold.entered.promise; f.edit(record.id); hold.resolve();
      assert.match((await run).error, /offline/); assert.equal(f.pending(record.id), true);
      assert.equal(f.calls.filter(c => c.phase === 'upsert').length, 1);
      assert.equal((await f.sync()).pushed, 1); assert.equal(f.pending(record.id), false);
    });
    for (const phase of ['peek', 'pull']) {
      await test(`${kind}: ${phase} failure retains concurrent edit for retry`, async () => {
        const f = await fixture(kind); const record = f.create();
        const hold = f.hold(phase); f.fail(phase); const run = f.sync();
        await hold.entered.promise; f.edit(record.id); hold.resolve();
        assert.match((await run).error, /offline/); assert.equal(f.pending(record.id), true);
        await f.sync(); assert.equal(f.pending(record.id), false);
      });
    }
    for (const mutation of ['edit', 'delete']) {
      await test(`${kind}: pending ${mutation} and monotonic revision survive process restart`, async () => {
        const f = await fixture(kind); const record = f.create();
        const hold = f.hold('upsert'); const run = f.sync(); await hold.entered.promise;
        if (mutation === 'edit') f.edit(record.id); else f.remove(record.id);
        hold.resolve(); await run;
        const revision = f.revision(record.id);
        const restored = await fixture(kind, f.disk, f.remote);
        assert.equal(restored.revision(record.id), revision);
        if (mutation === 'edit') {
          assert.equal(restored.records().find(r => r.id === record.id).customerName, 'Newer edit');
          assert.equal(restored.pending(record.id), true);
          restored.edit(record.id, 'After restart');
          assert.ok(restored.revision(record.id) > revision);
          await restored.sync(); assert.equal(restored.pending(record.id), false);
        } else {
          await restored.sync(); assert.equal(restored.records().some(r => r.id === record.id), false);
        }
      });
    }
  }
  await test('inspection: recreation during remote DELETE remains dirty and uploads', async () => {
    const f = await fixture('inspection'); const record = f.create(); await f.sync(); f.remove(record.id);
    const hold = f.hold('delete'); const run = f.sync(); await hold.entered.promise;
    f.store.getState().create({ id: record.id, customerName: 'Recreated', address: 'Test address', material: 'asphalt_architectural' });
    hold.resolve(); await run; await f.sync();
    assert.equal(f.records().find(r => r.id === record.id).customerName, 'Recreated');
    assert.equal(f.remote.get(record.id).payload.customerName, 'Recreated');
  });
  await test('inspection: delete/recreate/delete during remote DELETE cannot acknowledge the new removal', async () => {
    const f = await fixture('inspection'); const record = f.create(); await f.sync(); f.remove(record.id);
    const hold = f.hold('delete'); const run = f.sync(); await hold.entered.promise;
    f.store.getState().create({ id: record.id, customerName: 'Recreated', address: 'Test address', material: 'asphalt_architectural' });
    f.remove(record.id); hold.resolve(); await run;
    assert.equal(f.syncStore.getState().deleted.includes(record.id), true);
    await f.sync(); assert.equal(f.syncStore.getState().deleted.includes(record.id), false);
    assert.equal(f.records().some(r => r.id === record.id), false);
  });
  await test('inspection: failed remote DELETE stays pending across restart', async () => {
    const f = await fixture('inspection'); const record = f.create(); await f.sync(); f.remove(record.id);
    f.fail('delete'); assert.match((await f.sync()).error, /offline/);
    const restored = await fixture('inspection', f.disk, f.remote);
    assert.equal(restored.syncStore.getState().deleted.includes(record.id), true);
    await restored.sync(); assert.equal(restored.remote.has(record.id), false);
  });
  await test('lead: missing-column retry keeps the original payload token', async () => {
    const f = await fixture('lead'); const record = f.create();
    const hold = f.hold('upsert'); f.fail('upsert', 'inspection_id missing'); const run = f.sync();
    await hold.entered.promise; f.edit(record.id); hold.resolve(); await run;
    assert.equal(f.pending(record.id), true);
    assert.equal(f.records()[0].customerName, 'Newer edit');
    assert.equal(f.calls.filter(c => c.phase === 'upsert').length, 2);
    await f.sync(); assert.equal(f.remote.get(record.id).customer_name, 'Newer edit');
  });
  await test('lead: every local cloud mutator advances its token and property enrichment survives remote apply', async () => {
    const f = await fixture('lead'); const record = f.create();
    const actions = [
      () => f.edit(record.id),
      () => f.store.getState().setStage(record.id, 'contacted'),
      () => f.store.getState().setFollowUp(record.id, '2026-09-05T12:00:00Z'),
      () => f.store.getState().setStormMatch(record.id, undefined),
      () => f.store.getState().linkInspection(record.id, 'job'),
      () => f.store.getState().upsert({ ...f.records()[0], customerName: 'Upserted' }),
    ];
    for (const action of actions) { const revision = f.revision(record.id); action(); assert.ok(f.revision(record.id) > revision); }
    f.store.getState().setPropertyRecord(record.id, { address: 'Cached property' });
    await f.sync(); f.seedRemote(record, true); await f.sync();
    assert.equal(f.records()[0].propertyRecord.address, 'Cached property');
  });
  await test('lead: backup replacement during upload retains imports and suppresses removals', async () => {
    const f = await fixture('lead'); const record = f.create();
    const other = f.create(); const hold = f.hold('upsert'); const run = f.sync(); await hold.entered.promise;
    f.store.getState().replaceAll([{ ...record, customerName: 'Restored from backup', syncStatus: 'synced' }]);
    hold.resolve(); await run;
    assert.equal(f.records().length, 1); assert.equal(f.records()[0].customerName, 'Restored from backup');
    assert.equal(f.pending(record.id), true); assert.ok(f.syncStore.getState().deleted[other.id]);
    await f.sync(); assert.equal(f.remote.get(record.id).customer_name, 'Restored from backup');
  });
  await test('legacy persisted leads and inspection delete queue migrate without record loss', async () => {
    const lead = { id: 'legacy', customerName: 'Legacy', address: 'Saved address', stage: 'new', createdAt: '2026-09-04T11:00:00Z', syncStatus: 'pending', customerPhone: '555-0101' };
    const disk = new Map([
      ['roofwise.leads.v1', JSON.stringify({ version: 1, state: { leads: [lead] } })],
      ['roofwise.inspectionSync.v1', JSON.stringify({ version: 0, state: { dirty: {}, deleted: ['removed'], lastSyncAt: null } })],
    ]);
    const leads = await fixture('lead', disk);
    assert.equal(JSON.stringify(leads.records()[0]), JSON.stringify(lead));
    await leads.sync(); assert.equal(leads.pending(lead.id), false);
    leads.edit(lead.id); assert.equal(leads.revision(lead.id), 1);
    const inspections = await fixture('inspection', disk);
    await inspections.sync();
    assert.equal(inspections.syncStore.getState().deleted.length, 0);
    assert.ok(inspections.syncStore.getState().tombstones.removed, 'acknowledged legacy delete keeps local suppression');
  });
  // The remaining probes exercise the added hydration/checkpoint interfaces.
  // The original network-race matrix above runs unchanged against HEAD.
  if (baseline) {
    console.log(`${passed} passed, ${failed} failed (baseline expected to fail)`);
    if (failed) process.exitCode = 1;
    return;
  }
  for (const kind of ['inspection', 'lead']) {
    const key = kind === 'inspection' ? 'roofwise.inspectionSync.v1' : 'roofwise.leads.v1';
    for (const mutation of ['edit', 'delete']) {
      await test(`${kind}: held initial metadata read preserves startup ${mutation}, gates sync and persists restart`, async () => {
        const f = await fixture(kind, new Map(), new Map(), { startup: true, asyncPersistence: true, holdRead: key });
        await f.initialRead.entered.promise;
        const record = f.create(); f.seedRemote(record); f.edit(record.id);
        if (mutation === 'delete') f.remove(record.id);
        const revision = f.revision(record.id);
        const network = f.hold(mutation === 'edit' ? 'peek' : 'pull');
        const sync = f.sync();
        const overlapA = f.syncStore.persist.rehydrate();
        const overlapB = f.syncStore.persist.rehydrate();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(f.calls.length, 0, 'no cloud access while local hydration is unresolved');
        assert.equal(f.readCounts.get(key), 1, 'overlapping hydration cannot replace the active read baseline');
        assert.equal(f.writeCounts.get(key) ?? 0, 0, 'incomplete startup snapshots are not written over unread records');
        f.initialRead.resolve(); await network.entered.promise;
        assert.ok(f.revision(record.id) >= revision, 'delayed hydration cannot reset the live revision');
        assert.equal(f.records().find(r => r.id === record.id)?.customerName, mutation === 'edit' ? 'Newer edit' : undefined);
        if (mutation === 'edit') assert.equal(f.pending(record.id), true);
        network.resolve(); await Promise.all([sync, overlapA, overlapB]);
        await f.store.persist.rehydrate(); await f.syncStore.persist.rehydrate();
        const restarted = await fixture(kind, f.disk, f.remote, { asyncPersistence: true });
        assert.ok(restarted.revision(record.id) >= revision);
        assert.equal(restarted.records().find(r => r.id === record.id)?.customerName, mutation === 'edit' ? 'Newer edit' : undefined);
        await restarted.sync();
        assert.equal(restarted.records().find(r => r.id === record.id)?.customerName, mutation === 'edit' ? 'Newer edit' : undefined);
        assert.ok(f.readCounts.get(key) < 10 && f.writeCounts.get(key) < 20, 'hydration/persistence does not loop');
      });
    }
    await test(`${kind}: explicit delayed rehydration preserves live edit and older saved neighbors`, async () => {
      const f = await fixture(kind, new Map(), new Map(), { asyncPersistence: true });
      const first = f.create(); const neighbor = f.create(); await f.sync();
      await f.store.persist.rehydrate(); await f.syncStore.persist.rehydrate();
      const hold = f.holdRead(key); const hydration = f.syncStore.persist.rehydrate(); await hold.entered.promise;
      f.edit(first.id); const revision = f.revision(first.id);
      hold.resolve(); await hydration;
      assert.equal(f.records().find(r => r.id === first.id).customerName, 'Newer edit');
      assert.equal(f.records().some(r => r.id === neighbor.id), true);
      assert.ok(f.revision(first.id) >= revision); assert.equal(f.pending(first.id), true);
      const restarted = await fixture(kind, f.disk, f.remote, { asyncPersistence: true });
      assert.equal(restarted.records().find(r => r.id === first.id).customerName, 'Newer edit');
      assert.equal(restarted.pending(first.id), true);
    });
  }
  await test('inspection: watcher distinguishes restored clean records from startup mutations during business hydration', async () => {
    const original = await fixture('inspection'); const saved = original.create(); await original.sync();
    await original.store.persist.rehydrate(); await original.syncStore.persist.rehydrate();
    const f = await fixture('inspection', original.disk, original.remote, {
      startup: true, asyncPersistence: true, holdRead: 'roofwise.inspections.v1',
    });
    await f.initialRead.entered.promise;
    // Use an explicit ID to avoid the test's deliberately frozen ID clock.
    const added = f.store.getState().create({ id: 'startup-new', customerName: 'Startup', address: 'Another address', material: 'asphalt_architectural' });
    f.edit(added.id); const sync = f.sync();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.calls.length, 0);
    f.initialRead.resolve(); await sync;
    assert.equal(f.records().find(r => r.id === saved.id).customerName, 'Original');
    assert.equal(f.records().find(r => r.id === added.id).customerName, 'Newer edit');
    const uploads = f.calls.filter(c => c.phase === 'upsert').flatMap(c => c.rows);
    assert.equal(uploads.some(row => row.id === saved.id), false, 'restored clean records must not be stamped as fresh user edits');
    assert.equal(uploads.some(row => row.id === added.id), true);
  });
  for (const kind of ['inspection', 'lead']) {
    await test(`${kind}: create/edit before the first hydration microtask is preserved`, async () => {
      let id;
      const f = await fixture(kind, new Map(), new Map(), { asyncPersistence: true, startup: true, beforeHydration: controls => {
        const record = controls.create(); id = record.id; controls.edit(id);
      } });
      await f.sync();
      assert.equal(f.records().find(r => r.id === id)?.customerName, 'Newer edit');
      assert.ok(f.revision(id) >= 2);
    });
    await test(`${kind}: startup mutation advances beyond a larger revision in delayed storage`, async () => {
      const seed = await fixture(kind); const saved = seed.create();
      for (let i = 0; i < 8; i++) seed.edit(saved.id, 'Saved revision');
      await seed.sync(); await seed.store.persist.rehydrate(); await seed.syncStore.persist.rehydrate();
      const prior = seed.revision(saved.id);
      const key = kind === 'inspection' ? 'roofwise.inspectionSync.v1' : 'roofwise.leads.v1';
      const f = await fixture(kind, seed.disk, seed.remote, { asyncPersistence: true, startup: true, holdRead: key });
      await f.initialRead.entered.promise;
      if (kind === 'lead') f.store.getState().upsert({ ...saved, customerName: 'Startup replacement' });
      else {
        f.store.getState().create({ id: saved.id, customerName: 'Startup', address: saved.address, material: 'asphalt_architectural' });
        f.edit(saved.id, 'Startup replacement');
      }
      f.initialRead.resolve(); await f.sync();
      assert.ok(f.revision(saved.id) > prior);
      assert.equal(f.records().find(r => r.id === saved.id).customerName, 'Startup replacement');
    });
    for (const fault of ['readFailures', 'writeFailures']) {
      await test(`${kind}: initial storage ${fault} blocks cloud work and safely retries live startup changes`, async () => {
        const key = kind === 'inspection' ? 'roofwise.inspectionSync.v1' : 'roofwise.leads.v1';
        let id;
        const f = await fixture(kind, new Map(), new Map(), { asyncPersistence: true, startup: true,
          [fault]: { [key]: 2 }, beforeHydration: controls => { id = controls.create().id; controls.edit(id); },
        });
        const failed = await f.sync();
        assert.ok(failed.error); assert.equal(f.calls.length, 0);
        assert.equal(f.records().find(r => r.id === id).customerName, 'Newer edit');
        const result = await f.sync(); assert.equal(result.error, undefined);
        assert.equal(f.records().find(r => r.id === id).customerName, 'Newer edit');
        assert.equal(f.pending(id), false);
      });
    }
  }
  await test('inspection: startup create/remove of an unread saved ID cannot resurrect on business hydration', async () => {
    const original = await fixture('inspection'); const saved = original.create(); await original.sync();
    await original.store.persist.rehydrate(); await original.syncStore.persist.rehydrate();
    const f = await fixture('inspection', original.disk, original.remote, { asyncPersistence: true, startup: true, holdRead: 'roofwise.inspections.v1' });
    await f.initialRead.entered.promise;
    f.store.getState().create({ id: saved.id, customerName: 'Temporary', address: saved.address, material: 'asphalt_architectural' });
    f.remove(saved.id);
    f.initialRead.resolve(); await f.sync();
    assert.equal(f.records().some(r => r.id === saved.id), false);
  });
  await test('inspection: held business read never overwrites unread neighbors before merge or simulated restart', async () => {
    const seed = await fixture('inspection'); const saved = seed.create(); await seed.sync();
    await seed.store.persist.rehydrate(); await seed.syncStore.persist.rehydrate();
    const before = seed.disk.get('roofwise.inspections.v1');
    const f = await fixture('inspection', seed.disk, seed.remote, { asyncPersistence: true, startup: true, holdRead: 'roofwise.inspections.v1' });
    await f.initialRead.entered.promise;
    f.store.getState().create({ id: 'startup-business', customerName: 'Startup', address: 'New address', material: 'asphalt_architectural' });
    f.edit('startup-business');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.disk.get('roofwise.inspections.v1'), before, 'unread saved collection remains intact until accepted merge');
    const restartedBeforeRelease = await fixture('inspection', new Map(f.disk), new Map(f.remote), { asyncPersistence: true });
    assert.equal(restartedBeforeRelease.records().find(r => r.id === saved.id)?.customerName, 'Original');
    f.initialRead.resolve(); await f.sync(); await f.store.persist.rehydrate();
    const restarted = await fixture('inspection', new Map(f.disk), new Map(f.remote), { asyncPersistence: true });
    assert.equal(restarted.records().find(r => r.id === saved.id)?.customerName, 'Original');
    assert.equal(restarted.records().find(r => r.id === 'startup-business')?.customerName, 'Newer edit');
  });
  await test('inspection: failed initial business read keeps the saved collection and retries the merged startup record', async () => {
    const seed = await fixture('inspection'); const saved = seed.create(); await seed.sync();
    await seed.store.persist.rehydrate(); await seed.syncStore.persist.rehydrate();
    const before = seed.disk.get('roofwise.inspections.v1');
    const f = await fixture('inspection', seed.disk, seed.remote, { asyncPersistence: true, startup: true,
      readFailures: { 'roofwise.inspections.v1': 2 }, beforeHydration: controls => {
        controls.store.getState().create({ id: 'startup-failure', customerName: 'Retained', address: 'New address', material: 'asphalt_architectural' });
      },
    });
    assert.ok((await f.sync()).error); assert.equal(f.calls.length, 0);
    assert.equal(f.disk.get('roofwise.inspections.v1'), before);
    assert.equal((await f.sync()).error, undefined);
    assert.equal(f.records().find(r => r.id === saved.id)?.customerName, 'Original');
    assert.equal(f.records().find(r => r.id === 'startup-failure')?.customerName, 'Retained');
  });
  await test('inspection: removing an unread saved ID persists deletion intent and cannot resurrect across restart', async () => {
    const seed = await fixture('inspection'); const saved = seed.create(); await seed.sync();
    await seed.store.persist.rehydrate(); await seed.syncStore.persist.rehydrate();
    const f = await fixture('inspection', seed.disk, seed.remote, { asyncPersistence: true, startup: true, holdRead: 'roofwise.inspections.v1' });
    await f.initialRead.entered.promise;
    assert.equal(f.records().length, 0); f.remove(saved.id);
    await f.syncStore.persist.rehydrate();
    assert.ok(f.syncStore.getState().tombstones[saved.id]);
    const restarted = await fixture('inspection', new Map(f.disk), new Map(f.remote), { asyncPersistence: true });
    assert.equal(restarted.records().some(r => r.id === saved.id), false);
    await restarted.sync(); assert.equal(restarted.records().some(r => r.id === saved.id), false);
    f.initialRead.resolve(); await f.sync(); assert.equal(f.records().some(r => r.id === saved.id), false);
  });
  for (const [kind, key] of [['inspection', 'roofwise.inspections.v1'], ['inspection', 'roofwise.inspectionSync.v1'], ['lead', 'roofwise.leads.v1']]) {
    await test(`${kind}: sync drains hydration queued after waiting began (${key})`, async () => {
      const f = await fixture(kind, new Map(), new Map(), { asyncPersistence: true, startup: true, holdRead: key });
      await f.initialRead.entered.promise;
      f.create(); const sync = f.sync();
      const next = f.holdRead(key);
      const target = key === 'roofwise.inspections.v1' ? f.store : f.syncStore;
      const queued = target.persist.rehydrate();
      f.initialRead.resolve(); await next.entered.promise;
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(target.persist.hasHydrated(), false);
      assert.equal(f.calls.length, 0, 'queued hydration remains part of the sync barrier');
      next.resolve(); await Promise.all([queued, sync]);
      assert.ok(f.calls.length > 0); assert.ok(target.persist.hasHydrated());
    });
  }
  for (const kind of ['inspection', 'lead']) {
    await test(`${kind}: empty backup waits for unread saved collection and persists its removal`, async () => {
      const seed = await fixture(kind); const saved = seed.create(); await seed.sync();
      await seed.store.persist.rehydrate(); await seed.syncStore.persist.rehydrate();
      const key = kind === 'inspection' ? 'roofwise.inspections.v1' : 'roofwise.leads.v1';
      const f = await fixture(kind, seed.disk, seed.remote, { asyncPersistence: true, startup: true, holdRead: key });
      await f.initialRead.entered.promise;
      let restored = false;
      const restore = f.restore({ version: 1, inspections: [], leads: [] }).then(() => { restored = true; });
      await new Promise(resolve => setImmediate(resolve)); assert.equal(restored, false);
      f.initialRead.resolve(); await restore;
      assert.equal(f.records().length, 0);
      assert.equal(JSON.parse(f.disk.get(key)).state[kind === 'inspection' ? 'inspections' : 'leads'].length, 0);
      await f.store.persist.rehydrate(); await f.syncStore.persist.rehydrate(); await f.sync();
      assert.equal(f.records().some(r => r.id === saved.id), false);
      const restarted = await fixture(kind, new Map(f.disk), new Map(f.remote), { asyncPersistence: true });
      await restarted.sync(); assert.equal(restarted.records().some(r => r.id === saved.id), false);
    });
  }
  await test('inspection: one failed merged business checkpoint retries without losing startup payload or saved neighbor', async () => {
    const seed = await fixture('inspection'); const saved = seed.create(); await seed.sync();
    await seed.store.persist.rehydrate(); await seed.syncStore.persist.rehydrate();
    const f = await fixture('inspection', seed.disk, seed.remote, { asyncPersistence: true, startup: true,
      writeFailures: { 'roofwise.inspections.v1': 1 }, beforeHydration: controls => {
        controls.store.getState().create({ id: 'retry-business', customerName: 'Retained startup', address: 'New address', material: 'asphalt_architectural' });
      },
    });
    const result = await f.sync();
    assert.equal(result.error, undefined); assert.equal(result.pushed, 1, 'retry must upload the retained startup record, not report an empty success');
    assert.equal(f.records().find(r => r.id === saved.id)?.customerName, 'Original');
    assert.equal(f.records().find(r => r.id === 'retry-business')?.customerName, 'Retained startup');
    const persisted = JSON.parse(f.disk.get('roofwise.inspections.v1')).state.inspections;
    assert.equal(persisted.some(r => r.id === saved.id), true); assert.equal(persisted.some(r => r.id === 'retry-business'), true);
    assert.equal(f.pending('retry-business'), false);
  });
  await test('inspection: sync waits for accepted business checkpoint and edits queued behind that write', async () => {
    const f = await fixture('inspection', new Map(), new Map(), { asyncPersistence: true, startup: true, holdWrite: 'roofwise.inspections.v1' });
    await f.initialWrite.entered.promise;
    const added = f.create(); f.edit(added.id); const run = f.sync();
    await new Promise(resolve => setImmediate(resolve)); assert.equal(f.calls.length, 0);
    f.initialWrite.resolve(); await run;
    assert.equal(JSON.parse(f.disk.get('roofwise.inspections.v1')).state.inspections.find(r => r.id === added.id).customerName, 'Newer edit');
  });
  await test('inspection: backup completion waits for durable deletion metadata and restart cannot pull the deleted job', async () => {
    const f = await fixture('inspection', new Map(), new Map(), { asyncPersistence: true });
    const saved = f.create(); await f.sync(); await f.store.persist.rehydrate(); await f.syncStore.persist.rehydrate();
    const hold = f.holdWrite('roofwise.inspectionSync.v1'); let complete = false;
    const restore = f.restore({ version: 1, inspections: [], leads: [] }).then(() => { complete = true; });
    await hold.entered.promise; await new Promise(resolve => setImmediate(resolve)); assert.equal(complete, false);
    hold.resolve(); await restore;
    assert.ok(JSON.parse(f.disk.get('roofwise.inspectionSync.v1')).state.tombstones[saved.id]);
    const restarted = await fixture('inspection', new Map(f.disk), new Map(f.remote), { asyncPersistence: true });
    await restarted.sync(); assert.equal(restarted.records().some(r => r.id === saved.id), false);
  });
  await test('inspection: backup metadata persistence failure reports error and an explicit retry persists suppression', async () => {
    const f = await fixture('inspection', new Map(), new Map(), { asyncPersistence: true });
    const saved = f.create(); await f.sync(); await f.store.persist.rehydrate(); await f.syncStore.persist.rehydrate();
    f.failStorageWrites('roofwise.inspectionSync.v1', 20);
    await assert.rejects(f.restore({ version: 1, inspections: [], leads: [] }), /could not be saved/);
    f.failStorageWrites('roofwise.inspectionSync.v1', 0);
    await f.restore({ version: 1, inspections: [], leads: [] });
    const restarted = await fixture('inspection', new Map(f.disk), new Map(f.remote), { asyncPersistence: true });
    await restarted.sync(); assert.equal(restarted.records().some(r => r.id === saved.id), false);
  });
  for (const first of ['business', 'metadata']) {
    await test(`inspection: cross-store barrier rechecks ${first === 'business' ? 'metadata' : 'business'} hydration queued during the other read`, async () => {
      const f = await fixture('inspection', new Map(), new Map(), { asyncPersistence: true }); f.create();
      const firstKey = first === 'business' ? 'roofwise.inspections.v1' : 'roofwise.inspectionSync.v1';
      const nextKey = first === 'business' ? 'roofwise.inspectionSync.v1' : 'roofwise.inspections.v1';
      const firstStore = first === 'business' ? f.store : f.syncStore;
      const nextStore = first === 'business' ? f.syncStore : f.store;
      const heldFirst = f.holdRead(firstKey); const firstHydration = firstStore.persist.rehydrate(); await heldFirst.entered.promise;
      const sync = f.sync();
      await new Promise(resolve => setImmediate(resolve));
      const heldNext = f.holdRead(nextKey); const nextHydration = nextStore.persist.rehydrate();
      heldFirst.resolve(); await heldNext.entered.promise;
      await new Promise(resolve => setImmediate(resolve)); assert.equal(f.calls.length, 0, 'neither store may queue a hidden read behind the combined barrier');
      heldNext.resolve(); await Promise.all([firstHydration, nextHydration, sync]);
      assert.ok(f.calls.length > 0);
    });
  }
  console.log(`${passed} passed, ${failed} failed${baseline ? ' (baseline expected to fail)' : ''}`);
  if (failed) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
