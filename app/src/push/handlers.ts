/**
 * Push handling: deep links on tap, and the widget-refresh trigger that fires
 * on *receipt* — trigger 2 of the three the design names (§4).
 *
 * And the notification log's sightings (`notify/log.ts`): whatever arrives
 * while the app is open, whatever is tapped, and on start and on every return
 * to the app whatever the tray holds (what came while it was closed).
 */
import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useQueryClient } from '@tanstack/react-query';
import { DEVICE_NOTIFICATION_TYPES } from '@sederyom/shared';
import { keys, refreshWidgetSoon, showChildForPush } from '../api/hooks';
import { refreshLocalSources } from '../local/source';
import { deliveryOf, logDeliveries, reconcileNotificationLog } from '../notify/local';
import { requestMashovRenew } from '../lib/mashovRenew';
import { routeForPayload, type PushRoute, type RouteHints } from '../lib/notifications';
import { requestTodayFocus } from '../lib/todayFocus';
import type { RootNavigation } from '../navigation/types';

export { routeForPayload, routeForLogEntry, type PushRoute } from '../lib/notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

/**
 * Opens a route from `routeForPayload`. A tab is reached by popping back to
 * the tab bar (`pop: true`): in React Navigation 7 a plain `navigate('Tabs')`
 * from a stack screen such as the log would push a second, fresh tab bar on
 * top of it. Stack screens (מצב חיבורים, הגדרות…) open on top, so "back"
 * returns to where the tap came from.
 *
 * A timetable change (`focus: 'changes'`) asks Today to open the change on
 * its day (lib/todayFocus.ts) before going there — the push and the bell's
 * log alike, since both come through here.
 *
 * "צריך להתחבר שוב למשוב" (`mashov-login`) opens the renewal sheet over
 * whatever is on screen (W6-1), not the full login screen: the login may go
 * through by itself, and "לא עכשיו" leaves the person where they were. The
 * full screen stays the way in from מצב חיבורים.
 */
export function navigateToRoute(navigation: RootNavigation, route: PushRoute): void {
  if (route.name === 'Tabs') {
    // A timetable change (Wave 7): Today opens the change itself once it shows the day.
    if (route.focus && route.params.screen === 'Today' && route.params.params?.date) {
      requestTodayFocus(route.params.params.date, route.focus);
    }
    navigation.navigate('Tabs', route.params, { pop: true });
  } else if (route.name === 'MashovLogin') requestMashovRenew('push');
  else navigation.navigate(route.name);
}

/**
 * How a tapped push opens a screen (plan A6). `hints` carry what the push
 * knows beyond its payload: when it was sent. A row of the notifications log
 * goes through `navigateToRoute` with `routeForLogEntry`, the same routes plus
 * one rule a fresh push never needs: a connection problem that is over by now
 * opens מצב חיבורים (run 7).
 */
export function navigateForPayload(navigation: RootNavigation, payload: unknown, hints?: RouteHints): void {
  navigateToRoute(navigation, routeForPayload(payload, hints));
}

/** The class's pushes to a device (`DEVICE_NOTIFICATION_TYPES`): each says the days changed. */
function changesTheDays(data: unknown): boolean {
  const type = (data as { type?: unknown } | null)?.type;
  return typeof type === 'string' && (DEVICE_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/** The class a push is about, on a phone that follows more than one (`PushPayload.class`). */
export function classOfPush(data: unknown): { siteUrl: string; classId: string } | null {
  const cls = (data as { class?: { siteUrl?: unknown; classId?: unknown } } | null)?.class;
  return cls && typeof cls.siteUrl === 'string' && typeof cls.classId === 'string' ? { siteUrl: cls.siteUrl, classId: cls.classId } : null;
}

function hintsOf(notification: Notifications.Notification): RouteHints {
  const sent = new Date(notification.date);
  return Number.isNaN(sent.getTime()) ? {} : { sentAt: sent.toISOString() };
}

export function usePushHandlers(navigation: RootNavigation | null): void {
  const qc = useQueryClient();
  // A cold-start tap can reach both the listener and the lookup below; open it once.
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((notification) => {
      // Into the log as it arrives (a push's own date is when it was sent), before the bell is counted again below.
      logDeliveries([deliveryOf(notification, Date.now())]);
      // Every push carries refreshWidget:true, so arrival alone is enough.
      refreshWidgetSoon();
      void qc.invalidateQueries();
      // A timetable change or a new exam for the class: the phone's own days read the feed again, and
      // the morning summary and evening reminder pending are built again from it. Only while the app
      // is open; with it closed they wait for the next refresh (notify/summaries.ts).
      if (changesTheDays(notification.request.content.data)) {
        void refreshLocalSources()
          .then(() => qc.invalidateQueries())
          .then(refreshWidgetSoon)
          .catch(() => undefined);
      }
    });
    return () => received.remove();
  }, [qc]);

  // What came while the app was closed is in the tray: logged on start and on every return to the app.
  useEffect(() => {
    const reconcile = (): void => {
      void reconcileNotificationLog().then((added) => {
        if (added) void qc.invalidateQueries({ queryKey: keys.notifications });
      });
    };
    reconcile();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') reconcile();
    });
    return () => sub.remove();
  }, [qc]);

  useEffect(() => {
    if (!navigation) return undefined;
    const open = (response: Notifications.NotificationResponse): void => {
      const { notification } = response;
      // A tap takes it out of the tray: logged now, in case nothing else saw it arrive.
      if (logDeliveries([deliveryOf(notification)])) void qc.invalidateQueries({ queryKey: keys.notifications });
      const id = notification.request.identifier;
      if (id && handled.current === id) return;
      handled.current = id;
      // On a parent's phone, a push about another child's class puts that child on screen (parents mode, stage 2).
      const cls = classOfPush(notification.request.content.data);
      if (cls) showChildForPush(qc, cls);
      navigateForPayload(navigation, notification.request.content.data, hintsOf(notification));
    };

    const responded = Notifications.addNotificationResponseReceivedListener(open);

    // A push that launched the app cold is delivered through this instead.
    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (response) open(response);
      })
      .catch(() => undefined);

    return () => responded.remove();
  }, [navigation, qc]);
}
