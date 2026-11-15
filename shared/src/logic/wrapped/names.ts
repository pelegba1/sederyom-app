/**
 * The name each card shows for a subject: the student's own, where they gave
 * one ("גוש ב׳" is "פיזיקה" to them), as every other screen shows it
 * (`ownNames.ts` decides, here as there). Without one, the source's name made
 * plain.
 *
 * Only what is shown: which lessons are the student's, which slot was
 * cancelled and every count still read the source's names.
 *
 * A source's name that is a person is not shown. The site sometimes prints a
 * teacher where the subject goes ("השיעור של לוי דנה", or a substitute's name
 * alone), and a card can be shared: such a lesson is "שיעור", and such an exam
 * "מבחן". A name the student typed is their own word and is shown as it is.
 */
import { examTitle, lessonName, mashovName, nameContext, siteLines } from '../ownNames';
import { plainSubject } from '../subjects';
import type { WrappedInput } from './types';

/** What a lesson is called when its source's name is a person's. It leads no card. */
export const UNNAMED_LESSON = 'שיעור';
const UNNAMED_EXAM = 'מבחן';

export interface ShownNames {
  /** A line of the class's timetable. */
  lesson(line: { subject: string; teacher: string | null }): string;
  /** A subject as Mashov names it: a grade's, an absence's, a homework item's, a group's. */
  fromMashov(subject: string): string;
  /** An exam's title: only the words that read the subject or the block change. */
  exam(title: string): string;
}

export function shownNames(input: Pick<WrappedInput, 'subjectNames' | 'hiddenSubjects' | 'history'>): ShownNames {
  // The lines of the whole year: an exam of September is named by the lines of September.
  const lines = (input.history?.lessons ?? []).map((l) => ({ subject: l.subject, teacher: l.teacher, status: l.status ?? undefined }));
  const ctx = nameContext(input.subjectNames, siteLines(lines), input.hiddenSubjects);
  // Every teacher and substitute the history names, as the site spells them.
  const people = new Set<string>();
  for (const l of input.history?.lessons ?? []) {
    for (const name of [l.teacher, l.substitute]) {
      const clean = (name ?? '').replace(/\s+/g, ' ').trim();
      if (clean.length >= 3) people.add(clean);
    }
  }
  const isPerson = (source: string): boolean => {
    const clean = source.replace(/\s+/g, ' ').trim();
    if (clean.startsWith('השיעור של ')) return true;
    for (const name of people) if (clean.includes(name)) return true;
    return false;
  };
  const plain = (source: string, unnamed: string): string => (isPerson(source) ? unnamed : plainSubject(source));
  return {
    lesson: (line) => (ctx && lessonName(ctx, line)) ?? plain(line.subject, UNNAMED_LESSON),
    fromMashov: (subject) => (ctx && mashovName(ctx, { subject })) ?? plainSubject(subject),
    exam: (title) => (ctx && examTitle(ctx, title)?.title) ?? plain(title, UNNAMED_EXAM),
  };
}
