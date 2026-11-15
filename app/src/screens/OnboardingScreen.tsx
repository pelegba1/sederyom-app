/**
 * First run (design-doc §3.2, design panel 06; plan A4, R-22–R-24, W4): five
 * short steps, one decision and one sentence each — welcome, connect Google
 * and Mashov, the class, the exams that are yours (F5, W4-4), notifications
 * (F14) — with a back button on every step but the first, and "מה יש
 * באפליקציה" as an optional link on the last step (F17), not a step of its own.
 *
 * The notebook (plan §16): each step starts at the top of the page, under the
 * step's title in the display face, and its content sits on the page — the
 * logo on the first step, the accounts as sections between ruled lines, the
 * classes as filter chips, the exams with their dates in the red margin, the
 * switches as ruled rows. No cards and no tinted boxes.
 *
 * Every step reads the real state rather than remembering its own, so a
 * half-finished onboarding self-heals, and every step can be redone later
 * from Settings. Server status lines stay on "מצב חיבורים": before anyone has
 * logged in, words like "ניתק" only alarm (R-22).
 *
 * The footer holds one row of buttons and the step dots and nothing more, so
 * it stays under the line a toast floats at (`toastBottom`): "המשך" on the
 * exam step moves straight on (Itai) and confirms with a toast that never
 * covers the next step's button (Daniel). A step's other choices sit in its page.
 *
 * The class step (plan Phase 3) has these pages (`classStepPage`): the classes
 * as chips; with no list and no Mashov, that the list comes through Mashov,
 * with the connect step's button; and when Mashov named no timetable site, or
 * could not say, the field to paste its address (`SchoolSiteField`) and "להמשיך בלי אתר",
 * with what that means. Without a list the footer says "לדלג בינתיים", as the
 * connect step does: going on without a class is allowed. A parent whose Mashov
 * brought children has no class to pick: the step lists them, with a line for
 * each child Mashov listed that the login cannot read (`children`).
 *
 * The exam step (plan §14.7, run 7, §16.2): the count, "15 מבחנים", the line
 * "על 6 מבחנים אנחנו לא בטוחים…" under it, and one button, "המשך", which marks
 * what the count says (W5-11, `examStepView`) and moves on. Unsure exams start
 * kept, with their "?" (`examStepOffer`), and the toast says so. "לבדוק
 * עכשיו" unfolds every exam the server could not place, grouped as "המבחנים
 * שלי" groups them, each row in one state: "?", "שלי" or "הוסתר". A row opens
 * what decides it — the owner's teacher and the one the title names, when the
 * timetable knows — with "שלי" / "לא שלי". "שלי" confirms it (W6-2,
 * `useConfirmedExams`): the "?" goes, here and on every exam screen.
 * With a board in hand (the class's, or the phone's own over it: `boardOwner`) the step says whose it is, under the count.
 * With a class, no exams and no board it offers to bring one (`examStepOffersBoard`, `ExamBoard`): "המשך" is still there, and after
 * a save the step checks the class again and shows what the board brought.
 *
 * The welcome step also offers the demo (`demo/mode.ts`), a text button with
 * its one line under the welcome, while nothing is connected or picked yet:
 * the app with a made-up student and no account, for Google Play's reviewers
 * and anyone curious. It goes to the tabs as "סיימנו" does.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, BackHandler, Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { HeaderBackButton } from '@react-navigation/elements';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ExamOption, SourceStatus, SubjectOption } from '@sederyom/shared';
import { useQueryClient } from '@tanstack/react-query';
import { connectGoogle as signInToGoogle } from '../google/connect';
import { keys, refreshWidgetFeed, useConfirmedExams, useGoWithoutSite, useOwnBoard, useSaveSettings, useSettings, useStatus } from '../api/hooks';
import { API_BASE_URL, isConfigured } from '../config';
import { AppIcon } from '../components/AppIcon';
import { ExamBoard } from '../components/ExamBoard';
import { UnsureMark } from '../components/ExamSheet';
import { Logo } from '../components/Logo';
import { FilterChip, MARGIN_LINE, MARGIN_WIDTH, MarginList, MarginRow, Mark, ROW_END, ROW_GUTTER, Row } from '../components/notebook';
import { SchoolSiteField } from '../components/SchoolSiteField';
import { Sheet } from '../components/Sheet';
import { toastBottom, useToast } from '../components/Toast';
import { Button, Loading, Ltr, MIN_TOUCH, Screen, Text, usePalette } from '../components/ui';
import { refreshFeed, storedFeed } from '../device/v2';
import { CONNECTION_COPY, PARENT_GOOGLE_COPY, PARENT_MASHOV_COPY, isConnected, mergeGoogle, movedToGoogleLabel } from '../lib/connections';
import { boardOwner, classHasBoard, examStepOffersBoard, sourceLine } from '../lib/examBoard';
import { formatShortDate, isolateRanges } from '../lib/format';
import {
  AUDIENCE_COPY, CLASS_LEAD, EXAM_ROW_LABELS, EXAM_STEP_UNDO, FOOTER, HEADER_GUIDE, SCHOOL_SITE_COPY, WELCOME_LEAD,
  classStepPage, displayClassName, examStepCheckingLine, examStepDoneToast, examStepLeaveLine, examStepLine, examStepOffer, examStepRowState, examStepTerms,
  examStepUnsure, examStepView, onboardingSteps, stepBack, stepDotsFit, stepForward, stepLabel, tabGuide,
  type ExamRowState, type ExamStepTerm, type OnboardingStep,
} from '../lib/onboarding';
import {
  FACT_ADVICE, blockSubjects, examDisplayTitle, setExamsShown, teacherFact, teacherFactText, termExplainer,
  unsureReason, withConfirmed, type ExamGroup,
} from '../lib/school';
import { font, space, type } from '../theme';
import type { RootNavigation } from '../navigation/types';
import { DEMO_COPY } from '../demo/mode';
import { enterDemo } from '../demo/phone';
import { mashovChildrenCount, setupView } from '../local/phoneChildren';
import { storage } from '../widget/feedCache';
import { requestWidgetUpdate } from '../widget/update';
import { Disclosure, hostOf } from './ConnectionsScreen';
import { ClassGroups } from './settings/classes';
import { NotificationPermissionNotice, PERMISSION_SWITCH_HINT, useNotificationPermission } from './settings/permission';
import { SwitchRow } from './settings/parts';

const SAVE_ERROR = 'לא הצלחנו לשמור. אפשר לנסות שוב';

type Palette = ReturnType<typeof usePalette>;

export function OnboardingScreen({ navigation }: { navigation: RootNavigation }): React.JSX.Element {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { fontScale } = useWindowDimensions();
  const qc = useQueryClient();
  const status = useStatus();
  const settings = useSettings();
  // The phone's own exam board, when it has one: it decides whose board the step says it shows (`boardOwner`).
  const ownBoard = useOwnBoard();
  // A parent logs in to Mashov as the parent, and the class step lists the children it brought, or has
  // its own page when it brought none (docs/parents-plan.md).
  const audience = settings.data?.settings.audience ?? 'student';
  const parent = audience === 'parent';
  const save = useSaveSettings();
  const goWithoutSite = useGoWithoutSite();
  const toast = useToast();
  const permission = useNotificationPermission();
  const notificationsOff = permission.state === 'off';
  // A press on a grey notification switch asks the phone, as "להדליק" does (run 8).
  const askPermission = permission.busy ? undefined : permission.enable;
  // "שלי" on an unsure exam (W6-2): kept on the phone, read by every exam screen.
  const { confirmed, setConfirmed } = useConfirmedExams();
  const [step, setStep] = useState<OnboardingStep>('welcome');
  // The recommendation was applied here, by "המשך": from then on the exam
  // step counts what is marked, never what it recommended (W5-11).
  const [appliedHere, setAppliedHere] = useState(false);
  // The exams the owner said "לא שלי" to on this step: the only unsure ones "המשך"
  // leaves hidden — every other starts kept, with its "?" (run 7, `examStepOffer`).
  // Kept across a class change: they are answers about those exams.
  const [hiddenHere, setHiddenHere] = useState<readonly string[]>([]);
  // The unsure exam whose "?" is open, with its reason and "שלי" / "לא שלי".
  const [openExam, setOpenExam] = useState<string | null>(null);
  // A class was chosen here ('class'), or a board was saved for it from the exam step ('board'): the exam matches read
  // with /settings belong to the class as it was, until /settings is read again. The word is what the step says it is doing.
  const [examsStale, setExamsStale] = useState<false | 'class' | 'board'>(false);
  const [tourOpen, setTourOpen] = useState(false);
  // The class step's "מה זה מגמה?".
  const [majorOpen, setMajorOpen] = useState(false);
  // The exam step's "מה זה גוש?" / "מה זה מתכונת?" that is open.
  const [openTerm, setOpenTerm] = useState<ExamStepTerm['key'] | null>(null);
  // The exam step's "לבדוק עכשיו": the unsure exams, folded until asked for (plan §14.7).
  const [checking, setChecking] = useState(false);
  const [rowHeight, setRowHeight] = useState<number>(MIN_TOUCH);
  const scroll = useRef<ScrollView>(null);
  // Refs, so the effects below run on a step change only, never on a re-render.
  const refetchStatus = useRef(status.refetch);
  refetchStatus.current = status.refetch;
  const refetchSettings = useRef(settings.refetch);
  refetchSettings.current = settings.refetch;
  // A toast's "לבטל" runs seconds later, against whatever the hide-list is by then.
  const latestHidden = useRef<readonly string[]>([]);
  const saving = save.isPending;
  // The class as the phone last read it, for the exam step: its board is what the step says whose it is, or offers to
  // bring (design 2026-11-10). Read from the kept feed on the step only, and again whenever /settings has been read again,
  // since every refresh of the feed ends in one (the effect below, a refresh at the foreground, `ExamBoard`'s own save).
  const boardClass = useMemo(
    () => (step === 'exams' ? storedFeed(storage)?.class ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the read time is the signal: the feed is not state.
    [step, settings.dataUpdatedAt],
  );

  // Coming back to the app (from Google's sign-in, or the phone's settings) is the moment to look again.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refetchStatus.current();
    });
    return () => sub.remove();
  }, []);

  // Each step starts at its top.
  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [step]);

  // The recommendation depends on the class: after a new one is saved, the
  // exams step reads /settings again — once, and only then. Until it has, the
  // step says it is checking, rather than offering the old class's exams
  // behind a button that looks switched off (Maya).
  // The class's feed is read first: /settings lists the exams that are in it, and the step says whose board it is by
  // its class, but picking a class only follows it (`followPickedClass`), so the kept feed is the one before (or none).
  // A board saved from this step comes here too (`ExamBoard`'s `onSaved`). The feed failing to read changes nothing else.
  useEffect(() => {
    if (step !== 'exams' || !examsStale || saving) return undefined;
    let live = true;
    void refreshFeed(storage)
      .catch(() => null)
      .then(() => refetchSettings.current())
      .finally(() => {
        if (live) setExamsStale(false);
      });
    return () => {
      live = false;
    };
  }, [step, examsStale, saving]);

  // Android's back goes one step back, not out of the app — only while this
  // screen is in front, so it never swallows the back of the Mashov login.
  // While the sheet is open, its Modal takes the back press and closes.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const previous = stepBack(step, audience);
        if (previous === null) return false;
        setStep(previous);
        return true;
      });
      return () => sub.remove();
    }, [step, audience]),
  );

  if (status.isLoading && settings.isLoading) return <Screen><Loading /></Screen>;

  const sources = status.data?.sources ?? [];
  const find = (name: SourceStatus['source']): SourceStatus | undefined => sources.find((s) => s.source === name);
  const google = mergeGoogle(find('google_calendar'), find('google_tasks'));
  const googleOk = isConnected(google);
  const mashovOk = isConnected(find('mashov'));
  const steps = onboardingSteps(audience);
  const index = steps.indexOf(step);
  const previous = stepBack(step, audience);
  const next = (): void => {
    const following = stepForward(step, audience);
    if (following) setStep(following);
  };
  const finish = (): void => {
    setTourOpen(false);
    navigation.replace('Tabs', { screen: 'Today' });
  };
  // The demo only before anything of the student's is here, so the two never mix.
  const canDemo = !googleOk && !mashovOk && !settings.data?.settings.classId;
  const startDemo = (): void => {
    enterDemo();
    // What was read so far is the empty phone's; the widget shows the demo too.
    qc.clear();
    void refreshWidgetFeed().then(requestWidgetUpdate);
    finish();
  };
  const patch = (body: Parameters<typeof save.mutate>[0]): void => save.mutate(body, { onError: () => toast.show(SAVE_ERROR) });
  const connectGoogle = (): void => {
    // The step reads as done as soon as Google says yes; the rest once the first read is in.
    signInToGoogle(() => void qc.invalidateQueries({ queryKey: keys.status }), (n) => toast.show(movedToGoogleLabel(n)))
      .then(() => qc.invalidateQueries())
      .catch(() => toast.show('לא הצלחנו להתחבר ל-Google. אפשר לנסות שוב בעוד רגע'));
  };

  const data = settings.data;
  const s = data?.settings;
  const morning = s?.morningSummaryTime ?? '07:00';
  const evening = s?.eveningReminderTime ?? '20:00';
  // With the owner's "שלי" answers, so the step counts as "המבחנים שלי" does (W6-2).
  const exams: ExamOption[] = withConfirmed(data?.exams ?? [], confirmed);
  const hiddenKeys = s?.exams.hiddenKeys ?? [];
  latestHidden.current = hiddenKeys;
  // Read on every render from the shared /settings cache, which every save in
  // "המבחנים שלי" updates: coming back from there shows what is marked now.
  const view = examStepView(exams, hiddenKeys, appliedHere, hiddenHere);
  // The rows read the list "המשך" will leave, so a row's state is what it will be.
  const rowHidden = new Set(view.hidden);
  const leaveLine = examStepLeaveLine(view.unsure);
  // Whose the board is, or the way to bring one when there is none (design 2026-11-10): the phone's own board over the
  // class's, else the class's. While the step checks, the class is the one before.
  // Only a phone that has a class is offered one: a board belongs to the class the phone follows, and "לדלג בינתיים" on the
  // class step (or a pick whose follow failed) leaves none, where every try would end in "קודם צריך לבחור כיתה" (`no_class`).
  const classOwner = boardOwner(boardClass, ownBoard);
  const offersBoard = !examsStale && Boolean(s?.classId) && examStepOffersBoard(exams.length, classOwner);
  const boardLine = examsStale ? null : sourceLine(classOwner, classHasBoard(boardClass));
  // The step's count line. Above the offer to bring a board there is none: the class has no exams to count, and the
  // block's own words say a board can be brought (V-19: "עוד אין מבחנים בלוח של השכבה" said it twice, and of the grade).
  const countLine = examsStale
    ? examStepCheckingLine(examsStale)
    : settings.isFetching && exams.length === 0
      ? 'טוען את לוח המבחנים…'
      : offersBoard
        ? null
        : examStepLine(view, exams.length);
  const majorExplainer = termExplainer(CLASS_LEAD);
  // Every exam the server could not place, decided or not, in "המבחנים שלי"'s groups (plan §14.7).
  const unsureGroups = examStepUnsure(exams);
  const terms = examStepTerms(unsureGroups.flatMap((g) => g.exams));
  const openAnswer = terms.find((t) => t.key === openTerm)?.answer ?? null;
  // Who teaches the owner what, for the fact beside a "?" (plan §14.7, Noa).
  const lessons = { subjects: data?.subjects ?? [], hidden: s?.lessons.hiddenSubjects ?? [] };
  // The classes, or the way to them: through Mashov, or the site's address (plan Phase 3).
  const classPage = classStepPage(data?.classes.length ?? 0, mashovOk, data?.site, audience, parent && step === 'class' ? mashovChildrenCount() : 0);
  // A parent's saved scan: the children it brought, and what it said of the ones it could not add (read on each render, as the scan ends before this step shows).
  const scanView = parent && step === 'class' ? setupView() : null;
  const withoutSite = data?.site.withoutSite ?? false;
  const continueWithoutSite = (): void => {
    goWithoutSite.mutate(undefined, { onError: () => toast.show(SAVE_ERROR) });
    next();
  };

  const chooseClass = (option: { id: string; name: string }): void => {
    if (option.id === s?.classId) return;
    patch({ classId: option.id, className: option.name });
    setExamsStale('class');
    // Another class, another recommendation: it is offered again.
    setAppliedHere(false);
    setOpenExam(null);
  };
  const applyRecommendation = (): void => {
    const before = hiddenKeys;
    // What the count says: the offer, every undecided "?" kept (run 7).
    const offer = examStepOffer(exams, hiddenKeys, hiddenHere);
    const done = examStepDoneToast(view);
    save.mutate({ exams: { hiddenKeys: offer } }, {
      onSuccess: () => {
        setAppliedHere(true);
        setOpenExam(null);
        // Straight on to the next step (Itai); the toast says what was marked and
        // how many still carry a "?" (Daniel), with a way back.
        setStep((current) => (current === 'exams' ? stepForward('exams') ?? current : current));
        toast.show(done, {
          // Says what it undoes (run 8): "לבטל" alone did not.
          actionLabel: EXAM_STEP_UNDO,
          onAction: () => {
            setAppliedHere(false);
            patch({ exams: { hiddenKeys: before } });
          },
        });
      },
      onError: () => toast.show(SAVE_ERROR),
    });
  };
  // A row answered, with a way back: "שלי" confirms it — the "?" goes and the
  // row reads "שלי", here and everywhere (W6-2) — and "לא שלי" hides it: the
  // row stays, reading "הוסתר" (run 7).
  const answerUnsure = (exam: ExamOption, mine: boolean): void => {
    const key = exam.naturalKey;
    const wasHidden = hiddenKeys.includes(key);
    const wasHiddenHere = hiddenHere.includes(key);
    const wasConfirmed = confirmed.has(key);
    const dropHere = (): void => setHiddenHere((keys) => keys.filter((k) => k !== key));
    const addHere = (): void => setHiddenHere((keys) => (keys.includes(key) ? keys : [...keys, key]));
    setOpenExam(null);
    if (mine) {
      setConfirmed(key, true);
      dropHere();
      if (wasHidden) patch({ exams: { hiddenKeys: setExamsShown(hiddenKeys, [key], true) } });
      toast.show('המבחן סומן כשלך', {
        onAction: () => {
          setConfirmed(key, wasConfirmed);
          if (wasHiddenHere) addHere();
          if (wasHidden) patch({ exams: { hiddenKeys: setExamsShown(latestHidden.current, [key], false) } });
        },
      });
      return;
    }
    setConfirmed(key, false);
    save.mutate({ exams: { hiddenKeys: setExamsShown(hiddenKeys, [key], false) } }, {
      onSuccess: () => {
        addHere();
        toast.show('המבחן הוסתר', {
          onAction: () => {
            dropHere();
            if (wasConfirmed) setConfirmed(key, true);
            // Back as it was: an exam hidden before this step stays on the list as hidden.
            if (!wasHidden) patch({ exams: { hiddenKeys: setExamsShown(latestHidden.current, [key], true) } });
          },
        });
      },
      onError: () => {
        if (wasConfirmed) setConfirmed(key, true);
        toast.show(SAVE_ERROR);
      },
    });
  };

  // The footer's one row; the dots below it only while they fit under the toast.
  const footerRow = ((): React.ReactNode => {
    switch (step) {
      case 'welcome':
        return <Button title="מתחילים" onPress={next} />;
      case 'connect':
        return googleOk || mashovOk ? <Button title="המשך" onPress={next} /> : <Button title="לדלג בינתיים" variant="ghost" onPress={next} />;
      case 'class':
        // Without a list the page's own button is the filled one, as on the connect step.
        return classPage === 'list' || classPage === 'children' || withoutSite
          ? <Button title="המשך" onPress={next} />
          : <Button title="לדלג בינתיים" variant="ghost" onPress={next} />;
      case 'exams':
        // One button (plan §14.7): on the offer it marks what the count says, and moves on.
        return (
          <Button
            title="המשך"
            disabled={examsStale !== false || (view.phase === 'offer' && saving)}
            onPress={view.phase === 'offer' ? applyRecommendation : next}
          />
        );
      default:
        return <Button title="סיימנו" onPress={finish} />;
    }
  })();
  const showDots = stepDotsFit(rowHeight, insets.bottom, toastBottom(insets.bottom, fontScale));

  return (
    <Screen>
      <View style={styles.topBar}>
        {/* The stack header's own back button: the same arrow as on every other screen (Daniel). */}
        {previous ? (
          <HeaderBackButton tintColor={p.accent} accessibilityLabel="חזרה לשלב הקודם" onPress={() => setStep(previous)} />
        ) : (
          <View style={styles.backButton} />
        )}
        <Text style={{ fontFamily: font.bodyMedium, fontSize: type.small, color: p.textMuted, paddingHorizontal: space.sm }}>
          {stepLabel(step, audience)}
        </Text>
      </View>

      {/* "handled": with the school address field open, the first tap on a button is the button's, not the keyboard's. */}
      <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {step === 'welcome' ? (
          // The name is the logo's (plan §16.3): the wordmark in place of an icon tile and a bold title.
          <View style={[styles.gutter, styles.welcome]}>
            <Logo size={46} />
            <Text style={[lead(p), { marginTop: space.xl }]}>{WELCOME_LEAD}</Text>
            {/* Who the app is for on this phone (docs/parents-plan.md): a parent's connect step comes first, and the class step lists the children Mashov brings. */}
            <Text style={[body(p), { marginTop: space.xl, color: p.text }]}>{AUDIENCE_COPY.question}</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel={AUDIENCE_COPY.question} style={styles.audience}>
              <FilterChip role="radio" label={AUDIENCE_COPY.student} selected={audience === 'student'} onPress={() => patch({ audience: 'student' })} />
              <FilterChip role="radio" label={AUDIENCE_COPY.parent} selected={audience === 'parent'} onPress={() => patch({ audience: 'parent' })} />
            </View>
            {audience === 'parent' ? <Text style={[body(p), { marginTop: space.xs }]}>{AUDIENCE_COPY.parentLine}</Text> : null}
            {/* Only when something is wrong: a working address means nothing to a student (Maya). */}
            {!isConfigured ? (
              <>
                <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.cancel, marginTop: space.xxl }}>האפליקציה עוד לא מוכנה לשימוש</Text>
                <Text style={[body(p), { marginTop: 4 }]}>חסרים בה פרטי חיבור, אז אי אפשר לקרוא שום מידע. הפרטים ב״מתקדם״.</Text>
                <Disclosure title="מתקדם" initiallyOpen style={{ marginTop: space.md }}>
                  <Text selectable style={body(p)}>
                    {'כתובת החיבור: '}
                    <Ltr style={body(p)}>{hostOf(API_BASE_URL) || 'לא הוגדרה'}</Ltr>
                  </Text>
                  <Text style={[body(p), { marginTop: 4 }]}>חסרים כתובת או מפתח גישה. צריך לבנות את האפליקציה מחדש עם משתני EXPO_PUBLIC.</Text>
                </Disclosure>
              </>
            ) : null}
            {/* The page's second choice, as a text button: "מתחילים" stays the step's one filled button. */}
            {canDemo ? (
              <View style={styles.demo}>
                <View style={{ alignItems: 'flex-start' }}>
                  <Button title={DEMO_COPY.enter} variant="ghost" onPress={startDemo} />
                </View>
                <Text style={body(p)}>{DEMO_COPY.enterLine}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {step === 'connect' ? (
          <View style={styles.page}>
            <View style={styles.gutter}>
              <Text accessibilityRole="header" style={title(p)}>{parent ? AUDIENCE_COPY.connectTitle : 'מחברים את Google ומשוב'}</Text>
              <Text style={lead(p)}>{parent ? AUDIENCE_COPY.connectLead : 'כל חיבור לוקח דקה, ואפשר גם לדלג ולחבר אחר כך מההגדרות.'}</Text>
            </View>

            <View style={[styles.sections, { borderTopColor: p.border }]}>
              {parent ? null : (
                <ConnectSection
                  name="Google"
                  done={googleOk}
                  account={googleOk ? google?.account ?? null : null}
                  text={CONNECTION_COPY.googleUse}
                  action={googleOk ? null : { title: 'להתחבר עם Google', onPress: connectGoogle }}
                />
              )}
              {/* A parent's own Mashov (stage 3): the same login screen, which reads the children list. */}
              <ConnectSection
                name="משוב"
                done={mashovOk}
                account={null}
                text={parent ? PARENT_MASHOV_COPY.use : CONNECTION_COPY.mashovUse}
                action={mashovOk ? null : {
                  title: parent ? PARENT_MASHOV_COPY.connect : 'להתחבר למשוב',
                  onPress: () => navigation.navigate('MashovLogin'),
                }}
              />
              {/* A parent's Google comes second, and only if wanted: the planning and tasks tabs come with it. */}
              {parent ? (
                <ConnectSection
                  name="Google"
                  done={googleOk}
                  account={googleOk ? google?.account ?? null : null}
                  text={PARENT_GOOGLE_COPY.use}
                  action={googleOk ? null : { title: 'להתחבר עם Google', onPress: connectGoogle }}
                />
              ) : null}
            </View>
          </View>
        ) : null}

        {step === 'class' && classPage === 'connect' ? (
          // The list comes through Mashov: the connect step's button, here.
          <View style={[styles.page, styles.gutter]}>
            <Text accessibilityRole="header" style={title(p)}>הכיתה שלך</Text>
            <Text style={lead(p)}>{SCHOOL_SITE_COPY.connectLead}</Text>
            <View style={{ alignItems: 'flex-start', marginTop: space.lg }}>
              <Button title={SCHOOL_SITE_COPY.connectButton} onPress={() => navigation.navigate('MashovLogin')} />
            </View>
          </View>
        ) : null}

        {step === 'class' && classPage === 'site' ? (
          // Mashov named no site: its address, pasted, or on without one, saying what that means.
          <View style={[styles.page, styles.gutter]}>
            <Text accessibilityRole="header" style={title(p)}>הכיתה שלך</Text>
            <Text style={lead(p)}>{SCHOOL_SITE_COPY.noSiteLead}</Text>
            <View style={{ marginTop: space.lg }}>
              <SchoolSiteField />
            </View>
            <View style={styles.without}>
              <View style={{ alignItems: 'flex-start' }}>
                <Button title={SCHOOL_SITE_COPY.withoutButton} variant="ghost" disabled={goWithoutSite.isPending} onPress={continueWithoutSite} />
              </View>
              <Text style={body(p)}>{SCHOOL_SITE_COPY.withoutLine}</Text>
            </View>
          </View>
        ) : null}

        {step === 'class' && classPage === 'children' ? (
          // The children Mashov brought: nothing to pick, only to see what was added before going on.
          <View style={styles.page}>
            <View style={styles.gutter}>
              <Text accessibilityRole="header" style={title(p)}>{AUDIENCE_COPY.childrenTitle}</Text>
              <Text style={lead(p)}>{AUDIENCE_COPY.childrenLead}</Text>
            </View>
            <View style={[styles.childList, { borderTopColor: p.border }]}>
              {(scanView?.children ?? []).map((child, i) => {
                const classLine = child.withoutSite ? AUDIENCE_COPY.withoutSite : child.className;
                return (
                  <Row
                    key={i}
                    title={child.name || classLine}
                    subtitle={child.name && classLine && child.name !== classLine ? classLine : undefined}
                  />
                );
              })}
            </View>
            {scanView?.unbound.length ? (
              <View style={[styles.gutter, styles.unbound]}>
                {scanView.unbound.map((line, i) => <Text key={i} style={body(p)}>{line}</Text>)}
              </View>
            ) : null}
          </View>
        ) : null}

        {step === 'class' && classPage === 'parent' ? (
          // A parent with no list yet: the child's invite link, or the site's address (docs/parents-plan.md).
          <View style={[styles.page, styles.gutter]}>
            <Text accessibilityRole="header" style={title(p)}>{AUDIENCE_COPY.classTitle}</Text>
            {/* Mashov was asked and listed nobody who can be added here: why, and which children need binding in Mashov first. */}
            {scanView?.scanned ? (
              <View style={styles.none}>
                <Text style={[body(p), { color: p.text }]}>{AUDIENCE_COPY.noneFromMashov}</Text>
                {scanView.unbound.map((line, i) => <Text key={i} style={body(p)}>{line}</Text>)}
              </View>
            ) : null}
            <Text style={lead(p)}>{AUDIENCE_COPY.classLead}</Text>
            <View style={{ marginTop: space.lg }}>
              <SchoolSiteField />
            </View>
          </View>
        ) : null}

        {step === 'class' && classPage === 'list' ? (
          <View style={[styles.page, styles.gutter]}>
            <Text accessibilityRole="header" style={title(p)}>{audience === 'parent' ? AUDIENCE_COPY.classTitle : 'הכיתה שלך'}</Text>
            <Text style={lead(p)}>{CLASS_LEAD}</Text>
            {/* "מגמה" explained in place, in "השיעורים שלי"'s words (Maya). */}
            {majorExplainer ? (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: majorOpen }}
                accessibilityLabel="מה זה מגמה?"
                onPress={() => setMajorOpen((v) => !v)}
                style={({ pressed }) => [styles.link, { marginTop: space.xs, opacity: pressed ? 0.6 : 1 }]}
              >
                <AppIcon name="help" color={p.accent} size={18} />
                <Text style={{ fontFamily: font.bodySemi, fontSize: type.label, color: p.accent }}>מה זה מגמה?</Text>
              </Pressable>
            ) : null}
            {majorOpen && majorExplainer ? (
              <Text accessibilityLiveRegion="polite" style={[body(p), { color: p.text }]}>{majorExplainer}</Text>
            ) : null}
            {s?.className ? (
              <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text, marginTop: space.lg }}>
                {`נבחרה: ${displayClassName(data?.classes.find((c) => c.id === s.classId)?.name ?? s.className)}`}
              </Text>
            ) : null}
            <View style={{ marginTop: space.md }}>
              <ClassGroups classes={data?.classes ?? []} selectedId={s?.classId ?? ''} onSelect={chooseClass} />
            </View>
          </View>
        ) : null}

        {step === 'exams' ? (
          <View style={styles.page}>
            <View style={styles.gutter}>
              <Text accessibilityRole="header" style={title(p)}>{audience === 'parent' ? AUDIENCE_COPY.examsTitle : 'המבחנים שלך'}</Text>
              {/* The count, and the "?" ones on a line of their own (plan §14.7, §16.2: Itai did
                  not read the step, Maya was anxious). The count is "המבחנים שלי"'s once marked (W5-11). */}
              {countLine ? (
                <Text style={{ fontFamily: font.bodySemi, fontSize: type.title, color: p.text, marginTop: space.md }}>{countLine}</Text>
              ) : null}
              {/* Whose the class's board is, under the count: one line, never a name (design 2026-11-10). */}
              {boardLine ? <Text style={[lead(p), { marginTop: space.xs }]}>{boardLine}</Text> : null}
              {/* What "המשך" leaves with a "?", said before it is pressed (run 7: Daniel, Itai). */}
              {!examsStale && leaveLine ? (
                <Text style={[lead(p), { marginTop: space.xs }]}>{leaveLine}</Text>
              ) : null}

              {/* Every exam the server could not place, each in one state, folded: checking now is a choice, not a step. */}
              {!examsStale && unsureGroups.length > 0 ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: checking }}
                  accessibilityLabel="לבדוק עכשיו את המבחנים עם סימן שאלה"
                  onPress={() => setChecking((v) => !v)}
                  style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
                >
                  <Text style={{ fontFamily: font.bodySemi, fontSize: type.label, color: p.accent }}>לבדוק עכשיו</Text>
                  <View style={checking ? styles.flip : null}>
                    <AppIcon name="chevronDown" color={p.accent} size={18} />
                  </View>
                </Pressable>
              ) : null}
              {/* "מה זה גוש?", "מה זה מתכונת?" — only for words the list holds (W6-8, Maya). Questions in
                  words, without a "?" icon each: one "?" per screen at most (the Wave 9 re-rate). */}
              {!examsStale && checking && terms.length > 0 ? (
                <View style={styles.terms}>
                  {terms.map((term) => (
                    <Pressable
                      key={term.key}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: openTerm === term.key }}
                      accessibilityLabel={term.question}
                      onPress={() => setOpenTerm((current) => (current === term.key ? null : term.key))}
                      style={({ pressed }) => [styles.termLink, { opacity: pressed ? 0.6 : 1 }]}
                    >
                      <Text style={{ fontFamily: font.bodySemi, fontSize: type.label, color: p.accent }}>{term.question}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
              {!examsStale && checking && openAnswer ? (
                <Text accessibilityLiveRegion="polite" style={[body(p), { color: p.text }]}>{openAnswer}</Text>
              ) : null}

              {/* No exams and no board for the class: the block that brings one, a choice that "המשך" skips. Once a board is
                  saved the step checks again (`examsStale`) and shows its exams, with the usual count and "המשך". */}
              {offersBoard ? (
                <View style={styles.board}>
                  <ExamBoard showHeading={false} own={ownBoard} onSaved={() => setExamsStale('board')} />
                </View>
              ) : null}
            </View>

            {/* A list of dates: the dates in the red margin (plan §16.1), each group under its name. */}
            {!examsStale && checking && unsureGroups.length > 0 ? (
              <MarginList style={[styles.examList, { borderTopColor: p.border }]}>
                {unsureGroups.map((group) => (
                  <UnsureGroup
                    key={group.key}
                    group={group}
                    hidden={rowHidden}
                    lessons={lessons}
                    openKey={openExam}
                    busy={saving}
                    onToggle={(key) => setOpenExam((current) => (current === key ? null : key))}
                    onAnswer={answerUnsure}
                  />
                ))}
              </MarginList>
            ) : null}
          </View>
        ) : null}

        {step === 'notifications' ? (
          <View style={styles.page}>
            <View style={styles.gutter}>
              <Text accessibilityRole="header" style={title(p)}>התראות</Text>
              <Text style={lead(p)}>נודיע לך על שינויים במערכת, מבחנים ושיעורי בית, ואפשר לשנות את זה אחר כך בהגדרות.</Text>
              <View style={{ marginTop: space.xl }}>
                {/* A text button here: the step's one filled button is "סיימנו" (the Wave 9 re-rate). */}
                <NotificationPermissionNotice permission={permission} primary={false} />
              </View>
            </View>
            {/* The stored choices; drawn disabled while the phone allows no notifications, and they apply once it does. */}
            <View style={[styles.sections, { borderTopColor: p.border }]}>
              <SwitchRow
                label="שינויים במערכת"
                value={Boolean(s?.notifications.schedule_change_tomorrow)}
                busy={saving}
                disabled={notificationsOff}
                disabledHint={PERMISSION_SWITCH_HINT}
                onDisabledPress={askPermission}
                onChange={(v) => patch({ notifications: { schedule_change_tomorrow: v, schedule_change_today: v } })}
              />
              <SwitchRow
                label={audience === 'parent' ? AUDIENCE_COPY.examsSwitch : 'מבחנים ושיעורי בית חדשים'}
                value={Boolean(s?.notifications.new_exam)}
                busy={saving}
                disabled={notificationsOff}
                disabledHint={PERMISSION_SWITCH_HINT}
                onDisabledPress={askPermission}
                onChange={(v) => patch({ notifications: { new_exam: v, new_homework: v } })}
              />
              <SwitchRow
                label={`סיכום בוקר ב־${morning}`}
                value={Boolean(s?.notifications.morning_summary)}
                busy={saving}
                disabled={notificationsOff}
                disabledHint={PERMISSION_SWITCH_HINT}
                onDisabledPress={askPermission}
                onChange={(v) => patch({ notifications: { morning_summary: v } })}
              >
                {'סיכום בוקר ב־'}
                <Ltr>{morning}</Ltr>
              </SwitchRow>
              <SwitchRow
                label={`תזכורת ערב ב־${evening}: מה להגיש`}
                value={Boolean(s?.notifications.evening_homework)}
                busy={saving}
                disabled={notificationsOff}
                disabledHint={PERMISSION_SWITCH_HINT}
                onDisabledPress={askPermission}
                onChange={(v) => patch({ notifications: { evening_homework: v } })}
              >
                {'תזכורת ערב ב־'}
                <Ltr>{evening}</Ltr>
                {': מה להגיש'}
              </SwitchRow>
            </View>
            {/* A list of the five tabs, said as one — not a tour of the screens (Daniel, Maya). */}
            <View style={styles.gutter}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="מה יש באפליקציה, 30 שניות קריאה"
                onPress={() => setTourOpen(true)}
                style={({ pressed }) => [styles.link, { opacity: pressed ? 0.6 : 1 }]}
              >
                <AppIcon name="help" color={p.accent} size={18} />
                <Text style={{ fontFamily: font.bodySemi, fontSize: type.label, color: p.accent }}>מה יש באפליקציה (30 שניות)</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <View style={[styles.footer, { borderTopColor: p.border, paddingBottom: FOOTER.paddingBottom + insets.bottom }]}>
        <View onLayout={(e) => setRowHeight(e.nativeEvent.layout.height)}>{footerRow}</View>
        {showDots ? (
          <View style={styles.dots}>
            {steps.map((name, i) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityLabel={`שלב ${i + 1} מתוך ${steps.length}`}
                accessibilityState={{ selected: i === index }}
                hitSlop={{ left: 4, right: 4 }}
                onPress={() => setStep(name)}
                style={styles.dotTarget}
              >
                <View style={[styles.dot, { backgroundColor: i === index ? p.accent : p.border, width: i === index ? 18 : 6 }]} />
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {/* "הבנתי" closes the sheet and stays on this step; "סיימנו" is the footer's (Maya). */}
      <Sheet visible={tourOpen} onClose={() => setTourOpen(false)} title="מה יש באפליקציה" footer={<Button title="הבנתי" onPress={() => setTourOpen(false)} />}>
        <Text style={body(p)}>חמישה כפתורים בתחתית המסך:</Text>
        <View style={{ marginTop: space.sm }}>
          {tabGuide(audience).map((tab) => (
            <View key={tab.title} style={[styles.tourRow, { borderBottomColor: p.border }]}>
              <AppIcon name={tab.icon} color={p.accent} size={22} />
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text }}>{tab.title}</Text>
                <Text style={[body(p), { marginTop: 2 }]}>{tab.body}</Text>
              </View>
            </View>
          ))}
        </View>
        <Text style={[body(p), { marginTop: space.lg }]}>{HEADER_GUIDE}</Text>
      </Sheet>
    </Screen>
  );
}

/**
 * One group of unsure exams under "לבדוק עכשיו", named as "המבחנים שלי" names
 * it ("אנגלית", "גוש ב׳"): its name on a line of the margin list, then a row
 * per exam with the date in the margin. Each row is a button (Daniel, Maya and
 * Noa tapped the "?" and nothing happened) in one state, at its end: "?" on
 * the pink highlighter, "שלי" with a drawn tick, or "הוסתר" (run 7: "לא שלי"
 * left "?" and "לא מסומן" side by side). It opens what decides it — the
 * owner's teacher and the one the title names, with "לא שלי" first (plan
 * §14.7) — or else why it is unsure, and the answer it does not have yet:
 * "שלי" / "לא שלי" while "?", the other one once decided.
 */
function UnsureGroup({
  group, hidden, lessons, openKey, busy, onToggle, onAnswer,
}: {
  group: ExamGroup<ExamOption>;
  /** The hide-list the step will leave (`examStepView().hidden`): a hidden row reads "הוסתר". */
  hidden: ReadonlySet<string>;
  /** The timetable's lines and the hide-list, for `teacherFact`. */
  lessons: { subjects: readonly SubjectOption[]; hidden: readonly string[] };
  /** The unsure exam whose explanation is open, if any. */
  openKey: string | null;
  busy: boolean;
  onToggle: (key: string) => void;
  onAnswer: (exam: ExamOption, mine: boolean) => void;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <>
      {/* What "גוש" is lives in the step's "מה זה גוש?", once, not under every block group (W6-8). */}
      <MarginRow
        title={group.key}
        titleStyle={{ fontFamily: font.headingSemi, fontSize: type.label, color: p.textMuted }}
        accessibilityRole="header"
        style={styles.groupRow}
      />
      {group.exams.map((exam) => {
        const date = formatShortDate(exam.date);
        const subjects = blockSubjects(exam);
        const detail = [examDisplayTitle(exam.subject), subjects].filter(Boolean).join(', ');
        const state = examStepRowState(exam, hidden);
        const open = openKey === exam.naturalKey;
        // What decides it is the same whatever was answered: read off the exam as the server sent it.
        const asked = { ...exam, confirmed: false };
        const fact = open ? teacherFact(asked, lessons.subjects, lessons.hidden) : null;
        return (
          <View key={exam.naturalKey}>
            <MarginRow
              margin={date}
              title={isolateRanges(examDisplayTitle(exam.subject))}
              subtitle={subjects ? isolateRanges(subjects) : undefined}
              titleLines={2}
              titleStyle={state === 'hidden' ? { color: p.textMuted } : null}
              end={<RowState state={state} />}
              accessibilityRole="button"
              accessibilityState={{ expanded: open }}
              accessibilityLabel={[date, detail, ROW_SPOKEN[state]].join(', ')}
              accessibilityHint={open ? 'סוגר את ההסבר' : state === 'open' ? 'מסביר למה, ואפשר לבחור שלי או לא שלי' : 'אפשר לשנות את הבחירה'}
              onPress={() => onToggle(exam.naturalKey)}
            />
            {open ? (
              <View accessibilityLiveRegion="polite" style={[styles.unsurePanel, { borderBottomColor: p.border }]}>
                {fact ? (
                  <>
                    <Text style={{ fontFamily: font.bodySemi, fontSize: type.body, color: p.text, lineHeight: 22 }}>{teacherFactText(fact)}</Text>
                    <Text style={body(p)}>{FACT_ADVICE}</Text>
                  </>
                ) : (
                  <UnsureMark reason={unsureReason(asked)} />
                )}
                <View style={styles.buttonRow}>
                  {state === 'hidden' ? null : (
                    <Button title="לא שלי" variant={fact && state === 'open' ? 'primary' : 'ghost'} disabled={busy} onPress={() => onAnswer(exam, false)} />
                  )}
                  {state === 'mine' ? null : <Button title="שלי" variant="ghost" disabled={busy} onPress={() => onAnswer(exam, true)} />}
                </View>
              </View>
            ) : null}
          </View>
        );
      })}
    </>
  );
}

/** A row's state at its end: the "?" on the pink highlighter, "שלי" with a drawn tick, "הוסתר" quiet. */
function RowState({ state }: { state: ExamRowState }): React.JSX.Element {
  const p = usePalette();
  if (state === 'open') {
    return <Mark kind="change" color={p.change} style={styles.stateText}>{EXAM_ROW_LABELS.open}</Mark>;
  }
  if (state === 'mine') {
    return (
      <View style={styles.stateMine}>
        <AppIcon name="check" color={p.ok} size={16} />
        <Text style={[styles.stateText, { color: p.ok }]}>{EXAM_ROW_LABELS.mine}</Text>
      </View>
    );
  }
  return <Text style={[styles.stateText, { color: p.textMuted }]}>{EXAM_ROW_LABELS.hidden}</Text>;
}

/** A row's state, as a screen reader says it. */
const ROW_SPOKEN: Readonly<Record<ExamRowState, string>> = {
  open: 'לא בטוח שזה שלך',
  mine: 'שלי',
  hidden: 'הוסתר',
};

/**
 * One account to connect, as a section of the page between ruled lines: its
 * name, "מחובר" with a drawn tick once it is, the account, what it brings in
 * one line, and the one button while it is not connected.
 */
function ConnectSection({
  name, done, account, text, action,
}: {
  name: string;
  done: boolean;
  account: string | null;
  text: string;
  action: { title: string; onPress: () => void } | null;
}): React.JSX.Element {
  const p = usePalette();
  return (
    <View style={[styles.section, { borderBottomColor: p.border }]}>
      <View style={styles.sectionHead}>
        <Text accessibilityRole="header" style={{ flexShrink: 1, fontFamily: font.bodySemi, fontSize: type.title, color: p.text }}>{name}</Text>
        {done ? (
          <View style={styles.connected}>
            <AppIcon name="check" color={p.ok} size={18} />
            <Text style={{ fontFamily: font.bodySemi, fontSize: type.small, color: p.ok }}>מחובר</Text>
          </View>
        ) : null}
      </View>
      {account ? <Ltr style={body(p)}>{account}</Ltr> : null}
      <Text style={body(p)}>{text}</Text>
      {action ? (
        <View style={{ alignItems: 'flex-start', marginTop: space.sm }}>
          <Button title={action.title} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  );
}

/** A step's title: the screen's title, in the display face (plan §16.1). */
function title(p: Palette) {
  return { fontFamily: font.display, fontSize: type.display, lineHeight: Math.round(type.display * 1.3), color: p.text } as const;
}

function lead(p: Palette) {
  return { fontFamily: font.body, fontSize: type.body, color: p.textMuted, marginTop: space.sm, lineHeight: 24 } as const;
}

function body(p: Palette) {
  return { fontFamily: font.body, fontSize: type.small, color: p.textMuted, lineHeight: 20 } as const;
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: space.xs, paddingTop: space.xs, minHeight: MIN_TOUCH,
  },
  /** Holds the back button's place on the first step, so the step label stays put. */
  backButton: { minHeight: MIN_TOUCH, minWidth: MIN_TOUCH },
  content: { paddingTop: space.sm, paddingBottom: 40, flexGrow: 1 },
  /** The page's gutter, where the rows' text starts. */
  gutter: { paddingHorizontal: ROW_GUTTER },
  // Each step starts at the top of the page (the 1.7 review: a step floating in the middle of empty space).
  page: { paddingTop: space.lg },
  welcome: { paddingTop: space.xxl * 2 },
  /** Sections between ruled lines, edge to edge, under the step's words. */
  sections: { marginTop: space.xl, borderTopWidth: 1 },
  section: {
    paddingStart: ROW_GUTTER, paddingEnd: ROW_END, paddingVertical: space.lg, gap: space.xs, borderBottomWidth: 1,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm },
  connected: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  footer: { paddingHorizontal: space.xl, paddingTop: FOOTER.paddingTop, borderTopWidth: 1 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // A fold's chevron points down when closed and up when open.
  flip: { transform: [{ rotate: '180deg' }] },
  link: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space.xs, minHeight: MIN_TOUCH, marginTop: space.md },
  terms: { flexDirection: 'row', flexWrap: 'wrap', columnGap: space.lg, marginTop: space.xs },
  /** "להמשיך בלי אתר" and its line, apart from the field above. */
  without: { marginTop: space.xl, gap: space.xs },
  /** "להסתכל בהדגמה" and its line, apart from the welcome above. */
  demo: { marginTop: space.xxl, gap: space.xs },
  audience: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginTop: space.sm },
  termLink: { flexDirection: 'row', alignItems: 'center', gap: space.xs, minHeight: MIN_TOUCH },
  dots: { flexDirection: 'row', justifyContent: 'center', marginTop: FOOTER.dotsGap },
  dotTarget: { width: 36, height: FOOTER.dots, alignItems: 'center', justifyContent: 'center' },
  dot: { height: 6, borderRadius: 3 },
  examList: { marginTop: space.md, borderTopWidth: 1 },
  /** The block that brings the class a board, under the step's words. */
  board: { marginTop: space.lg },
  /** The children Mashov brought, as ruled rows under the step's words. */
  childList: { marginTop: space.xl, borderTopWidth: 1 },
  /** The lines about children the login cannot read, under the rows. */
  unbound: { marginTop: space.lg, gap: space.xs },
  /** The line over the way of today when Mashov brought nobody, and the unbound lines under it. */
  none: { marginTop: space.sm, gap: space.xs },
  groupRow: { minHeight: MIN_TOUCH },
  stateText: { fontFamily: font.bodySemi, fontSize: type.small },
  stateMine: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  // Under its row, in line with the row's words: past the margin and its red line.
  unsurePanel: {
    paddingStart: MARGIN_WIDTH + MARGIN_LINE + space.md, paddingEnd: ROW_END, paddingBottom: space.md,
    gap: space.sm, borderBottomWidth: 1,
  },
  tourRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingVertical: space.md, borderBottomWidth: 1 },
});
