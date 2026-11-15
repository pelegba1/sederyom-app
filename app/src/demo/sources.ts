/**
 * The demo's made-up student (`demo/data.ts`) as `LocalSources`, the shape the
 * phone builds its days from. `demo/phone.ts` makes them for the phone, with
 * what the visitor kept in MMKV; the chat connection's server makes them for
 * the demo's chat, with nothing kept.
 *
 * Pure, so the server can load it: no storage, no config, nothing that needs
 * a phone. What the phone keeps comes in as `kept`.
 */
import type { UserSettings } from '@sederyom/shared';
import type { LocalSources } from '../local/days';
import { NO_EXAM_PREFS, type ExamPrefs } from '../local/examPrefs';
import type { HomeworkStates } from '../local/homeworkState';
import type { ManualExam } from '../local/manualExams';
import type { DemoData } from './data';
import { withDemoTaskEdits, type DemoTaskEdits } from './mode';

/** What a visitor did in the demo, kept on the phone as for a student (`demo/phone.ts`). */
export interface DemoKept {
  manualExams?: ManualExam[];
  examPrefs?: ExamPrefs;
  homeworkState?: HomeworkStates;
  taskEdits?: DemoTaskEdits;
}

/**
 * The made-up sources of `now` in `zone`, and on them what the visitor kept:
 * the exams added and renamed, the ticks, the tasks changed. `settings` are
 * the visitor's own (`demoSettings` gives the demo's class to a fresh set).
 */
export function demoSourcesFrom(demo: DemoData, settings: UserSettings, now: Date, zone: string, kept: DemoKept = {}): LocalSources {
  return {
    feed: demo.feed,
    mashov: demo.mashov,
    bagrut: demo.bagrut,
    manualExams: kept.manualExams ?? [],
    examPrefs: kept.examPrefs ?? NO_EXAM_PREFS,
    google: withDemoTaskEdits(demo.google, kept.taskEdits ?? {}),
    settings,
    // No "בית ספר" calendar is kept in the demo, and no grade's exam calendar followed.
    calendars: { school: null, exam: null },
    changeSeen: demo.changeSeen,
    homeworkState: { ...demo.homeworkState, ...kept.homeworkState },
    zone,
    now,
  };
}
