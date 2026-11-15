/**
 * Parents mode, stage 2 on the phone (docs/parents-plan.md): a parent's
 * children (app/src/local/children.ts), the device's other classes and their
 * feeds (app/src/device/v2.ts), and the morning summary and evening reminder
 * that speak of every child (`childrenMorningSummary`,
 * `childrenEveningReminder`, app/src/notify/summaries.ts).
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ClassFeed, ClassLesson, DayView, Lesson, UserSettings } from '@sederyom/shared';
import { DEFAULT_SETTINGS, MAX_FOLLOWED_CLASSES } from '@sederyom/shared';
import { buildDayView } from '@sederyom/shared/logic/build';
import { childrenEveningReminder, childrenMorningSummary, composeMorningSummary, packKey } from '@sederyom/shared/logic/summaries';
import { DateTime } from 'luxon';
import type { ParentSchools } from '../../app/src/mashov/parentSchools';

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

const { DEVICE_KEYS, otherClassesUnsupported, readFeedOf, syncOtherClasses } = await import('../../app/src/device/v2');
const {
  addChild, CHILD_KEYS, childOfClass, CHILDREN_KEY, dismissedGuids, feedOfChild, linkChild, ONLY_CHILD_LINK_KEY, ONLY_CHILD_NAME_KEY, otherFollows, readChildren, readOnlyChildName,
  removeChild, renameChild, sameClassNames, setOnlyChildName, stashedChild, stashKey, shownMashovLink, switchChild, syncShownChild,
} = await import('../../app/src/local/children');
const { applyChildrenPlan } = await import('../../app/src/local/childrenFromMashov');
const { SETTINGS_KEYS } = await import('../../app/src/local/keyMigrations');
const { MANUAL_EXAMS_KEY } = await import('../../app/src/local/manualExams');
const { EXAM_PREFS_KEY, readExamPrefs, setExamDate } = await import('../../app/src/local/examPrefs');
const { PACK_LIST_KEY, readPackList } = await import('../../app/src/local/packList');
const { SCHOOL_SITE_KEYS, isWithoutSite, pastedSite, savePastedSite, setWithoutSite } = await import('../../app/src/local/schoolSite');
const { DISMISSED_KEY } = await import('../../app/src/local/children');
const { PARENT_KEYS, forgetParentLogin } = await import('../../app/src/mashov/parents');
const { planLocalSummaries, summaryId } = await import('../../app/src/notify/summaries');

const ZONE = 'Asia/Jerusalem';
const SITE_C = 'https://school-c.shahaf.site';
const SITE_G = 'https://school-g.shahaf.site';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) };
}

const settings = (over: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_SETTINGS, audience: 'parent', ...over });

/** A parent's phone that shows יא' 4, with פיזיקה not the child's. */
const SHOWN = settings({ classId: '12144', className: "יא' 4", lessons: { hiddenSubjects: ['פיזיקה'] } });

function ids() {
  let n = 0;
  return () => `c${++n}`;
}

const feedOf = (siteUrl: string, classId: string, className: string, lessons: ClassLesson[] = [], lastOkAt: string | null = null): ClassFeed => ({
  class: { siteUrl, classId, className, examCalendarId: null }, lastOkAt, freshness: null, lessons, changes: [], exams: [], events: [], messages: [],
});

describe("a parent's children", () => {
  it('begin with the second: the class the phone had is the first, and stays on screen', () => {
    const kv = memoryKv();
    const next = ids();
    expect(readChildren(kv)).toBeNull();
    const added = addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2", classes: [{ id: '13900', name: "ז' 2" }] }, next);
    expect(added).toBe('added');
    const children = readChildren(kv)!;
    expect(children.activeId).toBe('c1');
    expect(children.list.map((c) => [c.id, c.siteUrl, c.classId, c.hiddenSubjects])).toEqual([
      ['c1', SITE_C, '12144', ['פיזיקה']],
      ['c2', SITE_C, '13900', []],
    ]);
    // The new child's school list goes aside with it, for Settings once it is on screen.
    expect(kv.getString(stashKey('c2', SETTINGS_KEYS.classes))).toContain('13900');
  });

  it('are six at most, each class once', () => {
    const kv = memoryKv();
    const next = ids();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, next);
    expect(addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '12144', className: "יא' 4" }, next)).toBe('already');
    expect(addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, next)).toBe('already');
    // The same class id at another school is another class.
    expect(addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_G, classId: '13900', className: "ט' - 2" }, next)).toBe('added');
    for (const [siteUrl, classId, className] of [[SITE_C, '13901', "ז' 3"], [SITE_C, '13902', "ז' 4"], [SITE_G, '4', "ט' - 4"]]) {
      expect(addChild(kv, SHOWN, SITE_C, { siteUrl: siteUrl!, classId: classId!, className: className! }, next)).toBe('added');
    }
    expect(addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_G, classId: '3', className: "ט' - 3" }, next)).toBe('full');
    expect(readChildren(kv)!.list).toHaveLength(MAX_FOLLOWED_CLASSES);
    expect(childOfClass(kv, { siteUrl: SITE_G, classId: '13900' })?.id).toBe('c3');
    expect(childOfClass(kv, { siteUrl: SITE_G, classId: '3' })).toBeNull();
  });

  it('switch with everything that is the class on screen, and switch back to it as it was', () => {
    const kv = memoryKv();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2", classes: [{ id: '13900', name: "ז' 2" }] }, ids());
    kv.set(DEVICE_KEYS.feed, JSON.stringify(feedOf(SITE_C, '12144', "יא' 4")));
    kv.set(MANUAL_EXAMS_KEY, JSON.stringify([{ naturalKey: 'manual|1', date: '2026-11-03', subject: 'ספרות', details: null }]));
    kv.set(PACK_LIST_KEY, JSON.stringify({ מתמטיקה: 'מחשבון' }));
    kv.set(SETTINGS_KEYS.classes, JSON.stringify([{ id: '12144', name: "יא' 4" }]));

    const second = switchChild(kv, SHOWN, 'c2', SITE_C)!;
    expect(second).toMatchObject({ classId: '13900', className: "ז' 2", audience: 'parent', lessons: { hiddenSubjects: [] } });
    // The phone's own keys are the second child's: no feed read yet, its school's list, nothing added.
    expect(kv.getString(DEVICE_KEYS.feed)).toBe('');
    expect(kv.getString(SETTINGS_KEYS.classes)).toContain('13900');
    expect(readPackList(kv)).toEqual({});
    // Its site is the one the refresh follows it at, before its feed is read.
    expect(kv.getString(SCHOOL_SITE_KEYS.pasted)).toBe(SITE_C);
    // The first child's went aside as they were, its hidden lines with them.
    const aside = stashedChild(kv, 'c1');
    expect(aside.feed?.class.classId).toBe('12144');
    expect(aside.manualExams.map((e) => e.subject)).toEqual(['ספרות']);
    expect(aside.pack).toEqual({ מתמטיקה: 'מחשבון' });
    expect(readChildren(kv)!.list[0]).toMatchObject({ classId: '12144', hiddenSubjects: ['פיזיקה'] });

    const back = switchChild(kv, { ...second, lessons: { hiddenSubjects: ['ספורט'] } }, 'c1', SITE_C)!;
    expect(back).toMatchObject({ classId: '12144', lessons: { hiddenSubjects: ['פיזיקה'] } });
    expect(JSON.parse(kv.getString(DEVICE_KEYS.feed)!).class.classId).toBe('12144');
    expect(readPackList(kv)).toEqual({ מתמטיקה: 'מחשבון' });
    // What changed while the second was on screen went aside with it.
    expect(readChildren(kv)!.list[1]).toMatchObject({ hiddenSubjects: ['ספורט'] });
    // On screen already: nothing to do.
    expect(switchChild(kv, back, 'c1', SITE_C)).toBeNull();
  });

  it('keep the dates a parent set for exams with the child they were set for', () => {
    const kv = memoryKv();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2", classes: [{ id: '13900', name: "ז' 2" }] }, ids());
    expect(CHILD_KEYS).toContain(EXAM_PREFS_KEY);
    setExamDate(kv, 'site-exam|english', '2026-11-20', '2026-11-03');
    const first = readExamPrefs(kv).dates;

    const second = switchChild(kv, SHOWN, 'c2', SITE_C)!;
    // The second child's own keys: none of the first child's dates, which went aside with the first.
    expect(readExamPrefs(kv).dates).toEqual({});
    expect(stashedChild(kv, 'c1').examPrefs.dates).toEqual(first);
    setExamDate(kv, 'site-exam|physics', '2026-12-01', '2026-11-30');

    switchChild(kv, second, 'c1', SITE_C);
    expect(readExamPrefs(kv).dates).toEqual(first);
    expect(stashedChild(kv, 'c2').examPrefs.dates).toEqual({ 'site-exam|physics': { date: '2026-12-01', sourceDate: '2026-11-30' } });
  });

  it("keep the class on screen as it is after it was picked again, or replaced by an invite's", () => {
    const kv = memoryKv();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    const moved = { ...SHOWN, classId: '13901', className: "ז' 3" };
    syncShownChild(kv, moved, SITE_G);
    expect(readChildren(kv)!.list[0]).toMatchObject({ id: 'c1', siteUrl: SITE_G, classId: '13901', className: "ז' 3" });
    expect(childOfClass(kv, { siteUrl: SITE_G, classId: '13901' })?.id).toBe('c1');
    expect(childOfClass(kv, { siteUrl: SITE_C, classId: '12144' })).toBeNull();
    // No list: nothing to keep.
    const alone = memoryKv();
    syncShownChild(alone, moved, SITE_G);
    expect(readChildren(alone)).toBeNull();
  });

  it('are renamed on the phone, and taken off the list with what was kept for them', () => {
    const kv = memoryKv();
    const next = ids();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, next);
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_G, classId: '2', className: "ט' - 2" }, next);
    renameChild(kv, 'c2', '  נועה  ');
    expect(readChildren(kv)!.list[1]!.label).toBe('נועה');

    kv.set(stashKey('c2', PACK_LIST_KEY), JSON.stringify({ ספורט: 'בגדי ספורט' }));
    expect(removeChild(kv, SHOWN, 'c2', SITE_C)).toBeNull();
    expect(readChildren(kv)!.list.map((c) => c.id)).toEqual(['c1', 'c3']);
    expect(kv.getString(stashKey('c2', PACK_LIST_KEY))).toBe('');

    // The one on screen goes after another is put there.
    kv.set(PACK_LIST_KEY, JSON.stringify({ מתמטיקה: 'מחשבון' }));
    const shown = removeChild(kv, SHOWN, 'c1', SITE_C)!;
    expect(shown).toMatchObject({ classId: '2', className: "ט' - 2" });
    expect(readPackList(kv)).toEqual({});
    // One child left is no list: the phone is a parent's of one child, as in stage 1.
    expect(readChildren(kv)).toBeNull();
    expect(kv.getString(stashKey('c1', PACK_LIST_KEY))).toBe('');
  });

  it("follow each other class once, without the one on screen's, and two children in one class with the lines neither hides", () => {
    const child = (id: string, siteUrl: string, classId: string, hiddenSubjects: string[] = []) => ({ id, label: '', siteUrl, classId, className: classId, hiddenSubjects });
    expect(otherFollows({
      activeId: 'a',
      list: [
        child('a', SITE_C, '12144', ['פיזיקה']),
        child('twin', SITE_C, '12144', ['ספרות']),
        child('b', SITE_C, '13900', ['ספרות', 'אמנות']),
        child('c', SITE_C, '13900', ['אמנות']),
        child('d', SITE_G, '12144'),
      ],
    })).toEqual([
      // Every follow carries its names, `{}` for none: the server replaces a follow's whole prefs.
      { siteUrl: SITE_C, classId: '13900', hiddenSubjects: ['אמנות'], subjectNames: {} },
      { siteUrl: SITE_G, classId: '12144', hiddenSubjects: [], subjectNames: {} },
    ]);
    expect(otherFollows(null)).toEqual([]);

    // The twin has no follow of its own, so no feed kept aside: the summaries read it by the feed on screen.
    const onScreen = feedOf(SITE_C, '12144', "יא' 4");
    const kept = feedOf(SITE_C, '13900', "ז' 2");
    const shown = { siteUrl: SITE_C, classId: '12144', feed: onScreen };
    expect(feedOfChild(child('twin', SITE_C, '12144'), null, shown)).toBe(onScreen);
    expect(feedOfChild(child('b', SITE_C, '13900'), kept, shown)).toBe(kept);
    expect(feedOfChild(child('d', SITE_G, '12144'), null, shown)).toBeNull();
  });
});

describe("a parent's children and their own names for subjects", () => {
  const MATH = 'subject:מתמטיקה';
  const LIT = 'subject:ספרות';
  const ART = 'subject:אמנות';
  const named = (subjectNames: Record<string, string>): UserSettings =>
    settings({ classId: '12144', className: "יא' 4", lessons: { hiddenSubjects: ['פיזיקה'], subjectNames } });
  const child = (id: string, siteUrl: string, classId: string, subjectNames?: Record<string, string>) => ({
    id, label: '', siteUrl, classId, className: classId, hiddenSubjects: [] as string[], ...(subjectNames ? { subjectNames } : {}),
  });

  it("keep a child's names with the child through a switch, and bring them back", () => {
    const kv = memoryKv();
    const noa = named({ [MATH]: 'חשבון' });
    addChild(kv, noa, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    // The class the phone had is the first child, with the names the phone had; the new child starts with none.
    expect(readChildren(kv)!.list.map((c) => c.subjectNames)).toEqual([{ [MATH]: 'חשבון' }, {}]);

    const second = switchChild(kv, noa, 'c2', SITE_C)!;
    expect(second.lessons.subjectNames).toEqual({});
    expect(second.lessons.hiddenSubjects).toEqual([]);

    // The second child names a subject; going back brings the first child's names, not the second's.
    const back = switchChild(kv, { ...second, lessons: { ...second.lessons, subjectNames: { [LIT]: 'ספר' } } }, 'c1', SITE_C)!;
    expect(back.lessons.subjectNames).toEqual({ [MATH]: 'חשבון' });
    expect(readChildren(kv)!.list.map((c) => c.subjectNames)).toEqual([{ [MATH]: 'חשבון' }, { [LIT]: 'ספר' }]);
    // And the second again has its own.
    expect(switchChild(kv, back, 'c2', SITE_C)!.lessons.subjectNames).toEqual({ [LIT]: 'ספר' });
  });

  it('give a child saved before names existed none, whoever was on screen', () => {
    const kv = memoryKv();
    kv.set(CHILDREN_KEY, JSON.stringify({ activeId: 'a', list: [child('a', SITE_C, '12144'), child('b', SITE_C, '13900')] }));
    expect(readChildren(kv)!.list.map((c) => c.subjectNames)).toEqual([undefined, undefined]);
    const there = switchChild(kv, named({ [MATH]: 'חשבון' }), 'b', SITE_C)!;
    expect(there.lessons.subjectNames).toEqual({});
    // The child that was on screen kept what the phone had.
    expect(readChildren(kv)!.list[0]!.subjectNames).toEqual({ [MATH]: 'חשבון' });
  });

  it('start the second child with none, and the first with the settings\' when there are none', () => {
    const kv = memoryKv();
    // Settings from before names: no `subjectNames` at all.
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    expect(readChildren(kv)!.list.map((c) => c.subjectNames)).toEqual([{}, {}]);
    // A third child, added while the second is on screen with names, starts with none and the shown child's are kept.
    const second = switchChild(kv, SHOWN, 'c2', SITE_C)!;
    addChild(kv, { ...second, lessons: { ...second.lessons, subjectNames: { [ART]: 'ציור' } } }, SITE_C, { siteUrl: SITE_G, classId: '3', className: "ט' - 3" }, ids());
    expect(readChildren(kv)!.list.map((c) => c.subjectNames)).toEqual([{}, { [ART]: 'ציור' }, {}]);
  });

  it('keep the shown child\'s place in the list as the phone has it, names included', () => {
    const kv = memoryKv();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    syncShownChild(kv, named({ [MATH]: 'חשבון' }), SITE_C);
    expect(readChildren(kv)!.list.map((c) => c.subjectNames)).toEqual([{ [MATH]: 'חשבון' }, {}]);
  });

  it('push, for the other children, only the names two children in one class gave alike', () => {
    const list = [
      child('a', SITE_C, '12144', { [MATH]: 'שלי' }),
      child('twin', SITE_C, '12144', { [MATH]: 'שלי' }),
      child('b', SITE_C, '13900', { [MATH]: 'חשבון', [LIT]: 'ספר', [ART]: 'ציור' }),
      child('c', SITE_C, '13900', { [MATH]: 'חשבון', [LIT]: 'ספרות יפה', 'subject:אזרחות': 'אזרח' }),
      // Alone in its class: all its names.
      child('d', SITE_G, '12144', { [LIT]: 'ספר' }),
      // Saved before names: none.
      child('e', SITE_G, '9'),
    ];
    expect(otherFollows({ activeId: 'a', list })).toEqual([
      { siteUrl: SITE_C, classId: '13900', hiddenSubjects: [], subjectNames: { [MATH]: 'חשבון' } },
      { siteUrl: SITE_G, classId: '12144', hiddenSubjects: [], subjectNames: { [LIT]: 'ספר' } },
      { siteUrl: SITE_G, classId: '9', hiddenSubjects: [], subjectNames: {} },
    ]);
    // A twin that gave no names takes the class's away.
    const bare = [child('a', SITE_C, '12144'), child('b', SITE_C, '13900', { [MATH]: 'חשבון' }), child('c', SITE_C, '13900')];
    expect(otherFollows({ activeId: 'a', list: bare })).toEqual([{ siteUrl: SITE_C, classId: '13900', hiddenSubjects: [], subjectNames: {} }]);
  });

  it('say, for the child on screen, the names of the other children in its class', () => {
    const none = { siteUrl: '', classId: '', withoutSite: true };
    const list = [
      child('a', SITE_C, '12144', { [MATH]: 'שלי' }),
      child('twin', SITE_C, '12144', { [MATH]: 'שלי', [LIT]: 'ספר' }),
      child('other', SITE_C, '13900', { [MATH]: 'חשבון' }),
      child('atOtherSchool', SITE_G, '12144', { [MATH]: 'חשבון' }),
      { ...child('without', '', '', { [MATH]: 'חשבון' }), ...none },
      child('bare', SITE_C, '12144'),
    ];
    // The twin's, and a twin saved before names gives none; never the shown child's own, nor another class's.
    expect(sameClassNames({ activeId: 'a', list })).toEqual([{ [MATH]: 'שלי', [LIT]: 'ספר' }, {}]);
    expect(sameClassNames({ activeId: 'other', list })).toEqual([]);
    expect(sameClassNames(null)).toEqual([]);
    // A shown child without a class shares none.
    expect(sameClassNames({ activeId: 'without', list })).toEqual([]);
  });

  it('start a list Mashov builds with no names on its first class, whatever the phone had', () => {
    const kv = memoryKv();
    // A phone with no class yet whose settings still hold names (a class left and names not cleared).
    const phone = settings({ classId: '', className: '', lessons: { hiddenSubjects: ['פיזיקה'], subjectNames: { [MATH]: 'חשבון' } } });
    const plan = {
      link: [], ask: [], unbound: [], full: [], later: [],
      add: [
        { link: { guid: 'g1', semel: '1' }, label: 'נועה', siteUrl: SITE_C, classId: '12144', className: "יא' 4", withoutSite: false, schoolName: '' },
        { link: { guid: 'g2', semel: '1' }, label: 'יואב', siteUrl: SITE_C, classId: '13900', className: "ז' 2", withoutSite: false, schoolName: '' },
      ],
    };
    const saved = applyChildrenPlan(kv, phone, null, plan, ids())!;
    expect(saved.lessons).toEqual({ hiddenSubjects: [], subjectNames: {} });
    // The list starts with the second child; the first is the phone's class on screen.
    expect(readChildren(kv)!.list.map((c) => c.subjectNames)).toEqual([{}, {}]);
  });
});

describe("a parent's name for an only child", () => {
  const NOA = { link: { guid: 'g1', semel: '1' }, label: 'נועה', siteUrl: SITE_C, classId: '12144', className: "יא' 4", withoutSite: false, schoolName: '' };
  const YOAV = { link: { guid: 'g2', semel: '1' }, label: 'יואב', siteUrl: SITE_C, classId: '13900', className: "ז' 2", withoutSite: false, schoolName: '' };
  const nothing = { link: [], ask: [], unbound: [], full: [], later: [] };

  it('is kept trimmed and at most forty long, and no name takes the key away', () => {
    const kv = memoryKv();
    expect(readOnlyChildName(kv)).toBe('');
    setOnlyChildName(kv, '  נועה  ');
    expect(readOnlyChildName(kv)).toBe('נועה');
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBe('נועה');
    setOnlyChildName(kv, 'א'.repeat(41));
    expect(readOnlyChildName(kv)).toBe('א'.repeat(40));
    setOnlyChildName(kv, '   ');
    expect(readOnlyChildName(kv)).toBe('');
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();
  });

  it('names the first child when a second one begins the list, and the key is empty after', () => {
    const kv = memoryKv();
    setOnlyChildName(kv, '  נועה ');
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    expect(readChildren(kv)!.list.map((c) => c.label)).toEqual(['נועה', '']);
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();
    expect(readOnlyChildName(kv)).toBe('');
  });

  it('is written as it is typed, so a second child added before the field is left takes what was typed', () => {
    const kv = memoryKv();
    // What the field writes on each change: the draft as typed, spaces and all.
    for (const draft of ['נ', 'נו', 'נועה', 'נועה ', 'נועה כ']) setOnlyChildName(kv, draft);
    expect(readOnlyChildName(kv)).toBe('נועה כ');
    // A word taken back out is taken out of the key too.
    setOnlyChildName(kv, 'נועה');
    expect(addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids())).toBe('added');
    expect(readChildren(kv)!.list.map((c) => c.label)).toEqual(['נועה', '']);
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();
    // The field's last write, after the list began (it unmounts and writes its draft once more), changes nothing.
    setOnlyChildName(kv, 'נועה');
    expect(readChildren(kv)!.list.map((c) => c.label)).toEqual(['נועה', '']);
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();

    // Typed and then emptied before the second child: the first has none.
    const emptied = memoryKv();
    for (const draft of ['נ', 'נו', '', ' ']) setOnlyChildName(emptied, draft);
    expect(emptied.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();
    addChild(emptied, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    expect(readChildren(emptied)!.list.map((c) => c.label)).toEqual(['', '']);
  });

  it('is dropped when it comes late: with a list the children carry the names', () => {
    const kv = memoryKv();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    setOnlyChildName(kv, 'נועה');
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();
    expect(readChildren(kv)!.list.map((c) => c.label)).toEqual(['', '']);
  });

  it('stays on the key while no child was added: the class is in the list already', () => {
    const kv = memoryKv();
    setOnlyChildName(kv, 'נועה');
    expect(addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '12144', className: "יא' 4" }, ids())).toBe('already');
    expect(readChildren(kv)).toBeNull();
    expect(readOnlyChildName(kv)).toBe('נועה');
  });

  it('starts a phone with no name as it began before: the first child has none', () => {
    const kv = memoryKv();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    expect(readChildren(kv)!.list.map((c) => c.label)).toEqual(['', '']);
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();
  });

  it('moves the label of the last child back to the key when the list goes', () => {
    const kv = memoryKv();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, ids());
    renameChild(kv, 'c1', 'נועה');
    renameChild(kv, 'c2', 'יואב');
    // The shown one goes: the other is on screen and alone, and the list's name is its name.
    removeChild(kv, SHOWN, 'c1', SITE_C);
    expect(readChildren(kv)).toBeNull();
    expect(readOnlyChildName(kv)).toBe('יואב');
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBe('יואב');
  });

  it('keeps the key empty while two children or more are left, and for a last child with no name', () => {
    const kv = memoryKv();
    const next = ids();
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, next);
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_G, classId: '2', className: "ט' - 2" }, next);
    renameChild(kv, 'c2', 'יואב');
    removeChild(kv, SHOWN, 'c3', SITE_C);
    expect(readChildren(kv)!.list).toHaveLength(2);
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();
    // The last child never named: the class's name stands for it, as it did.
    removeChild(kv, SHOWN, 'c2', SITE_C);
    expect(readChildren(kv)).toBeNull();
    expect(kv.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();
  });

  it('comes back to the key as it was given after the list grew and shrank again', () => {
    const kv = memoryKv();
    const next = ids();
    setOnlyChildName(kv, 'נועה');
    addChild(kv, SHOWN, SITE_C, { siteUrl: SITE_C, classId: '13900', className: "ז' 2" }, next);
    renameChild(kv, 'c2', 'יואב');
    removeChild(kv, SHOWN, 'c2', SITE_C);
    expect(readChildren(kv)).toBeNull();
    expect(readOnlyChildName(kv)).toBe('נועה');
  });

  it("is kept by Mashov's rebuild: it fills an empty name only", () => {
    const phone = settings({ classId: '', className: '' });
    const plan = { ...nothing, add: [NOA, YOAV] };
    const named = memoryKv();
    setOnlyChildName(named, 'נועי');
    applyChildrenPlan(named, phone, null, plan, ids());
    expect(readChildren(named)!.list.map((c) => c.label)).toEqual(['נועי', 'יואב']);
    expect(named.getString(ONLY_CHILD_NAME_KEY)).toBeUndefined();

    // With no name of the parent's, Mashov's first name stands, as it did.
    const bare = memoryKv();
    applyChildrenPlan(bare, phone, null, plan, ids());
    expect(readChildren(bare)!.list.map((c) => c.label)).toEqual(['נועה', 'יואב']);
  });

  it("is kept by Mashov's rebuild when a sibling begins the list of the phone's linked child", () => {
    const kid = (guid: string, firstName: string) => ({ guid, firstName, classCode: 'יא', classNum: '4', semel: '1', bound: true });
    const scan: ParentSchools = {
      at: '2026-11-02T08:00:00.000Z', home: '1', back: null,
      schools: [{ semel: '1', name: '', home: true, site: SITE_C, siteKnown: true, switched: null, children: [kid('g1', 'נועה'), kid('g2', 'יואב')], externGuidsSeen: null }],
    };
    const phone = settings({ classId: '12144', className: "יא' 4" });
    const named = memoryKv();
    savePastedSite(named, SITE_C);
    linkChild(named, 'shown', { guid: 'g1', semel: '1' });
    setOnlyChildName(named, 'נועי');
    applyChildrenPlan(named, phone, SITE_C, { ...nothing, add: [YOAV] }, ids(), {}, scan);
    expect(readChildren(named)!.list.map((c) => c.label)).toEqual(['נועי', 'יואב']);

    const bare = memoryKv();
    savePastedSite(bare, SITE_C);
    linkChild(bare, 'shown', { guid: 'g1', semel: '1' });
    applyChildrenPlan(bare, phone, SITE_C, { ...nothing, add: [YOAV] }, ids(), {}, scan);
    expect(readChildren(bare)!.list.map((c) => c.label)).toEqual(['נועה', 'יואב']);
  });
});

describe('children from Mashov', () => {
  const link = (guid: string, semel = '540211') => ({ guid, semel });
  const site = (classId: string, over: Record<string, unknown> = {}) => ({ siteUrl: SITE_C, classId, className: classId, ...over });
  const child = (id: string, over: Record<string, unknown> = {}) => ({ id, label: '', siteUrl: SITE_C, classId: id, className: id, hiddenSubjects: [] as string[], ...over });

  it('keeps two children in one class when Mashov says they are two', () => {
    const kv = memoryKv();
    const next = ids();
    linkChild(kv, 'shown', link('g1'));
    expect(addChild(kv, SHOWN, SITE_C, site('13900', { mashov: link('g2') }), next)).toBe('added');
    // Another child in the shown child's class, by another guid.
    expect(addChild(kv, SHOWN, SITE_C, site('12144', { mashov: link('g3') }), next)).toBe('added');
    // The same guid, or no guid, is the class that is there.
    expect(addChild(kv, SHOWN, SITE_C, site('12144', { mashov: link('g1') }), next)).toBe('already');
    expect(addChild(kv, SHOWN, SITE_C, site('12144'), next)).toBe('already');
    expect(addChild(kv, SHOWN, SITE_C, site('13900', { mashov: link('g2') }), next)).toBe('already');
    expect(readChildren(kv)!.list.map((c) => [c.id, c.mashov?.guid])).toEqual([['c1', 'g1'], ['c2', 'g2'], ['c3', 'g3']]);
  });

  it('never takes two children without a site for one class', () => {
    const kv = memoryKv();
    const next = ids();
    const none = (guid: string) => ({ siteUrl: '', classId: '', className: '', withoutSite: true, mashov: link(guid) });
    expect(addChild(kv, SHOWN, SITE_C, none('g1'), next)).toBe('added');
    expect(addChild(kv, SHOWN, SITE_C, none('g2'), next)).toBe('added');
    expect(readChildren(kv)!.list).toHaveLength(3);
  });

  it('follows no class for a child without a site', () => {
    const list = [child('a'), child('b', { siteUrl: '', classId: '', withoutSite: true }), child('c', { siteUrl: '', classId: '', withoutSite: true }), child('d')];
    expect(otherFollows({ activeId: 'a', list })).toEqual([{ siteUrl: SITE_C, classId: 'd', hiddenSubjects: [], subjectNames: {} }]);
  });

  it('puts "without a site" on screen with the child', () => {
    const kv = memoryKv();
    savePastedSite(kv, SITE_C);
    const next = ids();
    addChild(kv, SHOWN, SITE_C, { siteUrl: '', classId: '', className: '', withoutSite: true }, next);
    const there = switchChild(kv, SHOWN, 'c2', SITE_C)!;
    expect(there).toMatchObject({ classId: '', className: '' });
    expect(isWithoutSite(kv)).toBe(true);
    expect(pastedSite(kv)).toBeNull();
    const back = switchChild(kv, there, 'c1', null)!;
    expect(back.classId).toBe('12144');
    expect(isWithoutSite(kv)).toBe(false);
    expect(pastedSite(kv)).toBe(SITE_C);
    // The first child, made from a phone that was without a site, is that way when it comes back.
    const first = memoryKv();
    setWithoutSite(first, true);
    addChild(first, settings(), '', site('13900'), ids());
    expect(readChildren(first)!.list[0]).toMatchObject({ withoutSite: true });
    switchChild(first, settings(), 'c2', null);
    expect(isWithoutSite(first)).toBe(false);
    switchChild(first, settings(), 'c1', null);
    expect(isWithoutSite(first)).toBe(true);
  });

  it("follows the phone's \"without a site\" for the child on screen, in the list, whichever way it changed", () => {
    // A phone without a site adds a child; the parent then picks a class for the first one in Settings.
    const kv = memoryKv();
    const next = ids();
    setWithoutSite(kv, true);
    addChild(kv, SHOWN, '', site('13900'), next);
    expect(readChildren(kv)!.list[0]!.withoutSite).toBe(true);
    setWithoutSite(kv, false);
    savePastedSite(kv, SITE_C);
    const aside = switchChild(kv, SHOWN, 'c2', SITE_C)!;
    expect(readChildren(kv)!.list[0]!.withoutSite).toBeUndefined();
    switchChild(kv, aside, 'c1', SITE_C);
    expect(isWithoutSite(kv)).toBe(false);
    expect(otherFollows(readChildren(kv)))
      .toEqual([{ siteUrl: SITE_C, classId: '13900', hiddenSubjects: [], subjectNames: {} }]);

    // The other way: a child with a site is set "without a site" in Settings while it is on screen.
    const two = memoryKv();
    const ids2 = ids();
    addChild(two, SHOWN, SITE_C, site('13900'), ids2);
    setWithoutSite(two, true);
    const away = switchChild(two, SHOWN, 'c2', SITE_C)!;
    expect(isWithoutSite(two)).toBe(false);
    expect(readChildren(two)!.list[0]).toMatchObject({ withoutSite: true });
    switchChild(two, away, 'c1', SITE_C);
    expect(isWithoutSite(two)).toBe(true);
    // And a change on screen with no switch is kept by the sync.
    setWithoutSite(two, false);
    syncShownChild(two, SHOWN, SITE_C);
    expect(readChildren(two)!.list[0]!.withoutSite).toBeUndefined();
  });

  it('moves the lone link onto the first child, and keeps it empty while there is a list', () => {
    const kv = memoryKv();
    linkChild(kv, 'shown', link('g1'));
    expect(shownMashovLink(kv)).toEqual(link('g1'));
    expect(kv.getString(ONLY_CHILD_LINK_KEY)).toContain('g1');
    addChild(kv, SHOWN, SITE_C, site('13900', { mashov: link('g2') }), ids());
    expect(kv.getString(ONLY_CHILD_LINK_KEY)).toBeUndefined();
    expect(readChildren(kv)!.list[0]!.mashov).toEqual(link('g1'));
    expect(shownMashovLink(kv)).toEqual(link('g1'));
    switchChild(kv, SHOWN, 'c2', SITE_C);
    expect(shownMashovLink(kv)).toEqual(link('g2'));
    linkChild(kv, 'shown', link('g2', '777'));
    linkChild(kv, 'c1', link('g1', '888'));
    expect(readChildren(kv)!.list.map((c) => c.mashov)).toEqual([link('g1', '888'), link('g2', '777')]);
    expect(kv.getString(ONLY_CHILD_LINK_KEY)).toBeUndefined();
  });

  it('keeps the link of the last child when the list goes', () => {
    const kv = memoryKv();
    linkChild(kv, 'shown', link('g1'));
    addChild(kv, SHOWN, SITE_C, site('13900', { mashov: link('g2') }), ids());
    // The shown one goes: the other is on screen and alone.
    removeChild(kv, SHOWN, 'c1', SITE_C);
    expect(readChildren(kv)).toBeNull();
    expect(shownMashovLink(kv)).toEqual(link('g2'));
  });

  it('remembers a removed child until Mashov is disconnected', () => {
    const kv = memoryKv();
    const next = ids();
    linkChild(kv, 'shown', link('g1'));
    addChild(kv, SHOWN, SITE_C, site('13900', { mashov: link('g2') }), next);
    addChild(kv, SHOWN, SITE_C, site('13901', { mashov: link('g3') }), next);
    removeChild(kv, SHOWN, 'c2', SITE_C);
    removeChild(kv, SHOWN, 'c3', SITE_C);
    expect(dismissedGuids(kv)).toEqual(['g2', 'g3']);
    kv.set(PARENT_KEYS.schools, '{"at":"x"}');
    kv.set(PARENT_KEYS.children, '{"at":"x"}');
    forgetParentLogin(kv);
    expect(dismissedGuids(kv)).toEqual([]);
    expect(kv.getString(DISMISSED_KEY)).toBeFalsy();
    expect(kv.getString(PARENT_KEYS.schools)).toBeFalsy();
    expect(kv.getString(PARENT_KEYS.children)).toBeFalsy();
    expect(shownMashovLink(kv)).toBeNull();
  });
});

/** A `/v2` with a device, answering the other classes' route as `classesStatus` says. */
function fakeServer(classesStatus = 200, feedClass: { siteUrl: string; classId: string } | null = null) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const path = url.replace(/^.*?(\/v2)/, '$1');
    calls.push({ method: init.method ?? 'GET', path, body: typeof init.body === 'string' ? JSON.parse(init.body) : null });
    if (path === '/v2/device/classes') return json(classesStatus, classesStatus === 200 ? { deviceId: 'd1' } : { message: 'Route not found' });
    if (path.startsWith('/v2/class/feed')) {
      const asked = new URL(`https://x${path}`).searchParams;
      const cls = feedClass ?? { siteUrl: asked.get('site')!, classId: asked.get('cls')! };
      return json(200, feedOf(cls.siteUrl, cls.classId, 'כיתה'));
    }
    return json(404, {});
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

function withDevice() {
  const kv = memoryKv();
  kv.set(DEVICE_KEYS.identity, JSON.stringify({ deviceId: 'd1', token: 't1' }));
  return kv;
}

describe("the device's other classes", () => {
  const ONE = [{ siteUrl: SITE_C, classId: '13900', hiddenSubjects: [] }];

  it('are sent when they change, and never by a phone that never had any', async () => {
    const kv = withDevice();
    const server = fakeServer();
    expect(await syncOtherClasses(kv, [], server.fetchImpl)).toBe('none');
    expect(server.calls).toEqual([]);
    expect(await syncOtherClasses(kv, ONE, server.fetchImpl)).toBe('sent');
    expect(await syncOtherClasses(kv, ONE, server.fetchImpl)).toBe('same');
    // Taken back once, then nothing to send.
    expect(await syncOtherClasses(kv, [], server.fetchImpl)).toBe('sent');
    expect(await syncOtherClasses(kv, [], server.fetchImpl)).toBe('same');
    expect(server.calls.map((c) => [c.method, c.path, c.body])).toEqual([
      ['PUT', '/v2/device/classes', { classes: ONE }],
      ['PUT', '/v2/device/classes', { classes: [] }],
    ]);
    // Without a device, nothing.
    expect(await syncOtherClasses(memoryKv(), ONE, server.fetchImpl)).toBe('none');
  });

  it('are sent again when only a name changed, and not when nothing did', async () => {
    const kv = withDevice();
    const server = fakeServer();
    const named = (name: string) => [{ ...ONE[0]!, subjectNames: { 'subject:מתמטיקה': name } }];
    expect(await syncOtherClasses(kv, named('חשבון'), server.fetchImpl)).toBe('sent');
    expect(await syncOtherClasses(kv, named('חשבון'), server.fetchImpl)).toBe('same');
    expect(await syncOtherClasses(kv, named('אלגברה'), server.fetchImpl)).toBe('sent');
    // A name taken back is a change too: the follow is sent with none.
    expect(await syncOtherClasses(kv, [{ ...ONE[0]!, subjectNames: {} }], server.fetchImpl)).toBe('sent');
    expect(server.calls.map((c) => (c.body as { classes: { subjectNames: unknown }[] }).classes[0]!.subjectNames)).toEqual([
      { 'subject:מתמטיקה': 'חשבון' }, { 'subject:מתמטיקה': 'אלגברה' }, {},
    ]);
  });

  it("are noted as not followed by a server from before stage 2, until one follows them", async () => {
    const kv = withDevice();
    expect(await syncOtherClasses(kv, ONE, fakeServer(404).fetchImpl)).toBe('unsupported');
    expect(otherClassesUnsupported(kv)).toBe(true);
    // Still not sent: the next refresh asks again.
    expect(await syncOtherClasses(kv, ONE, fakeServer().fetchImpl)).toBe('sent');
    expect(otherClassesUnsupported(kv)).toBe(false);
    await expect(syncOtherClasses(kv, [], fakeServer(500).fetchImpl)).rejects.toThrow();
  });

  it("read each one's feed, and take no feed of another class for it", async () => {
    const kv = withDevice();
    const feed = await readFeedOf(kv, SITE_C, '13900', fakeServer().fetchImpl);
    expect(feed?.class.classId).toBe('13900');
    expect(fakeServer().calls).toEqual([]);
    // A server from before stage 2 answers with the device's own class.
    expect(await readFeedOf(kv, SITE_C, '13900', fakeServer(200, { siteUrl: SITE_C, classId: '12144' }).fetchImpl)).toBeNull();
  });
});

// ---- what a parent's phone says in the morning and the evening ----

const DATE = '2026-11-02';

const lessonOf = (hourIndex: number, startTime: string, endTime: string, status: Lesson['status'] = 'regular'): Lesson => ({
  date: DATE, hourIndex, startTime, endTime, subject: 'מתמטיקה', teacher: null, room: null, status, substitute: null, note: null, source: 'shahaf', changeSeenAt: null,
});

function dayOf(lessons: Lesson[], exams: DayView['examsToday'] = []): DayView {
  const day = buildDayView({ date: DATE, zone: ZONE, now: new Date('2026-11-02T05:00:00Z'), lessons, events: [], tasks: [], exams: [], schoolEvents: [], vacationMode: false });
  return { ...day, examsToday: exams };
}

describe("a parent's morning, of every child", () => {
  const noa = dayOf([lessonOf(1, '08:00', '08:45'), lessonOf(2, '08:50', '12:20')]);
  const yoav = dayOf([lessonOf(1, '08:00', '08:45'), lessonOf(2, '08:50', '13:10'), lessonOf(3, '13:15', '14:00', 'cancelled')]);
  const part = (label: string, day: DayView) => ({ label, day, push: composeMorningSummary(day, { audience: 'parent' }) });

  it('ends each in the title, and has a line for each', () => {
    const push = childrenMorningSummary([part('נועה', noa), part('יואב', yoav)])!;
    expect(push.title).toBe('מסיימים היום: נועה ב־12:20, יואב ב־13:10');
    expect(push.body.split('\n')).toEqual(['נועה: 08:00–12:20', 'יואב: 08:00–13:10, שיעור אחד בוטל']);
    expect(push.payload).toMatchObject({ type: 'morning_summary', deepLink: 'today', date: DATE });
    expect(`${push.title}\n${push.body}`).not.toMatch(/·| — /);
  });

  it('says a day with no lesson left, and an exam', () => {
    const none = dayOf([lessonOf(1, '08:00', '08:45', 'cancelled')]);
    const exam = { naturalKey: 'e1', date: DATE, subject: 'מבחן במתמטיקה', details: null, source: 'shahaf' } as unknown as DayView['examsToday'][number];
    const push = childrenMorningSummary([part('נועה', dayOf(noa.timeline.flatMap((i) => (i.kind === 'lesson' ? [i.lesson] : [])), [exam])), part('יואב', none)])!;
    expect(push.title).toBe('מסיימים היום: נועה ב־12:20, יואב בלי שיעורים');
    expect(push.body.split('\n')).toEqual(['נועה: 08:00–12:20, מבחן היום: מתמטיקה', 'יואב: אין שיעורים, שיעור אחד בוטל']);
  });

  it("is the one child's own, after the name, when only one has school", () => {
    const only = part('יואב', yoav);
    expect(childrenMorningSummary([only])).toEqual({ ...only.push, title: `יואב: ${only.push.title}` });
    expect(childrenMorningSummary([])).toBeNull();
  });

  it('says when the first and the last end with more than three, and has a line for each', () => {
    const maya = dayOf([lessonOf(1, '08:00', '08:45'), lessonOf(2, '08:50', '14:00')]);
    const none = dayOf([lessonOf(1, '08:00', '08:45', 'cancelled')]);
    const push = childrenMorningSummary([part('נועה', noa), part('יואב', yoav), part('מאיה', maya), part('איתי', none)])!;
    expect(push.title).toBe('מסיימים היום בין 12:20 ל־14:00');
    expect(push.body.split('\n')).toEqual([
      'נועה: 08:00–12:20',
      'יואב: 08:00–13:10, שיעור אחד בוטל',
      'מאיה: 08:00–14:00',
      'איתי: אין שיעורים, שיעור אחד בוטל',
    ]);
    expect(`${push.title}\n${push.body}`).not.toMatch(/·| — /);
  });

  it('says one end, or no lessons, when it is so for every child', () => {
    const six = ['נועה', 'יואב', 'מאיה', 'איתי', 'שירה', 'אורי'];
    expect(six).toHaveLength(MAX_FOLLOWED_CLASSES);
    const same = childrenMorningSummary(six.map((label) => part(label, noa)))!;
    expect(same.title).toBe('מסיימים היום ב־12:20');
    expect(same.body.split('\n')).toEqual(six.map((label) => `${label}: 08:00–12:20`));
    const none = dayOf([lessonOf(1, '08:00', '08:45', 'cancelled')]);
    expect(childrenMorningSummary(six.map((label) => part(label, none)))!.title).toBe('היום אין שיעורים');
  });
});

describe("a parent's evening, of every child", () => {
  const push = (title: string, body = '') => ({ title, body, payload: { type: 'evening_homework' as const, deepLink: 'today' as const, date: '2026-11-03', refreshWidget: true as const } });

  it("has each child's reminder on a line, under their names", () => {
    const evening = childrenEveningReminder([{ label: 'נועה', push: push('מחר מבחן במתמטיקה', 'מבחן במתמטיקה') }, { label: 'יואב', push: push('מחר לתיק: מחשבון') }])!;
    expect(evening.title).toBe('תזכורת ערב: נועה, יואב');
    expect(evening.body.split('\n')).toEqual(['נועה: מחר מבחן במתמטיקה', 'יואב: מחר לתיק: מחשבון']);
    expect(evening.payload.date).toBe('2026-11-03');
  });

  it("is the one child's own, after the name, when only one has something", () => {
    expect(childrenEveningReminder([{ label: 'נועה', push: push('מחר מבחן במתמטיקה', 'מבחן במתמטיקה') }])).toMatchObject({
      title: 'נועה: מחר מבחן במתמטיקה', body: 'מבחן במתמטיקה',
    });
    expect(childrenEveningReminder([])).toBeNull();
  });

  it('counts them in the title with more than three, and has a line for each', () => {
    const four = [['נועה', 'מחר מבחן במתמטיקה'], ['יואב', 'מחר לתיק: מחשבון'], ['מאיה', 'מחר לתיק: בגדי ספורט'], ['איתי', 'מחר מבחן באנגלית']];
    const evening = childrenEveningReminder(four.map(([label, title]) => ({ label: label!, push: push(title!) })))!;
    expect(evening.title).toBe('תזכורת ערב ל־4 ילדים');
    expect(evening.body.split('\n')).toEqual(four.map(([label, title]) => `${label}: ${title}`));
    expect(`${evening.title}\n${evening.body}`).not.toMatch(/·| — /);
  });
});

describe("what a parent's phone schedules", () => {
  // Wednesday 7.10.2026, mid-morning: Thursday's summary and this evening's reminder are ahead.
  const at = (date: string, time: string) => DateTime.fromISO(`${date}T${time}`, { zone: ZONE }).toJSDate();
  const NOW = at('2026-10-07', '10:00');
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  afterAll(() => vi.useRealTimers());
  const plain = (text: string) => text.replace(/[⁠⁦-⁩]/g, '');
  const lesson = (date: string, hourIndex: number, startTime: string, endTime: string, subject: string): ClassLesson => ({
    date, hourIndex, startTime, endTime, subject, teacher: null, room: null, status: 'regular', substitute: null, note: null,
  });

  const sourcesOf = (feed: ClassFeed, over: { settings?: Partial<UserSettings>; pack?: Record<string, string> } = {}) => ({
    feed, mashov: [], bagrut: [], google: [], settings: settings({ classId: feed.class.classId, className: feed.class.className, ...over.settings }),
    pack: over.pack, zone: ZONE, now: NOW,
  });
  const noa = sourcesOf(feedOf(SITE_C, '12144', "יא' 4", [lesson('2026-10-08', 1, '08:00', '08:45', 'אנגלית'), lesson('2026-10-08', 2, '08:45', '12:20', 'היסטוריה')], NOW.toISOString()));
  const yoav = sourcesOf(feedOf(SITE_C, '13900', "ז' 2", [lesson('2026-10-08', 1, '08:00', '13:10', 'ספורט')], NOW.toISOString()), { pack: { [packKey('ספורט')]: 'בגדי ספורט' } });

  it('speaks of every child, in the list\'s order, whichever is on screen', () => {
    const children = [{ label: 'נועה', src: noa }, { label: 'יואב', src: yoav }];
    const plan = planLocalSummaries(noa, NOW, ZONE, children);
    const morning = plan.find((a) => a.identifier === summaryId('morning', '2026-10-08'))!;
    expect(plain(morning.note!.title)).toBe('מסיימים היום: נועה ב־12:20, יואב ב־13:10');
    expect(plain(morning.note!.body).split('\n')).toEqual(['נועה: 08:00–12:20', 'יואב: 08:00–13:10']);
    // Only יואב has something for tomorrow: the bag.
    const evening = plan.find((a) => a.identifier === summaryId('evening', '2026-10-07'))!;
    expect(plain(evening.note!.title)).toBe('יואב: מחר לתיק: בגדי ספורט');

    // The same from the other child's screen.
    const fromYoav = planLocalSummaries(yoav, NOW, ZONE, children);
    expect(fromYoav.find((a) => a.identifier === summaryId('morning', '2026-10-08'))!.note!.title).toBe(morning.note!.title);
  });

  it('is the one child\'s, as in stage 1, with fewer than two', () => {
    const plan = planLocalSummaries(noa, NOW, ZONE, [{ label: 'נועה', src: noa }]);
    expect(plain(plan.find((a) => a.identifier === summaryId('morning', '2026-10-08'))!.note!.title)).toBe('היום מסיימים ב־12:20');
  });
});
