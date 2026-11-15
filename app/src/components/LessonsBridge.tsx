/**
 * The days show the student's own lessons rather than the whole class's,
 * once the phone knows which they are: Mashov lists only the student's own
 * timetable ("להשאיר רק מה שבמשוב", `lessonsFromMashov`). A student used to
 * get that only by pressing the button in "השיעורים שלי", so every new phone
 * showed every group of the class, after the Mashov login too.
 *
 * On a parent's phone (docs/parents-plan.md) the child's: first from the
 * child's invite link, whose codes name the lines the child hid
 * (`lib/invite.ts`); else from the parent's Mashov.
 *
 * Applied once (for each child on a parent's phone), with a toast that can
 * take it back. A list the person changed is never touched, and a list that
 * was filled is not filled again, not even after "להציג הכול".
 *
 * Rendered once, inside the navigation container, beside the join bridge.
 */
import { useEffect, useRef } from 'react';
import { useSaveSettings, useSettings } from '../api/hooks';
import { isDemo } from '../demo/phone';
import { linkLessons } from '../lib/invite';
import { LESSONS_COPY, lessonsFromMashov } from '../lib/school';
import { dropLinkLessons, lessonsFilled, linkLessonCodes, markLessonsFilled } from '../local/children';
import { userSettings } from '../local/userSettings';
import { storage } from '../widget/feedCache';
import { useToast } from './Toast';

export function LessonsBridge(): null {
  const settings = useSettings();
  const save = useSaveSettings();
  const toast = useToast();
  // The effect runs when the settings change; it reads the toast and the save as they are then.
  const latest = useRef({ save, toast });
  latest.current = { save, toast };
  const data = settings.data;

  useEffect(() => {
    if (!data || isDemo()) return;
    const parent = data.settings.audience === 'parent';
    // Another class (a parent's: another child) went on screen since these settings were read: its list is not this one.
    if (userSettings().classId !== data.settings.classId) return;
    const hidden = data.settings.lessons.hiddenSubjects;
    const fill = (next: string[], said: string): void => {
      markLessonsFilled(storage);
      if (next.length === 0) return;
      const { save: run, toast: say } = latest.current;
      run.mutate({ lessons: { hiddenSubjects: next } }, {
        onSuccess: () => say.show(said, { onAction: () => run.mutate({ lessons: { hiddenSubjects: [] } }) }),
      });
    };

    // The child's own choices, from the link, once the class's lines are here to read them by.
    const codes = parent ? linkLessonCodes(storage) : [];
    if (codes.length > 0) {
      if (data.subjects.length === 0) return;
      dropLinkLessons(storage);
      const next = linkLessons(codes, data.subjects.map((s) => s.key));
      if (hidden.length === 0 && next.length > 0) {
        fill(next, LESSONS_COPY.parent.fromLink);
        return;
      }
    }

    if (lessonsFilled(storage)) return;
    const fromMashov = lessonsFromMashov({ mashovKnown: data.mashovKnown, subjects: data.subjects, hidden });
    if (fromMashov !== null) fill(fromMashov, parent ? LESSONS_COPY.parent.fromMashov : LESSONS_COPY.student.fromMashov);
  }, [data]);

  return null;
}
