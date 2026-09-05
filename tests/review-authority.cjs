// node tests/review-authority.cjs [--baseline]
// Real production stores, persistence, review handler, reconciliation and engine.
// Only device storage and unrelated native/network collaborators are substituted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const compile = source => ts.transpileModule(source, { compilerOptions: {
  // Downlevel async so VM functions use the injected host Promise; Zustand's
  // AsyncStorage adapter intentionally checks instanceof Promise.
  target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;
const marker = id => ({ id, category: 'hail_hits', severity: 'moderate', confidence: 79,
  evidence: 'exposed_substrate', x: 0.5, y: 0.5, radius: 0.03 });
const finding = { label: 'hail_hits', detected: true, severity: 'moderate', confidence: 79, count: 1 };

async function fixture(storage = new Map()) {
  const cache = new Map();
  const printed = [];
  let failKey, holdKey, release;
  const adapter = {
    getItem: async key => storage.get(key) ?? null,
    setItem: async (key, value) => {
      if (key === holdKey) await new Promise(resolve => { release = resolve; });
      if (key === failKey) throw new Error('disk full');
      storage.set(key, value);
    },
    removeItem: async key => storage.delete(key),
  };
  const constants = {
    'lib/services/propertyRecord.ts': { roofAgePrefill: () => ({}) },
    'lib/stores/leadStore.ts': { useLeadStore: { getState: () => ({ leads: [] }) } },
    'lib/stores/activityStore.ts': { useActivityStore: { getState: () => ({ log: () => {} }) } },
    'lib/stores/inspectorProfileStore.ts': { useInspectorProfileStore: { getState: () => ({ profile: {} }) }, hasCompanyBranding: () => false },
    'lib/stores/annotationStore.ts': { useAnnotationStore: { getState: () => ({ getRecord: () => undefined }) } },
    'lib/services/telemetry.ts': { recordReportMs: async () => {} },
  };
  function load(file) {
    if (constants[file]) return constants[file];
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const resolve = id => {
      if (id === 'zustand' || id === 'zustand/middleware') return require(id);
      if (id === '@react-native-async-storage/async-storage') return adapter;
      if (id === 'react-native') return { Platform: { OS: 'web', select: choices => choices.web ?? choices.default } };
      if (id === 'expo-print') return { printToFileAsync: async ({ html }) => { printed.push(html); return { uri: 'test-report.pdf' }; } };
      if (id === 'expo-image-manipulator') return { SaveFormat: { JPEG: 'jpeg' }, manipulateAsync: async () => ({ base64: 'test-image' }) };
      if (id.startsWith('@/')) return load(id.slice(2) + '.ts');
      if (id.startsWith('.')) return load(path.normalize(path.join(path.dirname(file), id)) + '.ts');
      throw new Error('Unexpected import ' + id);
    };
    vm.runInNewContext(compile(fs.readFileSync(path.join(root, file), 'utf8')),
      { exports, require: resolve, console, Error, Promise, process: { env: {} }, __DEV__: false }, { filename: file });
    return exports;
  }
  const inspections = load('lib/stores/inspectionStore.ts').useInspectionStore;
  const queue = load('lib/stores/trainingQueueStore.ts').useTrainingQueueStore;
  const corrections = load('lib/stores/correctionsStore.ts').useCorrectionsStore;
  await Promise.all([inspections, queue, corrections].map(s => s.persist.rehydrate()));
  const service = load('lib/services/rejectReviewItem.ts');
  const flush = async () => {
    await load('lib/services/inspectionPersistence.ts').flushInspectionPersistence();
    await load('lib/services/reviewPersistence.ts').flushReviewPersistence();
  };
  const inspection = () => inspections.getState().getById('job');
  const slope = () => inspection().slopes[0];
  if (!inspection()) {
    inspections.getState().create({ id: 'job', customerName: 'Test', address: 'Test',
      material: 'architectural_asphalt', geometry: 'gable', condition: 'fair', ageYears: 10 });
    inspections.getState().attachRawPhotos('job', ['a', 'b'].map(uri => ({ uri, slope: 'N', captureMode: 'square_10x10' })));
    inspections.getState().replacePhotoMarkers('job', slope().id, 0, [marker('a-hit')]);
    inspections.getState().replacePhotoMarkers('job', slope().id, 1, [{ ...marker('b-hit'), category: 'granule_loss' }]);
    inspections.setState({ inspections: [{ ...inspection(), storedEngineResult: { stale: true }, slopes: [{ ...slope(),
      aiFindings: [{ ...finding, photoPath: 'a' }, { ...finding, label: 'granule_loss', photoPath: 'b' }],
      photoAnalysis: { a: { status: 'done', at: '2026-09-04T00:00:00Z', findingCount: 1, subject: 'roof_field' },
        b: { status: 'done', at: '2026-09-04T00:00:00Z', findingCount: 1 } },
      photoAnalysisByAttachment: Object.fromEntries(slope().photoAttachmentIds.map(id => [id,
        { status: 'done', at: '2026-09-04T00:00:00Z', findingCount: 1, subject: 'roof_field' }])),
    }] }] });
    queue.getState().enqueue({ inspectionId: 'job', slopeId: slope().id, photoPath: 'a',
      findings: [finding], markers: [marker('a-hit')],
      reviewEvidence: { attachmentId: slope().photoAttachmentIds[0], markers: [marker('a-hit')], findings: [finding], analysisAt: slope().photoAnalysis.a.at },
    });
    await flush();
  }
  const reject = () => service.rejectReviewItem(queue.getState().items[0].id);
  const mutate = patch => inspections.setState({ inspections: [{ ...inspection(), slopes: [{ ...slope(), ...patch,
    ...(patch.photoAnalysis ? { photoAnalysisByAttachment: Object.fromEntries(slope().photoPaths.map((uri, index) =>
      [slope().photoAttachmentIds[index], patch.photoAnalysis[uri]])) } : {}),
  }] }] });
  return { load, storage, printed, inspections, inspection, slope, queue, corrections, reject, flush, mutate,
    fail: key => { failKey = key; }, hold: key => { holdKey = key; },
    release: () => { holdKey = undefined; release?.(); },
  };
}

async function screenReject(f, verdict = 'reject') {
  const source = process.argv.includes('--baseline')
    ? execFileSync('git', ['show', 'HEAD:app/swipe-review.tsx'], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'app/swipe-review.tsx'), 'utf8');
  const ast = ts.createSourceFile('swipe.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'SwipeReview');
  const handler = component.body.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'handleVerdict'));
  const toasts = [], advances = [];
  const context = {
    useInspectionStore: f.inspections,
    rejectReviewItem: id => f.load('lib/services/rejectReviewItem.ts').rejectReviewItem(id),
    reviewCorrectionId: id => f.load('lib/services/savePhotoCorrection.ts').reviewCorrectionId(id),
    savingRef: { current: false }, setSaving: () => {}, setHandledIds: () => {},
    Haptics: { impactAsync: () => {}, ImpactFeedbackStyle: { Medium: 'medium' } },
    setStatus: f.queue.getState().setStatus, recordCorrection: f.corrections.getState().record,
    toast: value => toasts.push(value), advance: id => advances.push(id),
    x: {}, y: {}, motion: { quick: {} }, withSpring: v => v, Error,
  };
  vm.runInNewContext(compile(handler.getText(ast) + '\nglobalThis.handler = handleVerdict;'), context);
  await context.handler(verdict, f.queue.getState().items[0]);
  return { toasts, advances };
}

async function main() {
  // True pre-attachment-ID disk state: exercise production hydration and
  // rejection without modern capture/store helpers preparing its evidence.
  const legacyAnalysis = { status: 'done', at: '2026-09-04T00:00:00Z', findingCount: 1,
    subject: 'roof_field', subjectDetail: 'Architectural shingles', shingleCount: 72,
    squareCoverage: { visible: true, fraction: 1, confidence: 96 }, modelUsed: 'legacy-model',
    shingleType: { type: 'Architectural', confidence: 91 }, attempts: 1 };
  const legacyInspection = { id: 'job', reportId: 'RW-2026-0001', createdAt: '2026-09-04T00:00:00Z',
    status: 'in_progress', customerName: 'Legacy', address: 'Test', material: 'architectural_asphalt',
    ageYears: 10, geometry: 'gable', condition: 'fair', brittlenessTest: 'not_tested',
    collateralChecklist: {}, verifyWithInspector: false, slopes: [{ id: 'legacy-slope', orientation: 'N',
      areaSquares: 1, photoPaths: ['legacy-photo'], analyzedPhotoIndices: [0],
      photoMeta: [{ photoIndex: 0, captureMode: 'square_10x10' }],
      photoAnalysis: { 'legacy-photo': legacyAnalysis },
      damage: [{ ...marker('legacy-hit'), photoIndex: 0 }], aiFindings: [{ ...finding, photoPath: 'legacy-photo' }],
      hailCount: 1, windLiftCount: 0, wearCount: 0, missingCount: 0, bruisingCount: 0,
      functional: true, verifyWithInspector: false,
    }] };
  const legacyDisk = new Map([
    ['roofwise.inspections.v1', JSON.stringify({ version: 1, state: { inspections: [legacyInspection], nextOrdinal: 2 } })],
    ['roofwise.trainingQueue.v1', JSON.stringify({ version: 0, state: { items: [{ id: 'legacy-review',
      inspectionId: 'job', slopeId: 'legacy-slope', photoPath: 'legacy-photo', status: 'pending',
      enqueuedAt: '2026-09-04T00:00:01Z', originalAnalysis: { findings: [finding], markers: [marker('legacy-hit')] },
    }] } })],
  ]);
  let legacy = await fixture(legacyDisk);
  assert.equal(legacy.slope().photoAttachmentIds.length, 1);
  const stableAttachment = legacy.slope().photoAttachmentIds[0];
  assert.equal(typeof stableAttachment, 'string');
  assert.ok(stableAttachment.length > 0, 'hydration assigns a valid attachment identity');
  const documented = legacy.load('lib/services/documentedSquares.ts');
  const beforeCoverage = documented.documentedCoverage(legacy.slope());
  assert.equal(beforeCoverage.squares, 1);
  await legacy.reject();
  const checkLegacy = async f => {
    const analysis = f.load('lib/services/photoAnalysisState.ts').readPhotoAnalysis(f.slope(), 0);
    assert.equal(analysis?.shingleCount, 72, 'pre-ID rejection must preserve live photo metadata');
    assert.deepEqual(plain(analysis), { ...legacyAnalysis, findingCount: 0 }, 'legacy review preserves all non-damage analysis metadata');
    assert.deepEqual(plain(f.load('lib/services/documentedSquares.ts').documentedCoverage(f.slope())), plain(beforeCoverage));
    assert.equal(f.load('lib/services/documentedSquares.ts').shingleCountForSlope(f.slope()), 72);
    assert.equal(f.slope().aiFindings.length, 0, 'normalization must not break matched finding references');
    assert.equal(f.slope().hailCount, 0);
    assert.equal(f.slope().functional, false);
    assert.equal(f.slope().historicalPhotoEvidence?.length ?? 0, 0, 'valid live metadata is not archived');
    const report = f.load('lib/services/storedEngine.ts').resolveEngineResult(f.inspection());
    assert.equal(report.decision.haag.slope_evaluations[0].hail_hits_per_square, 0);
    await f.load('lib/services/haagPdf.ts').generateHaagReport(f.inspection());
    assert.ok(f.printed.at(-1).includes('Hail 0 · Wind 0'));
  };
  await checkLegacy(legacy);
  await legacy.flush();
  assert.equal(legacy.slope().photoAttachmentIds[0], stableAttachment);
  legacy = await fixture(legacyDisk);
  assert.equal(legacy.slope().photoAttachmentIds[0], stableAttachment);
  await checkLegacy(legacy);

  let f = await fixture();
  const other = plain(f.slope().damage.find(m => m.id === 'b-hit'));
  const ui = await screenReject(f);
  assert.equal(f.slope().hailCount, 0, 'reject must remove authoritative hail evidence, not only mark its queue reviewed');
  assert.equal(f.slope().functional, false);
  assert.equal(f.slope().squareHitCount, 0);
  assert.equal(f.slope().singleShingleHitCount, 0);
  assert.deepEqual(plain(f.slope().damage), [other]);
  assert.deepEqual(plain(f.slope().aiFindings.map(x => x.photoPath)), ['b']);
  assert.equal(f.slope().photoAnalysis.a.findingCount, 0);
  assert.equal(f.slope().photoAnalysis.a.status, 'done');
  assert.equal(f.inspection().storedEngineResult, undefined);
  assert.equal(f.queue.getState().items[0].status, 'reviewed');
  assert.equal(ui.advances.length, 1);
  assert.equal(ui.toasts[0].title, 'Marked not damage');
  const correction = f.corrections.getState().corrections[0];
  assert.equal(correction.photoId, 'a');
  assert.equal(correction.photoUrl, 'a');
  assert.equal(correction.delta.appliedMarkers[0].id, 'a-hit');
  assert.equal(f.load('lib/services/learning/userCorrectionProfile.ts').computeProfile([correction]).perCategory.hail_hits.overCount, 1);
  const report = f.load('lib/services/storedEngine.ts').resolveEngineResult(f.inspection());
  assert.equal(report.decision.haag.slope_evaluations[0].hail_hits_per_square, 0);
  await f.load('lib/services/haagPdf.ts').generateHaagReport(f.inspection());
  assert.ok(f.printed[0].includes('Hail 0 · Wind 0'), 'PDF print input reflects recounted evidence');
  assert.ok(!f.printed[0].includes('Hail Hits'), 'rejected finding must not survive in report narrative');
  await f.flush();
  const saved = await fixture(f.storage);
  assert.equal(saved.slope().hailCount, 0);
  assert.equal(saved.corrections.getState().corrections[0].id, correction.id);
  await saved.reject();
  assert.equal(saved.corrections.getState().corrections.length, 1, 'replay must not teach twice');

  // Earlier deletion renumbers the target but never changes its provenance.
  f = await fixture();
  f.queue.setState({ items: [{ ...f.queue.getState().items[0], photoPath: 'b', originalAnalysis: { findings: [{ ...finding, label: 'granule_loss' }], markers: [{ ...marker('b-hit'), category: 'granule_loss' }] },
    reviewEvidence: { attachmentId: f.slope().photoAttachmentIds[1], analysisAt: f.slope().photoAnalysis.b.at,
      findings: [{ ...finding, label: 'granule_loss' }], markers: [{ ...marker('b-hit'), category: 'granule_loss' }] } }] });
  f.inspections.getState().removePhoto('job', f.slope().id, 0);
  await f.reject();
  assert.equal(f.slope().damage.length, 0);
  assert.equal(f.corrections.getState().corrections[0].delta.photoIndexAtReview, 0);

  // Queue retains raw low-confidence detections even when the authority gated them out.
  f = await fixture();
  f.inspections.getState().replacePhotoMarkers('job', f.slope().id, 0, []);
  f.queue.setState({ items: [{ ...f.queue.getState().items[0], reviewEvidence: {
    ...f.queue.getState().items[0].reviewEvidence, markers: [],
  } }] });
  await f.reject();
  assert.deepEqual(plain(f.slope().aiFindings.map(x => x.photoPath)), ['b']);
  assert.equal(f.corrections.getState().corrections[0].originalDetection.markers.length, 1);
  assert.equal(f.corrections.getState().corrections[0].delta.appliedMarkers.length, 0);

  // Unambiguous legacy cards still work without inventing photo ownership.
  f = await fixture();
  f.inspections.getState().removePhoto('job', f.slope().id, 1);
  f.mutate({ aiFindings: [finding] });
  f.queue.setState({ items: [{ ...f.queue.getState().items[0], reviewEvidence: undefined }] });
  await f.reject();
  assert.equal(f.slope().aiFindings.length, 0);

  // Single-shingle mode is recounted independently, and repeated taps share a commit.
  f = await fixture();
  f.mutate({ photoMeta: [{ photoIndex: 0, captureMode: 'single_shingle' }] });
  const first = f.reject();
  const second = f.reject();
  assert.equal(first, second);
  await first;
  assert.equal(f.slope().singleShingleHitCount, 0);
  assert.equal(f.corrections.getState().corrections.length, 1);

  // Stale/ambiguous cards are side-effect free, including ratings/training.
  const changes = [
    f => f.mutate({ damage: f.slope().damage.map(m => m.id === 'a-hit' ? { ...m, softSpot: true } : m) }),
    f => f.mutate({ photoAnalysis: { ...f.slope().photoAnalysis, a: { ...f.slope().photoAnalysis.a, status: 'analyzing' } } }),
    f => f.mutate({ photoAnalysis: { ...f.slope().photoAnalysis, a: { ...f.slope().photoAnalysis.a, at: 'new-analysis' } } }),
    f => f.mutate({ photoAttachmentIds: ['replacement', f.slope().photoAttachmentIds[1]] }),
    f => f.inspections.getState().removePhoto('job', f.slope().id, 0),
    f => f.inspections.getState().setReportFinalizedAt('job'),
    f => f.queue.setState({ items: [{ ...f.queue.getState().items[0], reviewEvidence: undefined }] }),
    f => f.mutate({ aiFindings: [{ ...finding }, ...f.slope().aiFindings] }),
  ];
  for (const change of changes) {
    f = await fixture(); change(f);
    const before = plain(f.inspection());
    await assert.rejects(f.reject());
    assert.deepEqual(plain(f.inspection()), before);
    assert.equal(f.corrections.getState().corrections.length, 0);
    assert.equal(f.queue.getState().items[0].status, 'pending');
  }

  // Persist evidence before projections; every failed boundary is retryable.
  for (const key of ['roofwise.inspections.v1', 'roofwise.corrections.v1', 'roofwise.trainingQueue.v1']) {
    f = await fixture(); f.fail(key);
    await assert.rejects(f.reject());
    assert.equal(f.queue.getState().items[0].status, 'pending');
    f.fail(undefined); await f.reject(); await f.flush();
    const restarted = await fixture(f.storage);
    assert.equal(restarted.slope().hailCount, 0);
    assert.equal(restarted.corrections.getState().corrections.length, 1);
    assert.equal(restarted.queue.getState().items[0].status, 'reviewed');
  }
  f = await fixture(); f.fail('roofwise.corrections.v1');
  const failedUI = await screenReject(f);
  assert.equal(failedUI.advances.length, 0);
  assert.equal(failedUI.toasts[0].title, 'Review needs attention');
  const blockedAccept = await screenReject(f, 'accept');
  assert.equal(blockedAccept.advances.length, 0);
  assert.equal(blockedAccept.toasts[0].title, 'Finish saving this rejection');
  f.fail(undefined);
  assert.equal((await screenReject(f)).advances.length, 1);
  f = await fixture(); f.hold('roofwise.corrections.v1');
  const interrupted = f.reject();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.queue.getState().items[0].status, 'pending');
  const restarted = await fixture(new Map(f.storage));
  await restarted.reject();
  assert.equal(restarted.slope().hailCount, 0);
  assert.equal(restarted.corrections.getState().corrections.length, 1);
  f.release(); await interrupted;
  console.log('PASS: review authority, exact provenance, counts, reports, learning, stale guards and persistence/restart boundaries');
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { fixture, marker, finding, plain };
