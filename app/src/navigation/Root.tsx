import React, { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { refreshWidgetSoon, useGoogleConnected, useSettings } from '../api/hooks';
import { SETTINGS_PAGE_TITLES, todayTabTitle } from '../lib/onboarding';
import { usePalette, useScheme, useTextScale } from '../components/ui';
import { AppIcon } from '../components/AppIcon';
import { TabBar, TabIcon } from './TabBar';
import { useSwipeTick } from './useSwipeTick';
import { BuddyBridge } from '../components/BuddyBridge';
import { JoinBridge } from '../components/JoinBridge';
import { LessonsBridge } from '../components/LessonsBridge';
import { MashovRenewHost } from '../components/MashovRenewSheet';
import { tabBarScale } from '../lib/layout';
import { registerBackgroundRefresh } from '../background/refresh';
import { usePushRegistration } from '../push/usePushRegistration';
import { usePushHandlers } from '../push/handlers';
import { refreshLocalSources } from '../local/source';
import { font, scaledSize } from '../theme';
import type { RootParamList, TabsParamList } from './types';
import { TodayScreen } from '../screens/TodayScreen';
import { CalendarScreen } from '../screens/CalendarScreen';
import { focusManager, useQueryClient } from '@tanstack/react-query';
import { WeekScreen } from '../screens/WeekScreen';
import { TasksScreen } from '../screens/TasksScreen';
import { SchoolScreen } from '../screens/SchoolScreen';
import { NotificationsScreen } from '../screens/NotificationsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { NotificationSettingsScreen } from '../screens/settings/NotificationSettingsScreen';
import { MeSettingsScreen } from '../screens/settings/MeSettingsScreen';
import { GoogleSettingsScreen } from '../screens/settings/GoogleSettingsScreen';
import { ShownSettingsScreen } from '../screens/settings/ShownSettingsScreen';
import { AppearanceSettingsScreen } from '../screens/settings/AppearanceSettingsScreen';
import { ConnectionsScreen } from '../screens/ConnectionsScreen';
import { MyLessonsScreen } from '../screens/MyLessonsScreen';
import { MyExamsScreen } from '../screens/MyExamsScreen';
import { CalendarsScreen } from '../screens/CalendarsScreen';
import { MashovLoginScreen } from '../screens/MashovLoginScreen';
import { OnboardingScreen } from '../screens/OnboardingScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { BuddiesScreen } from '../screens/BuddiesScreen';
import { BuddyScreen } from '../screens/BuddyScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { TeacherSearchScreen } from '../screens/TeacherSearchScreen';
import { WrappedScreen } from '../screens/WrappedScreen';
import { TEACHER_SEARCH_COPY } from '../lib/teacherSearch';
import { BUDDY_COPY } from '../buddies/copy';
import { WRAPPED_COPY } from '../wrapped/copy';
import { CHAT_COPY } from '../chat/copy';
import { hasOnboarded, markOnboarded } from '../lib/prefs';

const Tabs = createMaterialTopTabNavigator<TabsParamList>();
const Stack = createNativeStackNavigator<RootParamList>();

/**
 * The tab bar is RTL: rightmost tab is the first one (UI kit, TAB BAR panel).
 * "שבוע" keeps the calendar grid; "תכנון" has its own glyph (R-34), since the
 * two side by side read as the same tab.
 */
const TAB_GLYPHS = { Today: 'day', Week: 'week', Calendar: 'plan', Tasks: 'tasks', School: 'school' } as const;

/** The back arrow of a stack screen's header: an `AppIcon`, pointing right in this RTL app. */
function BackButton({ onPress }: { onPress: () => void }): React.JSX.Element {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="חזרה"
      onPress={onPress}
      style={({ pressed }) => [styles.back, { opacity: pressed ? 0.6 : 1 }]}
    >
      <AppIcon name="arrowRight" color={p.text} size={24} />
    </Pressable>
  );
}

/**
 * The main tabs: pages side by side that slide under the finger, in the bar's
 * order, right to left (docs/superpowers/specs/2026-11-03-tab-swipe-design.md),
 * over the tab bar (`TabBar`). A swipe that lands on another page ticks
 * (`useSwipeTick`).
 *
 * A page is built the first time it is reached. Once the app has settled after
 * start-up, the pages either side of the open one are built ahead, so a swipe
 * finds its page ready; not before, since the first taps after a start must
 * not share the JS thread with building a second page (the tap lag of
 * 2026-11-01).
 */
function TabsNavigator(): React.JSX.Element {
  const p = usePalette();
  const { fontScale } = useWindowDimensions();
  // Tab labels grow with the phone's text size and the in-app one, the latter
  // only one step (`TAB_BAR.maxAppScale`); the bar grows with them.
  const scale = tabBarScale(fontScale, useTextScale());
  // A parent has the class's day, its week and its school (docs/parents-plan.md); the planning and
  // the tasks only with Google, which a parent connects if they want it.
  const audience = useSettings().data?.settings.audience ?? 'student';
  const google = useGoogleConnected();
  const planning = audience !== 'parent' || google;
  const swipeTick = useSwipeTick();
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setWarm(true), WARM_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Tabs.Navigator
      tabBarPosition="bottom"
      tabBar={(props) => <TabBar {...props} scale={scale} />}
      screenListeners={swipeTick}
      screenOptions={{
        lazy: true,
        lazyPreloadDistance: warm ? 1 : 0,
        swipeEnabled: true,
        sceneStyle: { backgroundColor: p.bg },
      }}
    >
      <Tabs.Screen
        name="Today"
        component={TodayScreen}
        options={{ title: todayTabTitle(audience), tabBarIcon: ({ color }) => <TabIcon glyph={TAB_GLYPHS.Today} color={color} /> }}
      />
      <Tabs.Screen
        name="Week"
        component={WeekScreen}
        options={{ title: 'שבוע', tabBarIcon: ({ color }) => <TabIcon glyph={TAB_GLYPHS.Week} color={color} /> }}
      />
      {planning ? (
        <Tabs.Screen
          name="Calendar"
          component={CalendarScreen}
          options={{ title: 'תכנון', tabBarIcon: ({ color }) => <TabIcon glyph={TAB_GLYPHS.Calendar} color={color} /> }}
        />
      ) : null}
      {planning ? (
        <Tabs.Screen
          name="Tasks"
          component={TasksScreen}
          options={{ title: 'משימות', tabBarIcon: ({ color }) => <TabIcon glyph={TAB_GLYPHS.Tasks} color={color} /> }}
        />
      ) : null}
      <Tabs.Screen
        name="School"
        component={SchoolScreen}
        options={{ title: 'בית ספר', tabBarIcon: ({ color }) => <TabIcon glyph={TAB_GLYPHS.School} color={color} /> }}
      />
    </Tabs.Navigator>
  );
}

/**
 * Trigger 3 (design-doc §4): app foreground refreshes the widget feed, and
 * the phone's own days (plan Phase 2e): Mashov at most every ten minutes (the
 * read is what keeps the Mashov session alive), Google when the phone is
 * signed in to it, and the class feed; then everything is built again, once.
 *
 * On the way back, the queries that went stale while the app was away are
 * built again by react-query's own focus refetch (`focusManager`); a second
 * round of every query on top of it held the JS thread just as the first taps
 * came. The widget waits a moment (`refreshWidgetSoon`) for the same reason.
 */
function useForegroundRefresh(): void {
  const qc = useQueryClient();
  useEffect(() => {
    const refresh = (): void => {
      refreshWidgetSoon();
      void refreshLocalSources()
        .then(() => qc.invalidateQueries())
        .then(refreshWidgetSoon)
        .catch(() => undefined);
    };
    refresh();
    const sub = AppState.addEventListener('change', (state) => {
      focusManager.setFocused(state === 'active');
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [qc]);
}

function PushBridge(): null {
  const navigation = useNavigation<import('./types').RootNavigation>();
  usePushHandlers(navigation);
  // Gets the phone's push address on every start, once the permission is
  // given: until 1.9.9 only opening Settings did, and the server had no one to send to.
  // It goes to the device the phone has; with none (no class followed) it is only kept.
  usePushRegistration();
  return null;
}

export function RootNavigator(): React.JSX.Element {
  const p = usePalette();
  // The app's scheme (the appearance setting), not the phone's.
  const scheme = useScheme();
  const textScale = useTextScale();
  const [initialRoute, setInitialRoute] = useState<keyof RootParamList | null>(null);
  // Whether onboarding is done: a friend's link that came before it is answered after it (`BuddyBridge`).
  const [onboarded, setOnboarded] = useState(() => hasOnboarded());
  const navigationRef = useRef(null);
  useForegroundRefresh();

  useEffect(() => {
    setInitialRoute(hasOnboarded() ? 'Tabs' : 'Onboarding');
    // Refreshing with the app closed, once setup is done (it survives restarts; asking again is a no-op).
    if (hasOnboarded()) void registerBackgroundRefresh();
  }, []);

  if (initialRoute === null) return <View style={{ flex: 1, backgroundColor: p.bg }} />;

  const base = scheme === 'light' ? DefaultTheme : DarkTheme;
  const navTheme = {
    ...base,
    colors: { ...base.colors, background: p.bg, card: p.surface, text: p.text, border: p.border, primary: p.accent },
  };

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme} direction="rtl">
      <PushBridge />
      {/* An invite link to a class (ideas ה2), as it opens the app or after an install from one. */}
      <JoinBridge />
      {/* A parent's phone: the child's lessons from the parent's Mashov, once for each child. */}
      <LessonsBridge />
      {/* A friend's invite link (friends spec 2.6): kept until onboarding is done, then the accept sheet. */}
      <BuddyBridge onboarded={onboarded} />
      {/* Mashov renewal (W6-1): opens by itself after a return to the app, or from the relogin push. */}
      <MashovRenewHost />
      {/* A stack screen's header (plan §16.1): its title in the display face, the back arrow an
          `AppIcon` with its own label, no shadow; the ruled line under the header is the content's top
          border (native-stack's header takes no border, and a header background would float it over
          the content). */}
      <Stack.Navigator
        initialRouteName={initialRoute}
        screenOptions={({ navigation }) => ({
          headerStyle: { backgroundColor: p.bg },
          headerShadowVisible: false,
          headerTitleStyle: { fontFamily: font.display, fontSize: scaledSize(HEADER_TITLE_SIZE, textScale), color: p.text },
          headerTintColor: p.text,
          headerLeft: ({ canGoBack }) => (canGoBack ? <BackButton onPress={() => navigation.goBack()} /> : null),
          contentStyle: { backgroundColor: p.bg, borderTopWidth: 1, borderTopColor: p.border },
        })}
      >
        <Stack.Screen
          name="Onboarding"
          component={OnboardingScreen}
          // A Hebrew title: the back button of the screen opened from here (the
          // Mashov login) was labelled from it, and read "Onboarding, back" (run 5).
          options={{ headerShown: false, title: 'היכרות', contentStyle: { backgroundColor: p.bg } }}
          listeners={{
            // Shown again after ״מחק את הנתונים שלי״, which forgets that onboarding was done.
            focus: () => setOnboarded(hasOnboarded()),
            beforeRemove: () => { markOnboarded(); setOnboarded(true); void registerBackgroundRefresh(); },
          }}
        />
        <Stack.Screen name="Tabs" component={TabsNavigator} options={{ headerShown: false, contentStyle: { backgroundColor: p.bg } }} />
        <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: 'התראות' }} />
        <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'הגדרות' }} />
        <Stack.Screen name="SettingsNotifications" component={NotificationSettingsScreen} options={{ title: SETTINGS_PAGE_TITLES.notifications }} />
        {/* The title follows the audience: `MeSettingsScreen` sets it once it is known. */}
        <Stack.Screen name="SettingsMe" component={MeSettingsScreen} options={{ title: SETTINGS_PAGE_TITLES.me }} />
        <Stack.Screen name="SettingsGoogle" component={GoogleSettingsScreen} options={{ title: SETTINGS_PAGE_TITLES.google }} />
        <Stack.Screen name="SettingsShown" component={ShownSettingsScreen} options={{ title: SETTINGS_PAGE_TITLES.shown }} />
        <Stack.Screen name="SettingsAppearance" component={AppearanceSettingsScreen} options={{ title: SETTINGS_PAGE_TITLES.appearance }} />
        <Stack.Screen name="Connections" component={ConnectionsScreen} options={{ title: 'מצב חיבורים' }} />
        <Stack.Screen name="MyLessons" component={MyLessonsScreen} options={{ title: 'השיעורים שלי' }} />
        <Stack.Screen name="MyExams" component={MyExamsScreen} options={{ title: 'המבחנים שלי' }} />
        <Stack.Screen name="Calendars" component={CalendarsScreen} options={{ title: 'יומן Google' }} />
        <Stack.Screen name="MashovLogin" component={MashovLoginScreen} options={{ title: 'משוב' }} />
        <Stack.Screen name="Help" component={HelpScreen} options={{ title: 'עזרה' }} />
        <Stack.Screen name="Buddies" component={BuddiesScreen} options={{ title: BUDDY_COPY.title }} />
        <Stack.Screen name="Buddy" component={BuddyScreen} options={{ title: '' }} />
        <Stack.Screen name="Chat" component={ChatScreen} options={{ title: CHAT_COPY.title }} />
        <Stack.Screen name="TeacherSearch" component={TeacherSearchScreen} options={{ title: TEACHER_SEARCH_COPY.title }} />
        {/* A full page of its own, rising from the bottom: no header, and no ruled line of the stack's over its own. */}
        <Stack.Screen
          name="Wrapped"
          component={WrappedScreen}
          options={{ headerShown: false, title: WRAPPED_COPY.settingsRow, animation: 'slide_from_bottom', contentStyle: { backgroundColor: p.bg } }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** How long after the tabs first show the pages either side of the open one are built ahead. */
const WARM_AFTER_MS = 2500;

/** A stack screen's title in the display face, scaled like every other text. */
const HEADER_TITLE_SIZE = 22;

export const styles = StyleSheet.create({
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginEnd: 4 },
});
