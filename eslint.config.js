// https://docs.expo.dev/guides/using-eslint/
// ESLint 9 flat config (eslint-config-expo ≥10 / SDK 54). Replaces .eslintrc.js.
const expoConfig = require('eslint-config-expo/flat');
const { defineConfig } = require('eslint/config');

module.exports = defineConfig([
  expoConfig,
  {
    // Build artifacts. `dist/` comes from `npx expo export` and holds a
    // multi-MB bundled vendor blob — linting it yields thousands of bogus
    // errors. It's gitignored, but ESLint doesn't read .gitignore.
    ignores: ['dist/', 'build/', 'web-build/', '.expo/'],
  },
  {
    rules: {
      // eslint-config-expo 10 turned this on; v7 (SDK 51) did not. Apostrophes
      // and quotes in JSX copy are intentional — keep the SDK 51 lint contract.
      'react/no-unescaped-entities': 'off',

      // SDK 57: eslint-config-expo's `plugin:react-hooks/recommended` now
      // resolves to eslint-plugin-react-hooks 7.x, whose "recommended" preset
      // adds the React Compiler rule family (refs/set-state-in-effect/
      // immutability/purity) as errors. That surfaced 125 new findings across
      // ~50 files on the SDK 54→57 upgrade — none from code this upgrade
      // touched. A chunk are real "move setState out of an effect" smells
      // worth a deliberate pass, but `immutability`/`refs` false-positive
      // heavily on this codebase's Reanimated shared-value (`.value`)
      // mutations inside worklets/gesture callbacks, which the rule has no
      // concept of. Rather than a blind mass-refactor of product code as a
      // side effect of a dependency bump, turn the four new rules off here —
      // same call this file already made for `react/no-unescaped-entities`
      // when v10 turned that on. Revisit deliberately, file by file.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/purity': 'off',
    },
  },
]);
