/* eslint-env node */
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.sourceExts = [...config.resolver.sourceExts, 'mjs', 'cjs'];

// SDK 53+ Metro honors `package.json#exports`. zustand 4.x's `import`
// condition points at an ESM build that uses `import.meta.env`, which the
// web bundle cannot evaluate ("Cannot use 'import.meta' outside a module").
// Native is unaffected (zustand has a `react-native` condition → CJS). Scope
// the fallback to zustand only instead of the global
// `unstable_enablePackageExports: false` escape hatch: without exports,
// Metro resolves zustand's `main` / subpath files, which are the CJS builds.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'zustand' || moduleName.startsWith('zustand/')) {
    const ctx = { ...context, unstable_enablePackageExports: false };
    return defaultResolveRequest
      ? defaultResolveRequest(ctx, moduleName, platform)
      : ctx.resolveRequest(ctx, moduleName, platform);
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
