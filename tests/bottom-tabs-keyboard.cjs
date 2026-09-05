// node tests/bottom-tabs-keyboard.cjs
// Execute the production dock's handlers and render its actual RN Web hosts.
// Native focus/gesture behavior remains an on-device gate.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { renderToStaticMarkup } = require('react-dom/server');
const native = require('react-native-web');
const root = path.resolve(__dirname, '..');

function load(file, mocks) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const exports = {};
  const compiled = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  vm.runInNewContext(compiled, { exports, require(id) {
    if (id === 'react/jsx-runtime') return require(id);
    assert.ok(id in mocks, `Unexpected dependency: ${id}`);
    return mocks[id];
  } });
  return exports;
}

let os = 'web';
const platform = { get OS() { return os; }, select: values => values.web ?? values.default };
const tokens = load('theme/tokens.ts', { 'react-native': { Platform: platform } });
const { mobileBottomItems } = load('components/shell/navItems.ts', {});
const states = new Map();
let scope, slot, reduced = false, springs = 0, haptics = 0;
function withHooks(key, component, props) {
  scope = key;
  slot = 0;
  if (!states.has(key)) states.set(key, []);
  return component(props);
}
function stateSlot(initial) {
  const values = states.get(scope), index = slot++;
  if (!(index in values)) values[index] = initial;
  return [values[index], value => { values[index] = value; }];
}
const { BottomTabs } = load('components/shell/BottomTabs.tsx', {
  react: { useState: stateSlot, useRef: value => stateSlot({ current: value })[0], useEffect: fn => fn() },
  'react-native': { ...native, Platform: platform, StyleSheet: { ...native.StyleSheet, create: value => value } },
  '@expo/vector-icons': { Ionicons: 'ion-icon' },
  'expo-haptics': { selectionAsync() { haptics++; return Promise.resolve(); } },
  'react-native-safe-area-context': { SafeAreaView: native.View },
  'react-native-reanimated': {
    __esModule: true, default: { View: native.View }, useReducedMotion: () => reduced,
    useSharedValue: value => ({ value }), useAnimatedStyle: fn => fn(),
    cancelAnimation() {}, ReduceMotion: { System: 'system' },
    withSpring(value) { springs++; return value; },
  },
  './navItems': { mobileBottomItems }, '@/theme/tokens': tokens,
});

const routes = mobileBottomItems.map(item => ({ name: item.name, key: item.name + '-key', params: { preserved: item.name } }));
const props = { state: { index: 0, routes }, descriptors: {}, navigation: {
  emit(event) { events.push(event); return { defaultPrevented: prevented }; },
  navigate(name, params) {
    navigations.push({ name, params });
    props.state.index = props.state.routes.findIndex(route => route.name === name);
  },
} };
let events = [], navigations = [], prevented = false, focused = null, controls;
function render() {
  const tree = withHooks('dock', BottomTabs, props);
  const children = tree.props.children.props.children;
  controls = children.map(child => withHooks(child.key, child.type, child.props));
  controls.forEach((control, index) => control.props.ref?.({ focus() {
    if (focused !== null) controls[focused]?.props.onBlur();
    focused = index;
    controls[index].props.onFocus();
  } }));
  return tree;
}
function key(index, value, repeat = false) {
  const event = { key: value, repeat, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
  controls[index].props.onKeyDown(event);
  return event;
}
function resetCalls() { events = []; navigations = []; haptics = 0; }
function assertEntry(index) {
  assert.deepEqual(controls.map(control => control.props.tabIndex), controls.map((_, i) => i === index ? 0 : -1));
  const html = controls.map(control => renderToStaticMarkup(control)).join('');
  assert.equal((html.match(/tabindex="0"/g) || []).length, 1);
  assert.equal((html.match(/aria-selected="true"/g) || []).length, 1);
}

render();
assert.equal(controls.length, 5);
assertEntry(0);
assert.equal(controls[0].props.style[1].outlineStyle, 'none', 'Web suppresses the duplicate browser focus rectangle');
for (const [from, pressed, expected] of [
  [0, 'ArrowLeft', 4], [4, 'ArrowRight', 0], [0, 'End', 4],
  [4, 'Home', 0], [0, 'ArrowRight', 1], [1, 'ArrowLeft', 0],
]) {
  resetCalls();
  const event = key(from, pressed);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(focused, expected);
  assert.equal(props.state.index, expected);
  assert.equal(navigations.length, 1);
  assert.equal(events.length, 1);
  assert.equal(haptics, 1);
  assert.equal(navigations[0].params, routes[expected].params, 'Existing route params retain identity');
  render();
  assertEntry(expected);
}
console.log('PASS arrows wrap; Home/End focus and select; one roving DOM tab stop; one activation with preserved params');

prevented = true;
resetCalls();
key(0, 'ArrowRight');
render();
assert.equal(focused, 1);
assert.equal(props.state.index, 0);
assertEntry(1);
assert.equal(navigations.length, 0, 'Prevented tabPress preserves selection while focus remains reachable');
prevented = false;
resetCalls();
assert.equal(key(1, ' ').prevented, true);
assert.equal(navigations.length, 1);
assert.equal(haptics, 1);
key(1, ' ', true);
assert.equal(navigations.length, 1, 'Held Space cannot repeat activation');
render();
resetCalls();
key(1, 'Enter');
assert.equal(events.length, 0, 'Enter is owned by RN Web press responder, never duplicated on keydown');
controls[1].props.onPress(); // RN Web delivers Enter's activation on keyup.
assert.equal(events.length, 1);
assert.equal(navigations.length, 0, 'Same-tab Enter emits its event without pushing navigation');
assert.equal(haptics, 1);
resetCalls();
controls[2].props.onPress();
assert.equal(navigations.length, 1, 'Touch/click retains the same activation path');
controls[2].props.onLongPress();
assert.equal(events.at(-1).type, 'tabLongPress');
assert.equal(events.at(-1).target, routes[2].key);
assert.equal(key(1, 'Tab').prevented, false, 'Tab can leave the dock');
console.log('PASS prevented navigation; Space repeat guard; Enter has one responder owner; touch and long-press retained');

// Settings is intentionally hidden from the five-tab dock. It still needs
// one keyboard entry point; a missing route must never become a dead target.
states.clear();
props.state = { index: 5, routes: [...routes, { name: 'settings', key: 'settings-key' }] };
render();
assert.equal(controls.filter(control => control.props.tabIndex === 0).length, 1);
assert.equal(controls[0].props.tabIndex, 0);
states.clear();
props.state = { index: 0, routes: routes.filter(route => route.name !== 'map') };
render();
resetCalls();
key(1, 'ArrowRight');
assert.equal(navigations[0].name, 'plan', 'Arrows skip missing route files');
console.log('PASS hidden Settings fallback and missing-route navigation');

for (const nativeOS of ['ios', 'android']) {
  os = nativeOS;
  states.clear();
  props.state = { index: 0, routes };
  reduced = true;
  springs = 0;
  render();
  assert.equal(springs, 0, 'Reduced Motion starts no icon spring');
  for (const control of controls) {
    assert.equal(control.props.onKeyDown, undefined);
    assert.equal(control.props.tabIndex, undefined);
    assert.equal(control.props.ref, undefined);
    assert.equal(typeof control.props.onPress, 'function');
    assert.equal(typeof control.props.onLongPress, 'function');
  }
}
console.log('PASS native controls receive no web keyboard/ref props; reduced motion has no spring');
