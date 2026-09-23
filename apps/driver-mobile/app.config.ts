import type { ConfigContext, ExpoConfig } from 'expo/config';

const whenInUse =
  'SUGAT uses your location while you operate an assigned trip so passengers can see where the bus or van is.';

const always =
  'SUGAT uses your location in the background only while an assigned trip is active so passengers along the route can see the bus or van approaching.';

const androidPackage = 'online.sugata.driver';
const iosBundleIdentifier = 'online.sugata.driver';

function validateApiUrl() {
  const value = process.env.EXPO_PUBLIC_API_URL;
  const environment =
    process.env.EXPO_PUBLIC_APP_ENV ??
    (process.env.EAS_BUILD_PROFILE === 'development'
      ? 'development'
      : 'production');

  if (!value) {
    throw new Error(
      `Missing EXPO_PUBLIC_API_URL for the ${environment} Driver Mobile build.`,
    );
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(
      'EXPO_PUBLIC_API_URL must be a valid absolute URL.',
    );
  }

  if (!url.pathname.endsWith('/api/v1')) {
    throw new Error(
      'EXPO_PUBLIC_API_URL must include the /api/v1 path.',
    );
  }

  if (
    environment !== 'development' &&
    (url.protocol !== 'https:' ||
      ['localhost', '127.0.0.1', '10.0.2.2'].includes(
        url.hostname,
      ))
  ) {
    throw new Error(
      `${environment} Driver Mobile builds require a non-local HTTPS EXPO_PUBLIC_API_URL.`,
    );
  }

  if (
    url.protocol === 'http:' &&
    process.env.SUGAT_ALLOW_HTTP !== 'true'
  ) {
    throw new Error(
      'HTTP API access requires SUGAT_ALLOW_HTTP=true and is development-only.',
    );
  }

  return value.replace(/\/$/, '');
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const apiUrl = validateApiUrl();
  const allowHttp = process.env.SUGAT_ALLOW_HTTP === 'true';

  return {
    ...config,

    name: 'SUGAT Driver',
    slug: 'sugat-driver',
    owner: 'sugata-app',

    /*
     * Application version shown to users.
     */
    version: '0.1.1',

    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    scheme: 'sugat-driver',

    ios: {
      bundleIdentifier: iosBundleIdentifier,
      supportsTablet: false,

      infoPlist: {
        NSLocationWhenInUseUsageDescription: whenInUse,
        NSLocationAlwaysAndWhenInUseUsageDescription: always,
        UIBackgroundModes: ['location'],
      },
    },

    android: {
      package: androidPackage,

      /*
       * Android versionCode must increase for every
       * installable release that upgrades an existing APK.
       *
       * Existing installed Driver app:
       * versionCode = 2
       *
       * This release:
       * versionCode = 3
       */
      versionCode: 3,

      // expo-location adds location and foreground-service permissions.
      permissions: ['POST_NOTIFICATIONS'],
    },

    plugins: [
      'expo-secure-store',

      'expo-notifications',

      [
        'expo-build-properties',
        {
          android: {
            usesCleartextTraffic: allowHttp,
          },
        },
      ],

      [
        'expo-location',
        {
          isIosBackgroundLocationEnabled: true,
          isAndroidBackgroundLocationEnabled: true,
          isAndroidForegroundServiceEnabled: true,
          locationWhenInUsePermission: whenInUse,
          locationAlwaysAndWhenInUsePermission: always,
        },
      ],
    ],

    extra: {
      apiUrl,
      eas: {
        projectId: 'db7e3d62-0fa2-445f-8c69-a6e3284c37ca',
      },
    },
  };
};
