/**
 * עזרה (plan F17): what each tab does, what is stored and where, how to
 * disconnect, and the questions people actually asked — in plain words, with
 * no "שרת" or "סשן" (plan appendix א). Reached from Settings.
 *
 * Everything said here must stay true of the code: the privacy lines follow
 * what the phone sends its device (`device/v2.ts`: the class, the push
 * address and `devicePrefsFrom`, hidden lessons included), the class's exam
 * board, a link or a file (`ExamBoard`: opened by the server, the file never
 * kept, the approved list kept for the whole class), the board and the dates
 * the student keeps for themselves (`local/ownBoard.ts`, `local/examPrefs.ts`:
 * on the phone), the disconnects in `local/phoneApi.ts` (Mashov's reads stay,
 * Google's go) and the notification engine (quiet hours defer, the morning summary is exempt).
 * The public page (public/privacy.html) says the same, at length, and the
 * privacy section links to it: both stores want the policy reachable from
 * inside the app.
 *
 * On the page (plan §16.1): headings, and ruled rows edge to edge under
 * them; the tabs with their bare line icons, the questions as rows that open
 * their answer in place. No cards.
 */
import React from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';
import { AppIcon } from '../components/AppIcon';
import { Row, ROW_END, ROW_GUTTER, ROW_MIN_HEIGHT, ROW_PADDING, SectionHeading } from '../components/notebook';
import { useToast } from '../components/Toast';
import { Button, Screen, Text, usePalette } from '../components/ui';
import { useSettings } from '../api/hooks';
import { HEADER_GUIDE, mePageTitle, tabGuide } from '../lib/onboarding';
import { font, space, type } from '../theme';
import type { RootNavigation } from '../navigation/types';
import { Disclosure } from './ConnectionsScreen';

type Palette = ReturnType<typeof usePalette>;

/** The full policy, public/privacy.html on the app's own domain. */
const PRIVACY_URL = 'https://sederyom.app/privacy';

interface Question {
  q: string;
  /** An answer that names a settings page of the person's own is a function of `parent` (`mePageTitle`). */
  a: string | ((parent: boolean) => string);
  link?: { label: string; to: 'MyExams' | 'Connections' | 'SettingsMe' | 'SettingsNotifications' | 'SettingsAppearance' };
}

/** In a ninth grader's words (Maya, W5-14): no "בענן", "מוצפן", "נקרא" or "ווידג׳טים". */
const PRIVACY: readonly { title: string; body: string }[] = [
  {
    title: 'מה נשאר בטלפון',
    body: 'כמעט הכול: מה שמגיע ממשוב (המערכת האישית, שיעורי הבית, הציונים וההודעות), ההגדרות שלך, מה שסימנת ״עשיתי״, המבחנים שהוספת, לוח מבחנים שהבאת רק לעצמך, תאריך שקבעת למבחן ורשימת ההתראות. כל אלה נשארים בטלפון, חוץ ממה שבחרת לשתף עם חבר או עם צ׳אט שחיברת. אם משתפים מבחנים עם חבר, הוא רואה אותם גם מלוח שהבאת רק לעצמך, ומבחן של בית הספר שהזזת ליום אחר מופיע אצלו ביום של בית הספר. צ׳אט שחיברת רואה את המבחנים כמו שהם אצלך. היומן והמשימות מ־Google נשארים בטלפון תמיד ולא עוברים לאף אחד, גם לא לצ׳אט.',
  },
  {
    title: 'מה נשלח לסדר יום',
    body: 'מה שצריך כדי להודיע לך על שינויים במערכת של הכיתה: אתר המערכת של בית הספר והכיתה שבחרת, הכתובת שאליה נשלחות ההתראות לטלפון, ואילו התראות ביקשת, כולל השעות השקטות, מצב חופש והשיעורים שהסתרת. בלי שם, בלי מספר טלפון ובלי שום דבר מהחשבון שלך ב־Google. גם ממשוב לא נשלח דבר, חוץ ממה שבחרת לשתף עם חבר או עם צ׳אט שחיברת. כשמביאים לוח מבחנים, סדר יום פותחת את הקישור או את הקובץ ומוצאת בהם את המבחנים. הקובץ לא נשמר, ונשמר רק הלוח שאושר לכיתה. לוח שהבאת רק לעצמך לא נשמר לכיתה ונשאר בטלפון. אם חיברת צ׳אט, נשמר אצלנו גם עותק מוגן של מה שבחרת לשתף איתו, והצ׳אט קורא אותו כשמבקשים ממנו משהו. העותק נמחק כשמנתקים את הצ׳אט האחרון. ההתראות על שינויים שנשלחו לטלפון נשמרות שם 30 יום, ואז נמחקות.',
  },
  {
    title: 'לוח המבחנים',
    body: 'ב״המבחנים שלי״ מביאים לוח מבחנים מקישור לדף של בית הספר, מיומן או גיליון Google שמשותפים לכולם, או מקובץ אקסל. לפני שמשהו נשמר רואים מה נמצא ומאשרים. אחרי האישור הלוח נשמר לכיתה: המבחנים שלו, עם התאריך, הכותרת והפרטים של כל אחד, מגיעים לכל מי שבכיתה, ואם לכיתה לא היה לוח, נשלחת לשאר התראה אחת, לא יותר מפעם ב־30 יום (אם ההתראות על מבחן חדש פועלות אצלם). מי שהביא את הלוח יכול להחליף אותו או להסיר אותו. אם לכיתה כבר יש לוח, אפשר להביא לוח רק לעצמך: הוא נשאר בטלפון וגובר אצלך על הלוח של הכיתה, ואפשר להסיר אותו בכל רגע.',
  },
  {
    title: 'הסיסמה למשוב',
    body: 'מקלידים אותה רק באתר של משוב, והיא לא נשמרת. אחרי ההתחברות משוב נותן אישור כניסה, והוא נשמר רק בטלפון.',
  },
  {
    title: 'Google',
    body: 'ההתחברות ל־Google נשמרת רק בטלפון. האפליקציה קוראת את היומן והמשימות, וכותבת רק מה שביקשת: משימות שהוספת או סימנת, והמבחנים ליומן ״בית ספר״. מה שהיא קוראת מ־Google נשאר בטלפון, ולא נשלח לסדר יום או לצ׳אט.',
  },
  {
    title: 'מחיקה',
    body: 'בהגדרות, ב״מחק את הנתונים שלי״, נמחק כל מה שבטלפון והרישום שלו אצל סדר יום, ואפשר לבחור למחוק גם את יומן ״בית ספר״ מ־Google. המשימות שלך ב־Google נשארות.',
  },
];

const QUESTIONS: readonly Question[] = [
  {
    q: 'למה צריך להתחבר שוב למשוב?',
    a: 'משוב מנתק חיבורים אחרי זמן מה, כמו באתר שלו. הסיסמה שלך לא נשמרת אצלנו, אז אי אפשר להתחבר במקומך. לא צריך לבדוק את זה בעצמך: כשמשוב מנתק, נשלח התראה אחת. לוחצים עליה ומתחברים שוב, וזה לוקח דקה. עד אז רואים את מה שכבר הגיע.',
  },
  {
    q: 'מאיפה מגיעים השינויים במערכת?',
    a: 'מאתר המערכת של בית הספר. בודקים אותו כמה פעמים בשעה במשך היום, ושולחים התראה כשמשהו משתנה במערכת של היום או של מחר. בבית ספר בלי אתר מערכת, המערכת והשינויים מגיעים ממשוב: המערכת הקבועה, עם השינויים שבית הספר מכניס למשוב, ובלי התראות על שינויים כשהאפליקציה סגורה.',
  },
  {
    q: 'למה אין רשימת כיתות?',
    a: (parent) => `את רשימת הכיתות מקבלים מאתר המערכת של בית הספר, ואת הכתובת שלו נותן משוב. אם משוב לא נתן אותה ויש לבית הספר אתר כזה, אפשר להעתיק את הכתובת מהדפדפן ולהדביק אותה בהגדרות, ב״${mePageTitle(parent)}״, תחת ״כיתה״. בלי אתר ממשיכים בלי כיתה, והמערכת מגיעה ממשוב.`,
    link: { label: 'להגדרות', to: 'SettingsMe' },
  },
  {
    q: 'למה מופיעים מבחנים שהם לא שלי?',
    a: 'לוח המבחנים הוא של כל השכבה. ב״המבחנים שלי״ מסמנים מה שלך, ומבחן שמוסתר שם לא יופיע ביום, בשבוע, במסך הבית של הטלפון ובהתראות.',
    link: { label: 'למבחנים שלי', to: 'MyExams' },
  },
  {
    q: 'לא מגיעות התראות. מה עושים?',
    a: 'קודם כול צריך לאפשר התראות בטלפון: בהגדרות, ב״התראות וזמנים״, יש כפתור שפותח את הגדרות הטלפון. באותו מקום כדאי לבדוק גם ש״מצב חופש״ כבוי. התראה שנוצרת בשעות השקטות מחכה לסופן, וסיכום הבוקר מגיע בכל מקרה.',
    link: { label: 'להגדרות', to: 'SettingsNotifications' },
  },
  {
    q: 'מה זה ״לפי המערכת הקבועה״ בשבוע?',
    a: 'כשאתר בית הספר עוד לא פרסם את השבוע, מוצגת המערכת הקבועה ומסומנת ״לפי המערכת הקבועה״. שינויים יופיעו ברגע שיתפרסמו. בבית ספר בלי אתר מערכת, כל השבועות לפי המערכת הקבועה ממשוב, עם השינויים שבית הספר מכניס למשוב.',
  },
  {
    q: 'איך מגדילים את הטקסט, או עוברים למצב בהיר או כהה?',
    a: 'בהגדרות, ב״מראה״, בוחרים גודל טקסט: רגיל, גדול או גדול מאוד. גם גודל הגופן שבהגדרות הטלפון חל כאן. באותו מקום בוחרים גם בהיר, כהה או לפי הטלפון.',
    link: { label: 'להגדרות', to: 'SettingsAppearance' },
  },
  {
    q: 'למה לא רואים מספר חדר?',
    a: 'אתר בית הספר לא מפרסם חדרים. כשמשוב יודע מה החדר, הוא מופיע.',
  },
  {
    q: 'איפה המשימות נשמרות?',
    a: 'בטלפון הזה, עד שמחברים Google. אחרי החיבור הן עוברות לחשבון ה־Google שלך, בלי אפליקציה נוספת. מה שמוסיפים או מסמנים כאן נשמר שם, ואפשר לראות ולערוך את המשימות גם ביומן Google.',
  },
];

export function HelpScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  // A parent's tabs are three (docs/parents-plan.md).
  const audience = useSettings().data?.settings.audience ?? 'student';
  const parent = audience === 'parent';
  const toast = useToast();
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Heading first>הכפתורים בתחתית המסך</Heading>
        {/* Each tab with the icon it has in the bar: a bare line icon, no tile behind it. */}
        {tabGuide(audience).map((tab) => (
          <View key={tab.title} style={[styles.iconRow, { borderBottomColor: p.border }]}>
            <View style={styles.icon}>
              <AppIcon name={tab.icon} color={p.accent} size={22} />
            </View>
            <View style={styles.iconBody}>
              <Text accessibilityRole="header" style={strong(p)}>{tab.title}</Text>
              <Text style={muted(p)}>{tab.body}</Text>
            </View>
          </View>
        ))}
        <View style={[styles.iconRow, { borderBottomColor: p.border }]}>
          <View style={styles.icon}>
            <AppIcon name="settings" color={p.textMuted} size={22} />
          </View>
          <Text style={[muted(p), styles.iconBody]}>{HEADER_GUIDE}</Text>
        </View>

        <Heading>פרטיות: מה נשמר ואיפה</Heading>
        {PRIVACY.map((item) => (
          <Row key={item.title} title={item.title} subtitle={item.body} />
        ))}
        <View style={[styles.gutter, { alignItems: 'flex-start', marginTop: space.xs }]}>
          <Button
            title="למדיניות הפרטיות המלאה"
            variant="ghost"
            onPress={() => void Linking.openURL(PRIVACY_URL).catch(() => toast.show('לא הצלחנו לפתוח את האתר'))}
          />
        </View>

        <Heading>איך מנתקים</Heading>
        <View style={[styles.gutter, { gap: space.sm }]}>
          <Text style={muted(p)}>
            בהגדרות, במסך ״מצב חיבורים״, תחת ״פרטים טכניים״ של Google ושל משוב, יש כפתור ״ניתוק״. אחרי הניתוק האפליקציה כבר לא מתעדכנת מהחשבון. מה שכבר הגיע ממשוב נשאר, ומה שהגיע מ־Google נמחק מהטלפון. אפשר להתחבר שוב בכל רגע.
          </Text>
          <Text style={muted(p)}>את הגישה של Google אפשר לבטל גם מתוך חשבון Google, בדף האבטחה.</Text>
          <View style={{ alignItems: 'flex-start' }}>
            <Button title="למצב החיבורים" variant="ghost" onPress={() => navigation.navigate('Connections')} />
          </View>
        </View>

        <Heading>שאלות נפוצות</Heading>
        {/* Each question a ruled row of the page that opens its answer under it. */}
        {QUESTIONS.map((item) => (
          <Disclosure key={item.q} title={item.q} titleStyle={strong(p)} style={[styles.question, { borderBottomColor: p.border }]}>
            <Text style={muted(p)}>{typeof item.a === 'function' ? item.a(parent) : item.a}</Text>
            {item.link ? (
              <View style={{ alignItems: 'flex-start', marginTop: space.xs }}>
                <Button title={item.link.label} variant="ghost" onPress={() => navigation.navigate(item.link!.to)} />
              </View>
            ) : null}
          </Disclosure>
        ))}
      </ScrollView>
    </Screen>
  );
}

/** A section's heading, in the page's gutter. */
function Heading({ children, first = false }: { children: string; first?: boolean }): React.JSX.Element {
  return (
    <View style={[styles.gutter, first ? null : styles.section]}>
      <SectionHeading>{children}</SectionHeading>
    </View>
  );
}

function strong(p: Palette) {
  return { fontFamily: font.bodySemi, fontSize: type.title, color: p.text } as const;
}

function muted(p: Palette) {
  return { fontFamily: font.body, fontSize: type.small, color: p.textMuted, lineHeight: 21 } as const;
}

const styles = StyleSheet.create({
  content: { paddingTop: space.lg, paddingBottom: 80 },
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  section: { marginTop: space.xxl },
  // A ruled row with a line icon at its start, as `Row` draws its text.
  iconRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.md, minHeight: ROW_MIN_HEIGHT,
    paddingStart: ROW_GUTTER, paddingEnd: ROW_END, paddingVertical: ROW_PADDING, borderBottomWidth: 1,
  },
  icon: { paddingTop: 2 },
  iconBody: { flex: 1, gap: 2 },
  question: { paddingStart: ROW_GUTTER, paddingEnd: ROW_END, paddingVertical: space.xs, borderBottomWidth: 1 },
});
