// node tests/bottom-sheet-keyboard.cjs
// Exercise the production modal tree and close/gesture callbacks. Native
// keyboard geometry still requires the device pass; no simulated layout is
// presented here as an iOS/Android rendering result.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'components/ui/BottomSheet.tsx'), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX,
} }).outputText;
const tokens = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(root, 'theme/tokens.ts'), 'utf8'), { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText, { exports: tokens, require: id => {
  assert.equal(id, 'react-native'); return { Platform: { OS: 'web', select: values => values.web ?? values.default } };
} });
const flatten = value => Object.assign({}, ...[value].flat(Infinity).filter(Boolean));
const children = node => [node?.props?.children].flat(Infinity).filter(Boolean);
const descendants = node => [node, ...children(node).flatMap(descendants)];
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('PASS ' + name); }

function render(os, { visible = true, reduced = false, cancel = true, top = 47, bottom = 34, footer, viewportHeight, keyboardVisible = false, subtitle } = {}) {
  const exports = {};
  let closed = 0;
  let panEnd;
  const states = [];
  let cursor = 0;
  const keyboardListeners = new Map();
  const gesture = { onUpdate() { return this; }, onEnd(fn) { panEnd = fn; return this; } };
  const native = Object.fromEntries(['KeyboardAvoidingView', 'Modal', 'Pressable', 'ScrollView', 'Text', 'View'].map(name => [name, name]));
  const mocks = {
    react: {
      useEffect: fn => fn(),
      useState: initial => { const index = cursor++; if (!(index in states)) states[index] = initial; return [states[index], next => { states[index] = next; }]; },
    },
    'react/jsx-runtime': require('react/jsx-runtime'),
    'react-native': { ...native, Platform: { OS: os }, StyleSheet: { create: v => v, absoluteFill: {} }, Keyboard: {
      isVisible: () => keyboardVisible,
      addListener: (event, callback) => { keyboardListeners.set(event, callback); return { remove: () => keyboardListeners.delete(event) }; },
    } },
    'react-native-safe-area-context': { useSafeAreaInsets: () => ({ top, bottom }) },
    'react-native-gesture-handler': { Gesture: { Pan: () => gesture }, GestureDetector: 'GestureDetector' },
    'react-native-reanimated': {
      __esModule: true, default: { View: 'Animated.View' }, runOnJS: fn => fn,
      useAnimatedStyle: fn => fn(), useReducedMotion: () => reduced,
      useSharedValue: value => ({ value }), withSpring: value => value,
      withTiming: (value, _, done) => { done?.(true); return value; },
    },
    '@/theme/tokens': tokens,
  };
  vm.runInNewContext(compiled, { exports, require: id => {
    assert.ok(id in mocks, `Unexpected dependency ${id}`); return mocks[id];
  } });
  const content = require('react/jsx-runtime').jsx('TextInput', { accessibilityLabel: 'Customer name' });
  const draw = () => { cursor = 0; return exports.BottomSheet({ visible, onClose: () => closed++, title: 'Edit customer', subtitle, children: content, cancel, footer }); };
  let tree = draw();
  if (viewportHeight != null) descendants(tree).find(n => n.props?.onLayout).props.onLayout({ nativeEvent: { layout: { height: viewportHeight } } });
  tree = draw();
  return {
    get tree() { return tree; }, content, get nodes() { return descendants(tree); }, get closed() { return closed; }, panEnd,
    resize(height, keyboardShown) {
      keyboardVisible = keyboardShown;
      const event = os === 'ios' ? (keyboardShown ? 'keyboardWillShow' : 'keyboardWillHide') : (keyboardShown ? 'keyboardDidShow' : 'keyboardDidHide');
      keyboardListeners.get(event)?.();
      descendants(tree).find(n => n.props?.onLayout).props.onLayout({ nativeEvent: { layout: { height } } });
      tree = draw();
    },
  };
}

for (const os of ['ios', 'android', 'web']) {
  test(`${os}: one bounded keyboard viewport owns header, fields and scrolling body`, () => {
    const { tree, nodes, content } = render(os);
    const avoiders = nodes.filter(n => n.type === 'KeyboardAvoidingView');
    assert.equal(avoiders.length, 1);
    const viewport = avoiders[0];
    assert.equal(viewport.props.enabled, os !== 'web');
    assert.equal(viewport.props.behavior, os === 'ios' ? 'padding' : 'height');
    assert.equal(flatten(viewport.props.style).flex, 1);
    assert.equal(flatten(viewport.props.style).paddingTop, 47);
    const sheet = descendants(viewport).find(n => n.props?.accessibilityViewIsModal);
    assert.equal(flatten(sheet.props.style).maxHeight, '88%');
    assert.equal(flatten(sheet.props.style).paddingBottom, 34);
    assert.equal(sheet.props.accessibilityViewIsModal, true);
    const scroll = descendants(sheet).find(n => n.type === 'ScrollView');
    assert.equal(scroll.props.keyboardShouldPersistTaps, 'handled');
    assert.equal(scroll.props.nestedScrollEnabled, true);
    assert.ok(children(scroll).includes(content));
    assert.ok(descendants(sheet).some(n => n.type === 'Text' && n.props.children === 'Edit customer'));
    // The dimming/dismiss surface covers the entire modal even while the
    // keyboard viewport shrinks; it must not shrink with the form.
    const modalRoot = children(tree)[0];
    const backdrop = children(modalRoot)[0];
    assert.equal(children(modalRoot)[1], viewport);
    assert.equal(children(backdrop)[0].props.accessibilityLabel, 'Dismiss');
    assert.equal(viewport.props.pointerEvents, 'box-none');
  });
}
for (const reduced of [false, true]) {
  test(`dismissal and Android back retain their callbacks (reduced motion ${reduced})`, () => {
    const rendered = render('ios', { reduced });
    rendered.tree.props.onRequestClose();
    const buttons = rendered.nodes.filter(n => n.type === 'Pressable');
    buttons.find(n => n.props.accessibilityLabel === 'Cancel').props.onPress();
    buttons.find(n => n.props.accessibilityLabel === 'Dismiss').props.onPress();
    assert.equal(rendered.closed, 3);
  });
}
test('header drag still dismisses, short drag retains the sheet', () => {
  const rendered = render('ios');
  rendered.panEnd({ translationY: 10, velocityY: 20 });
  assert.equal(rendered.closed, 0);
  rendered.panEnd({ translationY: 100, velocityY: 20 });
  assert.equal(rendered.closed, 1);
});
test('no-inset phones retain bottom breathing room; hidden/cancel-free sheets retain their contract', () => {
  const { tree, nodes } = render('android', { visible: false, cancel: false, top: 0, bottom: 0 });
  assert.equal(tree.props.visible, false);
  const sheet = nodes.find(n => n.props?.accessibilityViewIsModal);
  assert.equal(flatten(sheet.props.style).paddingBottom, 16);
  assert.ok(!nodes.some(n => n.props?.accessibilityLabel === 'Cancel'));
});
test('the primary action remains outside the scroller and cannot shrink with the form', () => {
  let saved = 0;
  const action = require('react/jsx-runtime').jsx('Pressable', { onPress: () => saved++, accessibilityLabel: 'Save' });
  const { nodes } = render('ios', { footer: action });
  const sheet = nodes.find(n => n.props?.accessibilityViewIsModal);
  const parts = children(sheet);
  const scroll = parts.find(n => n.type === 'ScrollView');
  const footer = parts.at(-1);
  assert.equal(footer.props.children, action);
  assert.equal(flatten(footer.props.style).flexShrink, 0);
  assert.equal(flatten(scroll.props.style).flexShrink, 1);
  assert.ok(!descendants(scroll).includes(action));
  assert.equal(nodes.filter(n => n.type === 'ScrollView').length, 1);
  action.props.onPress();
  assert.equal(saved, 1);
});
test('sheets without a footer retain their compact scrolling layout', () => {
  const { nodes } = render('ios');
  const sheet = nodes.find(n => n.props?.accessibilityViewIsModal);
  assert.equal(children(sheet).at(-1).type, 'ScrollView');
});
test('320x568 with a 300pt keyboard retains a 56pt dismiss row, 88pt Save and positive field space', () => {
  // This deterministic vertical budget reads the production-rendered styles;
  // it is not a native screenshot/Yoga layout claim. Long titles/subtitles
  // cannot consume fixed chrome because they are inside the scroller.
  const action = require('react/jsx-runtime').jsx('Pressable', { style: { height: 88 }, accessibilityLabel: 'Save' });
  for (const os of ['ios', 'android']) {
    const rendered = render(os, { footer: action, viewportHeight: 218, keyboardVisible: true, subtitle: 'Long explanatory copy that can wrap across many lines on a small phone.' });
    const sheet = rendered.nodes.find(n => n.props?.accessibilityViewIsModal);
    const sheetStyle = flatten(sheet.props.style);
    const parts = children(sheet);
    const handle = children(parts[0])[0];
    const scroll = parts.find(n => n.type === 'ScrollView');
    const footer = parts.at(-1);
    assert.equal(sheetStyle.maxHeight, '100%');
    assert.equal(sheetStyle.paddingBottom, 4);
    assert.equal(flatten(handle.props.style).minHeight, 56);
    assert.ok(!descendants(handle).some(n => n.type === 'Text' && n.props.children === 'Edit customer'));
    assert.ok(descendants(scroll).some(n => n.type === 'Text' && n.props.children === 'Edit customer'));
    assert.ok(descendants(scroll).some(n => n.type === 'Text' && String(n.props.children).startsWith('Long explanatory')));
    const bodyBudget = 218 - flatten(handle.props.style).minHeight - flatten(footer.props.children.props.style).height - sheetStyle.paddingBottom - sheetStyle.gap * 2;
    assert.equal(bodyBudget, 62);
    assert.ok(bodyBudget >= 56, 'At least one field target fits above Save');
    assert.equal(flatten(footer.props.style).flexShrink, 0);
    assert.equal(flatten(scroll.props.style).flexShrink, 1);
    // Keyboard dismissal restores bottom safe area and normal header layout.
    rendered.resize(797, false);
    const restored = rendered.nodes.find(n => n.props?.accessibilityViewIsModal);
    assert.equal(flatten(restored.props.style).maxHeight, '88%');
    assert.equal(flatten(restored.props.style).paddingBottom, 34);
  }
});
test('390x844 retains normal chrome with and without a 300pt keyboard', () => {
  for (const [viewportHeight, keyboardVisible] of [[797, false], [497, true]]) {
    const rendered = render('ios', { viewportHeight, keyboardVisible });
    const sheet = rendered.nodes.find(n => n.props?.accessibilityViewIsModal);
    assert.equal(flatten(sheet.props.style).maxHeight, '88%');
    assert.equal(flatten(sheet.props.style).paddingBottom, 34);
    const scroll = children(sheet).find(n => n.type === 'ScrollView');
    assert.ok(!descendants(scroll).some(n => n.type === 'Text' && n.props.children === 'Edit customer'));
  }
});
test('constrained screens without a keyboard retain the bottom safe area', () => {
  const rendered = render('ios', { viewportHeight: 300, keyboardVisible: false });
  const sheet = rendered.nodes.find(n => n.props?.accessibilityViewIsModal);
  assert.equal(flatten(sheet.props.style).maxHeight, '100%');
  assert.equal(flatten(sheet.props.style).paddingBottom, 34);
});
test('the 392pt boundary is compact and the next point restores normal chrome', () => {
  for (const [viewportHeight, expectedCap] of [[392, '100%'], [393, '88%']]) {
    const rendered = render('ios', { viewportHeight, keyboardVisible: true });
    const sheet = rendered.nodes.find(n => n.props?.accessibilityViewIsModal);
    assert.equal(flatten(sheet.props.style).maxHeight, expectedCap);
  }
});
test('form consumers have one scroll owner and pass their existing Save contract to the shared footer', () => {
  for (const file of ['components/sheets/CustomerDetailsSheet.tsx', 'components/knock/PinSheet.tsx']) {
    const text = fs.readFileSync(path.join(root, file), 'utf8');
    assert.doesNotMatch(text, /KeyboardAvoidingView|ScrollView/);
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let sheet;
    function visit(node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === 'BottomSheet') sheet = node;
      ts.forEachChild(node, visit);
    }
    visit(ast);
    assert.ok(sheet);
    const footer = sheet.openingElement.attributes.properties.find(p => p.name?.getText(ast) === 'footer');
    assert.ok(footer, `${file} must provide the shared footer`);
    assert.match(footer.getText(ast), /onPress=\{save\}/);
    assert.match(footer.getText(ast), /disabled=\{!canSave\}/);
    assert.match(footer.getText(ast), /accessibilityLabel=\{saveLabel\}/);
    assert.match(footer.getText(ast), /accessibilityState=\{\{ disabled: !canSave \}\}/);
    assert.doesNotMatch(sheet.children.map(n => n.getText(ast)).join(''), /onPress=\{save\}/);
    // Keep validation explanations and optional actions accessible by scrolling.
    assert.match(sheet.children.map(n => n.getText(ast)).join(''), /styles.saveHint/);
    if (file.includes('PinSheet')) assert.match(footer.getText(ast), /!readOnly/);
  }
});
console.log(`${passed} bottom-sheet keyboard regression scenarios passed.`);
