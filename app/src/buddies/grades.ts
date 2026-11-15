/**
 * The box of grades a student shares with a friend, built on their own phone
 * (docs/superpowers/specs/2026-10-30-buddies-grades-design.md, 4.3). It is a
 * `pair` box of its own, next to the main one (`content.ts`), written only
 * when both friends chose to share grades.
 *
 * What goes in is what the grades tab shows: the newest `BUDDY_GRADES_MAX`
 * grades of Mashov's (not Classroom's), in whole days, by subject
 * (`groupGradesBySubject`), each subject with its average by the sharer's own
 * weights, worked out over the grades kept (whole days, at most
 * `BUDDY_GRADES_MAX`), before the size trim (`fitGrades`). A field with no
 * value is not written, so the box stays small; a grade with neither a number
 * nor words is left out. Text
 * goes in as the friend's phone reads it (`boxText`): nothing it refuses, and
 * none longer than it takes. The bagrut part, when it is shared too, is each
 * questionnaire's latest sitting with a grade of Mashov's own: no status code
 * (`realGrade`), nothing the student entered, no estimate.
 *
 * A box that leaves older grades out says where it starts in `from`:
 * `myGradesContent` at the cap of grades, and `fitGrades`, which drops the
 * oldest days of grades until the box fits the server's cap for a pair box once
 * sealed, later still.
 *
 * The format only grows, as `content.ts` says: `v: 1`, optional fields added.
 *
 * `compareGrades` sets a friend's box (read by `readGradesContent`) beside
 * mine, built by the same function on my own phone: the friend's page is made
 * of it (spec 4.5, 2.3).
 *
 * Pure, so the tests run it as is: the caller gives the grades the phone
 * keeps, the sharer's weights and the bagrut rows; or the two boxes.
 */
import type { BagrutExam, BuddyBagrutRow, BuddyGrade, BuddyGradesContent, BuddyGradeSubject, DateStr, Grade, Instant } from '@sederyom/shared';
import { BUDDY_GRADE_NAME_MAX, BUDDY_GRADE_SUBJECT_MAX, BUDDY_GRADES_MAX, BUDDY_PAIR_CIPHERTEXT_MAX } from '@sederyom/shared';
import { subjectsMatch } from '@sederyom/shared/logic/subjects';
import { addDays } from '@sederyom/shared/logic/time';
import { cleanName, realGrade } from '../lib/bagrut';
import type { GradeWeightsPrefs } from '../lib/gradeWeights';
import { assessmentName, groupGradesBySubject } from '../lib/school';
import { contentHash, sealedLength } from './crypto';
import { notInAName } from './validate';

/**
 * What the box reads of a grade: the phone's `Grade` has it, and so does
 * Mashov's own (`MashovGrade`). A grade the phone named carries Mashov's name
 * in `originalSubject`, and that is the one a friend gets.
 */
export type GradeLike = Pick<Grade, 'naturalKey' | 'date' | 'subject' | 'originalSubject' | 'value' | 'valueText' | 'weight' | 'notes'>;

/** What `myGradesContent` is built from. */
export interface MyGradesInput {
  /** The grades as the phone keeps them, in any order: the newest `BUDDY_GRADES_MAX` are taken. */
  grades: readonly GradeLike[];
  /** The sharer's types and weights, which the averages follow. */
  weights: GradeWeightsPrefs;
  /** Mashov's bagrut rows, one per questionnaire and sitting. */
  bagrut: readonly BagrutExam[];
  /** Both friends share the bagrut part (`shares.bagrut` on each side). */
  withBagrut: boolean;
  /** The last Mashov read: the box says when it was, not when it was written. */
  readAt: Instant;
}

/**
 * Text as it goes in the box, so that the friend's phone (`readGradesContent`)
 * never drops it: a line break or a tab is a space, what the reader refuses
 * (`notInAName`: direction marks, other control characters) is taken out,
 * runs of spaces become one, and what is longer than `max` characters
 * (`BUDDY_GRADE_NAME_MAX` for an assessment, `BUDDY_GRADE_SUBJECT_MAX` for a
 * subject, a questionnaire or a grade in words) is cut, the last of a cut one an
 * ellipsis. `null` when nothing is left, and the field is then left out.
 */
function boxText(text: string | null | undefined, max: number): string | null {
  // By code points, so a cut never splits one in two.
  const chars = Array.from((text ?? '').replace(/\s/g, ' ')).filter((ch) => !notInAName(ch.codePointAt(0) ?? 0));
  const clean = chars.join('').replace(/ {2,}/g, ' ').trim();
  if (clean === '') return null;
  const kept = Array.from(clean);
  return kept.length <= max ? clean : `${kept.slice(0, max - 1).join('')}…`;
}

function gradeOf(grade: GradeLike): BuddyGrade {
  const out: BuddyGrade = { date: grade.date };
  const name = boxText(assessmentName(grade), BUDDY_GRADE_NAME_MAX);
  if (name) out.name = name;
  if (typeof grade.value === 'number' && Number.isFinite(grade.value)) out.value = grade.value;
  else {
    const words = boxText(grade.valueText, BUDDY_GRADE_SUBJECT_MAX);
    if (words) out.text = words;
  }
  return out;
}

/** Each questionnaire's latest sitting with a grade of Mashov's own, by code. */
function bagrutRows(exams: readonly BagrutExam[]): BuddyBagrutRow[] {
  const bySemel = new Map<number, BagrutExam[]>();
  for (const exam of exams) {
    const rows = bySemel.get(exam.semel);
    if (rows) rows.push(exam);
    else bySemel.set(exam.semel, [exam]);
  }
  const out: BuddyBagrutRow[] = [];
  for (const [semel, sittings] of bySemel) {
    for (const sitting of [...sittings].sort((a, b) => b.moed.localeCompare(a.moed))) {
      const school = realGrade(sitting.schoolGrade);
      const exam = realGrade(sitting.examGrade);
      const final = realGrade(sitting.finalGrade);
      if (school === null && exam === null && final === null) continue;
      // A name with nothing left in it leaves the questionnaire out: an older sitting is not sent in place of the latest.
      const name = boxText(cleanName(sitting.name), BUDDY_GRADE_SUBJECT_MAX);
      if (name) {
        const row: BuddyBagrutRow = { semel, name, moed: sitting.moed };
        if (school !== null) row.school = school;
        if (exam !== null) row.exam = exam;
        if (final !== null) row.final = final;
        out.push(row);
      }
      break;
    }
  }
  // By code, so the same grades always make the same box, whatever order Mashov listed them in.
  return out.sort((a, b) => a.semel - b.semel);
}

/**
 * The box for one friend, the newest `BUDDY_GRADES_MAX` grades, in whole days:
 * when the cap would cut a day in two, the day goes, so that no day is half in
 * the box. Then the box says where it starts in `from`, the oldest date still in
 * it (the day after the newest grade, when none is), so that a friend's grade
 * older than it is not taken for one I do not have. With no grade over the cap
 * there is no `from`. `bagrut` only with `withBagrut`, and `subjects: []`
 * when no grades were read. `at` is the Mashov read's time (`readAt`). Not yet
 * fitted: see `fitGrades`.
 */
export function myGradesContent(input: MyGradesInput): BuddyGradesContent {
  const byDate = [...input.grades].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const capped = byDate.length > BUDDY_GRADES_MAX;
  // The day of the first grade over the cap is the one cut, or one the cap fell right after: either way what is kept is newer than it.
  const newest = capped ? byDate.slice(0, BUDDY_GRADES_MAX).filter((g) => g.date > byDate[BUDDY_GRADES_MAX]!.date) : byDate;
  const subjects = groupGradesBySubject(newest.map((g): Grade => ({ firstSeen: null, ...g })), input.weights).flatMap((group): BuddyGradeSubject[] => {
    // A grade with neither a number nor words has nothing to show a friend; a subject with only such grades has nothing either, nor has one with no name left.
    const grades = group.grades.map(gradeOf).filter((g) => g.value !== undefined || g.text !== undefined);
    // Mashov's name, never one I gave the subject (own names): what a friend's subjects are matched with.
    const subject = boxText(group.originalSubject ?? group.subject, BUDDY_GRADE_SUBJECT_MAX);
    if (grades.length === 0 || !subject) return [];
    const entry: BuddyGradeSubject = { subject, average: group.average ? Math.round(group.average.value * 10) / 10 : null, grades };
    // The grades the average leaves out: without them a friend reads the average as the mean of the grades shown.
    if (group.average && group.average.uncounted > 0) entry.uncounted = group.average.uncounted;
    return [entry];
  });
  const content: BuddyGradesContent = { v: 1, at: input.readAt, subjects };
  if (capped) content.from = newest.length > 0 ? newest[newest.length - 1]!.date : addDays(byDate[0]!.date, 1);
  if (input.withBagrut) content.bagrut = bagrutRows(input.bagrut);
  return content;
}

/**
 * `content` as it fits a pair box once sealed (`BUDDY_PAIR_CIPHERTEXT_MAX`;
 * the server refuses a box over it): whole, as a real box is; else without
 * its oldest day of grades, and the next, until it fits, with `from` the
 * oldest date still in it (the day after the newest, when none is). A subject
 * that lost every grade stays, with its average: the averages and the bagrut
 * are never cut. `null` when not even a box with no grades fits.
 */
export function fitGrades(content: BuddyGradesContent): BuddyGradesContent | null {
  const fits = (box: BuddyGradesContent) => sealedLength(box) <= BUDDY_PAIR_CIPHERTEXT_MAX;
  if (fits(content)) return content;
  const days = [...new Set(content.subjects.flatMap((s) => s.grades.map((g) => g.date)))].sort();
  if (days.length === 0) return null;
  // Each cut keeps the days from one date on, so `from` is the oldest day left; the last cut keeps none.
  const cuts = [...days.slice(1), addDays(days[days.length - 1]!, 1)];
  for (const from of cuts) {
    const box: BuddyGradesContent = {
      ...content,
      subjects: content.subjects.map((s) => ({ ...s, grades: s.grades.filter((g) => g.date >= from) })),
      from,
    };
    if (fits(box)) return box;
  }
  return null;
}

/** A fingerprint of the box without its `at`: equal while nothing a friend sees has changed, so the write can be skipped. */
export function gradesHash(content: BuddyGradesContent): string {
  const { at: _at, ...rest } = content;
  return contentHash(rest);
}

/** One line of an open subject: a grade of mine, a grade of theirs, or one each for the same assessment. */
export interface GradeRow {
  date: DateStr;
  /** The assessment's name: mine, and theirs when I have none; `null` when neither has one. */
  name: string | null;
  mine: BuddyGrade | null;
  theirs: BuddyGrade | null;
  /** One side only, and the other side's box reaches back that far: it is "רק לך" or "רק לנועה". `null` for a pair, and for a grade older than the other box's `from`, which may have dropped the grade it matches. */
  onlyOne: 'mine' | 'theirs' | null;
}

/** One subject both of us have, or one only they have: then `mine` is `null`, `mineCount` 0 and `rows` hold none of my grades. */
export interface GradeSubjectCompare {
  /** As theirs names it. */
  subject: string;
  /** The averages, each by its own sharer's weights; `null` with no numeric grade. */
  mine: number | null;
  theirs: number | null;
  /** How many grades of it each box holds, words included: what `averageLabel` takes. */
  mineCount: number;
  theirsCount: number;
  /** How many numeric grades each average leaves out, at 0%: 0 for none, and for a box that does not say. */
  mineUncounted: number;
  theirsUncounted: number;
  /** Newest first. */
  rows: GradeRow[];
}

/** One bagrut questionnaire of theirs, with mine when I have its row too. */
export interface BagrutRow {
  semel: number;
  /** As theirs names it. */
  name: string;
  mine: BuddyBagrutRow | null;
  theirs: BuddyBagrutRow;
}

export interface GradesCompare {
  /** The subjects both boxes have grades or an average of, the one with the newest grade of either first, then by name. */
  shared: GradeSubjectCompare[];
  /** The rest of theirs, in the order of their box. A subject of mine alone is in neither list. */
  others: GradeSubjectCompare[];
  /** The questionnaires, each list in the order of their box. */
  bagrut: { shared: BagrutRow[]; others: BagrutRow[] };
}

/** A name for telling two apart: runs of spaces, and spaces at the ends, do not count. */
const spacesOut = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** An assessment's name for telling two apart. */
const nameKey = (grade: BuddyGrade): string => spacesOut(grade.name ?? '');

/**
 * One date's grades of both sides as rows. The same name first (a grade with no
 * name has none to go by); then, when one grade of each side is left, those two
 * (an exam the whole year sits goes by another name in each group); every other
 * is one side's alone. A pair comes first, then the grades of mine alone, then
 * theirs.
 */
function rowsOfDate(date: DateStr, mine: readonly BuddyGrade[], theirs: readonly BuddyGrade[], mineFrom: DateStr | undefined, theirsFrom: DateStr | undefined): GradeRow[] {
  const pairs: Array<[BuddyGrade, BuddyGrade]> = [];
  const mineAlone: BuddyGrade[] = [];
  const theirsAlone = [...theirs];
  for (const m of mine) {
    // A grade with no name is the same as every other with none: it is paired below, only when it is the one left.
    const key = nameKey(m);
    const at = key === '' ? -1 : theirsAlone.findIndex((t) => nameKey(t) === key);
    if (at >= 0) pairs.push([m, theirsAlone.splice(at, 1)[0]!]);
    else mineAlone.push(m);
  }
  if (mineAlone.length === 1 && theirsAlone.length === 1) pairs.push([mineAlone.pop()!, theirsAlone.pop()!]);
  return [
    ...pairs.map(([m, t]): GradeRow => ({ date, name: m.name || t.name || null, mine: m, theirs: t, onlyOne: null })),
    // A grade older than the other box's start may have had its match cut from that box: it is not claimed as one side's alone.
    ...mineAlone.map((m): GradeRow => ({ date, name: m.name || null, mine: m, theirs: null, onlyOne: theirsFrom !== undefined && date < theirsFrom ? null : 'mine' })),
    ...theirsAlone.map((t): GradeRow => ({ date, name: t.name || null, mine: null, theirs: t, onlyOne: mineFrom !== undefined && date < mineFrom ? null : 'theirs' })),
  ];
}

/** A subject of theirs beside mine (`null` when I have none of it), the grades of both newest first. */
function subjectCompare(mine: BuddyGradeSubject | null, theirs: BuddyGradeSubject, mineBox: BuddyGradesContent, theirsBox: BuddyGradesContent): GradeSubjectCompare {
  const mineGrades = mine?.grades ?? [];
  const dates = [...new Set([...mineGrades, ...theirs.grades].map((g) => g.date))].sort().reverse();
  return {
    subject: theirs.subject,
    mine: mine?.average ?? null,
    theirs: theirs.average,
    mineCount: mineGrades.length,
    theirsCount: theirs.grades.length,
    mineUncounted: mine?.uncounted ?? 0,
    theirsUncounted: theirs.uncounted ?? 0,
    rows: dates.flatMap((date) => rowsOfDate(date, mineGrades.filter((g) => g.date === date), theirs.grades.filter((g) => g.date === date), mineBox.from, theirsBox.from)),
  };
}

/**
 * My box beside a friend's (spec 4.5). A subject is a subject a box lists, even
 * one whose grades were all trimmed, as it still has its average. Each of
 * theirs is set beside one of mine of the same name (spaces aside) first, and
 * only then is the rest matched by `subjectsMatch`, so ״אנגלית״ and
 * ״אנגלית דוברי״ on both sides never cross, whatever order each box lists
 * them in. One of mine is set beside one of theirs only, so my grades are
 * never shown twice. A bagrut questionnaire is the same by `semel`. A box
 * with no bagrut part has no questionnaires.
 */
export function compareGrades(mine: BuddyGradesContent, theirs: BuddyGradesContent): GradesCompare {
  const mineFree = [...mine.subjects];
  /** The subject of mine set beside each of theirs, by its place in their box. */
  const beside: (BuddyGradeSubject | null)[] = theirs.subjects.map(() => null);
  const match = (same: (m: BuddyGradeSubject, t: BuddyGradeSubject) => boolean) =>
    theirs.subjects.forEach((t, i) => {
      if (beside[i]) return;
      const at = mineFree.findIndex((m) => same(m, t));
      if (at >= 0) beside[i] = mineFree.splice(at, 1)[0]!;
    });
  match((m, t) => spacesOut(m.subject) === spacesOut(t.subject));
  match((m, t) => subjectsMatch(m.subject, t.subject));
  const shared: GradeSubjectCompare[] = [];
  const others: GradeSubjectCompare[] = [];
  theirs.subjects.forEach((t, i) => {
    const m = beside[i] ?? null;
    (m ? shared : others).push(subjectCompare(m, t, mine, theirs));
  });
  const newest = (s: GradeSubjectCompare) => s.rows[0]?.date ?? '';
  shared.sort((a, b) => newest(b).localeCompare(newest(a)) || a.subject.localeCompare(b.subject, 'he'));
  const mineBagrut = mine.bagrut ?? [];
  const rows = (theirs.bagrut ?? []).map((t): BagrutRow => ({ semel: t.semel, name: t.name, mine: mineBagrut.find((m) => m.semel === t.semel) ?? null, theirs: t }));
  return { shared, others, bagrut: { shared: rows.filter((r) => r.mine), others: rows.filter((r) => !r.mine) } };
}
