// SDK 58 removed beforeRemove. Execute the production annotation handlers
// against the new usePreventRemove repeat/disable contract.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const text = fs.readFileSync(path.join(__dirname, '../app/annotate.tsx'), 'utf8');
const ast = ts.createSourceFile('annotate.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'AnnotateScreen');
const names = ['leavingRef', 'allowExit', 'pendingResume', 'disablePrevention', 'onBack', 'resumeOnDiscard', 'discardAndLeave'];
function bindingName(name) {
  return ts.isArrayBindingPattern(name) ? name.elements[0].name.getText(ast) : name.getText(ast);
}
const selected = component.body.statements.filter(n => ts.isVariableStatement(n) &&
  n.declarationList.declarations.some(d => names.includes(bindingName(d.name))));
assert.equal(selected.length, names.length);
let cancel;
function visit(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'ConfirmSheet') {
    const attributes = node.attributes.properties;
    if (attributes.some(a => a.name?.text === 'title' && a.initializer?.text === 'Leave without saving?')) {
      cancel = attributes.find(a => a.name?.text === 'onClose').initializer.expression.getText(ast);
    }
  }
  ts.forEachChild(node, visit);
}
visit(component);
assert.ok(cancel);
const js = ts.transpileModule(selected.map(n => n.getText(ast)).join('\n') +
  `\nglobalThis.handlers = { onBack, discardAndLeave, leavingRef, pendingResume, cancel: ${cancel} };`,
{ compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
function fixture(dirty, state = { refs: [], allowExit: false, calls: [] }) {
  const calls = state.calls;
  let refIndex = 0;
  const scope = {
    dirty, dirtyRef: { current: dirty },
    useRef: value => state.refs[refIndex++] ??= { current: value },
    useState: () => [state.allowExit, next => {
      state.allowExit = next;
      calls.push(['allowExit', next]);
    }],
    usePreventRemove: (enabled, callback) => {
      scope.enabled = enabled;
      scope.blocked = callback;
      return () => calls.push(['disable']);
    },
    setConfirmBack: value => calls.push(['confirm', value]),
    router: { back: () => calls.push(['back']) },
  };
  vm.runInNewContext(js, scope);
  return { ...scope.handlers, scope, calls, render: () => fixture(dirty, state) };
}
let f = fixture(false);
assert.equal(f.scope.enabled, false);
f.onBack();
assert.deepEqual(f.calls, [['back']]);

f = fixture(true);
assert.equal(f.scope.enabled, true);
let repeats = 0;
f.scope.blocked({ repeat: () => repeats++ });
assert.deepEqual(f.calls, [['confirm', true]]);
assert.equal(repeats, 0, 'Blocked navigation retains the unsaved drawing');
f.cancel();
assert.equal(f.pendingResume.current, null);
assert.equal(repeats, 0, 'Keep drawing cannot replay a blocked navigation');

f = fixture(true);
const originalRepeat = () => repeats++;
f.scope.blocked({ repeat: originalRepeat });
f = f.render();
f.cancel(); // ConfirmSheet closes before calling its captured onConfirm.
f.discardAndLeave();
assert.equal(repeats, 1, 'Discard resumes the exact blocked action once');
assert.equal(f.leavingRef.current, true);
assert.equal(f.pendingResume.current, null);
assert.deepEqual(f.calls, [['confirm', true], ['confirm', false], ['allowExit', true]]);

f = fixture(true);
f.onBack();
f.discardAndLeave();
assert.deepEqual(f.calls, [['confirm', true], ['allowExit', true], ['disable'], ['back']],
  'Manual close disables prevention before issuing a new back action');

for (const saved of [true, false]) {
  f = fixture(true);
  f.scope.dirtyRef.current = !saved;
  f.leavingRef.current = !saved;
  let resumed = 0;
  f.scope.blocked({ repeat: () => resumed++ });
  assert.equal(resumed, 1);
  assert.deepEqual(f.calls, [['allowExit', true]],
    'A saved or already-approved exit cannot reopen the discard prompt');
}
console.log('PASS SDK 58 annotation protection: blocked/cancel/discard/manual close/save continuation');
