// node tests/correction-provenance.cjs [--baseline]
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { execFileSync } = require('node:child_process');
const { fixture, marker, finding, plain } = require('./review-authority.cjs');
const root = path.resolve(__dirname, '..');
const service = f => f.load('lib/services/savePhotoCorrection.ts');
const begin = (f, index = 0, queue = false) => service(f).beginPhotoCorrection({
  inspectionId: 'job', slopeId: f.slope().id, photoIndex: index,
  ...(queue ? { queueItemId: f.queue.getState().items[0].id } : {}),
});

function photoReportRoute(f, index, log = false) {
  const source = fs.readFileSync(path.join(root, 'components/job/PhotosTab.tsx'), 'utf8');
  const ast = ts.createSourceFile('photos.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const routes = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === 'router.push' && node.arguments[0]?.getText(ast).includes("pathname: '/photo-report'")) routes.push(node.arguments[0]);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const slope = f.slope(), uri = slope.photoPaths[index];
  const context = { inspection: f.inspection(), slope, uri, i: index,
    actionTarget: { slopeId: slope.id, photoIndex: index, uri, attachmentId: slope.photoAttachmentIds[index] } };
  vm.runInNewContext(`globalThis.route = (${routes[log ? 0 : 1].getText(ast)});`, context);
  return plain(context.route);
}

// Render the actual report component with inert native elements, real model
// helpers and live store selectors. Child props/text prove its visible branches.
function renderPhotoReport(f, params) {
  const source = fs.readFileSync(path.join(root, 'app/photo-report.tsx'), 'utf8');
  const ast = ts.createSourceFile('report.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const context = { exports: {}, styles: {} };
  for (const statement of ast.statements.filter(ts.isImportDeclaration)) {
    for (const binding of statement.importClause?.namedBindings?.elements ?? []) context[binding.name.text] = binding.name.text;
  }
  const pushes = [];
  Object.assign(context, f.load('lib/models/types.ts'), f.load('lib/services/haagThresholds.ts'), {
    React: { createElement: (type, props, ...children) => ({ type, props: { ...props, children } }), Fragment: 'Fragment' },
    colors: {}, Stack: { Screen: 'Screen' }, styles: {},
    useRouter: () => ({ push: value => pushes.push(value), back: () => {} }),
    useLocalSearchParams: () => params,
    useInspectionStore: Object.assign(selector => selector(f.inspections.getState()), { getState: f.inspections.getState }),
    useToastStore: () => () => {}, useState: value => [value, () => {}], useMemo: fn => fn(),
    getPhotoAnalysisState: f.load('lib/services/photoAnalysisState.ts').readPhotoAnalysis,
    resolvePhotoReportTarget: f.load('lib/services/photoReportTarget.ts').resolvePhotoReportTarget,
  });
  const componentSource = ast.statements.filter(statement => !ts.isImportDeclaration(statement) &&
    !(ts.isVariableStatement(statement) && statement.declarationList.declarations.some(d => d.name.getText(ast) === 'styles')))
    .map(statement => statement.getText(ast)).join('\n');
  const compiled = ts.transpileModule(componentSource, { compilerOptions: {
    target: ts.ScriptTarget.ES2016, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  vm.runInNewContext(compiled, context);
  const tree = context.exports.default();
  const nodes = [];
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value && typeof value === 'object') { nodes.push(value); walk(value.props?.children); }
    else if (value != null && value !== false) nodes.push(value);
  }
  walk(tree);
  return { nodes, pushes, text: nodes.filter(n => typeof n === 'string').join(' ') };
}

async function screenSave(f, session, draftMarkers) {
  const source = process.argv.includes('--baseline')
    ? execFileSync('git', ['show', 'HEAD:app/edit-detection.tsx'], { cwd: root, encoding: 'utf8' })
    : fs.readFileSync(path.join(root, 'app/edit-detection.tsx'), 'utf8');
  const ast = ts.createSourceFile('editor.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'EditDetectionView');
  const handler = component.body.statements.find(n => ts.isVariableStatement(n) && n.declarationList.declarations.some(d => d.name.getText(ast) === 'onSave'));
  const toasts = [], backs = [];
  const context = { session, draftMarkers, photoMarkers: session.markers, inspection: f.inspection(), slope: f.slope(),
    index: 0, photoUri: 'a', savingRef: { current: false }, setSaving: () => {},
    uniqueCategories: markers => [...new Set(markers.map(m => m.category))],
    savePhotoCorrection: service(f).savePhotoCorrection,
    replacePhotoMarkers: f.inspections.getState().replacePhotoMarkers, recordCorrection: f.corrections.getState().record,
    logActivity: () => {}, useCorrectionsStore: f.corrections, computeProfile: () => ({}), overallAccuracy: () => null,
    toast: value => toasts.push(value), router: { back: () => backs.push(true) },
    Haptics: { notificationAsync: () => {}, NotificationFeedbackType: { Success: 'success' } }, Error,
  };
  const compiled = ts.transpileModule(handler.getText(ast) + '\nglobalThis.handler = onSave;', {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, context);
  await context.handler();
  return { toasts, backs };
}

async function main() {
  let f = await fixture();
  const untouched = plain(f.slope().damage[1]);
  let session = begin(f, 0, true);
  const raw = plain(f.queue.getState().items[0].originalAnalysis);
  const ui = await screenSave(f, session, []);
  assert.deepEqual(plain(f.slope().aiFindings.map(x => x.label)), ['granule_loss'], 'removing final hail marker must remove its authoritative finding and report narrative');
  assert.deepEqual(plain(f.slope().damage), [untouched]);
  assert.equal(f.slope().hailCount, 0);
  assert.equal(f.slope().functional, false);
  assert.equal(f.slope().squareHitCount, 0);
  assert.equal(f.slope().photoAnalysis.a.findingCount, 0);
  assert.equal(f.slope().photoAnalysis.a.subject, 'roof_field');
  assert.equal(f.inspection().storedEngineResult, undefined);
  assert.equal(ui.backs.length, 1);
  assert.equal(f.queue.getState().items[0].status, 'reviewed');
  assert.deepEqual(plain(f.corrections.getState().corrections[0].originalDetection), raw);
  assert.equal(service(f).completedReviewCorrection(f.queue.getState().items[0].id).id, session.id);
  const engine = f.load('lib/services/storedEngine.ts').resolveEngineResult(f.inspection());
  assert.equal(engine.decision.haag.slope_evaluations[0].hail_hits_per_square, 0);
  await f.load('lib/services/haagPdf.ts').generateHaagReport(f.inspection());
  assert.ok(f.printed[0].includes('Hail 0 · Wind 0'));
  assert.ok(!f.printed[0].includes('Hail Hits'));

  // A general edit on another photo/another session cannot complete a review.
  f = await fixture();
  session = begin(f, 1);
  await service(f).savePhotoCorrection(session, []);
  assert.equal(service(f).completedReviewCorrection(f.queue.getState().items[0].id), undefined);
  assert.equal(f.queue.getState().items[0].status, 'pending');
  assert.deepEqual(plain(f.corrections.getState().corrections[0].originalDetection.findings.map(x => x.label)), ['granule_loss']);

  // Duplicate bytes/URIs are separate attachments, findings, state and audits.
  f = await fixture();
  const ids = f.slope().photoAttachmentIds;
  f.mutate({ photoPaths: ['a', 'a'], aiFindings: [
    { ...finding, photoPath: 'a', photoAttachmentId: ids[0] },
    { ...finding, label: 'granule_loss', photoPath: 'a', photoAttachmentId: ids[1] },
  ] });
  session = begin(f, 0, true);
  await service(f).savePhotoCorrection(session, []);
  assert.deepEqual(plain(f.slope().aiFindings.map(x => x.photoAttachmentId)), [ids[1]]);
  assert.equal(f.slope().photoAnalysisByAttachment[ids[1]].findingCount, 1);
  assert.equal(f.corrections.getState().corrections[0].photoId, ids[0]);

  // An earlier deletion shifts indices but never changes the edited attachment.
  f = await fixture(); session = begin(f, 1);
  f.inspections.getState().removePhoto('job', f.slope().id, 0);
  await service(f).savePhotoCorrection(session, []);
  assert.equal(f.slope().damage.length, 0);
  assert.equal(f.corrections.getState().corrections[0].delta.photoIndexAtReview, 0);

  // Navigation carries identity even if its original index shifted before mount.
  f = await fixture();
  const attachmentId = f.slope().photoAttachmentIds[1];
  f.inspections.getState().removePhoto('job', f.slope().id, 0);
  session = service(f).beginPhotoCorrection({ inspectionId: 'job', slopeId: f.slope().id,
    photoIndex: 1, attachmentId, photoPath: 'b' });
  assert.equal(session.attachmentId, attachmentId);
  await service(f).savePhotoCorrection(session, []);
  assert.equal(f.slope().damage.length, 0);

  // Inspector evidence edits replace stale severity/narrative, rederive HAAG function.
  f = await fixture(); session = begin(f);
  await service(f).savePhotoCorrection(session, session.markers.map(m => ({ ...m, evidence: 'cosmetic', severity: 'minor' })));
  assert.equal(f.slope().functional, false);
  assert.equal(f.slope().aiFindings.find(x => x.label === 'hail_hits').severity, 'minor');
  assert.equal(f.slope().aiFindings.find(x => x.label === 'hail_hits').note, 'Markers reviewed by inspector.');

  // Missing/replaced/currently analyzing/finalized/edited evidence is never overwritten.
  const mutations = [
    f => f.inspections.getState().removePhoto('job', f.slope().id, 0),
    f => f.mutate({ photoAttachmentIds: ['replacement', f.slope().photoAttachmentIds[1]] }),
    f => f.mutate({ damage: f.slope().damage.map(m => m.id === 'a-hit' ? { ...m, severity: 'severe' } : m) }),
    f => f.mutate({ aiFindings: f.slope().aiFindings.map(x => x.photoPath === 'a' ? { ...x, count: 9 } : x) }),
    f => f.mutate({ photoAnalysis: { ...f.slope().photoAnalysis, a: { ...f.slope().photoAnalysis.a, status: 'analyzing' } } }),
    f => f.inspections.setState({ inspections: [{ ...f.inspection(), reportFinalizedAt: '2026-09-04T01:00:00Z' }] }),
    f => f.queue.getState().setStatus(f.queue.getState().items[0].id, 'discarded'),
  ];
  for (const mutate of mutations) {
    f = await fixture(); session = begin(f, 0, true); mutate(f);
    const before = plain(f.inspection());
    await assert.rejects(service(f).savePhotoCorrection(session, []));
    assert.deepEqual(plain(f.inspection()), before);
    assert.equal(f.corrections.getState().corrections.length, 0);
  }

  // Legacy ambiguity fails closed, including repeated URI findings without IDs.
  f = await fixture(); f.mutate({ aiFindings: [finding] });
  assert.throws(() => begin(f), /provenance/);
  f = await fixture(); f.mutate({ photoPaths: ['a', 'a'] });
  assert.throws(() => begin(f), /provenance/);
  f = await fixture(); f.inspections.getState().removePhoto('job', f.slope().id, 1);
  f.mutate({ aiFindings: [finding], damage: [marker('legacy')] });
  session = begin(f); await service(f).savePhotoCorrection(session, []);
  assert.equal(f.slope().damage.length, 0);
  assert.equal(f.slope().aiFindings.length, 0);

  f = await fixture(); f.inspections.getState().removePhoto('job', f.slope().id, 1);
  f.mutate({ aiFindings: [finding], damage: [marker('legacy')] });
  session = begin(f);
  await service(f).savePhotoCorrection(session, session.markers.map(m => ({ ...m, severity: 'minor' })));
  assert.equal(f.slope().damage[0].photoIndex, 0);
  assert.equal(f.slope().damage[0].severity, 'minor');

  // Every persistence boundary is retryable; persisted evidence+audit replays once.
  for (const key of ['roofwise.inspections.v1', 'roofwise.corrections.v1', 'roofwise.trainingQueue.v1']) {
    f = await fixture(); session = begin(f, 0, true); f.fail(key);
    const ui = await screenSave(f, session, []);
    assert.equal(ui.backs.length, 0);
    assert.equal(ui.toasts.at(-1).tone, 'warn');
    assert.equal(f.queue.getState().items[0].status, 'pending');
    const restarted = await fixture(new Map(f.storage));
    if (key === 'roofwise.inspections.v1') {
      assert.equal(restarted.slope().hailCount, 1);
      await service(restarted).savePhotoCorrection(begin(restarted, 0, true), []);
    } else await service(restarted).recoverPhotoCorrections();
    assert.equal(restarted.slope().hailCount, 0);
    assert.equal(restarted.corrections.getState().corrections.length, 1);
    await service(restarted).recoverPhotoCorrections();
    assert.equal(restarted.corrections.getState().corrections.length, 1);
    assert.equal(restarted.queue.getState().items[0].status, 'reviewed');
  }
  f = await fixture(); session = begin(f, 0, true); f.hold('roofwise.corrections.v1');
  const first = service(f).savePhotoCorrection(session, []);
  assert.equal(first, service(f).savePhotoCorrection(session, []));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.queue.getState().items[0].status, 'pending');
  // Restart between authority and correction projection preserves the correction.
  const restarted = await fixture(new Map(f.storage));
  await service(restarted).recoverPhotoCorrections();
  assert.equal(restarted.corrections.getState().corrections.length, 1);
  f.release(); await first;
  f.inspections.getState().replacePhotoMarkers('job', f.slope().id, 0, [marker('later-evidence')]);
  await service(f).savePhotoCorrection(session, [marker('new-not-replayed')]);
  assert.equal(f.slope().hailCount, 1, 'idempotent replay never mutates newer evidence');
  assert.equal(f.slope().damage.find(m => m.category === 'hail_hits').id, 'later-evidence');
  assert.equal(f.corrections.getState().corrections.length, 1);

  // Two editor lifetimes cannot overwrite one another's accepted evidence.
  f = await fixture(); session = begin(f);
  const secondEditor = begin(f);
  await service(f).savePhotoCorrection(session, []);
  await assert.rejects(service(f).savePhotoCorrection(secondEditor, [marker('other-edit')]), /evidence changed/);

  // General edits (without a queue card) also repair their audit after restart.
  f = await fixture(); session = begin(f, 1); f.fail('roofwise.corrections.v1');
  await assert.rejects(service(f).savePhotoCorrection(session, []));
  const generalRestart = await fixture(new Map(f.storage));
  const stopRecovery = service(generalRestart).startPhotoCorrectionRecovery();
  await new Promise(resolve => setImmediate(resolve));
  await generalRestart.flush();
  stopRecovery();
  assert.equal(generalRestart.corrections.getState().corrections.length, 1);
  assert.equal(generalRestart.corrections.getState().corrections[0].id, session.id);
  assert.equal(generalRestart.queue.getState().items[0].status, 'pending');

  // Current service may not reverse a partially saved correction into rejection.
  f = await fixture(); session = begin(f, 0, true); f.fail('roofwise.corrections.v1');
  await assert.rejects(service(f).savePhotoCorrection(session, []));
  await assert.rejects(f.reject(), /already corrected/);

  // Actual photo-log and slope-thumbnail routes pin the middle duplicate B.
  for (const fromLog of [false, true]) {
    f = await fixture();
    f.inspections.getState().attachRawPhotos('job', [{ uri: 'b', slope: 'N', captureMode: 'square_10x10' }]);
    f.inspections.getState().replacePhotoMarkers('job', f.slope().id, 2, [marker('last-b-hit')]);
    const middleId = f.slope().photoAttachmentIds[1];
    const route = photoReportRoute(f, 1, fromLog);
    assert.equal(route.params.attachmentId, middleId);
    assert.equal(route.params.photoPath, 'b');
    f.inspections.getState().removePhoto('job', f.slope().id, 0);
    const report = renderPhotoReport(f, route.params);
    const photo = report.nodes.find(n => n.type === 'AnnotatedPhoto');
    assert.deepEqual(plain(photo.props.markers.map(m => m.id)), ['b-hit'], 'rendered report must remain the originally opened duplicate B');
    report.nodes.find(n => n.props?.accessibilityLabel === 'Edit the markers on this photo').props.onPress();
    assert.equal(report.pushes[0].params.attachmentId, middleId);
    assert.equal(report.pushes[0].params.photoIndex, '0');
    f.inspections.getState().removePhoto('job', f.slope().id, 0);
    assert.match(renderPhotoReport(f, route.params).text, /isn't here any more/);
    assert.match(renderPhotoReport(f, { inspectionId: 'job', slopeId: f.slope().id, photoIndex: '0' }).text, /isn't here any more/);
  }

  // Manual markers on an unanalysed photo create explicit reportable review.
  f = await fixture();
  const states = f.load('lib/services/photoAnalysisState.ts');
  const photoBAnalysis = states.readPhotoAnalysis(f.slope(), 1);
  f.mutate({ damage: f.slope().damage.filter(m => m.photoIndex !== 0),
    aiFindings: f.slope().aiFindings.filter(finding => finding.photoPath !== 'a'),
    analyzedPhotoIndices: [1], photoAnalysis: { b: photoBAnalysis } });
  assert.equal(states.photoWasAnalyzed(f.slope(), 0), false);
  session = begin(f);
  await service(f).savePhotoCorrection(session, [marker('manual-1'), marker('manual-2')]);
  assert.equal(states.photoWasAnalyzed(f.slope(), 0), true);
  assert.equal(states.readPhotoAnalysis(f.slope(), 0).reviewSource, 'inspector');
  assert.equal(states.readPhotoAnalysis(f.slope(), 0).findingCount, 2);
  let rendered = renderPhotoReport(f, photoReportRoute(f, 0).params);
  assert.ok(rendered.nodes.some(n => n.props?.label === 'Reviewed by inspector'));
  assert.ok(rendered.nodes.some(n => n.props?.title === 'Damage in this photo'));
  assert.match(rendered.text, /Hail Hits/);
  assert.doesNotMatch(rendered.text, /has not been analyzed yet/);
  assert.equal(f.load('lib/services/storedEngine.ts').resolveEngineResult(f.inspection()).decision.haag.slope_evaluations[0].hail_hits_per_square, 1, 'two reviewed hits across two documented test-square photos');
  await f.load('lib/services/haagPdf.ts').generateHaagReport(f.inspection());
  assert.ok(f.printed[0].includes('Hail 2 · Wind 0'));
  session = begin(f); await service(f).savePhotoCorrection(session, []);
  rendered = renderPhotoReport(f, photoReportRoute(f, 0).params);
  assert.match(rendered.text, /inspector review has no remaining damage/);
  assert.equal(states.photoWasAnalyzed(f.slope(), 0), true);
  assert.equal(states.readPhotoAnalysis(f.slope(), 0).findingCount, 0);

  // A conflicting model subject is explicitly superseded by manual roof review.
  f = await fixture();
  f.mutate({ damage: f.slope().damage.filter(m => m.photoIndex !== 0),
    aiFindings: f.slope().aiFindings.filter(finding => finding.photoPath !== 'a'),
    photoAnalysis: { ...f.slope().photoAnalysis, a: { status: 'done', at: '2026-09-04T00:00:00Z',
      noRoofDetected: true, subject: 'unidentifiable', subjectDetail: 'Original model subject', findingCount: 0 } } });
  session = begin(f);
  await service(f).savePhotoCorrection(session, [marker('reviewed-roof')]);
  const state = f.load('lib/services/photoAnalysisState.ts').readPhotoAnalysis(f.slope(), 0);
  assert.equal(state.noRoofDetected, false);
  assert.equal(state.subject, 'roof_field');
  assert.equal(state.reviewSource, 'inspector');
  assert.equal(f.corrections.getState().corrections[0].delta.originalPhotoAnalysis.subjectDetail, 'Original model subject');
  rendered = renderPhotoReport(f, photoReportRoute(f, 0).params);
  assert.ok(rendered.nodes.some(n => n.props?.title === 'Damage in this photo'));
  assert.ok(!rendered.nodes.some(n => n.props?.title === 'Collateral evidence'));
  const queued = f.load('lib/services/photoAnalysisState.ts').patchPhotoAnalysis(f.slope(), 0, { status: 'queued' });
  assert.equal(f.load('lib/services/photoAnalysisState.ts').readPhotoAnalysis(queued, 0).reviewSource, undefined);

  // Foreground recovery retries an in-memory general correction lacking a disk acknowledgement.
  f = await fixture(); session = begin(f, 1); f.fail('roofwise.corrections.v1');
  await assert.rejects(service(f).savePhotoCorrection(session, []));
  assert.equal(f.corrections.getState().corrections.length, 1);
  assert.equal(JSON.parse(f.storage.get('roofwise.corrections.v1') ?? '{"state":{"corrections":[]}}').state.corrections.length, 0);
  f.fail(undefined);
  await service(f).recoverPhotoCorrections();
  assert.equal(JSON.parse(f.storage.get('roofwise.corrections.v1')).state.corrections[0].id, session.id);
  await service(f).recoverPhotoCorrections();
  assert.equal(f.corrections.getState().corrections.length, 1);
  console.log('correction-provenance: UI, attachment identity, findings, HAAG/PDF, stale-state and persistence/restart regressions passed');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
