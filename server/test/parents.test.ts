/**
 * Parents mode, stage 1 (docs/parents-plan.md): a parent follows the child's
 * class without Mashov. The setting, the School tab, the morning title and
 * the invite that brings a parent in; the onboarding steps and the tabs' names
 * are in app/test/onboarding.test.cjs.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { DayView, Lesson } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { buildDayView } from '@sederyom/shared/logic/build';
import { mergeSettings } from '@sederyom/shared/logic/options';
import { composeMorningSummary, planMorningSummary } from '@sederyom/shared/logic/summaries';
import { inviteUrl, joinOf, lessonToken, linkLessons, parentInviteMessage } from '../../app/src/lib/invite';
import { schoolTabsFor } from '../../app/src/lib/school';

const ZONE = 'Asia/Jerusalem';
const DATE = '2026-11-02';

describe('the setting', () => {
  it('is a student\'s on a phone set up before it existed', () => {
    expect(mergeSettings({ classId: '7', className: 'יב2' }).audience).toBe('student');
    expect(mergeSettings({ audience: 'parent' }).audience).toBe('parent');
  });
});

describe('the School tab', () => {
  it('keeps only the site\'s exams and messages for a parent', () => {
    expect(schoolTabsFor({ bagrut: true, audience: 'parent' }).map((t) => t.key)).toEqual(['exams', 'messages']);
    expect(schoolTabsFor({ bagrut: false }).map((t) => t.key)).toEqual(['exams', 'homework', 'grades', 'messages', 'attendance']);
    expect(schoolTabsFor({ bagrut: true }).map((t) => t.key)).toContain('bagrut');
  });
});

const lesson = (hourIndex: number, startTime: string, endTime: string, status: Lesson['status'] = 'regular'): Lesson => ({
  date: DATE, hourIndex, startTime, endTime, subject: 'מתמטיקה', teacher: null, room: null, status, substitute: null,
  note: null, source: 'shahaf', changeSeenAt: null,
});

function day(lessons: Lesson[]): DayView {
  return buildDayView({
    date: DATE, zone: ZONE, now: new Date('2026-11-02T05:00:00Z'), lessons, events: [], tasks: [], exams: [], schoolEvents: [], vacationMode: false,
  });
}

describe('a parent\'s morning summary', () => {
  it('is titled with the hour school ends, every day', () => {
    const push = composeMorningSummary(day([lesson(1, '08:00', '08:45'), lesson(2, '08:50', '12:20')]), { audience: 'parent' });
    expect(push.title).toBe('היום מסיימים ב־12:20');
    // The body's first line carries the whole span.
    expect(push.body.split('\n')[0]).toMatch(/^08:00–12:20/);
  });

  it('counts what was cancelled after it, and is the student\'s title without times', () => {
    const cancelled = composeMorningSummary(day([lesson(1, '08:00', '08:45'), lesson(2, '08:50', '09:35', 'cancelled'), lesson(3, '09:45', '10:30', 'cancelled')]), { audience: 'parent' });
    expect(cancelled.title).toBe('היום מסיימים ב־08:45 · 2 בוטלו');
    const timeless = day([{ ...lesson(1, '', ''), startTime: null, endTime: null }]);
    expect(composeMorningSummary(timeless, { audience: 'parent' }).title).toBe(composeMorningSummary(timeless).title);
  });

  it('follows the phone\'s setting', () => {
    const lessons = day([lesson(1, '08:00', '13:10')]);
    expect(planMorningSummary(lessons, { ...DEFAULT_SETTINGS, audience: 'parent' }, ZONE)!.title).toBe('היום מסיימים ב־13:10');
    expect(planMorningSummary(lessons, DEFAULT_SETTINGS, ZONE)!.title).toBe('08:00–13:10 · שיעור אחד');
  });
});

describe('the invite to a parent', () => {
  it('carries p=1, read back from the link and from the store\'s referrer', () => {
    const url = inviteUrl('https://api.example', 'https://school-a.shahaf.site', '36', true);
    expect(url).toBe('https://api.example/join?s=school-a&c=36&p=1');
    expect(joinOf(url)).toEqual({ siteUrl: 'https://school-a.shahaf.site', classId: '36', parent: true });
    expect(joinOf('s=school-a&c=36&p=1')?.parent).toBe(true);
    expect(joinOf('sederyom://join?s=school-a&c=36')?.parent).toBeUndefined();
  });

  it('says what a parent gets, with the copy rules: a student\'s own timetable, or a parent\'s child\'s class', () => {
    const url = 'https://api.example/join?s=school-a&c=36&p=1';
    const student = parentInviteMessage(url);
    const parent = parentInviteMessage(url, 'י״א 2');
    for (const text of [student, parent]) {
      // A parent can connect Mashov too (stage 3): the invite no longer says it works without it.
      expect(text).not.toContain('משוב');
      expect(text.endsWith(`\n${url}`)).toBe(true);
      expect(text).not.toMatch(/·| — /);
    }
    expect(student).toContain('המערכת שלי');
    expect(student).not.toMatch(/כיתה/);
    expect(parent).toContain('י״א 2');
  });

  it('is passed on by the page, to the app and through the store', () => {
    const html = readFileSync(join(__dirname, '..', '..', 'public', 'join.html'), 'utf8');
    expect(html).toContain("params.get('p') === '1'");
    expect(html).toContain("(parent ? '&p=1' : '')");
    // The child's lessons, as codes, go on with the parent's link only.
    expect(html).toContain("params.get('h')");
    expect(html).toContain("(parent && lessons ? '&h=' + lessons : '')");
  });
});

describe('the child\'s lessons in the invite to a parent', () => {
  const HIDDEN = ['אנגלית@דן', 'מגמת ביולוגיה@לוי'];

  it('carries a short code for each hidden line, and no subject or teacher name', () => {
    const url = inviteUrl('https://api.example', 'https://school-a.shahaf.site', '36', true, HIDDEN)!;
    const h = new URL(url).searchParams.get('h')!;
    expect(h.split('.')).toEqual(HIDDEN.map(lessonToken));
    expect(url).not.toMatch(/[֐-׿]|%D7/i);
    expect(joinOf(url)).toEqual({ siteUrl: 'https://school-a.shahaf.site', classId: '36', parent: true, lessons: HIDDEN.map(lessonToken) });
    // The same code on both phones, for the same line.
    expect(lessonToken('אנגלית@דן')).toBe(lessonToken('אנגלית@דן'));
    expect(lessonToken('אנגלית@דן')).not.toBe(lessonToken('אנגלית@רון'));
    expect(lessonToken('אנגלית@דן')).toMatch(/^[0-9a-z]{1,7}$/);
  });

  it('never rides a student\'s invite to classmates, nor an empty list', () => {
    expect(inviteUrl('https://api.example', 'https://school-a.shahaf.site', '36', false, HIDDEN)).toBe('https://api.example/join?s=school-a&c=36');
    expect(inviteUrl('https://api.example', 'https://school-a.shahaf.site', '36', true, [])).toBe('https://api.example/join?s=school-a&c=36&p=1');
    expect(joinOf('s=school-a&c=36&h=abc')?.lessons).toBeUndefined();
  });

  it('is read leniently: a bad or cut code list drops the codes, never the class', () => {
    expect(joinOf('s=school-a&c=36&p=1&h=%%%')).toEqual({ siteUrl: 'https://school-a.shahaf.site', classId: '36', parent: true });
    expect(joinOf('s=school-a&c=36&p=1&h=abc.TOOLONGCODE.de')?.lessons).toEqual(['abc', 'de']);
    const many = Array.from({ length: 60 }, (_, i) => i.toString(36)).join('.');
    expect(joinOf(`s=school-a&c=36&p=1&h=${many}`)?.lessons).toHaveLength(40);
  });

  it('names the class\'s own lines on the parent\'s phone, each once', () => {
    const keys = ['מתמטיקה', 'אנגלית@רון', 'אנגלית@דן', 'מגמת ביולוגיה@לוי', 'אנגלית@דן'];
    expect(linkLessons(HIDDEN.map(lessonToken), keys)).toEqual(['אנגלית@דן', 'מגמת ביולוגיה@לוי']);
    expect(linkLessons(['zzzz'], keys)).toEqual([]);
  });
});
