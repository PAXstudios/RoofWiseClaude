// node tests/control-semantics.cjs
// Execute unchanged production JSX/styles with React Native Web hosts. This
// checks real DOM semantics and source-rendered paint, not native screen readers.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const native = require('react-native-web');
const root = path.resolve(__dirname, '..');
const compile = source => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
function evaluate(source, scope = {}) {
  const exports = {};
  vm.runInNewContext(compile(source), { exports, ...scope, require(id) {
    if (id === 'react/jsx-runtime') return require(id);
    if (id === 'react-native') return native;
    throw new Error(`Unexpected dependency ${id}`);
  } });
  return exports;
}
const tokens = evaluate(fs.readFileSync(path.join(root, 'theme/tokens.ts'), 'utf8'));
function sourceFile(file) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}
function declarations(file, names, scope = {}) {
  const ast = sourceFile(file);
  const selected = ast.statements.filter(node =>
    (ts.isFunctionDeclaration(node) && names.includes(node.name.text)) ||
    (ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast))))
  );
  assert.equal(selected.length, names.length, `Missing production declaration in ${file}`);
  return evaluate(selected.map(n => n.getText(ast)).join('\n') + `\nexport { ${names.join(', ')} };`, {
    ...tokens, ...native, StyleSheet: { ...native.StyleSheet, create: v => v },
    useId: React.useId, IconChip: 'icon-chip', Ionicons: 'ion-icon',
    PressableScale: native.Pressable, ...scope,
  });
}
const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const descendants = node => [node, ...[node?.props?.children].flat(Infinity).filter(Boolean).flatMap(descendants)];
function renderControl(Component, props) {
  let control;
  function Capture() { control = Component(props); return control; }
  renderToStaticMarkup(React.createElement(Capture));
  return control;
}
function elements(file, tag) {
  const ast = sourceFile(file);
  const result = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === tag) result.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}

const settingsFile = 'app/(tabs)/settings.tsx';
const { Row, MiniSwitch } = declarations(settingsFile, ['Row', 'MiniSwitch', 'styles'], {
  useEffect() {}, useSharedValue: value => ({ value }), useAnimatedStyle: fn => fn(),
  withSpring: value => value, Animated: { View: native.View },
});
for (const [title, stateName, setter] of [
  ['Auto-plan damaging storms', 'autoPlanStorms', 'setAutoPlanStorms'],
  ['Pre-inspection safety check', 'preFlightEnabled', 'setPreFlightEnabled'],
]) {
  const jsx = elements(settingsFile, 'Row').find(text => text.includes(`title="${title}"`));
  assert.ok(jsx, `Missing ${title}`);
  for (const checked of [false, true]) {
    let next;
    const { row } = evaluate(`export const row = (${jsx});`, {
      Row, MiniSwitch, [stateName]: checked, [setter]: value => { next = value; },
      DAMAGING_HAIL_INCHES: 1, DAMAGING_WIND_MPH: 70,
    });
    const control = renderControl(Row, row.props);
    assert.equal(control.props.accessibilityRole, 'switch');
    assert.equal(control.props.accessibilityLabel, title);
    assert.equal(control.props.accessibilityState.checked, checked);
    assert.ok(flatten(control.props.style).minHeight >= 56);
    assert.ok(control.props.accessibilityHint.length > 0);
    control.props.onPress();
    assert.equal(next, !checked, 'Existing toggle callback retains its exact state transition');
    next = undefined;
    let prevented = false;
    control.props.onKeyDown({ key: ' ', repeat: false, preventDefault() { prevented = true; } });
    assert.equal(prevented, true, 'Space does not scroll the page');
    assert.equal(next, !checked, 'Space toggles the switch');
    next = undefined;
    control.props.onKeyDown({ key: ' ', repeat: true, preventDefault() {} });
    assert.equal(next, undefined, 'Holding Space does not repeatedly toggle');
    control.props.onKeyDown({ key: 'Enter' });
    assert.equal(next, undefined, 'Enter remains owned by the built-in press responder');
    const html = renderToStaticMarkup(row);
    assert.match(html, /role="switch"/);
    assert.ok(html.includes(`aria-checked="${checked}"`));
    assert.equal((html.match(/role="switch"/g) || []).length, 1);
    assert.match(html, /aria-hidden="true"/);
    const descriptionId = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    assert.ok(descriptionId, 'The switch references its visible description');
    const descriptionHtml = renderToStaticMarkup(React.createElement(native.Text, null, row.props.sub));
    const descriptionText = descriptionHtml.slice(descriptionHtml.indexOf('>') + 1, descriptionHtml.lastIndexOf('</'));
    assert.ok(html.includes(`id="${descriptionId}"`));
    assert.match(html, new RegExp(`id="${descriptionId}"[^>]*>${descriptionText.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')}<`));
  }
  console.log(`PASS ${title}: named switch, both states and existing toggle callback`);
}
const disabled = renderControl(Row, { title: 'Unavailable action', onPress() {}, disabled: true });
assert.equal(disabled.props.accessibilityRole, 'button');
assert.equal(disabled.props.accessibilityState.disabled, true);
assert.equal(disabled.props.disabled, true);
assert.equal(disabled.props['aria-describedby'], undefined);
assert.equal(renderControl(Row, { title: 'Static information' }).type, native.View);
let disabledPressed = false;
renderControl(Row, { title: 'Disabled switch', checked: false, disabled: true, onPress() { disabledPressed = true; } })
  .props.onKeyDown({ key: ' ', repeat: false, preventDefault() {} });
assert.equal(disabledPressed, false);
console.log('PASS non-toggle Settings rows retain button/static semantics and disabled state');
for (const os of ['ios', 'android']) {
  const { Row: NativeRow } = declarations(settingsFile, ['Row', 'styles'], { Platform: { OS: os } });
  const control = renderControl(NativeRow, { title: 'Native switch', checked: true, onPress() {} });
  assert.equal(control.props.accessibilityState.checked, true);
  assert.equal(control.props.onKeyDown, undefined);
}
console.log('PASS native switches retain native state without web keyboard props');
const siblingRows = renderToStaticMarkup(React.createElement(React.Fragment, null,
  ...['First', 'Second'].map(title => React.createElement(Row, { key: title, title, sub: `${title} description`, checked: true, onPress() {} }))));
const descriptionIds = [...siblingRows.matchAll(/aria-describedby="([^"]+)"/g)].map(match => match[1]);
assert.equal(descriptionIds.length, 2);
assert.equal(new Set(descriptionIds).size, 2, 'Sibling switches reference unique descriptions');
console.log('PASS web switches reference their actual visible descriptions with unique IDs');

const { Field } = declarations('components/sheets/CustomerDetailsSheet.tsx', ['Field', 'styles']);
const labels = ['Customer name *', 'Phone', 'Email'];
const fields = labels.map(label => React.createElement(Field, {
  key: label, label, value: '', onChangeText() {}, icon: 'person-outline', tone: 'blue',
}));
const fieldHtml = renderToStaticMarkup(React.createElement(React.Fragment, null, ...fields));
const inputs = [...fieldHtml.matchAll(/<input\b[^>]*>/g)].map(match => match[0]);
assert.equal(inputs.length, 3);
const labelIds = inputs.map((input, i) => {
  assert.ok(input.includes(`aria-label="${labels[i]}"`), 'Empty fields retain their name without a placeholder');
  const id = /aria-labelledby="([^"]+)"/.exec(input)?.[1];
  assert.ok(id, 'Each input references its visible label');
  assert.ok(fieldHtml.includes(`id="${id}"`));
  assert.match(fieldHtml, new RegExp(`id="${id}"[^>]*>${labels[i].replace('*', '\\*')}<`));
  return id;
});
assert.equal(new Set(labelIds).size, 3, 'Sibling inputs cannot reference the same label');
console.log('PASS customer fields: unique visible-label associations and accessible names when empty');

let withinWindow72h = false;
const { NoaaCrossCheck } = declarations('app/new-job.tsx', ['NoaaCrossCheck', 'styles'], {
  tripleCheckDateOfLoss: () => ({ withinWindow72h, daysFromDol: 10 }),
  formatDateShort: value => value, DOL_MATCH_WINDOW_DAYS: 30,
});
function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  return hex.slice(1).match(/../g).map(channel => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }).reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
}
for (const status of ['no_match', 'match', 'mismatch']) {
  withinWindow72h = status === 'match';
  const tree = NoaaCrossCheck({ dolIso: '2026-08-01', lookup: {
    status: status === 'no_match' ? status : 'matched',
    event: { date: '2026-08-01', kind: 'hail', hailSizeInches: 1, distanceMiles: 2 },
  } });
  const fill = flatten(tree.props.style).backgroundColor;
  assert.equal(fill, status === 'match' ? tokens.colors.successSoft : tokens.colors.warnSoft);
  for (const node of descendants(tree)) {
    if (node.type !== native.Text && node.type !== 'ion-icon') continue;
    const ink = node.type === native.Text ? flatten(node.props.style).color : node.props.color;
    const a = luminance(ink), b = luminance(fill);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    assert.ok(ratio >= 4.5, `NOAA ${status}: ${ratio.toFixed(2)}:1 below 4.5:1`);
  }
  console.log(`PASS NOAA ${status}: text and meaningful icon exceed 4.5:1 on existing soft fill`);
}
assert.equal(NoaaCrossCheck({ lookup: null, dolIso: '' }), null);
console.log('Control semantics and status-ink regression checks passed.');
