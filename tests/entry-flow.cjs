/* global __dirname */
// Exercise the route decisions and actual buttons together. Both index files
// can resolve to Home, depending on how the user launches the app.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const native = {
  StyleSheet: { create: styles => styles }, Platform: { OS: 'ios', select: options => options.ios ?? options.default },
  View: 'View', Text: 'Text', Pressable: 'Pressable', useWindowDimensions: () => ({ width: 390 }),
};
const auth = { initialized: true, session: null };
const tour = { completed: false, complete() { tour.completed = true; } };
const env = { REQUIRE_AUTH: false };
let navigated, hydrated = true, segments = ['(tabs)'], reduced = false;
const router = {
  replace: href => { navigated = href; }, dismissTo: href => { navigated = href; },
};
const animation = { duration() { return this; }, delay() { return this; } };
const mocks = {
  react: { useEffect: fn => fn(), useCallback: fn => fn, useMemo: fn => fn(), useRef: current => ({current}),
    useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}] },
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': native,
  'expo-router': { useRouter: () => router, useSegments: () => segments, Redirect: 'Redirect', Stack: { Screen:'Screen' }, Tabs:{ Screen:'Screen' } },
  'react-native-reanimated': { __esModule:true, default:{ View:'Animated.View' }, useAnimatedStyle: () => ({}),
    useSharedValue: value => ({value}), useReducedMotion: () => reduced, FadeIn: animation, FadeInDown: animation },
  '@/lib/auth/authStore': { useAuthStore: selector => selector(auth) },
  '@/lib/stores/onboardingStore': { useOnboardingHydrated: () => hydrated, useOnboardingStore: selector => selector(tour) },
  '@/lib/stores/toastStore': { useToastStore: selector => selector({show() {}}) },
  '@/lib/env': { env },
  '@/theme/useResponsive': {useResponsive: () => ({isDesktop:false})},
};
function load(file) {
  const source = fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  const js = ts.transpileModule(source,{compilerOptions:{ target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX }}).outputText;
  const output = {};
  vm.runInNewContext(js,{exports:output,require:id=>mocks[id] ?? {}});
  return output;
}
mocks['@/theme/tokens'] = load('theme/tokens.ts');
const index = load('app/index.tsx').default;
const tabs = load('app/(tabs)/_layout.tsx').default;
const onboarding = load('app/onboarding.tsx').default;
const welcome = load('app/welcome.tsx').default;
function find(element, match) {
  if (!element || typeof element !== 'object') return undefined;
  if (match(element)) return element;
  for (const child of [element.props?.children].flat()) {
    const found = find(child,match);
    if (found) return found;
  }
}
function guestButton(element) {
  return find(element,e=>e.type === 'Pressable' && find(e, child=>child.props?.children === 'Continue as guest'));
}
function skip() {
  find(onboarding(), e => e.props?.accessibilityLabel === 'Skip onboarding').props.onPress();
}
hydrated = false;
assert.equal(index().type,'View');
assert.equal(tabs().type,'View');
hydrated = true;
assert.equal(index().props.href,'/onboarding');
for (segments of [['(tabs)'],['(tabs)','index']]) assert.equal(tabs().props.href,'/onboarding');
skip();
assert.equal(tour.completed,true);
assert.equal(navigated,'/welcome');
guestButton(welcome()).props.onPress();
assert.equal(navigated,'/(tabs)');
assert.equal(auth.session,null);
assert.equal(index().props.href,'/(tabs)');
assert.notEqual(tabs().type,'Redirect');
skip();
assert.equal(navigated,'/(tabs)');
tour.completed = false;
guestButton(onboarding()).props.onPress();
assert.equal(navigated,'/(tabs)');
assert.equal(tour.completed,true);
env.REQUIRE_AUTH = true;
assert.equal(guestButton(welcome()),undefined);
assert.equal(guestButton(onboarding()),undefined);
assert.equal(index().props.href,'/welcome');
assert.equal(tabs().props.href,'/welcome');
auth.session = {user:{id:'test-user'}};
skip();
assert.equal(navigated,'/(tabs)');
assert.equal(index().props.href,'/(tabs)');
console.log('PASS first-run hydration, both Home entry points, tour Skip, guest entry from tour and sign-in, returning guest, replay and required-auth gate');

reduced = true;
let nextScroll;
mocks.react.useRef = () => ({current:{scrollToOffset: value => { nextScroll=value; }}});
mocks['expo-haptics'] = { ImpactFeedbackStyle:{Light:'light'}, impactAsync: () => Promise.resolve() };
const reducedTour = load('app/onboarding.tsx').default;
find(reducedTour(), e => e.props?.accessibilityLabel === 'Next').props.onPress();
assert.equal(nextScroll.animated,false);
assert.equal(nextScroll.offset,390);
const animations = mocks['react-native-reanimated'];
animations.default.createAnimatedComponent = value => value;
animations.useAnimatedProps = () => ({});
animations.withTiming = () => assert.fail('Reduce Motion must skip the launch animation');
assert.equal(load('components/onboarding/RooflineIntro.tsx').RooflineIntro(),null);
console.log('PASS Reduce Motion bypasses the launch overlay and advances the tour without animated scrolling');
