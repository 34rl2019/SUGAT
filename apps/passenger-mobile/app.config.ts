import type { ConfigContext, ExpoConfig } from 'expo/config';

const androidPackage = 'ph.sugata.passenger';

function apiConfiguration() {
  const value = process.env.EXPO_PUBLIC_API_URL;

  const environment =
    process.env.EXPO_PUBLIC_APP_ENV ??
    (process.env.EAS_BUILD_PROFILE === 'development'
      ? 'development'
      : 'production');

  if (!value) {
    throw new Error(
      `Missing EXPO_PUBLIC_API_URL for the ${environment} Passenger Mobile build.`,
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
    (
      url.protocol !== 'https:' ||
      ['localhost', '127.0.0.1', '10.0.2.2'].includes(url.hostname)
    )
  ) {
    throw new Error(
      `${environment} Passenger Mobile builds require a non-local HTTPS EXPO_PUBLIC_API_URL.`,
    );
  }

  if (
    url.protocol === 'http:' &&
    (
      environment !== 'development' ||
      process.env.SUGAT_ALLOW_HTTP !== 'true'
    )
  ) {
    throw new Error(
      'HTTP API access requires a development build and SUGAT_ALLOW_HTTP=true.',
    );
  }

  return {
    apiUrl: value.replace(/\/$/, ''),
    allowHttp: url.protocol === 'http:',
  };
}

export default ({ config }: ConfigContext): ExpoConfig => {
  const { apiUrl, allowHttp } = apiConfiguration();

  return {
    ...config,

    name: 'SUGAT Passenger',
    slug: 'sugat-passenger',
    owner: 'sugata-app',
    version: '0.1.0',
    orientation: 'portrait',
    userInterfaceStyle: 'dark',
    scheme: 'sugat-passenger',

    android: {
      package: androidPackage,

      permissions: [
        'ACCESS_COARSE_LOCATION',
        'ACCESS_FINE_LOCATION',
        'POST_NOTIFICATIONS',
      ],
    },

    plugins: [
      '@maplibre/maplibre-react-native',

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
          locationWhenInUsePermission:
            'Allow SUGAT to use your location to help you understand nearby stops and rides.',
        },
      ],

      'expo-notifications',
    ],

    extra: {
      apiUrl,

      eas: {
        projectId: 'b57a0a43-3955-4f55-aa94-bfef0f10bc51',
      },
    },
  };
};
