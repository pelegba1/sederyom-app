/**
 * The September checkpoint, as a test.
 *
 * Every assertion here runs against HTML captured from dugma.shahaf.site on
 * 2026-09-01 — the first real school day, and the first time the parser met
 * data that was not a summer placeholder or something I invented. It found
 * three bugs; these fixtures are what stops them coming back.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChanges, parseChangeCellText, parseDatedList, parseFreshness, parseMessages, parseTimetable } from '../src/adapters/shahaf/parser.js';

const DIR = join(import.meta.dirname, '..', 'fixtures', 'shahaf', 'live-2026-09-01');
const html = (name: string) => readFileSync(join(DIR, `${name}.html`), 'utf8');
const ZONE = 'Asia/Jerusalem';

const week0 = parseTimetable(html('changestable-w0'), '2026-08-30', { zone: ZONE });
const lessonsOn = (date: string) => week0.lessons.filter((l) => l.date === date).sort((a, b) => a.hourIndex - b.hourIndex);

describe('live timetable', () => {
  it('parses the whole published week', () => {
    expect(week0.days).toEqual(['2026-08-30', '2026-08-31', '2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']);
    // 21 cells hold one lesson; 8 more hold two parallel groups.
    expect(week0.lessons.length).toBe(29);
    expect(week0.freshness?.toISOString()).toBe('2026-09-01T13:42:00.000Z');
  });

  /**
   * Bug 4, found by the student rather than the fixtures: a cell that stacks
   * two groups of one period kept only the first, so whichever group the site
   * printed second — physics, a network-services group — vanished from the day.
   */
  it('keeps every parallel group a cell stacks', () => {
    const bySlot = new Map<string, typeof week0.lessons>();
    for (const l of week0.lessons) {
      const key = `${l.date}|${l.hourIndex}`;
      bySlot.set(key, [...(bySlot.get(key) ?? []), l]);
    }
    // The ninth slot with two entries is 02.09 hour 4 — a cancellation and a
    // moved lesson, both change-only — so count the regular pairs.
    const stacked = [...bySlot.values()].filter((ls) => ls.length > 1 && ls.every((l) => l.status === 'regular'));
    expect(stacked).toHaveLength(8);
    for (const ls of stacked) expect(new Set(ls.map((l) => l.teacher)).size).toBe(ls.length);

    // Real markup: <div class="TTLesson"><b>היסטוריה</b>&nbsp;&nbsp;(יא1)<br/>הלפרין שרית</div>
    //              <div class="TTLesson"><b>היסטוריה</b><br/>כרמל עליזה</div>
    const history = stacked.find((ls) => ls.some((l) => l.teacher === 'כרמל עליזה'))!;
    expect(history.map((l) => `${l.subject} / ${l.teacher}`).sort()).toEqual([
      'היסטוריה (יא1) / הלפרין שרית',
      'היסטוריה / כרמל עליזה',
    ]);
  });

  it('reads subject, teacher and both clock times from a normal cell', () => {
    // Real markup: <div class="TTLesson"><b>אנגלית 5 יח"ל</b><br/>נקש ירדנה</div>
    expect(lessonsOn('2026-09-01')[0]).toMatchObject({
      hourIndex: 1,
      startTime: '08:00',
      endTime: '08:45',
      subject: 'אנגלית 5 יח"ל',
      teacher: 'נקש ירדנה',
      status: 'regular',
    });
  });

  it('agrees with the bell schedule Mashov publishes', () => {
    // Cross-source check: the grid's own hour labels against /api/bells.
    const bells = JSON.parse(readFileSync(join(DIR, '..', '..', 'mashov', 'bells.json'), 'utf8')) as
      { lessonNumber: number; startTime: string; endTime: string }[];
    for (const lesson of week0.lessons) {
      const bell = bells.find((b) => b.lessonNumber === lesson.hourIndex);
      if (!bell) continue;
      expect([lesson.hourIndex, lesson.startTime, lesson.endTime])
        .toEqual([lesson.hourIndex, bell.startTime.slice(0, 5), bell.endTime.slice(0, 5)]);
    }
  });

  /**
   * Bug 1. A cancelled lesson's cell holds *only* the change div — no
   * `.TTLesson` — so the entire sentence became the subject and the UI would
   * have shown a lesson called "ביטול אנגלית 5 יח״ל, נקש ירדנה".
   */
  it('keeps a cancelled lesson identifiable', () => {
    const cancelled = lessonsOn('2026-09-02').filter((l) => l.status === 'cancelled');
    expect(cancelled.map((l) => [l.hourIndex, l.subject, l.teacher])).toEqual([
      [1, 'אנגלית 5 יח"ל', 'נקש ירדנה'],
      [4, 'אנגלית 5 יח"ל', 'נקש ירדנה'],
    ]);
    for (const l of cancelled) expect(l.subject).not.toContain('ביטול');
  });

  /**
   * Bug 2. The school paints a *moved* lesson with TableFillChange — the same
   * lime class as a substitute teacher — so reading the class alone reported
   * "מ״מ" for a lesson that had merely changed hour.
   */
  it('calls a moved lesson moved, not a substitution', () => {
    const moved = lessonsOn('2026-09-02').filter((l) => l.status === 'moved');
    expect(moved.map((l) => l.hourIndex)).toEqual([4, 7]);
    for (const l of moved) {
      expect(l.subject).toBe('כישורי חיים');
      expect(l.teacher).toBe('שחם בועז');
      expect(l.substitute).toBeNull();
    }
    // Where it went is worth saying in the slot it left, and redundant in the
    // slot it landed in.
    expect(moved.find((l) => l.hourIndex === 7)!.note).toBe('הועבר לשעה 4');
    expect(moved.find((l) => l.hourIndex === 4)!.note).toBeNull();
  });

  it('leaves untouched days entirely regular', () => {
    expect(lessonsOn('2026-09-03').every((l) => l.status === 'regular')).toBe(true);
  });

  it('parses next week too, from the same markup', () => {
    const week1 = parseTimetable(html('changestable-w1'), '2026-09-06', { zone: ZONE });
    expect(week1.lessons.length).toBe(42);
    expect(week1.days[0]).toBe('2026-09-06');
  });
});

describe('change-cell text', () => {
  it('splits the shapes the school actually writes', () => {
    expect(parseChangeCellText('ביטול אנגלית 5 יח"ל, נקש ירדנה', 'TTChange TableFreeChange'))
      .toEqual({ kind: 'cancelled', subject: 'אנגלית 5 יח"ל', teacher: 'נקש ירדנה', targetHour: null });

    expect(parseChangeCellText('הזזת כישורי חיים, שחם בועז לשעה 4', 'TTChange TableFillChange'))
      .toEqual({ kind: 'moved', subject: 'כישורי חיים', teacher: 'שחם בועז', targetHour: 4 });
  });

  it('falls back to the colour when no verb is written', () => {
    expect(parseChangeCellText('משהו לא צפוי', 'TTChange TableRemoteChange').kind).toBe('remote');
    expect(parseChangeCellText('משהו לא צפוי', '').kind).toBe('other');
  });
});

/**
 * Bug 3. The changes tab is a flat `li.ChangesInfo` list with no date heading.
 * The parser looked for `.ChangesDate` and walked its siblings, so it returned
 * nothing at all — on a tab that was not empty.
 */
describe('live changes tab', () => {
  const changes = parseChanges(html('changes'), { zone: ZONE, year: 2026 });

  it('finds every published change', () => {
    expect(changes.length).toBe(3);
  });

  it('reads the date, the period and the kind out of one comma-separated line', () => {
    expect(changes.map((c) => [c.date, c.hourIndex, c.kind])).toEqual([
      ['2026-09-02', 1, 'cancelled'],
      ['2026-09-02', 4, 'cancelled'],
      ['2026-09-02', 7, 'moved'],
    ]);
  });

  it('takes the slot from the first period mentioned, not from "לשיעור 4"', () => {
    expect(changes[2]!.hourIndex).toBe(7);
    expect(changes[2]!.text).toContain('לשיעור 4');
  });

  it('gives each change a key stable across polls', () => {
    const again = parseChanges(html('changes'), { zone: ZONE, year: 2026 });
    expect(again.map((c) => c.naturalKey)).toEqual(changes.map((c) => c.naturalKey));
    expect(new Set(changes.map((c) => c.naturalKey)).size).toBe(3);
  });
});

describe('live list tabs that are genuinely empty', () => {
  it('reports nothing for exams, events and messages', () => {
    // These really were empty on 2026-09-01 — verified against the EmptyList
    // marker, not merely inferred from a parser returning zero.
    for (const tab of ['exams', 'events'] as const) {
      expect(html(tab)).toContain('EmptyList');
      expect(parseDatedList(html(tab), tab, { zone: ZONE, year: 2026 })).toEqual([]);
    }
    expect(html('messages')).toContain('EmptyList');
    expect(parseMessages(html('messages'), { zone: ZONE, year: 2026 })).toEqual([]);
  });

  it('still reports the page freshness', () => {
    expect(parseFreshness(html('exams'), ZONE)?.toISOString()).toBe('2026-09-01T13:42:00.000Z');
  });
});
