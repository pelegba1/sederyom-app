/**
 * The year in review, as the list of cards the screen draws, in the order it
 * tells them. A card with too little behind it is simply not in the list.
 */
import { cancelledCards, daysCard, hoursCard, introCard, myDays, sleepCard, substitutesCard } from './lessons';
import { shownNames } from './names';
import { attendanceCard, examsCard, gradesCard, heldCard, tasksCard } from './other';
import type { WrappedCard, WrappedInput } from './types';

export * from './types';

export function buildWrapped(input: WrappedInput): WrappedCard[] {
  const names = shownNames(input);
  const days = myDays(input, names);
  const cards: (WrappedCard | null)[] = [
    introCard(days),
    hoursCard(days, input.zone),
    heldCard(input, names),
    ...cancelledCards(days, input.zone),
    sleepCard(days),
    substitutesCard(days, names),
    daysCard(days, input.zone),
    examsCard(input, names),
    tasksCard(input, names),
    attendanceCard(input, names),
    gradesCard(input, names),
    { id: 'outro', value: 0, params: {}, from: null, to: null, shareable: true, records: [] },
  ];
  return cards.filter((c): c is WrappedCard => c !== null);
}
