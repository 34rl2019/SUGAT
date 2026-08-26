import type { ConfigContext, ExpoConfig } from 'expo/config';

const whenInUse = 'SUGAT uses your location while you operate an assigned trip so passengers can see where the bus or van is.';
const always = 'SUGAT uses your location in the background only while an assigned trip is active so passengers along the route can see the bus or van approaching.';

export default ({ config }: ConfigContext): ExpoConfig => {
  const iosBundleIdentifier = process.env.SUGAT_IOS_BUNDLE_ID;
  const androidPackage = process.env.SUGAT_ANDROID_PACKAGE ?? iosBundleIdentifier;
  if (!iosBundleIdentifier && !androidPackage) throw new Error('Set SUGAT_ANDROID_PACKAGE or SUGAT_IOS_BUNDLE_ID to an identifier you control.');
  const allowHttp = process.env.SUGAT_ALLOW_HTTP === 'true';
  return {
    ...config,
    name: 'SUGAT Driver',
    slug: 'sugat-driver',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'light',
    scheme: 'sugat-driver',
    ios: iosBundleIdentifier ? {
      bundleIdentifier: iosBundleIdentifier,
      supportsTablet: false,
      infoPlist: {
        NSLocationWhenInUseUsageDescription: whenInUse,
        NSLocationAlwaysAndWhenInUseUsageDescription: always,
        UIBackgroundModes: ['location'],
      },
    } : undefined,
    android: {
      package: androidPackage,
      // expo-location adds location and foreground-service permissions.
      permissions: ['POST_NOTIFICATIONS'],
    },
    plugins: [
      'expo-secure-store',
      'expo-notifications',
      ['expo-build-properties', { android: { usesCleartextTraffic: allowHttp } }],
      ['expo-location', {
        isIosBackgroundLocationEnabled: true,
        isAndroidBackgroundLocationEnabled: true,
        isAndroidForegroundServiceEnabled: true,
        locationWhenInUsePermission: whenInUse,
        locationAlwaysAndWhenInUsePermission: always,
      }],
    ],
    extra: { apiUrl: process.env.EXPO_PUBLIC_API_URL },
  };
};
