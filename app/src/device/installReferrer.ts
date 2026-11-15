/**
 * The store's install referrer, read once (ideas ה2). An install from an
 * invite link's page (`public/join.html`) carries the link's `s=…&c=…`
 * through Google Play, so the app can follow that class on its first start
 * without the link being tapped again. Read once per install whatever it
 * says: an install from no invite carries the store's own words, which name
 * no class. Only Android has one.
 */
import * as Application from 'expo-application';
import { Platform } from 'react-native';
import { joinOf, type JoinTarget } from '../lib/invite';
import type { KeyValue } from '../mashov/sync';

export const REFERRER_KEY = 'invite.referrerRead';

export async function inviteFromInstall(kv: KeyValue): Promise<JoinTarget | null> {
  if (Platform.OS !== 'android' || kv.getString(REFERRER_KEY) === '1') return null;
  kv.set(REFERRER_KEY, '1');
  try {
    return joinOf(await Application.getInstallReferrerAsync());
  } catch {
    return null;
  }
}
