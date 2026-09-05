// node tests/analysis-photo-identity.cjs
// Production analysis service + inspection store; only native/network effects
// are fault-injected. No customer data, files, or paid model calls are used.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const compile = source => ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
function extractedFunction(file, name, context) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node, name + ' exists in production');
  const sandbox = { ...context, exports: {} };
  vm.runInNewContext(compile(node.getText(ast) + '\nexports.fn = ' + name + ';'), sandbox);
  return sandbox.exports.fn;
}
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const marker = id => ({ id, category: 'hail_hits', severity: 'moderate', confidence: 79, evidence: 'exposed_substrate', x: 0.5, y: 0.5, radius: 0.03 });
const result = id => ({
  markers: [marker(id)], findings: [{ category: 'hail_hits', severity: 'moderate', confidence: 79, detail: id }],
  detectionAudit: { rawCount: 1, keptCount: 1, gridRejected: false },
  shingleScaleEstimate: { pixelsPerInch: 12, confidence: 90, reference: id },
  subject: 'roof_field', modelUsed: 'test-model', noRoofDetected: false,
});
function fixture({ asynchronousPersistence = false } = {}) {
  const cache = new Map(), storage = new Map(), requests = [], reads = [], training = [], snapshots = [];
  let readGate;
  let storageReadGate;
  let annotationWriteGate;
  let annotationWriteFailures = 0;
  class GeminiAnalysisError extends Error {}
  const storageAdapter = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const asyncStorage = {
    getItem: async key => {
      const snapshot = storage.get(key) ?? null;
      const gate = storageReadGate; storageReadGate = undefined;
      if (gate) { gate.entered.resolve(); await gate.promise; }
      await Promise.resolve(); return snapshot;
    },
    setItem: async (key, value) => {
      if (key === 'roofwise.annotations.v1') {
        const gate = annotationWriteGate; annotationWriteGate = undefined;
        if (gate) { gate.entered.resolve(); await gate.promise; }
        if (annotationWriteFailures > 0) { annotationWriteFailures--; throw new Error('Injected device storage full'); }
      }
      await Promise.resolve(); storage.set(key, value);
    },
    removeItem: async key => { await Promise.resolve(); storage.delete(key); },
  };
  const constants = {
    'lib/env.ts': { isGeminiConfigured: true },
    'lib/services/propertyRecord.ts': { roofAgePrefill: () => ({}) },
    'lib/services/propertyIntel.ts': { squaresFacing: () => undefined },
    'lib/services/inspectionPersistence.ts': { inspectionStorage: storageAdapter },
    'lib/stores/leadStore.ts': { useLeadStore: { getState: () => ({ leads: [] }) } },
    'lib/stores/activityStore.ts': { useActivityStore: { getState: () => ({ log: () => {} }) } },
    'lib/stores/correctionsStore.ts': { useCorrectionsStore: { getState: () => ({ corrections: [] }) } },
    'lib/stores/trainingQueueStore.ts': { useTrainingQueueStore: { getState: () => ({ enqueue: item => training.push(item) }) } },
    'lib/stores/toastStore.ts': { useToastStore: { getState: () => ({ show: () => {} }) } },
    'lib/stores/aiSettingsStore.ts': { useAiSettingsStore: { getState: () => ({ enabled: false, tiledTestSquares: false }) } },
    'lib/services/learning/userCorrectionProfile.ts': { computeProfile: () => ({}) },
    'lib/services/learning/localLearningEngine.ts': { userStylePromptPrefix: () => '' },
    'lib/services/weather.ts': { getSafetyForecast: async () => undefined },
    'lib/services/storedEngine.ts': { snapshotEngineResult: inspection => {
      snapshots.push(plain(inspection)); return { payload: {}, at: new Date().toISOString() };
    } },
    'lib/services/telemetry.ts': { mark: () => {}, measure: () => {}, clearMark: () => {}, recordAnalysisMs: async () => {} },
    'lib/services/gemini.ts': {
      GeminiAnalysisError, GeminiNotConfiguredError: class extends Error {},
      describeAnalysisError: error => error.message, isRetryableGeminiError: () => true,
      analyzePhoto: options => { const pending = deferred(); requests.push({ ...pending, options }); return pending.promise; },
    },
  };
  if (asynchronousPersistence) delete constants['lib/services/inspectionPersistence.ts'];
  function load(file) {
    if (constants[file]) return constants[file];
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const resolve = id => {
      if (id === 'zustand' || id === 'zustand/middleware') return require(id);
      if (id === '@react-native-async-storage/async-storage') return asyncStorage;
      if (id === 'expo-file-system/legacy') return {
        EncodingType: { Base64: 'base64' }, getInfoAsync: async () => ({ exists: true, size: 1000 }),
        readAsStringAsync: async uri => { reads.push(uri); if (readGate) await readGate.promise; return uri + 'x'.repeat(100); },
      };
      if (id.startsWith('@/')) return load(id.slice(2) + '.ts');
      if (id.startsWith('.')) return load(path.normalize(path.join(path.dirname(file), id)) + '.ts');
      throw new Error('Unexpected import ' + id);
    };
    const code = compile(fs.readFileSync(path.join(root, file), 'utf8'));
    // True async production persistence executes in Node's own realm so
    // Zustand sees native Promises, not foreign VM-realm lookalikes.
    new Function('exports', 'require', 'console', '__DEV__', code)(exports, resolve, console, false);
    return exports;
  }
  const storeModule = load('lib/stores/inspectionStore.ts');
  const store = storeModule.useInspectionStore;
  const service = load('lib/services/analyzeSlope.ts');
  const analysisState = load('lib/services/photoAnalysisState.ts');
  const captureHelpers = load('components/capture/hud/reviewState.ts');
  const inspection = store.getState().create({ id: 'job', customerName: 'Test', address: 'Test', material: 'asphalt_architectural' });
  store.getState().attachRawPhotos('job', ['a', 'b', 'c'].map(uri => ({ uri, slope: 'N', captureMode: 'square_10x10', areaTag: 'Rear Slope' })));
  const slopeId = store.getState().getById(inspection.id).slopes[0].id;
  const slope = () => store.getState().getById('job').slopes[0];
  const waitFor = async count => {
    for (let tries = 0; requests.length < count && tries < 30; tries++) await new Promise(resolve => setImmediate(resolve));
    assert.equal(requests.length, count, 'expected model request count');
  };
  return { store, service, slopeId, slope, requests, reads, training, snapshots, storage, waitFor,
    loadAnnotations: () => load('lib/stores/annotationStore.ts').useAnnotationStore,
    failAnnotationWrite: () => { annotationWriteFailures++; },
    holdAnnotationWrite: () => { annotationWriteGate = { ...deferred(), entered: deferred() }; return annotationWriteGate; },
    persistence: load('lib/services/inspectionPersistence.ts'),
    holdStorageRead: () => { storageReadGate = { ...deferred(), entered: deferred() }; return storageReadGate; },
    analysisState, captureHelpers, coverage: load('lib/services/documentedSquares.ts'),
    annotationTarget: load('lib/services/annotationTarget.ts').resolveAnnotationTarget,
    applyRemote: extractedFunction('lib/services/inspectionSync.ts', 'applyRemote', { applyingRemote: false, useInspectionStore: store, normalizeInspection: storeModule.normalizeInspection }),
    annotateRoute: photo => {
      const source = fs.readFileSync(path.join(root, 'components/capture/hud/ReviewDrawer.tsx'), 'utf8');
      const ast = ts.createSourceFile('drawer.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'ReviewDrawer');
      const declaration = component.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'onAnnotate'));
      const routes = [];
      const sandbox = { ...captureHelpers, exports: {}, inspection: store.getState().getById('job'),
        Haptics: { selectionAsync: async () => {} }, onClose: () => {}, router: { push: route => routes.push(plain(route)) } };
      vm.runInNewContext(compile(declaration.getText(ast) + '\nexports.open = onAnnotate;'), sandbox);
      sandbox.exports.open(photo); return routes;
    },
    photoProgress: extractedFunction('lib/services/pipeline.ts', 'photoProgress', analysisState),
    wasAnalyzed: extractedFunction('lib/services/haagPdf.ts', 'wasAnalyzed', analysisState),
    pump: async photos => {
      const source = fs.readFileSync(path.join(root, 'app/quick-inspection.tsx'), 'utf8');
      const ast = ts.createSourceFile('capture.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'QuickInspectionNative');
      const declaration = component.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(ast) === 'pump'));
      const submitted = [];
      const sandbox = { ...analysisState, ...captureHelpers, exports: {}, useCallback: fn => fn,
        runningRef: { current: false }, mountedRef: { current: false }, pendingRef: { current: photos.map(captureHelpers.captureKey) },
        photosRef: { current: photos }, captureAnalysisOwners: new Set(photos.map(captureHelpers.captureKey)),
        useInspectionStore: store, analyzeSlope: async (_job, _slope, options) => { submitted.push(plain(options.photoIndexes)); return { failures: [] }; },
        describeAnalysisError: error => error.message,
        Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Error: 'error', Success: 'success' } },
        useToastStore: { getState: () => ({ show: () => {} }) },
      };
      vm.runInNewContext(compile(declaration.getText(ast) + '\nexports.pump = pump;'), sandbox);
      await sandbox.exports.pump(); return submitted;
    },
    holdRead: () => { readGate = deferred(); return readGate; },
    remove: index => store.getState().removePhoto('job', slopeId, index),
    run: options => service.analyzeSlope('job', slopeId, options),
  };
}
async function main() {
  // Earlier deletion shifts B onto A's old index while B is awaiting Gemini.
  let f = fixture();
  f.store.getState().replacePhotoMarkers('job', f.slopeId, 2, [{ ...marker('inspector-c'), softSpot: true }]);
  const cBefore = plain(f.slope().damage[0]);
  let pass = f.run({ photoIndexes: [1] });
  await f.waitFor(1);
  f.remove(0);
  f.requests[0].resolve(result('b-hit'));
  assert.equal((await pass).attached, 1);
  assert.deepEqual(plain(f.slope().damage.filter(m => m.photoIndex === 0).map(m => m.id)), ['b-hit']);
  assert.deepEqual(plain(f.slope().damage.find(m => m.id === 'inspector-c')), { ...cBefore, photoIndex: 1 });
  assert.deepEqual(plain(f.slope().analyzedPhotoIndices), [0, 1]);
  assert.equal(f.slope().scaleEstimates[0].photoIndex, 0);
  assert.equal(f.slope().photoAnalysis.b.status, 'done');
  assert.equal(f.training[0].photoPath, 'b');
  assert.equal(f.snapshots[0].slopes[0].damage.find(m => m.id === 'b-hit').photoIndex, 0);
  const persisted = JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].slopes[0];
  assert.equal(persisted.damage.find(m => m.id === 'b-hit').photoIndex, 0, 'report projection and persisted evidence agree');

  // Deleted in-flight B: C retains its corrections; later queued C still runs once.
  f = fixture();
  pass = f.run({ photoIndexes: [1, 2] });
  await f.waitFor(1);
  f.remove(1);
  f.requests[0].resolve(result('deleted-b'));
  await f.waitFor(2);
  assert.ok(f.requests[1].options.imageBase64.startsWith('c'));
  f.requests[1].resolve(result('c-hit'));
  assert.equal((await pass).attached, 1);
  assert.deepEqual(plain(f.slope().damage.map(m => [m.id, m.photoIndex])), [['c-hit', 1]]);
  assert.equal(f.slope().photoAnalysis.b, undefined);
  assert.equal(f.slope().aiFindings.length, 1);
  assert.equal(f.training.length, 1);

  // A replacement URI during I/O must not inherit the old response or analysis flag.
  f = fixture();
  pass = f.run({ photoIndexes: [1] });
  await f.waitFor(1);
  f.store.getState().replacePhoto('job', f.slopeId, 1, 'rotated-b');
  f.requests[0].resolve(result('old-b'));
  assert.equal((await pass).attached, 0);
  assert.equal(f.slope().damage.length, 0);
  assert.equal(f.slope().analyzedPhotoIndices.length, 0);
  assert.equal(f.training.length, 0);
  f.service.setPhotoAnalysisState('job', f.slopeId, 'b', { status: 'failed', error: 'late callback' });
  assert.equal(f.slope().photoAnalysis.b, undefined);

  // Removed while reading: avoid the paid request entirely.
  f = fixture();
  const read = f.holdRead();
  pass = f.run({ photoIndexes: [1] });
  await new Promise(resolve => setImmediate(resolve));
  f.remove(1);
  read.resolve();
  assert.equal((await pass).attached, 0);
  assert.equal(f.requests.length, 0);

  // Failure reports the current retry index; retry commits only B, never C.
  f = fixture();
  pass = f.run({ photoIndexes: [1] });
  await f.waitFor(1);
  f.remove(0);
  f.requests[0].reject(new Error('temporary transport failure'));
  const failure = await pass;
  assert.equal(failure.failures[0].photoIndex, 0);
  assert.equal(f.slope().photoAnalysis.b.status, 'failed');
  pass = f.service.retryPhotoAnalysis('job', f.slopeId, failure.failures[0].photoIndex);
  await f.waitFor(2);
  f.requests[1].resolve(result('retried-b'));
  await pass;
  assert.equal(f.slope().photoAnalysis.b.status, 'done');
  assert.equal(f.slope().photoAnalysis.b.attempts, 2);
  assert.equal(f.slope().photoAnalysis.b.error, undefined);
  assert.deepEqual(plain(f.slope().analyzedPhotoIndices), [0]);
  assert.equal(f.slope().photoAnalysis.c, undefined);

  // Persisted prior analysis is invalidated on replacement, while C's scale,
  // count, marker and manual confirmation survive exactly.
  f = fixture();
  f.store.getState().replacePhotoMarkers('job', f.slopeId, 1, [marker('old-b')]);
  f.store.getState().replacePhotoMarkers('job', f.slopeId, 2, [{ ...marker('confirmed-c'), softSpot: true }]);
  f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl,
    scaleEstimates: [1, 2].map(photoIndex => ({ photoIndex, pixelsPerInch: photoIndex * 10, confidence: 90 })),
    photoAnalysis: { b: { status: 'done', at: 'before', shingleCount: 5 }, c: { status: 'done', at: 'before' } },
    photoAnalysisByAttachment: undefined,
    aiFindings: [{ photoPath: 'b', description: 'old B finding' }, { photoPath: 'c', description: 'C finding' }, { description: 'legacy unscoped evidence' }],
  })) })) }));
  const originalId = f.slope().photoAttachmentIds[1];
  f.store.getState().replacePhoto('job', f.slopeId, 1, 'rotated-b');
  let saved = JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].slopes[0];
  assert.deepEqual(saved.damage.map(m => m.id), ['confirmed-c']);
  assert.deepEqual(saved.analyzedPhotoIndices, [2]);
  assert.deepEqual(saved.scaleEstimates.map(scale => scale.photoIndex), [2]);
  assert.equal(saved.photoAnalysis.b, undefined);
  assert.equal(saved.photoAnalysis['rotated-b'], undefined);
  assert.equal(saved.hailCount, 1);
  assert.notEqual(saved.photoAttachmentIds[1], originalId);
  assert.equal(saved.damage[0].softSpot, true);
  assert.deepEqual(saved.aiFindings.map(finding => finding.description), ['C finding']);
  assert.ok(saved.historicalPhotoEvidence.some(entry => entry.findings?.some(finding => finding.description === 'legacy unscoped evidence')));
  f.remove(1);
  saved = JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].slopes[0];
  assert.deepEqual(saved.scaleEstimates, [{ photoIndex: 1, pixelsPerInch: 20, confidence: 90 }]);
  assert.deepEqual(saved.analyzedPhotoIndices, [1]);
  assert.equal(saved.damage[0].photoIndex, 1);

  f = fixture();
  f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl,
    scaleEstimates: [0, 1, 2].map(photoIndex => ({ photoIndex, pixelsPerInch: 10 + photoIndex, confidence: 90 })),
  })) })) }));
  f.remove(1);
  saved = JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].slopes[0];
  assert.deepEqual(saved.scaleEstimates.map(scale => [scale.photoIndex, scale.pixelsPerInch]), [[0, 10], [1, 12]], 'remove the deleted scale, preserve and shift both neighbors');

  // The sole removed in-flight photo has no ghost spinner or resurrected state.
  f = fixture();
  f.remove(2); f.remove(0);
  pass = f.run({ photoIndexes: [0] });
  await f.waitFor(1);
  f.remove(0);
  assert.equal(f.slope().photoAnalysis?.b, undefined);
  f.requests[0].resolve(result('removed-only-photo'));
  assert.equal((await pass).attached, 0);
  assert.equal(f.slope().photoAnalysis?.b, undefined);
  assert.equal(f.slope().damage.length, 0);
  saved = JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].slopes[0];
  assert.equal(saved.photoAnalysis?.b, undefined);

  // URI reuse cannot revive a removed attachment or spend on its replacement.
  f = fixture();
  const oldId = f.slope().photoAttachmentIds[1];
  pass = f.run({ photoIndexes: [1] });
  await f.waitFor(1);
  f.remove(1);
  f.store.getState().attachRawPhotos('job', [{ uri: 'b', slope: 'N', captureMode: 'square_10x10' }]);
  assert.notEqual(f.slope().photoAttachmentIds[2], oldId);
  f.requests[0].resolve(result('removed-b-response'));
  assert.equal((await pass).attached, 0);
  assert.equal(f.slope().damage.length, 0);
  assert.equal(f.slope().analyzedPhotoIndices.length, 0);
  assert.equal(f.slope().photoAnalysis?.b, undefined);
  assert.equal(f.training.length, 0);

  // Two attachments may share a URI; selecting the second must not write
  // markers to the first. Deleting the first while pending still resolves it.
  f = fixture();
  f.store.getState().attachRawPhotos('job', [{ uri: 'b', slope: 'N', captureMode: 'square_10x10' }]);
  pass = f.run({ photoIndexes: [3] });
  await f.waitFor(1);
  f.remove(1);
  f.requests[0].resolve(result('second-b-attachment'));
  assert.equal((await pass).attached, 1);
  assert.equal(f.slope().damage[0].photoIndex, 2);
  assert.deepEqual(plain(f.slope().analyzedPhotoIndices), [2]);

  // Lazy legacy identities are persisted and stable across store hydration.
  f = fixture();
  f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl, photoAttachmentIds: undefined })) })) }));
  f.store.getState().ensurePhotoAttachmentIds('job', f.slopeId);
  const migratedIds = plain(f.slope().photoAttachmentIds);
  await f.store.persist.rehydrate();
  f.store.getState().ensurePhotoAttachmentIds('job', f.slopeId);
  assert.deepEqual(plain(f.slope().photoAttachmentIds), migratedIds);
  assert.equal(new Set(migratedIds).size, 3);

  // R2: duplicate file bytes do not share findings, status, or descriptive
  // metadata. A failure on the new attachment cannot demote its done sibling.
  f = fixture();
  pass = f.run({ photoIndexes: [1] });
  await f.waitFor(1);
  f.requests[0].resolve({ ...result('first-b'), shingleCount: 10, subject: 'roof_field' });
  await pass;
  const firstAttachment = f.slope().photoAttachmentIds[1];
  f.store.getState().attachRawPhotos('job', [{ uri: 'b', slope: 'N', captureMode: 'square_10x10' }]);
  const secondAttachment = f.slope().photoAttachmentIds[3];
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 3), undefined, 'new duplicate must not inherit Done/count/subject');
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1).shingleCount, 10);
  assert.equal(f.slope().photoAnalysis.b, undefined, 'ambiguous URI mirror must not claim either attachment');
  pass = f.run({ photoIndexes: [3] });
  await f.waitFor(2);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1).status, 'done');
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 3).status, 'analyzing');
  f.requests[1].reject(new Error('second attachment failed'));
  await pass;
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1).status, 'done');
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 3).status, 'failed');
  pass = f.run({ photoIndexes: [3] });
  await f.waitFor(3);
  f.requests[2].resolve({ ...result('second-b'), shingleCount: 3, subject: 'gutter', noRoofDetected: true });
  await pass;
  assert.deepEqual(plain(f.slope().aiFindings.map(finding => finding.photoAttachmentId)), [firstAttachment, secondAttachment]);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1).subject, 'roof_field');
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 3).subject, 'gutter');
  assert.equal(f.coverage.shingleCountForSlope(f.slope()), 10, 'report geometry reads each attachment metadata independently');
  await f.store.persist.rehydrate();
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1).shingleCount, 10);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 3).shingleCount, 3);
  f.remove(3);
  assert.deepEqual(plain(f.slope().aiFindings.map(finding => finding.photoAttachmentId)), [firstAttachment], 'delete only the findings owned by the removed attachment');
  assert.equal(f.slope().photoAnalysis.b.subject, 'roof_field', 'surviving unique URI mirror retains its own metadata');
  assert.equal(f.slope().photoAnalysisByAttachment[secondAttachment], undefined);
  await f.store.persist.rehydrate();
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1).subject, 'roof_field');
  assert.equal(f.slope().aiFindings.length, 1);

  // Removing the first duplicate likewise leaves the second's descriptive
  // metadata and finding intact at its renumbered index.
  f = fixture();
  f.store.getState().attachRawPhotos('job', [{ uri: 'b', slope: 'N' }]);
  pass = f.run({ photoIndexes: [3] }); await f.waitFor(1);
  f.requests[0].resolve({ ...result('second-only'), shingleCount: 7 }); await pass;
  f.remove(1);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 2).shingleCount, 7);
  assert.equal(f.slope().aiFindings[0].photoAttachmentId, f.slope().photoAttachmentIds[2]);

  // R2: unindexed legacy evidence is retained as historical, never counted
  // on the replacement or on a slope with zero surviving photos.
  for (const action of ['replace', 'delete']) {
    f = fixture(); f.remove(2); f.remove(1);
    f.store.getState().setSlopeMarkers('job', f.slopeId, [marker('legacy-unindexed')]);
    f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl,
      aiFindings: [{ label: 'hail_hits', detected: true, count: 1, severity: 'moderate', confidence: 79 }],
    })) })) }));
    assert.equal(f.slope().hailCount, 0, 'unindexed marker is immediately historical, even before removal');
    if (action === 'replace') f.store.getState().replacePhoto('job', f.slopeId, 0, 'new-a'); else f.remove(0);
    await f.store.persist.rehydrate();
    assert.equal(f.slope().damage.length, 0);
    assert.equal(f.slope().aiFindings.length, 0);
    assert.equal(f.slope().hailCount, 0);
    assert.equal(f.slope().functional, false);
    assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.markers?.some(m => m.id === 'legacy-unindexed')));
    assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.findings?.some(finding => finding.count === 1)));
  }

  // Legacy duplicate-URI metadata cannot be defensibly assigned to either
  // attachment. Migration preserves it as history and does not fabricate Done.
  f = fixture();
  f.store.getState().attachRawPhotos('job', [{ uri: 'b', slope: 'N' }]);
  f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl,
    photoAnalysisByAttachment: undefined, photoAnalysis: { b: { status: 'done', at: 'legacy', shingleCount: 99 } },
  })) })) }));
  f.store.getState().ensurePhotoAttachmentIds('job', f.slopeId);
  await f.store.persist.rehydrate();
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1), undefined);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 3), undefined);
  assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.analysis?.shingleCount === 99));

  // R3: current-version hydration validates every active evidence collection.
  f = fixture();
  const validId = f.slope().photoAttachmentIds[1];
  f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl,
    damage: [{ ...marker('valid'), photoIndex: 1 }, marker('unindexed'), { ...marker('out-of-range'), photoIndex: 99 }],
    hailCount: 100,
    aiFindings: [{ label: 'hail_hits', photoAttachmentId: validId, count: 1 }, { label: 'hail_hits', photoAttachmentId: 'orphan', count: 99 }, { label: 'hail_hits', count: 50 }],
    photoAnalysisByAttachment: { ghost: { status: 'done', at: 'legacy', shingleCount: 99 } },
  })) })) }));
  await f.store.persist.rehydrate();
  assert.deepEqual(plain(f.slope().damage.map(marker => marker.id)), ['valid']);
  assert.equal(f.slope().hailCount, 1);
  assert.equal(f.slope().aiFindings.length, 1);
  assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.markers?.some(marker => marker.id === 'out-of-range')));
  assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.findings?.some(finding => finding.count === 99)));
  assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.analysis?.shingleCount === 99));
  const historyCount = f.slope().historicalPhotoEvidence.length;
  await f.store.persist.rehydrate();
  assert.equal(f.slope().historicalPhotoEvidence.length, historyCount, 'normalization is idempotent, never duplicates historical evidence');

  // No photos means no active evidence or fabricated completion, even when
  // loading an old record without analyzedPhotoIndices.
  f = fixture();
  f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl,
    photoPaths: [], photoAttachmentIds: undefined, analyzedPhotoIndices: undefined,
    damage: [marker('ghost')], aiFindings: [{ count: 1 }], hailCount: 1,
  })) })) }));
  await f.store.persist.rehydrate();
  assert.equal(f.slope().hailCount, 0);
  assert.equal(f.slope().damage.length, 0);
  assert.equal(f.slope().aiFindings.length, 0);
  assert.equal(f.wasAnalyzed(f.slope(), 0), false);
  assert.deepEqual(plain(f.photoProgress(f.store.getState().getById('job'))), { done: 0, total: 0 });

  f = fixture();
  f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl, analyzedPhotoIndices: undefined })) })) }));
  f.store.getState().replacePhoto('job', f.slopeId, 1, 'replacement');
  assert.equal(f.wasAnalyzed(f.slope(), 1), false);
  assert.equal(f.photoProgress(f.store.getState().getById('job')).done, 0);

  // Capture UI and production pump resolve identities, not their original
  // indices: B failed/C done stays B failed after A is deleted.
  f = fixture();
  const capturedB = { uri: 'b', inspectionId: 'job', slopeId: f.slopeId, photoIndex: 1, attachmentId: f.slope().photoAttachmentIds[1] };
  const capturedC = { uri: 'c', inspectionId: 'job', slopeId: f.slopeId, photoIndex: 2, attachmentId: f.slope().photoAttachmentIds[2] };
  f.service.setPhotoAnalysisState('job', f.slopeId, 'b', { status: 'failed', error: 'B failed' }, capturedB.attachmentId);
  f.service.setPhotoAnalysisState('job', f.slopeId, 'c', { status: 'done', findingCount: 5 }, capturedC.attachmentId);
  f.remove(0);
  assert.equal(f.captureHelpers.stripStateFor(capturedB, f.store.getState().getById('job')).status, 'failed');
  assert.equal(f.captureHelpers.stripStateFor(capturedC, f.store.getState().getById('job')).status, 'done');
  assert.deepEqual(await f.pump([capturedB]), [[0]], 'capture pump submits B at current index zero, never C at stale index one');
  f.store.getState().attachRawPhotos('job', [{ uri: 'b', slope: 'N' }]);
  const duplicateB = { ...capturedB, photoIndex: 2, attachmentId: f.slope().photoAttachmentIds[2] };
  f.remove(0);
  assert.deepEqual(await f.pump([duplicateB]), [[1]], 'duplicate URI resolves by exact attachment');
  assert.equal(f.captureHelpers.resolveCapturedPhoto(capturedB, f.store.getState().getById('job')), undefined, 'removed capture cannot alias reattached URI');

  // R4: the production annotation route and overlay share one live attachment.
  f = fixture();
  const annotationB = { uri: 'b', inspectionId: 'job', slopeId: f.slopeId, photoIndex: 1, attachmentId: f.slope().photoAttachmentIds[1] };
  f.store.getState().replacePhotoMarkers('job', f.slopeId, 1, [marker('b-overlay')]);
  f.store.getState().replacePhotoMarkers('job', f.slopeId, 2, [marker('c-overlay')]);
  f.remove(0);
  const route = f.annotateRoute(annotationB)[0];
  assert.equal(route.params.index, '0');
  assert.equal(route.params.attachmentId, annotationB.attachmentId);
  let overlay = f.annotationTarget(f.store.getState().getById('job'), { uri: 'b', slopeId: f.slopeId, index: 1 });
  assert.deepEqual(plain(overlay.markers.map(marker => marker.id)), ['b-overlay'], 'supplied B URI cannot borrow C overlay from stale index');
  assert.equal(f.annotationTarget(f.store.getState().getById('job'), { uri: 'c', attachmentId: annotationB.attachmentId }), undefined);
  f.store.getState().attachRawPhotos('job', [{ uri: 'b', slope: 'N' }]);
  assert.equal(f.annotationTarget(f.store.getState().getById('job'), { uri: 'b', slopeId: f.slopeId }), undefined, 'URI-only duplicate annotation is ambiguous');
  f.remove(0);
  assert.deepEqual(f.annotateRoute(annotationB), [], 'removed original cannot route to another B');

  // R4: duplicated persisted IDs have no privileged first owner. Only their
  // identity-owned evidence is quarantined; unrelated neighbor remains intact.
  f = fixture();
  f.store.setState(state => ({ inspections: state.inspections.map(ins => ({ ...ins, slopes: ins.slopes.map(sl => ({ ...sl,
    photoAttachmentIds: ['duplicate', 'duplicate', 'legitimate'],
    photoAnalysisByAttachment: { duplicate: { status: 'done', at: 'old', subject: 'gutter' }, legitimate: { status: 'done', at: 'valid', shingleCount: 12 } },
    aiFindings: [{ photoAttachmentId: 'duplicate', count: 99 }, { photoAttachmentId: 'legitimate', count: 1 }],
    scaleEstimates: [{ photoIndex: 2, pixelsPerInch: 10, confidence: 80 }, { photoIndex: 99, pixelsPerInch: 42, confidence: 70 }],
  })) })) }));
  await f.store.persist.rehydrate();
  assert.ok(!f.slope().photoAttachmentIds.includes('duplicate'));
  assert.equal(f.slope().photoAttachmentIds[2], 'legitimate');
  assert.deepEqual(plain(f.slope().aiFindings.map(finding => finding.photoAttachmentId)), ['legitimate']);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 0), undefined);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1), undefined);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 2).shingleCount, 12);
  assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.analysis?.subject === 'gutter'));
  assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.findings?.some(finding => finding.count === 99)));
  assert.deepEqual(plain(f.slope().scaleEstimates.map(scale => scale.photoIndex)), [2]);
  assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.scaleEstimates?.some(scale => scale.pixelsPerInch === 42)), 'orphan scale is retained as audit data');

  // R4: hydration writes the normalized IDs, so another hydration without
  // any intervening mutation reads those exact same durable identities.
  f = fixture();
  const legacy = plain(f.store.getState().getById('job'));
  legacy.slopes[0].photoAttachmentIds = undefined;
  legacy.slopes[0].photoAnalysisByAttachment = undefined;
  f.storage.set('roofwise.inspections.v1', JSON.stringify({ version: 1, state: { inspections: [legacy], nextOrdinal: 2 } }));
  await f.store.persist.rehydrate();
  const acceptedIds = plain(f.slope().photoAttachmentIds);
  const durableIds = JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].slopes[0].photoAttachmentIds;
  assert.deepEqual(durableIds, acceptedIds);
  await f.store.persist.rehydrate();
  assert.deepEqual(plain(f.slope().photoAttachmentIds), acceptedIds);
  f.applyRemote([legacy], 1);
  const remoteIds = plain(f.slope().photoAttachmentIds);
  f.applyRemote([legacy], 1);
  assert.deepEqual(plain(f.slope().photoAttachmentIds), remoteIds, 'repeated legacy remote payload cannot invalidate stable review identities');
  const reordered = plain(legacy);
  reordered.slopes[0].photoPaths.reverse();
  f.applyRemote([reordered], 1);
  assert.notDeepEqual(plain(f.slope().photoAttachmentIds), remoteIds, 'changed attachment sequence cannot reuse positional identity');
  const duplicateRemote = plain(legacy);
  duplicateRemote.slopes[0].photoAttachmentIds = ['reused-id', 'reused-id', 'valid-neighbor'];
  duplicateRemote.slopes[0].photoAnalysisByAttachment = { 'reused-id': { status: 'done', at: 'old' }, 'valid-neighbor': { status: 'done', at: 'valid', shingleCount: 4 } };
  f.applyRemote([duplicateRemote], 1);
  const repairedRemoteIds = plain(f.slope().photoAttachmentIds);
  f.applyRemote([duplicateRemote], 1);
  assert.deepEqual(plain(f.slope().photoAttachmentIds), repairedRemoteIds);
  assert.equal(f.slope().photoAttachmentIds[2], 'valid-neighbor');
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 2).shingleCount, 4);

  // R5: true async adapter + real production persistence. Quarantine incoming
  // duplicate A BEFORE prior [A,B,C] can be reconciled back into the record.
  f = fixture({ asynchronousPersistence: true });
  await f.store.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
  const priorIds = plain(f.slope().photoAttachmentIds);
  const duplicatedA = plain(f.store.getState().getById('job'));
  duplicatedA.slopes[0].photoAttachmentIds = [priorIds[0], priorIds[0], priorIds[2]];
  duplicatedA.slopes[0].photoAnalysisByAttachment = {
    [priorIds[0]]: { status: 'done', at: 'ambiguous', shingleCount: 99 },
    [priorIds[2]]: { status: 'done', at: 'valid', shingleCount: 4 },
  };
  duplicatedA.slopes[0].aiFindings = [{ photoAttachmentId: priorIds[0], count: 99 }, { photoAttachmentId: priorIds[2], count: 4 }];
  f.applyRemote([duplicatedA], 1);
  await f.persistence.flushInspectionPersistence();
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 0), undefined);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 1), undefined);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 2).shingleCount, 4);
  assert.deepEqual(plain(f.slope().aiFindings.map(finding => finding.count)), [4]);
  assert.ok(f.slope().historicalPhotoEvidence.some(entry => entry.analysis?.shingleCount === 99));
  await f.store.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 0), undefined);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 2).shingleCount, 4);
  const duplicateLegacyState = plain(duplicatedA);
  duplicateLegacyState.slopes[0].photoAnalysisByAttachment = undefined;
  duplicateLegacyState.slopes[0].photoAnalysis = { a: { status: 'done', at: 'ambiguous', shingleCount: 99 }, c: { status: 'done', at: 'valid', shingleCount: 4 } };
  f.applyRemote([duplicateLegacyState], 1);
  await f.persistence.flushInspectionPersistence();
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 0), undefined);
  assert.equal(f.service.getPhotoAnalysisState(f.slope(), 2).shingleCount, 4, 'valid neighbor survives even on the legacy URI-state format');

  // Delayed read snapshots OLD bytes, then a real edit is durably flushed.
  // Releasing the old read cannot restore its stale note in memory or on disk.
  f.store.getState().setNotes('job', 'before delayed read');
  await f.persistence.flushInspectionPersistence();
  const delayedRead = f.holdStorageRead();
  const hydration = f.store.persist.rehydrate();
  await delayedRead.entered.promise;
  f.store.getState().setNotes('job', 'inspector edit during read');
  await f.persistence.flushInspectionPersistence();
  assert.equal(JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].notes, 'inspector edit during read');
  const overlappingHydration = f.store.persist.rehydrate();
  delayedRead.resolve();
  await Promise.all([hydration, overlappingHydration]);
  await f.persistence.flushInspectionPersistence();
  assert.equal(f.store.getState().getById('job').notes, 'inspector edit during read');
  assert.equal(JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].notes, 'inspector edit during read');

  // The async migration itself is durable and stable with no mutation between
  // repeated rehydrates. New reads wait for the accepted normalized write.
  const oldAsync = plain(f.store.getState().getById('job'));
  oldAsync.slopes[0].photoAttachmentIds = undefined;
  oldAsync.slopes[0].photoAnalysisByAttachment = undefined;
  f.storage.set('roofwise.inspections.v1', JSON.stringify({ version: 1, state: { inspections: [oldAsync], nextOrdinal: 2 } }));
  await f.store.persist.rehydrate();
  const asyncAccepted = plain(f.slope().photoAttachmentIds);
  await f.store.persist.rehydrate();
  await f.persistence.flushInspectionPersistence();
  assert.deepEqual(plain(f.slope().photoAttachmentIds), asyncAccepted);
  assert.deepEqual(JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].slopes[0].photoAttachmentIds, asyncAccepted);
  const removalRead = f.holdStorageRead();
  const removalHydration = f.store.persist.rehydrate();
  await removalRead.entered.promise;
  f.store.getState().remove('job');
  f.store.getState().create({ id: 'new-during-read', customerName: 'New', address: 'New', material: 'asphalt_architectural' });
  await f.persistence.flushInspectionPersistence();
  removalRead.resolve();
  await removalHydration; await f.persistence.flushInspectionPersistence();
  assert.equal(f.store.getState().getById('job'), undefined, 'a delayed read cannot resurrect a removed inspection');
  assert.ok(f.store.getState().getById('new-during-read'), 'a delayed read cannot discard a newly created inspection');
  assert.deepEqual(JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections.map(inspection => inspection.id), ['new-during-read']);
  // R6: a unique incoming neighbor reserves its ID BEFORE positional repair.
  for (const permutation of [[1, 1, 0], [2, 1, 1], [2, 0, 0], [-1, 0, 2]]) {
    f = fixture({ asynchronousPersistence: true });
    await f.store.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
    const prior = plain(f.slope().photoAttachmentIds);
    const incoming = plain(f.store.getState().getById('job'));
    incoming.slopes[0].photoAttachmentIds = permutation.map(i => prior[i]);
    const uniqueIndex = permutation.findIndex(i => i >= 0 && permutation.filter(other => other === i).length === 1);
    const preservedId = prior[permutation[uniqueIndex]];
    incoming.slopes[0].photoAnalysisByAttachment = { [preservedId]: { status: 'done', at: 'valid', shingleCount: 4 } };
    incoming.slopes[0].aiFindings = [{ photoAttachmentId: preservedId, photoPath: incoming.slopes[0].photoPaths[uniqueIndex], count: 4 }];
    f.applyRemote([incoming], 1);
    const accepted = plain(f.slope().photoAttachmentIds);
    assert.equal(new Set(accepted).size, 3);
    assert.equal(accepted[uniqueIndex], preservedId, 'valid incoming owner cannot be stolen by a fallback');
    assert.equal(f.service.getPhotoAnalysisState(f.slope(), uniqueIndex).shingleCount, 4);
    assert.deepEqual(plain(f.slope().aiFindings.map(finding => finding.count)), [4]);
    f.applyRemote([incoming], 1);
    assert.deepEqual(plain(f.slope().photoAttachmentIds), accepted, 'repair stays stable on repeated remote payload');
    await f.persistence.flushInspectionPersistence(); await f.store.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
    assert.deepEqual(plain(f.slope().photoAttachmentIds), accepted);
    assert.equal(f.service.getPhotoAnalysisState(f.slope(), uniqueIndex).shingleCount, 4);
    assert.equal(JSON.parse(f.storage.get('roofwise.inspections.v1')).state.inspections[0].slopes[0].photoAttachmentIds[uniqueIndex], preservedId);
  }

  // Real annotation store, async hydration/persistence, and inspection mutations.
  f = fixture({ asynchronousPersistence: true });
  await f.store.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
  const drawing = id => ({ id, kind: 'circle', color: 'danger', width: 0.01, rect: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, createdAt: '2026-01-01' });
  const legacyDrawing = { uri: 'a', items: [drawing('legacy')], imageW: 100, imageH: 200, updatedAt: '2026-01-01' };
  f.storage.set('roofwise.annotations.v1', JSON.stringify({ version: 1, state: { byUri: { a: legacyDrawing } } }));
  const annotations = f.loadAnnotations();
  await annotations.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
  const originalA = f.slope().photoAttachmentIds[0];
  assert.equal(annotations.getState().get('a', originalA)[0].id, 'legacy', 'unique legacy URI safely adopts exact attachment');
  f.store.getState().attachRawPhotos('job', [{ uri: 'a', slope: 'N', captureMode: 'square_10x10', areaTag: 'Rear Slope' }]);
  const duplicateA = f.slope().photoAttachmentIds[3];
  assert.equal(annotations.getState().count('a', duplicateA), 0);
  assert.equal(annotations.getState().count('a'), 0, 'URI-only duplicate is ambiguous');
  await annotations.getState().set('a', [drawing('duplicate')], undefined, duplicateA);
  const annotationPdf = extractedFunction('lib/services/haagPdf.ts', 'annotationsFor', { useAnnotationStore: annotations });
  assert.equal(annotations.getState().get('a', originalA)[0].id, 'legacy');
  assert.equal(annotations.getState().get('a', duplicateA)[0].id, 'duplicate');
  assert.equal(annotationPdf('a', originalA).items[0].id, 'legacy');
  assert.equal(annotationPdf('a', duplicateA).items[0].id, 'duplicate', 'PDF reads the exact attachment drawing');
  const annotationReordered = plain(f.store.getState().getById('job'));
  const reorderedSlope = annotationReordered.slopes[0];
  reorderedSlope.photoPaths.reverse(); reorderedSlope.photoAttachmentIds.reverse(); reorderedSlope.photoMeta.reverse();
  f.applyRemote([annotationReordered], 1);
  assert.equal(annotations.getState().get('a', duplicateA)[0].id, 'duplicate', 'drawings follow ID across reorder');
  f.store.getState().removePhoto('job', f.slopeId, 3);
  assert.equal(annotations.getState().count('a', originalA), 0, 'removed owner is not a live overlay');
  assert.equal(annotations.getState().get('a', duplicateA)[0].id, 'duplicate');
  assert.equal(annotations.getState().byAttachment[originalA].items[0].id, 'legacy', 'removed drawing retained for audit');
  f.store.getState().replacePhoto('job', f.slopeId, 0, 'a');
  const reusedA = f.slope().photoAttachmentIds[0];
  assert.equal(annotations.getState().count('a', reusedA), 0, 'same URI replacement does not inherit drawings');
  assert.equal(await annotations.getState().set('a', [drawing('stale-save')], undefined, duplicateA), false);
  assert.equal(annotations.getState().count('a', reusedA), 0, 'stale editor cannot save onto replacement');
  await f.persistence.flushInspectionPersistence(); await annotations.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
  assert.equal(annotations.getState().count('a', reusedA), 0);
  assert.equal(annotations.getState().byAttachment[originalA].items[0].id, 'legacy');
  assert.equal(JSON.parse(f.storage.get('roofwise.annotations.v1')).state.byAttachment[duplicateA].items[0].id, 'duplicate');
  await annotations.getState().set('a', [drawing('replacement')], undefined, reusedA);
  await f.persistence.flushInspectionPersistence();
  const annotationRead = f.holdStorageRead();
  const annotationHydration = annotations.persist.rehydrate();
  await annotationRead.entered.promise;
  const clearingLoaded = annotations.getState().clear('a', reusedA);
  await f.persistence.flushInspectionPersistence();
  annotationRead.resolve(); await annotationHydration; await clearingLoaded; await annotations.getState().flush();
  assert.equal(annotations.getState().count('a', reusedA), 0, 'delayed hydration cannot resurrect a cleared drawing');
  assert.equal(JSON.parse(f.storage.get('roofwise.annotations.v1')).state.byAttachment[reusedA], undefined);
  const annotationRestartBytes = f.storage.get('roofwise.annotations.v1');
  const annotationRestartInspection = plain(f.store.getState().getById('job'));
  f = fixture({ asynchronousPersistence: true });
  await f.store.persist.rehydrate();
  f.applyRemote([annotationRestartInspection], 1);
  await f.persistence.flushInspectionPersistence();
  f.storage.set('roofwise.annotations.v1', annotationRestartBytes);
  const restartedAnnotations = f.loadAnnotations();
  await restartedAnnotations.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
  assert.equal(restartedAnnotations.getState().count('a', reusedA), 0, 'fresh store keeps replacement drawing cleared');
  assert.equal(restartedAnnotations.getState().byAttachment[originalA].items[0].id, 'legacy');
  assert.equal(restartedAnnotations.getState().byAttachment[duplicateA].items[0].id, 'duplicate', 'fresh store preserves both retired attachment drawings');

  f = fixture({ asynchronousPersistence: true });
  await f.store.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
  f.store.getState().attachRawPhotos('job', [{ uri: 'a', slope: 'N', captureMode: 'square_10x10', areaTag: 'Rear Slope' }]);
  await f.persistence.flushInspectionPersistence();
  f.storage.set('roofwise.annotations.v1', JSON.stringify({ version: 1, state: { byUri: { a: legacyDrawing } } }));
  const ambiguousAnnotations = f.loadAnnotations();
  await ambiguousAnnotations.persist.rehydrate(); await f.persistence.flushInspectionPersistence();
  assert.equal(ambiguousAnnotations.getState().count('a', f.slope().photoAttachmentIds[0]), 0);
  assert.equal(ambiguousAnnotations.getState().count('a', f.slope().photoAttachmentIds[3]), 0);
  f.store.getState().removePhoto('job', f.slopeId, 3);
  assert.equal(ambiguousAnnotations.getState().count('a', f.slope().photoAttachmentIds[0]), 0, 'ambiguity cannot become falsely owned after deletion');
  assert.equal(ambiguousAnnotations.getState().byUri.a.items[0].id, 'legacy', 'ambiguous legacy drawing remains in audit storage');

  // R7: compile the actual editor Save handler in the native Node realm and
  // drive it against real production store + ordered async persistence.
  f = fixture({ asynchronousPersistence: true });
  await f.store.persist.rehydrate();
  const durableAnnotations = f.loadAnnotations();
  await durableAnnotations.persist.rehydrate(); await durableAnnotations.getState().flush();
  const durableId = f.slope().photoAttachmentIds[0];
  const draft = [drawing('durable-draft')];
  const saveUi = { uri: 'a', present: draft, target: { attachmentId: durableId }, img: { width: 100, height: 200 },
    setItems: durableAnnotations.getState().set, savedRef: { current: [] }, dirtyRef: { current: true }, leavingRef: { current: false },
    presentRef: { current: draft }, savingRef: { current: false }, saving: [], notices: [], navigation: [],
    setSaving: value => saveUi.saving.push(value), toast: value => saveUi.notices.push(value),
    router: { back: () => saveUi.navigation.push('back') },
    Haptics: { notificationAsync: async () => {}, NotificationFeedbackType: { Success: 'success' } },
  };
  const annotateSource = fs.readFileSync(path.join(root, 'app/annotate.tsx'), 'utf8');
  const annotateAst = ts.createSourceFile('annotate.tsx', annotateSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const annotateComponent = annotateAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'AnnotateScreen');
  const saveDeclaration = annotateComponent.body.statements.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(d => d.name.getText(annotateAst) === 'onSave'));
  const saveExports = {};
  new Function(...Object.keys(saveUi), 'exports', compile(saveDeclaration.getText(annotateAst) + '\nexports.onSave = onSave;'))(...Object.values(saveUi), saveExports);
  f.failAnnotationWrite();
  await saveExports.onSave();
  assert.equal(saveUi.dirtyRef.current, true, 'storage failure keeps the actual editor dirty');
  assert.deepEqual(saveUi.savedRef.current, []);
  assert.deepEqual(saveUi.navigation, [], 'failed write cannot navigate');
  assert.equal(saveUi.leavingRef.current, false);
  assert.equal(saveUi.notices.at(-1).title, 'Drawing not saved');
  assert.equal(saveUi.presentRef.current, draft, 'draft is retained for retry');
  const heldSave = f.holdAnnotationWrite();
  const retrySave = saveExports.onSave();
  await heldSave.entered.promise;
  assert.equal(saveUi.dirtyRef.current, true);
  assert.deepEqual(saveUi.navigation, [], 'no success while the actual storage write is pending');
  heldSave.resolve(); await retrySave;
  assert.equal(saveUi.dirtyRef.current, false);
  assert.deepEqual(saveUi.navigation, ['back']);
  assert.equal(JSON.parse(f.storage.get('roofwise.annotations.v1')).state.byAttachment[durableId].items[0].id, 'durable-draft');

  // Clearing an UNREAD record must register a revision even though both
  // baseline and current maps are absent. Preserve unread neighboring data.
  const unreadInspection = plain(f.store.getState().getById('job'));
  const unreadBytes = JSON.stringify({ version: 2, state: { byUri: {}, legacyOwners: {}, byAttachment: {
    [durableId]: { ...legacyDrawing, items: [drawing('unread')] },
    [f.slope().photoAttachmentIds[1]]: { ...legacyDrawing, uri: 'b', items: [drawing('unread-neighbor')] },
  } } });
  f = fixture({ asynchronousPersistence: true });
  await f.store.persist.rehydrate(); f.applyRemote([unreadInspection], 1); await f.persistence.flushInspectionPersistence();
  f.storage.set('roofwise.annotations.v1', unreadBytes);
  const unreadGate = f.holdStorageRead();
  const unreadAnnotations = f.loadAnnotations();
  await unreadGate.entered.promise;
  const unreadClear = unreadAnnotations.getState().clear('a', durableId);
  assert.equal(unreadAnnotations.getState().count('a', durableId), 0);
  assert.equal(f.storage.get('roofwise.annotations.v1'), unreadBytes, 'never overwrite unread neighbors with an incomplete store');
  unreadGate.resolve(); await unreadClear; await unreadAnnotations.getState().flush();
  assert.equal(unreadAnnotations.getState().count('a', durableId), 0);
  const clearedBytes = f.storage.get('roofwise.annotations.v1');
  assert.equal(JSON.parse(clearedBytes).state.byAttachment[durableId], undefined);
  assert.equal(JSON.parse(clearedBytes).state.byAttachment[f.slope().photoAttachmentIds[1]].items[0].id, 'unread-neighbor');
  await unreadAnnotations.persist.rehydrate();
  assert.equal(unreadAnnotations.getState().count('a', durableId), 0);
  f = fixture({ asynchronousPersistence: true });
  await f.store.persist.rehydrate(); f.applyRemote([unreadInspection], 1); await f.persistence.flushInspectionPersistence();
  f.storage.set('roofwise.annotations.v1', clearedBytes);
  const clearRestart = f.loadAnnotations(); await clearRestart.persist.rehydrate();
  assert.equal(clearRestart.getState().count('a', durableId), 0, 'unread clear survives a fresh store restart');

  const raceGate = f.holdAnnotationWrite();
  const oldSet = clearRestart.getState().set('a', [drawing('older-set')], undefined, durableId);
  await raceGate.entered.promise;
  const latestClear = clearRestart.getState().clear('a', durableId);
  raceGate.resolve(); await Promise.all([oldSet, latestClear]);
  assert.equal(clearRestart.getState().count('a', durableId), 0);
  assert.equal(JSON.parse(f.storage.get('roofwise.annotations.v1')).state.byAttachment[durableId], undefined, 'set then clear is durably clear');
  const clearGate = f.holdAnnotationWrite();
  const olderClear = clearRestart.getState().clear('a', durableId);
  await clearGate.entered.promise;
  const latestSet = clearRestart.getState().set('a', [drawing('latest-set')], undefined, durableId);
  clearGate.resolve(); await Promise.all([olderClear, latestSet]);
  assert.equal(JSON.parse(f.storage.get('roofwise.annotations.v1')).state.byAttachment[durableId].items[0].id, 'latest-set');
  // A later successful write must not hide the earlier caller's failure.
  const failureGate = f.holdAnnotationWrite();
  f.failAnnotationWrite();
  const failedOlder = clearRestart.getState().set('a', [drawing('will-fail')], undefined, durableId);
  const rejectedOlder = assert.rejects(failedOlder, /could not be saved/);
  await failureGate.entered.promise;
  const successfulNewer = clearRestart.getState().set('a', [drawing('successful-newer')], undefined, durableId);
  failureGate.resolve(); await rejectedOlder; await successfulNewer;
  assert.equal(JSON.parse(f.storage.get('roofwise.annotations.v1')).state.byAttachment[durableId].items[0].id, 'successful-newer');
  // R8: a durable write is not a successful live save if its attachment was
  // removed/replaced while storage was pending. Run the actual editor handler.
  for (const mutation of ['remove', 'replace']) {
    f = fixture({ asynchronousPersistence: true });
    await f.store.persist.rehydrate();
    const pendingAnnotations = f.loadAnnotations(); await pendingAnnotations.persist.rehydrate();
    const pendingId = f.slope().photoAttachmentIds[0];
    const pendingDraft = [drawing('pending-owner-' + mutation)];
    const pendingUi = { ...saveUi, present: pendingDraft, target: { attachmentId: pendingId }, setItems: pendingAnnotations.getState().set,
      savedRef: { current: [] }, dirtyRef: { current: true }, leavingRef: { current: false },
      presentRef: { current: pendingDraft }, savingRef: { current: false }, saving: [], notices: [], navigation: [],
      setSaving: value => pendingUi.saving.push(value), toast: value => pendingUi.notices.push(value), router: { back: () => pendingUi.navigation.push('back') },
    };
    const pendingExports = {};
    new Function(...Object.keys(pendingUi), 'exports', compile(saveDeclaration.getText(annotateAst) + '\nexports.onSave = onSave;'))(...Object.values(pendingUi), pendingExports);
    const ownerWrite = f.holdAnnotationWrite();
    const savingOwner = pendingExports.onSave();
    await ownerWrite.entered.promise;
    if (mutation === 'remove') f.store.getState().removePhoto('job', f.slopeId, 0);
    else f.store.getState().replacePhoto('job', f.slopeId, 0, 'a');
    ownerWrite.resolve(); await savingOwner; await pendingAnnotations.getState().flush(); await f.persistence.flushInspectionPersistence();
    assert.equal(pendingUi.dirtyRef.current, true, 'ownership loss after acknowledgement must keep draft dirty');
    assert.deepEqual(pendingUi.navigation, [], 'ownership loss cannot report success and navigate');
    assert.equal(pendingUi.leavingRef.current, false);
    assert.deepEqual(pendingUi.savedRef.current, []);
    assert.equal(pendingUi.notices.at(-1).title, 'Photo changed');
    assert.equal(pendingUi.notices.some(notice => notice.tone === 'success'), false);
    assert.equal(pendingAnnotations.getState().count('a', pendingId), 0);
    const auditedBytes = f.storage.get('roofwise.annotations.v1');
    assert.equal(JSON.parse(auditedBytes).state.byAttachment[pendingId].items[0].id, pendingDraft[0].id, 'held write and removal both preserve orphan audit');
    await pendingExports.onSave();
    assert.equal(pendingUi.notices.at(-1).title, 'Photo changed', 'retry refuses the removed original');
    assert.deepEqual(pendingUi.navigation, []);
    assert.equal(f.storage.get('roofwise.annotations.v1'), auditedBytes, 'refused retry cannot overwrite audit');
    if (mutation === 'remove') f.store.getState().attachRawPhotos('job', [{ uri: 'a', slope: 'N', captureMode: 'square_10x10', areaTag: 'Rear Slope' }]);
    const newIndex = f.slope().photoPaths.indexOf('a');
    assert.equal(pendingAnnotations.getState().count('a', f.slope().photoAttachmentIds[newIndex]), 0);
    await pendingExports.onSave();
    assert.deepEqual(pendingUi.navigation, [], 'same URI reuse cannot make the stale editor valid');
    await pendingAnnotations.persist.rehydrate();
    assert.equal(pendingAnnotations.getState().byAttachment[pendingId].items[0].id, pendingDraft[0].id);
  }
  console.log('PASS: attachment identity, persistence races, recovery, capture targeting, and attachment-owned annotations');
}
let completed = false;
process.once('beforeExit', () => {
  if (!completed) { console.error('FAIL: identity suite exited with an unresolved test checkpoint'); process.exitCode = 1; }
});
main().then(() => { completed = true; }).catch(error => { completed = true; console.error(error); process.exitCode = 1; });
