// Exercise the installed SDK 58 screen-option transform and route-visibility
// hook with the production layout. A hidden Settings route redirects to Home.
/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const sdk = path.join(root, 'node_modules/expo-router/build');
const source = fs.readFileSync(path.join(root, 'app/(tabs)/_layout.tsx'), 'utf8');
const ast = ts.createSourceFile('layout.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const screens = [];
function visit(n) {
  if (ts.isJsxSelfClosingElement(n) && n.tagName.getText(ast) === 'Tabs.Screen') {
    const props = n.attributes.properties;
    const name = props.find(p => p.name?.text === 'name').initializer.text;
    const optionsSource = props.find(p => p.name?.text === 'options').initializer.expression.getText(ast);
    const options = vm.runInNewContext('(' + optionsSource + ')');
    screens.push({ name, options });
  }
  ts.forEachChild(n, visit);
}
visit(ast);
assert.equal(screens.length, 6);
let processScreens;
vm.runInNewContext(fs.readFileSync(path.join(sdk, 'layouts/TabsClient.js'), 'utf8'), {
  exports: {}, require(id) {
    if (id === '../standard-navigation') return { integrateWithRouter(_nav, _router, options) {
      processScreens = options.processScreens;
      return {};
    } };
    return {};
  },
});
assert.equal(typeof processScreens, 'function');
const exportsObject = {};
let redirects;
const order = require(path.join(sdk, 'utils/orderRoutesByRouteNames.js'));
const mocks = {
  react: { useMemo: fn => fn(), useEffect: fn => fn() },
  '../Route': { useRouteNode: () => ({ initialRouteName: 'index' }) },
  '../constants': { NOT_FOUND_ROUTE_NAME: '+not-found' },
  '../global-state/useRouterActions': { useRouterActions: () => ({ replace: href => redirects.push(href) }) },
  '../layouts/GuardContext': { useGuardRedirect: () => undefined },
  '../link/preview/PreviewRouteContext': { useIsPreview: () => false },
  '../react-navigation/native': { useIsFocused: () => true },
  '../routeNode': { getValidInitialRouteName: node => node.initialRouteName },
  '../utils/orderRoutesByRouteNames': order,
  './useBuildHref': { useBuildHref: () => route => '/' + route.name },
};
vm.runInNewContext(fs.readFileSync(path.join(sdk, 'standard-navigation/useVisibleTabsWithRedirect.js'), 'utf8'), {
  exports: exportsObject, __DEV__: false, console, require(id) {
    assert.ok(id in mocks, id);
    return mocks[id];
  },
});
function render(input) {
  redirects = [];
  const processed = processScreens(input);
  const routes = processed.map(s => ({ name: s.name, key: s.name + '-key' }));
  const descriptors = Object.fromEntries(processed.map(s => [s.name + '-key', { routeSource: 'layout', options: s.options }]));
  return exportsObject.useVisibleTabsWithRedirect({ routes, routeNames: routes.map(r => r.name),
    focusedRouteKey: 'settings-key', descriptors });
}
const current = render(screens);
assert.ok(current.focusedIndex >= 0, 'Production Settings remains reachable in the SDK 58 navigator');
assert.equal(current.visibleRoutes[current.focusedIndex].name, 'settings');
assert.deepEqual(redirects, []);
const old = render(screens.map(s => s.name === 'settings' ? { ...s, options: { ...s.options, href: null } } : s));
assert.equal(old.focusedIndex, -1);
assert.deepEqual(redirects, ['/index'], 'Control reproduces the SDK 57 layout redirect under SDK 58');
console.log('PASS installed SDK 58 preserves Settings; href:null control reproduces the prior redirect');
