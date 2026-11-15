/**
 * The markup of 4.11.2026, as a test.
 *
 * That afternoon the grid stopped printing a `<br/>` between a lesson's group
 * and its teacher: `<b>אזרחות</b>&nbsp;&nbsp;(יב2)נחמיאס משה`. Read as one line,
 * every lesson became "אזרחות (יב2)נחמיאס משה" with no teacher — a new natural
 * key for each, so the next poll told the class that every lesson of today and
 * tomorrow "ירד מהמערכת", and "חינוך גופני…" matched the Mashov group "חינוך".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { parseTimetable, type ParsedLesson } from '../src/adapters/shahaf/parser.js';
import { lessonNaturalKey } from '../src/adapters/shahaf/index.js';
import type { NormalizedEntity, Scope } from '../src/adapters/types.js';
import { applyDelta, MemorySnapshotStore, type ChangeEventDraft } from '../src/sync/delta.js';
import { planNotifications } from '../src/notify/engine.js';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'shahaf', 'live-2026-11-04');
const ZONE = 'Asia/Jerusalem';
const page = readFileSync(join(DIR, 'changestable-w0.html'), 'utf8');
const week = parseTimetable(page, '2026-11-01', { zone: ZONE });

describe('lesson cells without the <br/> before the teacher', () => {
  it('reads the teacher apart from the subject and its group', () => {
    const math = week.lessons.find((l) => l.date === '2026-11-04' && l.hourIndex === 1);
    expect(math).toMatchObject({ subject: 'מתמטיקה 5 יח"ל (יב2)', teacher: 'פרץ נורית' });
    for (const l of week.lessons) expect(l.teacher, l.subject).not.toBeNull();
  });

  it('reads a teacher printed straight after the subject, with no group', () => {
    // Real markup: <div class="TTLesson"><b>חינוך גופני</b>ברגמן עומר</div>
    const pe = week.lessons.filter((l) => l.subject === 'חינוך גופני').map((l) => l.teacher);
    expect(new Set(pe)).toEqual(new Set(['ברגמן עומר', 'אדלר לימור']));
  });

  it('keys every lesson as the markup with the <br/> did', () => {
    // The same page as it was printed until that afternoon.
    const before = page.replace(/(<div class="TTLesson"><b>[^<]*<\/b>(?:&nbsp;&nbsp;\([^)]*\))?)([^<]+<\/div>)/g, '$1<br/>$2');
    expect(before).not.toBe(page);
    const old = parseTimetable(before, '2026-11-01', { zone: ZONE });
    expect(week.lessons.map(lessonNaturalKey)).toEqual(old.lessons.map(lessonNaturalKey));
  });
});

describe('the polls around the change', () => {
  const entities = (lessons: ParsedLesson[]): NormalizedEntity[] =>
    lessons.map((l) => ({ source: 'shahaf', kind: 'lesson', naturalKey: lessonNaturalKey(l), partition: l.date, payload: l }));
  // What the parser made of the page before this fix: one line, no teacher.
  const glued = week.lessons.map((l) => ({ ...l, subject: `${l.subject}${l.teacher ?? ''}`, teacher: null }));
  const scopes: Scope[] = week.days.map((date) => ({ kind: 'lesson', partition: date }));
  const ctx = { settings: DEFAULT_SETTINGS, today: '2026-11-04', tomorrow: '2026-11-05', nowTime: '16:45' };
  const plan = (events: ChangeEventDraft[], from: number) =>
    planNotifications(events.map((e, i) => ({ ...e, id: from + i })), ctx).planned;

  it('says nothing when the teacher is glued on, nor when it is read apart again', async () => {
    const store = new MemorySnapshotStore();
    const now = new Date('2026-11-04T14:45:00Z');
    await applyDelta(store, 'shahaf', entities(week.lessons), scopes, now);

    const broke = await applyDelta(store, 'shahaf', entities(glued), scopes, now);
    // Without the engine's pairing this was the 16:45 push: "11 שינויים במערכת של היום", all "ירד מהמערכת".
    expect(broke.deleted).toBe(week.lessons.length);
    expect(plan(broke.events, 1000)).toEqual([]);

    const fixed = await applyDelta(store, 'shahaf', entities(week.lessons), scopes, now);
    expect(fixed.deleted).toBeGreaterThan(0);
    expect(plan(fixed.events, 2000)).toEqual([]);
  });
});
