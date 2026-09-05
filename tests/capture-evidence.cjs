// Run: node tests/capture-evidence.cjs. Native I/O is fault-injected; production
// service and screen functions are compiled unchanged from their TypeScript.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const disk = new Map([['file:///cache/roof.heic', 'real-photo-bytes']]);
const storage = new Map();
let copyFails = false, writeFails = false, emptyCopy = false, deleteFails = false, writeThenFail = false, verificationFails = false, partialCopyFails = false;
let pauseAt = null, copyCalls = 0;
const terminateHere = () => new Promise(() => {}); // abandoned with the old simulated process
const nativeFS = {
  documentDirectory: 'file:///documents/',
  makeDirectoryAsync: async () => {},
  getInfoAsync: async uri => {
    if (verificationFails && uri.startsWith('file:///documents/')) throw new Error('verification unavailable');
    return { exists: disk.has(uri), isDirectory: false, size: disk.get(uri)?.length ?? 0 };
  },
  copyAsync: async ({ from, to }) => {
    if (pauseAt === 'beforeCopy') await terminateHere();
    copyCalls++;
    if (copyFails || !disk.has(from)) throw new Error('copy failed');
    if (partialCopyFails) { disk.set(to, 'partial bytes'); throw new Error('native copy stopped midway'); }
    disk.set(to, emptyCopy ? '' : disk.get(from));
    if (pauseAt === 'afterCopy') await terminateHere();
  },
  moveAsync: async ({ from, to }) => {
    if (!disk.has(from) || disk.has(to)) throw new Error('invalid move');
    disk.set(to, disk.get(from)); disk.delete(from);
    if (pauseAt === 'afterMove') await terminateHere();
  },
  deleteAsync: async uri => { if (deleteFails) throw new Error('delete failed'); disk.delete(uri); },
};
const asyncStorage = {
  getItem: async key => storage.get(key) ?? null,
  setItem: async (key, value) => {
    if (writeFails) throw new Error('disk full');
    if (pauseAt === 'beforeReadyCommit' && key === 'roofwise.pending-captures.v1' && JSON.parse(value).entries.some(entry => !entry.retentionReservation)) await terminateHere();
    storage.set(key, value);
    if (writeThenFail) throw new Error('write completed but acknowledgement failed');
  },
  removeItem: async key => { storage.delete(key); },
};
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
function processModules() {
  const cache = new Map();
  function load(name) {
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    const requireMock = id => {
      if (id === 'expo-file-system/legacy') return nativeFS;
      if (id === '@react-native-async-storage/async-storage') return asyncStorage;
      if (id === '@/lib/env') return { isGeminiConfigured: true };
      if (id === '@/lib/services/photoAnalysisState') return load('photoAnalysisState');
      if (id === 'react-native') return { Image: { getSize: (_uri, success) => success(1000, 800) } };
      if (id === 'expo-image-manipulator') return {
        SaveFormat: { JPEG: 'jpeg' },
        manipulateAsync: async uri => {
          const normalized = 'file:///cache/normalized.jpg';
          disk.set(normalized, disk.get(uri));
          return { uri: normalized };
        },
      };
      if (id.startsWith('./')) return load(id.slice(2));
      throw new Error('Unexpected import ' + id);
    };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'lib/services', name + '.ts'), 'utf8')), { exports, require: requireMock, console, Error });
    return exports;
  }
  return { evidence: load('photoEvidence'), journal: load('pendingCaptures'), persistence: load('inspectionPersistence'), images: load('imagePipeline'), analysisState: load('photoAnalysisState'), captureHelpers: load('../../components/capture/hud/reviewState') };
}
const source = fs.readFileSync(path.join(root, 'app/quick-inspection.tsx'), 'utf8');
const ast = ts.createSourceFile('capture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'QuickInspectionNative');
const names = ['saveCapture', 'fileCapture', 'onSlopePicked', 'onSlopePickerCancel', 'addPhoto', 'contextForSlope'];
const declarations = component.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => names.includes(declaration.name.getText(ast))));
assert.equal(declarations.length, names.length);
const screenJS = compile(declarations.map(node => node.getText(ast)).join('\n') + '\nglobalThis.handlers = {' + names.join(',') + '};');
const pumpNames = ['pump', 'enqueueAnalysis'];
const pumpDeclarations = component.body.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => pumpNames.includes(declaration.name.getText(ast))));
assert.equal(pumpDeclarations.length, pumpNames.length);
const pumpLifetime = component.body.statements.find(node => ts.isExpressionStatement(node) && node.getText(ast).includes('pendingRef.current = []')).expression.arguments[0];
const pumpJS = compile(pumpDeclarations.map(node => node.getText(ast)).join('\n') + '\nglobalThis.livePump = { pump, enqueueAnalysis };\nglobalThis.mountCapture = ' + pumpLifetime.getText(ast) + ';');
const context = { slope: 'N', areaTag: 'Rear Slope', captureMode: 'square_10x10', areaTagPinned: false, slopeMode: 'auto', compassSlope: 'N' };
function screen(services, jobs, target = 'job') {
  const prompts = [], analyses = [];
  const state = { getById: id => jobs.find(job => job.id === id), inspections: jobs };
  const sandbox = {
    Error,
    ...services.journal, ...services.evidence, ...services.persistence, ...services.analysisState, ...services.captureHelpers,
    pendingCaptureRef: { current: null }, pendingImportRef: { current: null },
    filingRef: { current: false }, mountedRef: { current: true },
    targetIdRef: { current: target }, createdHereRef: { current: false },
    photosRef: { current: [] }, setPhotos: () => {}, setTargetId: () => {},
    selectSlope: () => {}, setSlopePrompt: prompt => prompts.push(prompt),
    defaultAreaTagForSlope: slope => slope === 'N' ? 'Rear Slope' : 'Front Slope',
    octantDistance: () => 4, zoneForAreaTag: () => null, setCollateralZone: () => {},
    enqueueAnalysis: uri => analyses.push(uri),
    ensureInspection: reserved => {
      if (reserved && !state.getById(reserved)) jobs.push({ id: reserved, slopes: [] });
      return reserved ?? sandbox.targetIdRef.current;
    },
    attachRawPhotos: (id, photos) => {
      for (const photo of photos) {
        const job = state.getById(id);
        let slope = job.slopes.find(s => s.orientation === photo.slope);
        if (!slope) job.slopes.push(slope = { id: 'slope-' + photo.slope, orientation: photo.slope, photoPaths: [], photoMeta: [] });
        slope.photoMeta.push({ photoIndex: slope.photoPaths.length, areaTag: photo.areaTag, captureMode: photo.captureMode });
        slope.photoPaths.push(photo.uri);
      }
    },
    useInspectionStore: {
      getState: () => state,
      setState: () => services.persistence.inspectionStorage.setItem('inspections', JSON.stringify(jobs)),
    },
    useAnalysisQueueStore: { getState: () => ({ jobs: [] }) },
  };
  vm.runInNewContext(screenJS, sandbox);
  return { ...sandbox.handlers, sandbox, prompts, analyses };
}

function installLivePump(ui, ownership, analyze) {
  Object.assign(ui.sandbox, {
    captureAnalysisOwners: ownership,
    pendingRef: { current: [] }, runningRef: { current: false },
    useCallback: callback => callback,
    isGeminiConfigured: true, setAnalyzing: () => {}, setLocalAnalysis: () => {},
    setPhotoAnalysisState: () => {}, analyzeSlope: analyze,
    describeAnalysisError: error => error.message,
    Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Error: 'error', Success: 'success' } },
    useToastStore: { getState: () => ({ show: () => {} }) },
  });
  vm.runInNewContext(pumpJS, ui.sandbox);
  ui.sandbox.enqueueAnalysis = ui.sandbox.livePump.enqueueAnalysis;
}

async function main() {
  let services = processModules();
  const pendingIdentity = { uri: 'file:///documents/photo-evidence/import.jpg' };
  assert.equal(services.journal.hasConflictingPendingCapture(null, pendingIdentity), false);
  assert.equal(services.journal.hasConflictingPendingCapture(pendingIdentity, pendingIdentity), false,
    'the recovery listener rediscovering the active album import cannot reject its own photo');
  assert.equal(services.journal.hasConflictingPendingCapture(
    { uri: 'file:///documents/photo-evidence/other.jpg' }, pendingIdentity,
  ), true, 'a genuinely different pending photo still blocks the import queue');
  const durable = await services.evidence.retainPhotoEvidence('file:///cache/roof.heic');
  assert.match(durable, /^file:\/\/\/documents\/photo-evidence\/.+\.heic$/);
  assert.equal(disk.get(durable), 'real-photo-bytes');
  assert.equal(await services.evidence.retainPhotoEvidence(durable), durable, 'retry must keep URI identity');
  const temporary = await services.images.prepareCapturedPhoto('file:///cache/roof.heic', { retainEvidence: false });
  assert.match(temporary, /^file:\/\/\/cache\//, 'journalled capture normalization must not pre-create an unowned durable copy');
  const stagedSize = disk.size;
  writeFails = true;
  await assert.rejects(services.journal.stageCapture(temporary, context, 'job'), /No new copy was created/);
  writeFails = false;
  assert.equal(disk.size, stagedSize, 'normalize→copy→journal failure leaves no extra durable file');
  const defaultPrepared = await services.images.prepareCapturedPhoto('file:///cache/roof.heic');
  assert.match(defaultPrepared, /^file:\/\/\/documents\/photo-evidence\//, 'other normalizer callers keep durable defaults');
  await services.evidence.discardPhotoEvidence(defaultPrepared);
  disk.delete(temporary);
  const before = disk.size;
  copyFails = true;
  await assert.rejects(services.evidence.retainPhotoEvidence('file:///cache/roof.heic'), /Could not save/);
  copyFails = false;
  assert.equal(disk.size, before, 'failed copy cleaned up; original untouched');
  emptyCopy = true;
  await assert.rejects(services.evidence.retainPhotoEvidence('file:///cache/roof.heic'), /empty/);
  emptyCopy = false;
  assert.equal(disk.size, before);

  // A failed first journal write must create no owned file at all.
  writeFails = true;
  const copiesBeforeReservation = copyCalls;
  await assert.rejects(services.journal.stageCapture('file:///cache/roof.heic', context, 'job'), /No new copy was created/);
  assert.equal(copyCalls, copiesBeforeReservation);
  assert.equal(disk.size, before);
  let retryHandle;
  await assert.rejects(services.journal.stageCapture(durable, context, 'job'), error => {
    assert.equal(error.name, 'CaptureStagingError'); retryHandle = error.photo; return true;
  });
  assert.equal(disk.has(durable), true, 'shared input must survive failed reservation');
  writeFails = false;
  await services.journal.discardPendingCapture(retryHandle);
  assert.equal(disk.has(durable), true, 'even explicit discard cannot delete a reused input');

  // Simulate process termination by abandoning execution at each native/
  // journal await, preserving only disk and AsyncStorage for the new process.
  for (const boundary of ['beforeCopy', 'afterCopy', 'afterMove', 'beforeReadyCommit']) {
    pauseAt = boundary;
    void services.journal.stageCapture('file:///cache/roof.heic', context, null);
    await new Promise(resolve => setImmediate(resolve));
    const reserved = JSON.parse(storage.get('roofwise.pending-captures.v1')).entries[0];
    assert.equal(reserved.retentionReservation.ownsCopy, true);
    assert.equal(reserved.uri, reserved.retentionReservation.uri);
    if (boundary === 'beforeCopy') assert.equal(disk.has(reserved.uri), false);
    if (boundary === 'afterCopy') {
      assert.equal(disk.has(reserved.retentionReservation.temporaryUri), true);
      assert.equal(disk.has(reserved.uri), false);
      disk.set(reserved.retentionReservation.temporaryUri, 'untrusted partial bytes');
    }
    if (boundary === 'afterMove' || boundary === 'beforeReadyCommit') {
      assert.equal(disk.has(reserved.uri), true);
      disk.delete('file:///cache/roof.heic'); // completed final no longer needs its source
    }
    pauseAt = null;
    services = processModules();
    const resumed = (await services.journal.readPendingCaptures())[0];
    const restartJobs = [];
    const restartUi = screen(services, restartJobs, null);
    const callsBeforeResume = copyCalls;
    assert.equal(await restartUi.saveCapture(resumed), true, boundary + ' recovers');
    assert.equal(disk.get(resumed.uri), 'real-photo-bytes');
    if (boundary === 'afterCopy') assert.equal(copyCalls, callsBeforeResume + 1, 'partial bytes require a fresh completed copy');
    if (boundary === 'afterMove' || boundary === 'beforeReadyCommit') assert.equal(copyCalls, callsBeforeResume, 'verified final is reused without source or duplicate copying');
    assert.equal(restartJobs.length, 1);
    assert.equal(restartJobs[0].id, reserved.targetId);
    assert.equal(await restartUi.saveCapture(resumed), true);
    assert.equal(restartJobs.length, 1);
    assert.equal(restartJobs[0].slopes[0].photoPaths.length, 1, 'one attachment after repeated recovery');
    assert.equal((await services.journal.readPendingCaptures()).length, 0);
    assert.equal(disk.has(reserved.retentionReservation.temporaryUri), false);
    await services.evidence.discardPhotoEvidence(resumed.uri);
    disk.set('file:///cache/roof.heic', 'real-photo-bytes');
  }

  // A terminated partial copy with a missing source remains unfiled and can
  // be discarded. Cleanup intent itself survives a failure and restart.
  pauseAt = 'afterCopy';
  void services.journal.stageCapture('file:///cache/roof.heic', context, 'job');
  await new Promise(resolve => setImmediate(resolve));
  pauseAt = null;
  services = processModules();
  let retained = (await services.journal.readPendingCaptures())[0];
  disk.delete('file:///cache/roof.heic');
  const partialJobs = [{ id: 'job', slopes: [] }];
  const partialUi = screen(services, partialJobs);
  assert.equal(await partialUi.saveCapture(retained), false);
  assert.equal(partialJobs[0].slopes.length, 0);
  assert.match(partialUi.prompts.at(-1), /no available original/);
  deleteFails = true;
  await assert.rejects(services.journal.discardPendingCapture(retained));
  assert.equal(JSON.parse(storage.get('roofwise.pending-captures.v1')).entries[0].discardRequested, true);
  deleteFails = false;
  services = processModules();
  retained = (await services.journal.readPendingCaptures())[0];
  await services.journal.discardPendingCapture(retained);
  assert.equal(disk.has(retained.retentionReservation.temporaryUri), false);
  assert.equal(disk.has(retained.uri), false);
  assert.equal((await services.journal.readPendingCaptures()).length, 0);
  assert.equal(disk.has(durable), true, 'restart cleanup never deletes shared accepted evidence');
  disk.set('file:///cache/roof.heic', 'real-photo-bytes');

  // Verification and cleanup failure no longer require best-effort rollback:
  // every possible owned target is already in the durable reservation.
  verificationFails = true;
  deleteFails = true;
  await assert.rejects(services.journal.stageCapture('file:///cache/roof.heic', context, 'job'), error => {
    assert.equal(error.name, 'CaptureStagingError'); retryHandle = error.photo; return true;
  });
  assert.equal(JSON.parse(storage.get('roofwise.pending-captures.v1')).entries[0].uri, retryHandle.uri);
  verificationFails = false;
  deleteFails = false;
  services = processModules();
  const recoveredUi = screen(services, [{ id: 'job', slopes: [] }]);
  assert.equal(await recoveredUi.saveCapture((await services.journal.readPendingCaptures())[0]), true);
  await services.evidence.discardPhotoEvidence(retryHandle.uri);

  const unsubscribeBrokenObserver = services.journal.subscribePendingCaptures(() => { throw new Error('observer failed'); });
  const observed = await services.journal.stageCapture('file:///cache/roof.heic', context, 'job');
  unsubscribeBrokenObserver();
  assert.equal(disk.has(observed.uri), true);
  await services.journal.discardPendingCapture(observed);

  // An ambiguous first reservation write is read back before creating files;
  // an ambiguous ready commit still leaves its durable reservation recoverable.
  writeThenFail = true;
  await assert.rejects(services.journal.stageCapture('file:///cache/roof.heic', context, 'job'), error => {
    assert.equal(error.name, 'CaptureStagingError'); retryHandle = error.photo; return true;
  });
  writeThenFail = false;
  assert.equal(disk.has(retryHandle.uri), true);
  services = processModules();
  await services.journal.discardPendingCapture((await services.journal.readPendingCaptures())[0]);

  // Legacy retention calls still propagate ownership if their own verification
  // and cleanup fail; image profile fallback cannot swallow that file handle.
  verificationFails = true;
  deleteFails = true;
  await assert.rejects(services.images.prepareCapturedPhoto('file:///cache/roof.heic'), error => {
    assert.equal(error.name, 'PhotoRetentionError'); retryHandle = error.recovery; return true;
  });
  verificationFails = false;
  deleteFails = false;
  await services.evidence.discardPhotoEvidence(retryHandle.uri);
  disk.delete('file:///cache/normalized.jpg');
  assert.equal(disk.size, before, 'every owned file is filed, reserved or explicitly discarded');
  disk.delete('file:///cache/roof.heic');
  assert.equal(disk.get(durable), 'real-photo-bytes', 'OS cache purge cannot remove accepted evidence');

  let pending = await services.journal.stageCapture(durable, context, 'job');
  services = processModules(); // actual module memory reset, shared durable I/O
  assert.equal((await services.journal.readPendingCaptures())[0].uri, durable, 'cold start recovers pending URI/context');
  const jobs = [{ id: 'job', slopes: [] }];
  let ui = screen(services, jobs);
  writeFails = true;
  assert.equal(await ui.saveCapture(pending), false);
  assert.equal(jobs[0].slopes.length, 0, 'journal failure must precede attachment');
  writeFails = false;

  const attach = ui.sandbox.attachRawPhotos;
  ui.sandbox.attachRawPhotos = (...args) => { attach(...args); throw new Error('subscriber failed after attach'); };
  assert.equal(await ui.saveCapture(pending), false);
  assert.equal(jobs[0].slopes[0].photoPaths.length, 1);
  assert.equal((await services.journal.readPendingCaptures()).length, 1);
  // Remount with null target reproduces standalone recovery: cancellation
  // still checks the journal target, not the screen's currently selected job.
  ui = screen(services, jobs, null);
  ui.sandbox.pendingCaptureRef.current = pending;
  await ui.onSlopePickerCancel();
  assert.equal(disk.has(durable), true, 'attached evidence cannot be discarded during recovery');
  assert.equal((await services.journal.readPendingCaptures()).length, 1);
  await ui.onSlopePicked('S');
  assert.match(ui.prompts.at(-1), /already saved to N/);
  await ui.onSlopePicked('N');
  assert.equal(jobs[0].slopes[0].photoPaths.length, 1, 'post-attach retry is idempotent');
  assert.equal((await services.journal.readPendingCaptures()).length, 0);
  assert.equal(JSON.parse(storage.get('inspections'))[0].slopes[0].photoPaths[0], durable, 'journal retired only after persisted attachment');

  // Completion removal can fail after attachment persistence; the next
  // process reuses the URI and does not rerun already-complete analysis.
  await services.journal.writePendingCapture(pending);
  jobs[0].slopes[0].analyzedPhotoIndices = [0];
  ui = screen(services, jobs);
  ui.sandbox.removePendingCapture = async () => { throw new Error('journal unavailable'); };
  assert.equal(await ui.saveCapture(pending), false);
  assert.equal((await services.journal.readPendingCaptures()).length, 1);
  services = processModules();
  ui = screen(services, JSON.parse(storage.get('inspections')));
  assert.equal(await ui.saveCapture((await services.journal.readPendingCaptures())[0]), true);
  assert.equal(ui.analyses.length, 0, 'completed analysis must not be billed again on replay');

  await services.journal.writePendingCapture(pending);
  const queuedJobs = [{ inspectionId: 'job', slopeId: 'slope-N', status: 'running' }];
  const runningJobs = [{ id: 'job', slopes: [{ id: 'slope-N', orientation: 'N', photoPaths: [durable] }] }];
  ui = screen(services, runningJobs);
  ui.sandbox.useAnalysisQueueStore = { getState: () => ({ jobs: queuedJobs }) };
  await ui.saveCapture(pending);
  assert.equal(ui.analyses.length, 0, 'recovery must not race an active background analysis of the same photo');

  // Hold the real camera-local pump inside analyzeSlope while retirement of
  // the capture journal fails. A replay must not enqueue a second local pass.
  const liveJobs = [{ id: 'job', slopes: [] }];
  const ownership = new Set();
  let resolveLive, calls = 0;
  const liveResult = new Promise(resolve => { resolveLive = resolve; });
  ui = screen(services, liveJobs);
  installLivePump(ui, ownership, () => { calls++; return liveResult; });
  const unmountLive = ui.sandbox.mountCapture();
  let failRetirement = true;
  ui.sandbox.removePendingCapture = async uri => {
    if (failRetirement) throw new Error('journal retirement failed');
    await services.journal.removePendingCapture(uri);
  };
  assert.equal(await ui.saveCapture(pending), false);
  assert.equal(calls, 1);
  assert.equal(ui.sandbox.pendingRef.current.length, 0, 'active batch has left the local pending array');
  assert.equal(ownership.has(durable), true, 'active batch must retain URI ownership');
  failRetirement = false;
  assert.equal(await ui.saveCapture(pending), true);
  assert.equal(calls, 1, 'journal retry cannot enqueue an owned active photo');
  assert.equal(ui.sandbox.pendingRef.current.length, 0);
  assert.equal(liveJobs[0].slopes[0].photoPaths.length, 1);

  // A remounted camera also observes the prior route's still-active request.
  unmountLive();
  assert.equal(ownership.has(durable), true, 'unmount must not release an active request');
  const remounted = screen(services, liveJobs);
  installLivePump(remounted, ownership, async () => { calls++; return { failures: [] }; });
  assert.equal(await remounted.saveCapture(pending), true);
  assert.equal(calls, 1, 'route remount cannot duplicate the prior route active pass');
  liveJobs[0].slopes[0].analyzedPhotoIndices = [0];
  resolveLive({ failures: [] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1, 'completing the first pass must not drain a duplicate retry');
  assert.equal(ownership.has(durable), false, 'completed batch releases URI for a deliberate future reanalysis');

  // Ownership includes queued work, not just the currently active batch.
  const queuedUi = screen(services, liveJobs);
  installLivePump(queuedUi, ownership, async () => { calls++; return { failures: [] }; });
  const unmountQueued = queuedUi.sandbox.mountCapture();
  queuedUi.sandbox.photosRef.current = [{ uri: durable, inspectionId: 'job', slopeId: 'slope-N', photoIndex: 0 }];
  queuedUi.sandbox.runningRef.current = true;
  queuedUi.sandbox.enqueueAnalysis(durable);
  queuedUi.sandbox.enqueueAnalysis(durable);
  assert.equal(queuedUi.sandbox.pendingRef.current.length, 1, 'two enqueue attempts have one queued owner');
  unmountQueued();
  assert.equal(ownership.has(durable), false, 'unstarted work releases its owner on teardown so durable recovery can resume it');
  assert.equal(queuedUi.sandbox.pendingRef.current.length, 0);

  // Inspection storage failure cannot clear the durable recovery record.
  pending = await services.journal.stageCapture(durable, context, 'job');
  ui = screen(services, jobs);
  ui.sandbox.flushInspectionPersistence = async () => { throw new Error('disk full'); };
  assert.equal(await ui.saveCapture(pending), false);
  assert.equal((await services.journal.readPendingCaptures()).length, 1);
  await services.journal.removePendingCapture(durable);

  // Standalone capture reserves its identity before any job exists.
  pending = await services.journal.stageCapture(durable, context, null);
  const reservedId = pending.targetId;
  services = processModules();
  const standalone = [];
  ui = screen(services, standalone, null);
  ui.sandbox.flushInspectionPersistence = async () => { throw new Error('interrupted'); };
  await ui.saveCapture((await services.journal.readPendingCaptures())[0]);
  assert.equal(standalone[0].id, reservedId);
  ui = screen(services, standalone, null);
  await ui.saveCapture((await services.journal.readPendingCaptures())[0]);
  assert.equal(standalone.length, 1, 'same reserved job after creation/filing interruption');
  assert.equal(standalone[0].slopes[0].photoPaths.length, 1);

  const batchFirst = await services.journal.stageCapture(durable, context, null, true);
  const batchSecond = await services.journal.stageCapture(durable + '-second', context, null, true, batchFirst).catch(() => null);
  assert.equal(batchSecond, null, 'unreadable batch asset cannot be accepted');
  disk.set(durable + '-second', 'second-photo');
  const batchNext = await services.journal.stageCapture(durable + '-second', context, null, true, {
    targetId: batchFirst.targetId, originTargetId: batchFirst.originTargetId, createdHere: batchFirst.createdHere,
  });
  assert.equal(batchNext.targetId, batchFirst.targetId, 'interrupted standalone batch shares one reserved job');
  assert.equal(batchNext.originTargetId, null, 'remaining batch photos can be found after first is discarded');
  await services.journal.removePendingCapture(batchFirst.uri);
  await services.journal.removePendingCapture(batchNext.uri);

  // Concurrent queued journal writes cannot erase one another.
  const other = { ...pending, uri: durable + '-other' };
  await Promise.all([services.journal.writePendingCapture(pending), services.journal.writePendingCapture(other)]);
  assert.equal((await services.journal.readPendingCaptures()).length, 2);
  await Promise.all([services.journal.removePendingCapture(pending.uri), services.journal.removePendingCapture(other.uri)]);
  assert.equal((await services.journal.readPendingCaptures()).length, 0);
  storage.set('roofwise.pending-captures.v1', '{bad json');
  await assert.rejects(services.journal.writePendingCapture(pending));
  assert.equal(storage.get('roofwise.pending-captures.v1'), '{bad json', 'corrupt journal must not be reset silently');
  storage.delete('roofwise.pending-captures.v1');

  const checkpoint = services.persistence;
  writeFails = true;
  await checkpoint.inspectionStorage.setItem('checkpoint', 'first');
  await assert.rejects(checkpoint.flushInspectionPersistence(), /device storage/);
  writeFails = false;
  await checkpoint.inspectionStorage.setItem('checkpoint', 'second');
  await checkpoint.flushInspectionPersistence();
  assert.equal(storage.get('checkpoint'), 'second', 'retry clears a persistence error only after writing');

  const queueSource = fs.readFileSync(path.join(root, 'lib/services/analysisQueue.ts'), 'utf8');
  const queueAst = ts.createSourceFile('queue.ts', queueSource, ts.ScriptTarget.Latest, true);
  const recovery = queueAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'recoverInterruptedCaptureAnalysis');
  const queueJobs = [], loaded = [];
  const recoveryInspections = [{ id: 'recover-job', slopes: [
    { id: 'queued', orientation: 'N', photoPaths: ['a'], photoAnalysis: { a: { status: 'queued' } } },
    { id: 'running', orientation: 'E', photoPaths: ['b'], photoAnalysis: { b: { status: 'analyzing' } } },
    { id: 'done', orientation: 'S', photoPaths: ['c'], photoAnalysis: { c: { status: 'queued' } }, analyzedPhotoIndices: [0] },
    { id: 'failed', orientation: 'W', photoPaths: ['d'], photoAnalysis: { d: { status: 'failed' } } },
  ] }];
  function persistenceMock(label) {
    let hydrated = false;
    return { hasHydrated: () => hydrated, rehydrate: async () => { loaded.push(label); hydrated = true; } };
  }
  const queueSandbox = {
    ...services.analysisState,
    useInspectionStore: { persist: persistenceMock('inspections'), getState: () => ({ inspections: recoveryInspections }) },
    useAnalysisQueueStore: { persist: persistenceMock('queue'), getState: () => ({ enqueue: item => queueJobs.push(item) }) },
  };
  vm.runInNewContext(compile('let captureRecoveryFinished = false;\n' + recovery.getText(queueAst) + '\nglobalThis.recover = recoverInterruptedCaptureAnalysis;'), queueSandbox);
  await queueSandbox.recover();
  assert.deepEqual(loaded, ['inspections', 'queue']);
  assert.deepEqual(queueJobs.map(job => job.slopeId), ['queued', 'running'], 'only unfinished prior-process analysis should resume');
  recoveryInspections[0].slopes.push({ id: 'live-camera', orientation: 'W', photoPaths: ['e'], photoAnalysis: { e: { status: 'queued' } } });
  await queueSandbox.recover();
  assert.equal(queueJobs.length, 2, 'foreground drain must not capture a live camera pump');

  // Only unattached pending evidence is cleaned up on explicit discard.
  pending = await services.journal.stageCapture(durable, context, 'new-job');
  ui = screen(services, [{ id: 'new-job', slopes: [] }], 'new-job');
  ui.sandbox.pendingCaptureRef.current = pending;
  await ui.onSlopePickerCancel();
  assert.equal(disk.has(durable), true, 'reused durable input remains owned by its original consumer');
  assert.equal((await services.journal.readPendingCaptures()).length, 0);
  disk.set('file:///cache/discard.jpg', 'discardable source');
  pending = await services.journal.stageCapture('file:///cache/discard.jpg', context, 'new-job');
  ui.sandbox.pendingCaptureRef.current = pending;
  await ui.onSlopePickerCancel();
  assert.equal(disk.has(pending.uri), false, 'explicit discard deletes the newly owned final copy');
  assert.equal(disk.has('file:///cache/discard.jpg'), true, 'source remains untouched');
  assert.equal((await services.journal.readPendingCaptures()).length, 0);
  console.log('PASS: journal-before-copy reservation, termination at four boundaries, partial-file recovery, exactly-once filing, durable discard intent, shared-file protection, analysis ownership, corrupt storage, legacy retention errors');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
