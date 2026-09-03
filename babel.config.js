module.exports = function (api) {
  api.cache(true);
  return {
    presets: [['babel-preset-expo', { jsxImportSource: 'react' }]],
    // Reanimated 4 moved its Babel plugin into react-native-worklets.
    // It must remain the LAST plugin in this list.
    plugins: ['react-native-worklets/plugin'],
  };
};
