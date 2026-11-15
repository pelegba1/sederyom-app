/**
 * The change written as an arrow, read from two real sites on 2026-11-04.
 *
 * - School B, `נקש מלכה <- פרנקו יונתן חדר אמנות מלכה`: the changes tab says
 *   "נקש מלכה, מילוי מקום פרנקו יונתן, חדר: חדר אמנות מלכה". The site drops
 *   the group's `.TTLesson` and prints the change *before* the groups left.
 * - Dugma, `אשכול יהודית -> חדר: מעבדת מחשבים 4`: the changes tab says
 *   "החלפת חדר לקבוצה אשכול יהודית". A new room, nobody else teaching.
 *
 * Read as `<verb> <subject>, <teacher>`, both became a lesson named after the
 * whole sentence, marked מ״מ.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArrowChange, parseTimetable, type ParsedLesson } from '../src/adapters/shahaf/parser.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'shahaf');
const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
const SUNDAY = '2026-11-01';
const THURSDAY = '2026-11-05';

const at = (lessons: ParsedLesson[], hour: number) =>
  lessons
    .filter((l) => l.date === THURSDAY && l.hourIndex === hour)
    .map((l) => ({ subject: l.subject, teacher: l.teacher, status: l.status, substitute: l.substitute, room: l.room }))
    .sort((a, b) => (a.teacher ?? '').localeCompare(b.teacher ?? ''));

const regularOf = (name: string) => parseTimetable(fixture(name), SUNDAY).lessons;

describe('parseArrowChange', () => {
  it('reads the absent teacher, the substitute and the room', () => {
    expect(parseArrowChange('נקש מלכה <- פרנקו יונתן חדר אמנות מלכה')).toEqual({
      teacher: 'נקש מלכה', substitute: 'פרנקו יונתן', room: 'חדר אמנות מלכה',
    });
    expect(parseArrowChange('נקש מלכה <- פרנקו יונתן ז5')).toEqual({
      teacher: 'נקש מלכה', substitute: 'פרנקו יונתן', room: 'ז5',
    });
  });

  it('uses the room it already knows to split the name from it', () => {
    expect(parseArrowChange("חסון ג'ומאנה <- פרנקו יונתן אולם ג'ומאנה החדש", "אולם ג'ומאנה החדש")).toEqual({
      teacher: "חסון ג'ומאנה", substitute: 'פרנקו יונתן', room: "אולם ג'ומאנה החדש",
    });
  });

  it('reads a new room with nobody else teaching', () => {
    expect(parseArrowChange('אשכול יהודית -> חדר: מעבדת מחשבים 4')).toEqual({
      teacher: 'אשכול יהודית', substitute: null, room: 'מעבדת מחשבים 4',
    });
  });

  it('leaves every other change text alone', () => {
    expect(parseArrowChange('ביטול מתמטיקה 4 יח"ל, צדוק עדן')).toBeNull();
    expect(parseArrowChange('מ״מ: כהן')).toBeNull();
  });
});

describe('School B ז-1, Thursday 5.11: one art group, then both, with a substitute', () => {
  const lessons = parseTimetable(fixture('school-b-2026-11-04/changestable-cls1.html'), SUNDAY, {
    regular: regularOf('school-b-2026-11-04/timetable-cls1.html'),
  }).lessons;

  it("period 2: ג'ומאנה teaches; מלכה's group has יונתן", () => {
    expect(at(lessons, 2)).toEqual([
      { subject: "אמנות (חדר אמנות ג'ומאנה)", teacher: "חסון ג'ומאנה", status: 'regular', substitute: null, room: null },
      { subject: 'אמנות (חדר אמנות מלכה)', teacher: 'נקש מלכה', status: 'substitution', substitute: 'פרנקו יונתן', room: null },
    ]);
  });

  it('period 3: יונתן takes both groups, in their own rooms', () => {
    expect(at(lessons, 3)).toEqual([
      { subject: "אמנות (חדר אמנות ג'ומאנה)", teacher: "חסון ג'ומאנה", status: 'substitution', substitute: 'פרנקו יונתן', room: null },
      { subject: 'אמנות (חדר אמנות מלכה)', teacher: 'נקש מלכה', status: 'substitution', substitute: 'פרנקו יונתן', room: null },
    ]);
  });

  it('keeps the identity of the lesson it changes, so the delta sees a change and not a new lesson', () => {
    const regular = regularOf('school-b-2026-11-04/timetable-cls1.html').filter((l) => l.date === THURSDAY && l.hourIndex === 3);
    const changed = lessons.filter((l) => l.date === THURSDAY && l.hourIndex === 3);
    expect(changed.map((l) => `${l.subject}|${l.teacher}`).sort()).toEqual(regular.map((l) => `${l.subject}|${l.teacher}`).sort());
  });

  it('never names a lesson after the change sentence', () => {
    for (const l of lessons) expect(l.subject).not.toMatch(/<-|->/);
  });

  it('without the regular grid, still no sentence for a name: the teacher whose lesson it is', () => {
    const bare = parseTimetable(fixture('school-b-2026-11-04/changestable-cls1.html'), SUNDAY).lessons;
    for (const l of bare) expect(l.subject).not.toMatch(/<-|->/);
    expect(at(bare, 2)).toEqual([
      { subject: "אמנות (חדר אמנות ג'ומאנה)", teacher: "חסון ג'ומאנה", status: 'regular', substitute: null, room: null },
      { subject: 'השיעור של נקש מלכה', teacher: 'נקש מלכה', status: 'substitution', substitute: 'פרנקו יונתן', room: 'חדר אמנות מלכה' },
    ]);
  });
});

describe('School B ז-5: a substitute in the class room, without the regular grid', () => {
  it('splits the room from the name', () => {
    const lessons = parseTimetable(fixture('school-b-2026-11-04/changestable-cls5.html'), SUNDAY).lessons;
    expect(at(lessons, 1)).toEqual([
      { subject: 'השיעור של נקש מלכה', teacher: 'נקש מלכה', status: 'substitution', substitute: 'פרנקו יונתן', room: 'ז5' },
    ]);
  });
});

describe('Dugma י2, Thursday 5.11: a new room, and a cancellation printed before the groups', () => {
  const lessons = parseTimetable(fixture('teachers-2026-11-04/cls-2.html'), SUNDAY, {
    regular: regularOf('teachers-2026-11-04/timetable-cls-2.html'),
  }).lessons;

  it('the lesson keeps its name and teacher, in the new room', () => {
    for (const hour of [7, 8]) {
      expect(at(lessons, hour)).toEqual([
        { subject: 'מבוא לאינטרנט (מעבדת מחשבים 1)', teacher: 'אשכול יהודית', status: 'regular', substitute: null, room: 'מעבדת מחשבים 4' },
      ]);
    }
  });

  it('a period the regular grid does not have takes the same teacher\'s lesson that day', () => {
    expect(at(lessons, 9)).toEqual([
      { subject: 'מבוא לאינטרנט (מעבדת מחשבים 1)', teacher: 'אשכול יהודית', status: 'regular', substitute: null, room: 'מעבדת מחשבים 4' },
    ]);
  });

  it('a cancellation of a group the cell no longer lists cancels nobody else', () => {
    const hour4 = at(lessons, 4);
    expect(hour4.filter((l) => l.status === 'cancelled')).toEqual([
      { subject: 'מתמטיקה 4 יח"ל', teacher: 'צדוק עדן', status: 'cancelled', substitute: null, room: null },
    ]);
    expect(hour4.filter((l) => l.status === 'regular')).toHaveLength(4);
  });
});
