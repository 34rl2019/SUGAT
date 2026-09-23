import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

export async function requestAndroidNotificationPermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) < 33) return { granted: true as const };
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return { granted: true as const };
  const requested = await Notifications.requestPermissionsAsync();
  if (!requested.granted) {
    return {
      granted: false as const,
      reason: 'Notification permission is required so Android can show that active-trip GPS tracking is running. Enable Notifications for SUGAT Driver in Settings.',
    };
  }
  return { granted: true as const };
}
