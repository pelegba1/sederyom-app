/**
 * The "בית ספר" calendar kept by the phone (plan Phase 2e, step 2).
 *
 * The shared mirror (`mirrorToCalendar`), with the phone's sign-in, whose
 * `calendar.app.created` scope reaches only calendars the phone made, and
 * with the exams and school events the phone builds its days from. A phone
 * keeps its own from the moment its class is picked (`local/source.ts`).
 */
import type { SchoolEvent } from '@sederyom/shared';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import { ensureMirrorCalendar, mirrorItems, mirrorToCalendar, type MirrorItem, type MirrorResult } from '@sederyom/shared/logic/google/mirror';
import { isHiddenExam } from '@sederyom/shared/logic/filters';
import { todayStr } from '@sederyom/shared/logic/time';
import { localExamsFrom, type LocalSources } from '../local/days';
import { isExamInCalendar } from '../local/examPrefs';
import { isManualKey } from '../local/manualExams';
import type { KeyValue } from './sync';

export const MIRROR_KEY = 'google.mirror';
/** Like the server's: the schedule changes a few times a day at most. */
const MIRROR_EVERY_MIN = 60;

export interface PhoneMirrorState {
  calendarId: string | null;
  lastRunAt: string | null;
  lastResult: MirrorResult | null;
  lastError: string | null;
  /** The last run failed because Google refused the phone's sign-in or its calendar scope: signing in again is the way. */
  authFailed?: boolean;
  /**
   * Counts the changes made on the phone to what the calendar carries
   * (`markMirrorDue`). A run that sees it move while it ran used what was
   * there before, so it leaves the next refresh due rather than stamp
   * `lastRunAt` over the change.
   */
  dueSeq?: number;
}

const EMPTY: PhoneMirrorState = { calendarId: null, lastRunAt: null, lastResult: null, lastError: null, authFailed: false };

/**
 * Google refused the sign-in (a second 401, `AuthError`) or the calendar scope
 * (a 403 that is not a rate limit): a run again later fails the same way.
 */
function refusedByGoogle(err: unknown): boolean {
  const e = err as { needsReauth?: unknown; status?: unknown; message?: unknown } | null;
  if (e?.needsReauth === true) return true;
  return e?.status === 403 && !/rate ?limit|quota|usageLimits/i.test(String(e.message ?? ''));
}

export function mirrorState(kv: KeyValue): PhoneMirrorState {
  try {
    return { ...EMPTY, ...(JSON.parse(kv.getString(MIRROR_KEY) ?? '{}') as Partial<PhoneMirrorState>) };
  } catch {
    return EMPTY;
  }
}

function save(kv: KeyValue, state: PhoneMirrorState): PhoneMirrorState {
  kv.set(MIRROR_KEY, JSON.stringify(state));
  return state;
}

export interface MirrorDeps {
  kv: KeyValue;
  requester: GoogleRequester;
  src: LocalSources;
  /**
   * A parent's other children (docs/parents-plan.md), each as its own sources
   * and its class's name. The calendar holds every child's exams, or each
   * switch of the child on screen would take the others' out of it. With more
   * than one child, each exam names its class; a child's name stays on the phone.
   */
  others?: readonly { src: LocalSources; className: string }[];
  now?: Date;
}

/** What one class puts in the calendar: its exams, under the names the phone gives them, and the school's events. */
function itemsOf(src: LocalSources, today: string, className: string | null): Map<string, MirrorItem> {
  const schoolEvents: SchoolEvent[] = (src.feed?.events ?? [])
    .filter((e): e is typeof e & { date: string } => e.date !== null)
    .map((e) => ({ naturalKey: e.naturalKey, date: e.date, title: e.title, details: e.details ?? null, source: 'shahaf' }));
  // Under the student's names for them (`localExamsFrom`), less the ones they keep out of Google:
  // those stay in the app, and an event already made for one is removed.
  const exams = localExamsFrom(src, today, today).filter((e) => isExamInCalendar(src.examPrefs, e.naturalKey));
  const items = mirrorItems(exams, schoolEvents, src.settings, today);
  if (className) {
    for (const exam of exams) {
      const item = items.get(exam.naturalKey);
      if (item) items.set(exam.naturalKey, { ...item, summary: `${item.summary} (${className})` });
    }
  }
  return items;
}

/**
 * Which events gone by leave the calendar: only the exams the student took
 * out of it, "לא המבחן שלי", "להציג ביומן Google" off, or one they added by
 * hand and deleted. Any other stays once its day has passed, so the student
 * still sees the exams they sat: the sources no longer carry most of them
 * (the class feed a week back, bagrut from today on), and a school event
 * stays the same way. On a parent's phone, by any child's.
 */
function goneByHand(sources: readonly LocalSources[]): (key: string) => boolean {
  const manual = new Set(sources.flatMap((s) => (s.manualExams ?? []).map((e) => e.naturalKey)));
  return (key) =>
    (isManualKey(key) && !manual.has(key))
    || sources.some((s) => isHiddenExam(s.settings.exams.hiddenKeys, { naturalKey: key }) || !isExamInCalendar(s.examPrefs, key));
}

/** One run, when the student wants exams in Google and an hour has passed. */
export async function runPhoneMirror(deps: MirrorDeps): Promise<PhoneMirrorState> {
  const now = deps.now ?? new Date();
  const state = mirrorState(deps.kv);
  if (!deps.src.settings.examsToCalendar) return state;
  if (state.lastRunAt && now.getTime() - Date.parse(state.lastRunAt) < MIRROR_EVERY_MIN * 60_000) return state;

  const { zone } = deps.src;
  const today = todayStr(zone);
  // Kept when the fill fails after the calendar was made: the next run fills that one, never a second "בית ספר".
  let calendarId = state.calendarId;
  try {
    const { id } = await ensureMirrorCalendar(deps.requester, state.calendarId, zone);
    calendarId = id;
    // The class on screen first: an exam two classes share keeps its name.
    const classes = [{ src: deps.src, className: deps.src.settings.className }, ...(deps.others ?? [])];
    const wanted = new Map<string, MirrorItem>();
    for (const { src, className } of classes) {
      for (const [key, item] of itemsOf(src, today, classes.length > 1 ? className : null)) {
        if (!wanted.has(key)) wanted.set(key, item);
      }
    }
    const result = await mirrorToCalendar(deps.requester, id, wanted, zone, { before: today, gone: goneByHand(classes.map((c) => c.src)) });
    return save(deps.kv, { ...afterRun(deps.kv, state, now), calendarId: id, lastResult: result, lastError: null, authFailed: false });
  } catch (err) {
    return save(deps.kv, {
      ...afterRun(deps.kv, state, now),
      calendarId,
      lastError: err instanceof Error ? err.message : String(err),
      authFailed: refusedByGoogle(err),
    });
  }
}

/**
 * The state a run leaves behind, on top of what is stored now rather than
 * what the run started from: an exam renamed, or kept out of Google, while
 * it ran (`markMirrorDue`) was not in what it sent, so the next refresh is
 * still due.
 */
function afterRun(kv: KeyValue, started: PhoneMirrorState, now: Date): PhoneMirrorState {
  const latest = mirrorState(kv);
  const changed = (latest.dueSeq ?? 0) !== (started.dueSeq ?? 0);
  return { ...latest, lastRunAt: changed ? null : now.toISOString() };
}

/**
 * What goes in the calendar changed on the phone (an exam renamed, or kept
 * out of Google): the next refresh mirrors again rather than an hour after
 * the last run, even when a run is under way as it changes (`dueSeq`).
 */
export function markMirrorDue(kv: KeyValue): void {
  const state = mirrorState(kv);
  save(kv, { ...state, lastRunAt: null, dueSeq: (state.dueSeq ?? 0) + 1 });
}
