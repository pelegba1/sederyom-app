import { useMemo } from 'react';
import { useSettings } from '../api/hooks';
import { useScheme } from '../components/ui';
import { keepSubjectSlots } from './subjectColorStore';
import { subjectColorOf, subjectOrder } from './subjectColors';

/**
 * The subject colour for this screen (W6-F, plan §16.1): `(subject) =>
 * colour`, handed out over the student's own subjects (settings' lines
 * without the hidden ones, the most taught first), so every screen agrees and
 * the seven most frequent subjects never share. A dot or a cell's fill
 * beside the subject's name, never the only cue.
 *
 * Stable (run 8): each subject's colour is kept on the phone once it has
 * one (lib/subjectColorStore.ts), so hiding a subject, or a new one, never
 * recolours the others, and a hidden subject's colour waits for it.
 *
 * Asked by the source's name (`originalSubject ?? subject`): a name the
 * student gave a subject never moves it to another colour.
 *
 *   const colorOf = useSubjectColor();
 *   <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colorOf(lesson.originalSubject ?? lesson.subject) }} />
 */
export function useSubjectColor(): (subject: string) => string {
  const settings = useSettings();
  const scheme = useScheme();
  const order = useMemo(
    () => subjectOrder(settings.data?.subjects ?? [], settings.data?.settings.lessons.hiddenSubjects ?? []),
    [settings.data],
  );
  const classId = settings.data?.settings.classId ?? null;
  // Reads the stored slots and saves a slot for any new subject: the same answer however many screens ask.
  const slots = useMemo(() => keepSubjectSlots(order, classId), [order, classId]);
  return useMemo(() => subjectColorOf(order, scheme, slots), [order, scheme, slots]);
}
