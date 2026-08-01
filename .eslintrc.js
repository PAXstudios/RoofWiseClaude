// https://docs.expo.dev/guides/using-eslint/
module.exports = {
  extends: 'expo',
  // Build artifacts. `dist/` comes from `npx expo export` and holds a
  // multi-MB bundled vendor blob — linting it yields thousands of bogus
  // errors. It's gitignored, but ESLint doesn't read .gitignore.
  ignorePatterns: ['dist/', 'build/', 'web-build/', '.expo/'],
};
