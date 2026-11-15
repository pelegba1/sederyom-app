import type { NavigatorScreenParams } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { DateStr, SchoolTab } from '@sederyom/shared';

export type TabsParamList = {
  /** `date` opens that day instead of today (push deep links, "למערכת של היום הזה"). */
  Today: { date?: string } | undefined;
  /** The "תכנון" tab. The route keeps its old name; a push's `deepLink: 'planning'` lands here. */
  Calendar: { date?: string } | undefined;
  Week: { date?: string } | undefined;
  Tasks: { compose?: boolean } | undefined;
  /** `tab` opens that sub-tab (a push about a new exam opens "מבחנים"). */
  School: { tab?: SchoolTab } | undefined;
};

export type RootParamList = {
  Onboarding: undefined;
  Tabs: NavigatorScreenParams<TabsParamList>;
  Notifications: undefined;
  Settings: undefined;
  /** The pages Settings opens, one per group (docs: settings reorganization). */
  SettingsNotifications: undefined;
  SettingsMe: undefined;
  SettingsGoogle: undefined;
  SettingsShown: undefined;
  SettingsAppearance: undefined;
  /** מצב חיבורים — per-source health, reconnect, sync now (design panel 05). */
  Connections: undefined;
  /** השיעורים שלי — which of the class's published lessons are mine. */
  MyLessons: undefined;
  /** המבחנים שלי — which of the grade's published exams are mine. */
  MyExams: undefined;
  /** יומן Google — calendar switches and the hidden-event list. */
  Calendars: undefined;
  MashovLogin: undefined;
  /** עזרה — what each tab does, privacy, disconnecting, FAQ (plan A4, F17). */
  Help: undefined;
  /** חברים: the friends, the exams shared with them, and adding one (friends spec 2.3). */
  Buddies: undefined;
  /** One friend's page (friends spec 2.4); `date` opens that day instead of the one it opens on. */
  Buddy: { id: string; date?: DateStr };
  /** חיבור לצ׳אט: a code for a new chat, what the chats may read, the chats linked (chat connection spec 4.5). */
  Chat: undefined;
  /** איפה המורה? — a teacher's day, from every class timetable on the school's site. */
  TeacherSearch: undefined;
  /** סיכום שנה: the year so far as a story of cards (students only). */
  Wrapped: undefined;
};

export type RootNavigation = NativeStackNavigationProp<RootParamList>;
