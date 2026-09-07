import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Linking from 'expo-linking';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from './supabase';

const DEFAULT_CHANNEL_ID = 'default';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

declare global {
  // Prevent duplicate listeners during development fast refreshes.
  var __fireOpsNotificationsStarted: boolean | undefined;
}

function getProjectId(): string | undefined {
  return Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId;
}

async function syncUnreadBadge() {
  if (Platform.OS === 'web' || !supabase) return;
  const { count, error } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null);
  if (!error) await Notifications.setBadgeCountAsync(count ?? 0);
}

async function configureAndroidChannel() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(DEFAULT_CHANNEL_ID, {
    name: 'General',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#D32F2F',
  });
}

/**
 * Requests notification permission, gets this installation's Expo token, and
 * assigns it to the current Supabase user. Safe to call more than once.
 */
export async function registerForPushNotifications(userId?: string) {
  const client = supabase;
  if (Platform.OS === 'web' || !Device.isDevice || !client) return null;

  const resolvedUserId = userId ?? (await client.auth.getUser()).data.user?.id;
  if (!resolvedUserId) return null;

  await configureAndroidChannel();

  const existingPermission = await Notifications.getPermissionsAsync();
  let permissionStatus = existingPermission.status;

  if (permissionStatus !== 'granted' && existingPermission.canAskAgain) {
    permissionStatus = (await Notifications.requestPermissionsAsync()).status;
  }

  if (permissionStatus !== 'granted') return null;

  const projectId = getProjectId();
  if (!projectId) {
    console.warn('Push registration skipped: EAS projectId is missing.');
    return null;
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await client.rpc('register_push_token', {
    p_expo_push_token: token,
    p_platform: Platform.OS,
    p_device_name: Device.deviceName,
    p_app_version: Constants.expoConfig?.version ?? null,
  });

  if (error) throw error;
  await syncUnreadBadge();
  return token;
}

/** Call before signing out so this device stops receiving this user's pushes. */
export async function unregisterFromPushNotifications() {
  const client = supabase;
  if (Platform.OS === 'web' || !Device.isDevice || !client) return;

  const projectId = getProjectId();
  if (!projectId) return;

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const { error } = await client.rpc('unregister_push_token', {
    p_expo_push_token: token,
  });

  if (error) throw error;
  await Notifications.setBadgeCountAsync(0);
}

function openNotification(response: Notifications.NotificationResponse) {
  const data = response.notification.request.content.data;
  const path = data?.path;
  const notificationId = data?.notificationId;
  if (typeof notificationId === 'string' && UUID_PATTERN.test(notificationId) && supabase) {
    void (async () => {
      await supabase.from('user_notifications').update({ read_at: new Date().toISOString() }).eq('id', notificationId);
      await syncUnreadBadge();
    })().catch(() => undefined);
  }
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
    return;
  }

  void Linking.openURL(Linking.createURL(path));
}

function startNotifications() {
  const client = supabase;
  if (Platform.OS === 'web' || !client || globalThis.__fireOpsNotificationsStarted) return;
  globalThis.__fireOpsNotificationsStarted = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  Notifications.addNotificationResponseReceivedListener(openNotification);
  Notifications.addNotificationReceivedListener(() => {
    void syncUnreadBadge().catch(() => undefined);
  });

  void Notifications.getLastNotificationResponseAsync().then((response) => {
    if (!response) return;
    openNotification(response);
    void Notifications.clearLastNotificationResponseAsync();
  });

  void client.auth.getSession().then(({ data }) => {
    if (!data.session?.user.id) return;
    void registerForPushNotifications(data.session.user.id).catch((error) => {
      console.warn('Push notification registration failed:', error);
    });
  });

  client.auth.onAuthStateChange((event, session) => {
    if (event !== 'SIGNED_IN' || !session?.user.id) return;

    // Run outside the auth callback to avoid blocking Supabase's auth lock.
    setTimeout(() => {
      void registerForPushNotifications(session.user.id).catch((error) => {
        console.warn('Push notification registration failed:', error);
      });
    }, 0);
  });
}

startNotifications();
