/**
 * The cards the year in review opens with: at once from what the phone kept,
 * then again once the class history was read (at most once a day, `history.ts`).
 *
 * The demo reads nothing and uses nothing kept: its days are made up, and a
 * real class's history beside them would be a number from nowhere.
 */
import { buildWrapped, type WrappedCard } from '@sederyom/shared/logic/wrapped/index';
import type { LocalSources } from '../local/days';
import type { KeyValue } from '../mashov/sync';
import { refreshHistory, storedHistory } from './history';
import { wrappedInput } from './input';

export interface WrappedView {
  cards: WrappedCard[];
  /**
   * `fresh`: everything there is to read was read. `kept`: the read failed and
   * the history is the one the phone kept. `missing`: the read failed and the
   * phone kept none, so the cards from the timetable are not there.
   */
  state: 'fresh' | 'kept' | 'missing';
}

/** The cards from what the phone holds now, with no network. */
export function wrappedNow(kv: KeyValue, src: LocalSources, demo = false): WrappedCard[] {
  return buildWrapped(wrappedInput(src, demo ? null : storedHistory(kv)?.history ?? null));
}

export async function loadWrapped(kv: KeyValue, src: LocalSources, fetchImpl: typeof fetch = fetch, demo = false): Promise<WrappedView> {
  if (demo) return { cards: wrappedNow(kv, src, true), state: 'fresh' };
  const input = wrappedInput(src, null);
  try {
    const read = await refreshHistory(kv, input.today, fetchImpl);
    // A server from before the route has nothing more to give: what was kept, if anything, is all there is.
    const history = read === 'unsupported' ? storedHistory(kv)?.history ?? null : read?.history ?? null;
    return { cards: buildWrapped({ ...input, history }), state: 'fresh' };
  } catch {
    const kept = storedHistory(kv)?.history ?? null;
    return { cards: buildWrapped({ ...input, history: kept }), state: kept ? 'kept' : 'missing' };
  }
}
