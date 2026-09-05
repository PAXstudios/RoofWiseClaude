// node tests/theme-contrast.cjs
// Check the production token pairs used by small labels and placeholders.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../theme/tokens.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const tokenExports = {};
vm.runInNewContext(compiled, {
  exports: tokenExports,
  require(id) {
    assert.equal(id, 'react-native');
    return { Platform: { select: values => values.web ?? values.default } };
  },
});
const { colors } = tokenExports;
function rgb(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  return hex.slice(1).match(/../g).map(channel => parseInt(channel, 16));
}
function composite(fill, ground) {
  const match = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(fill);
  assert.ok(match, `Unsupported translucent fill: ${fill}`);
  const [, r, g, b, alpha] = match.map(Number);
  return rgb(ground).map((channel, i) => [r, g, b][i] * alpha + channel * (1 - alpha));
}
function luminance(color) {
  const linear = (Array.isArray(color) ? color : rgb(color)).map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return linear.reduce((sum, channel, i) => sum + channel * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Render the production primitive: this covers its actual soft/solid ink
// selection, not just the intended pairs in its palette table.
const pillSource = fs.readFileSync(path.join(__dirname, '../components/ui/Pill.tsx'), 'utf8');
const pillCompiled = ts.transpileModule(pillSource, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
  jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
} }).outputText;
const pillExports = {};
const pillMocks = {
  react: { useEffect() {} },
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': { View: 'View', Text: 'Text', StyleSheet: { create: value => value } },
  '@expo/vector-icons': { Ionicons: 'Ionicons' },
  'react-native-reanimated': { __esModule: true, default: { View: 'Animated.View' } },
  '@/theme/tokens': tokenExports,
};
vm.runInNewContext(pillCompiled, { exports: pillExports, require(id) {
  assert.ok(id in pillMocks, `Unexpected Pill dependency ${id}`);
  return pillMocks[id];
} });
const flatten = styles => Object.assign({}, ...[styles].flat(Infinity).filter(Boolean));
for (const tone of ['neutral', 'brand', 'accent', 'success', 'warn', 'danger', 'info']) {
  for (const solid of [false, true]) {
    for (const size of ['sm', 'md']) {
      const pill = pillExports.Pill({ label: 'Status', tone, solid, size, icon: 'checkmark' });
      const fill = flatten(pill.props.style).backgroundColor;
      const children = pill.props.children.filter(Boolean);
      const label = children.find(child => child.type === 'Text');
      const ink = flatten(label.props.style).color;
      assert.equal(children.find(child => child.type === 'Ionicons').props.color, ink);
      for (const ground of ['bg', 'surface', 'surfaceMuted']) {
        const paint = fill.startsWith('rgba') ? composite(fill, colors[ground]) : fill;
        const ratio = contrast(ink, paint);
        const name = `Pill ${tone} ${solid ? 'solid' : 'soft'} ${size} on ${ground}`;
        assert.ok(ratio >= 4.5, `${name}: ${ratio.toFixed(2)}:1 is below 4.5:1`);
        if (size === 'sm' && ground === 'bg') console.log(`PASS ${name}: ${ratio.toFixed(2)}:1`);
      }
    }
  }
}
const grounds = Object.fromEntries(['bg', 'surface', 'surfaceMuted'].map(name => [name, colors[name]]));
// JobTabs' inactive labels sit on a translucent track, not bare paper.
const quietTrack = composite(colors.fillQuiet, colors.bg);
grounds['fillQuiet over bg'] = quietTrack;
grounds['fillQuiet over bg (8-bit paint)'] = quietTrack.map(Math.round);
for (const [ground, paint] of Object.entries(grounds)) {
  for (const ink of ['text', 'textMuted', 'textSubtle']) {
    const ratio = contrast(colors[ink], paint);
    assert.ok(ratio >= 4.5, `${ink} on ${ground}: ${ratio.toFixed(2)}:1 is below 4.5:1`);
    console.log(`PASS ${ink} on ${ground}: ${ratio.toFixed(2)}:1`);
  }
}
assert.ok(luminance(colors.text) < luminance(colors.textMuted));
assert.ok(luminance(colors.textMuted) < luminance(colors.textSubtle));
console.log('PASS primary, secondary and subtle text preserve their visual hierarchy');

// These labels paint their severity color as a solid fill over photographs.
// Read each component's actual maps so a text-token-as-fill regression is
// caught even when all normal light-surface text pairs still pass.
for (const [file, tintName] of [
  ['components/capture/LiveOverlay.tsx', 'SEVERITY_TINT'],
  ['components/DamageMarkerLayer.tsx', 'SEVERITY_COLORS'],
]) {
  const componentSource = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const ast = ts.createSourceFile(file, componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const maps = {};
  for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const name = declaration.name.getText(ast);
      if (name !== tintName && name !== 'SEVERITY_INK') continue;
      assert.ok(declaration.initializer, `${file}: ${name} must define a severity map`);
      maps[name] = vm.runInNewContext(`(${declaration.initializer.getText(ast)})`, {
        colors, brand: tokenExports.brand,
      });
    }
  }
  assert.ok(maps[tintName] && maps.SEVERITY_INK, `${file}: missing severity maps`);
  for (const severity of ['none', 'minor', 'moderate', 'severe']) {
    const ratio = contrast(maps.SEVERITY_INK[severity], maps[tintName][severity]);
    assert.ok(ratio >= 4.5, `${file} ${severity} pill: ${ratio.toFixed(2)}:1 is below 4.5:1`);
    console.log(`PASS ${file} ${severity} pill: ${ratio.toFixed(2)}:1`);
  }
}
