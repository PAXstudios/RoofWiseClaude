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
    },
  },
]);
