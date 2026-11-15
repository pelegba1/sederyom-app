import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { isConfigured } from '../config';
import { isDemo } from '../demo/phone';
import { keepPushAddress, sendPushToken } from '../device/v2';
import { storage } from '../widget/feedCache';

export interface PushRegistration {
  granted: boolean;
  token: string | null;
  error: string | null;
  request: () => Promise<void>;
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'סדר יום',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#5AA2D8',
  });
}

function projectIdOption(): { projectId: string } | undefined {
  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  return projectId ? { projectId } : undefined;
}

export function usePushRegistration(): PushRegistration {
  const [granted, setGranted] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = useCallback(async (ask: boolean) => {
    try {
      if (!Device.isDevice) {
        setError('התראות פוש עובדות רק על מכשיר אמיתי, לא באמולטור.');
        return;
      }
      await ensureAndroidChannel();

      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== 'granted' && ask) {
        status = (await Notifications.requestPermissionsAsync()).status;
      }
      if (status !== 'granted') {
        setGranted(false);
        if (ask) setError('ההתראות כבויות בטלפון. אפשר להפעיל אותן בהגדרות הטלפון.');
        return;
      }
      setGranted(true);
      setError(null);
      // The demo's made-up student gets no pushes: no push address is asked for, kept or sent.
      if (isDemo()) return;

      const expoToken = await Notifications.getExpoPushTokenAsync(projectIdOption());
      setToken(expoToken.data);
      // Kept, and sent to the device for the class's pushes once there is one: the phone
      // registers only when it follows a class, and the follow sends it then (`sendDeviceDetails`).
      keepPushAddress(storage, expoToken.data);
      if (isConfigured) await sendPushToken(storage, expoToken.data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  // On mount only *check* — asking for the permission is the onboarding step's job.
  useEffect(() => {
    void register(false);
  }, [register]);

  return { granted, token, error, request: () => register(true) };
}
