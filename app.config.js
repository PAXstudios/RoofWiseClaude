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
    scheme: 'roofwise',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    splash: {
      resizeMode: 'contain',
      backgroundColor: '#F0F0E4',
    },
    assetBundlePatterns: ['**/*'],
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.roofwise.app',
      usesAppleSignIn: true,
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
        backgroundColor: '#0C183C',
      },
    },
    plugins: [
      'expo-router',
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
    ],
    experiments: {
      typedRoutes: false,
      tsconfigPaths: true,
    },
  },
};
