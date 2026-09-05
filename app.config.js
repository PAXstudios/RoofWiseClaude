// Dynamic Expo app config.
//
// Keys come from process.env at build time so secrets stay out of git.
// The values for Google Maps / Places / etc. live in `.env.local`
// (gitignored). For EAS builds, set them in EAS Secrets.

const googleMapsApiKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

const googleMapsAndroidKey =
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY ||
  process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
  '';

module.exports = {
  expo: {
    name: 'RoofWise',
    slug: 'roofwise',
    // EAS project on the owner's `roofwise` Expo account (created 2026-09-01).
    // `eas project:init` cannot write into a dynamic config, so these three
    // fields are maintained by hand. `runtimeVersion` MUST stay on the
    // `sdkVersion` policy: Expo Go identifies its runtime by SDK version, so
    // an update published under any other policy is invisible to it.
    owner: 'roofwise',
    updates: {
      url: 'https://u.expo.dev/b1fdcacc-a354-499a-842c-0f5ce6fa2e68',
    },
    runtimeVersion: { policy: 'sdkVersion' },
    scheme: 'roofwise',
    version: '0.1.0',
    icon: './assets/roofwise-app-logo.png',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    // Expo Go 52+ only runs the New Architecture; SDK 54 defaults it on.
    newArchEnabled: true,
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.roofwise.app',
      usesAppleSignIn: true,
      // SDK 54 / RN 0.81 floor.
      deploymentTarget: '15.1',
      config: {
        googleMapsApiKey,
      },
      infoPlist: {
        NSCameraUsageDescription:
          'RoofWise uses the camera to capture roof damage photos for AI analysis.',
        NSPhotoLibraryUsageDescription:
          'RoofWise can attach inspection photos from your library.',
        NSPhotoLibraryAddUsageDescription:
          'RoofWise can save captured inspection photos to your library.',
        NSLocationWhenInUseUsageDescription:
          'RoofWise uses your location to map storm activity, find nearby leads, and log door-knocking visits.',
        NSMicrophoneUsageDescription:
          'RoofWise uses the microphone for voice-to-text notes during inspections.',
        NSSpeechRecognitionUsageDescription:
          'RoofWise uses speech recognition to transcribe your voice notes.',
        NSMotionUsageDescription:
          'RoofWise uses motion sensors to measure roof pitch and detect slope orientation.',
      },
    },
    android: {
      package: 'com.roofwise.app',
      permissions: [
        'android.permission.CAMERA',
        'android.permission.ACCESS_COARSE_LOCATION',
        'android.permission.ACCESS_FINE_LOCATION',
        'android.permission.RECORD_AUDIO',
      ],
      config: {
        googleMaps: {
          apiKey: googleMapsAndroidKey,
        },
      },
      adaptiveIcon: {
        foregroundImage: './assets/roofwise-app-logo.png',
        backgroundColor: '#F2F0E7',
      },
    },
    web: {
      // First-class web target: Metro bundling + static export so the same
      // expo-router tree ships to iOS, Android, and a hosted web app
      // (`npx expo export --platform web`).
      bundler: 'metro',
      output: 'static',
      // Ships as favicon.ico in the static export — without it every page
      // load logs a 404 for /favicon.ico.
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      [
        // Since SDK 52 the splash screen is configured via this plugin
        // instead of the top-level `splash` field.
        'expo-splash-screen',
        {
          image: './assets/roofwise-app-logo.png',
          imageWidth: 220,
          resizeMode: 'contain',
          backgroundColor: '#F2F0E7',
        },
      ],
      'expo-apple-authentication',
      [
        'expo-camera',
        {
          cameraPermission:
            'Allow RoofWise to access your camera to capture roof damage photos.',
        },
      ],
      [
        'expo-location',
        {
          locationAlwaysAndWhenInUsePermission:
            'Allow RoofWise to use your location to map storms, leads, and door-knocking routes.',
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission:
            'Allow RoofWise to access your photo library to attach inspection photos.',
        },
      ],
      // SDK 57: `expo install --fix` started flagging these as unlinked
      // plugins (each now ships an app.plugin.js). All are true no-ops
      // without props except expo-audio, which is pinned to `false`/`false`
      // below so it does NOT silently opt the app into a background-audio
      // UIBackgroundMode we don't use — everything else here just registers
      // cleanly for EAS Build with default behavior unchanged.
      'expo-asset',
      'expo-font',
      'expo-image',
      'expo-sharing',
      'expo-status-bar',
      'expo-web-browser',
      [
        'expo-audio',
        {
          enableBackgroundPlayback: false,
          enableBackgroundRecording: false,
        },
      ],
    ],
    experiments: {
      typedRoutes: false,
      tsconfigPaths: true,
    },
    extra: {
      eas: {
        projectId: 'b1fdcacc-a354-499a-842c-0f5ce6fa2e68',
      },
    },
  },
};
