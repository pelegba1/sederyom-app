/**
 * What `/v2/devices` registers this phone as. Apart from `v2.ts`, so that one
 * imports nothing of React Native and its rules are tested in Node.
 */
import { Platform } from 'react-native';
import type { DevicePlatform } from './v2';

export const DEVICE_PLATFORM: DevicePlatform = Platform.OS === 'ios' ? 'ios' : 'android';
