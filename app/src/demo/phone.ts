/**
 * The demo on the phone (`demo/mode.ts`): its switch in MMKV, the way in, and
 * the sources the phone builds from while it is on, in place of the
 * student's. The way out is `leaveDemoNow` (`local/deleteMyDataRun.ts`).
 */
import type { KeptEntity } from '@sederyom/shared/logic/snapshot';
import { TIMEZONE } from '../config';
import type { LocalSources } from '../local/days';
import { readExamPrefs } from '../local/examPrefs';
import { readHomeworkStates } from '../local/homeworkState';
import { readManualExams } from '../local/manualExams';
import { saveUserSettings, userSettings } from '../local/userSettings';
import { storage } from '../widget/feedCache';
import { demoData, demoSettings, demoToday, type DemoData } from './data';
import { DEMO_KEY, demoOn, readDemoTaskEdits, withDemoTaskEdits } from './mode';
import { demoSourcesFrom } from './sources';

/** Whether the demo is on: the one question every guard asks. */
export function isDemo(): boolean {
  return demoOn(storage);
}

/** "להסתכל בהדגמה": the demo's class and the usual notifications, then the switch. */
export function enterDemo(): void {
  saveUserSettings(demoSettings(userSettings()));
  storage.set(DEMO_KEY, true);
}

/** Today's made-up sources, made once a day (each screen asks for them) and kept in memory only. */
let built: { day: string; json: string } | null = null;

/** Today's demo, as a copy of its own: as from storage, no screen can change another's. */
export function todaysDemo(now: Date = new Date()): DemoData {
  const day = demoToday(now, TIMEZONE);
  if (built?.day !== day) built = { day, json: JSON.stringify(demoData(now, TIMEZONE)) };
  return JSON.parse(built.json) as DemoData;
}

/** The made-up Google, with the tasks the visitor changed. */
export function demoGoogle(now: Date = new Date()): KeptEntity[] {
  return withDemoTaskEdits(todaysDemo(now).google, readDemoTaskEdits(storage));
}

/**
 * What the phone builds its days from in the demo: the made-up sources of
 * today, and on them what the visitor did, kept on the phone as for a
 * student: the settings, the ticks, the exams added and renamed, the tasks.
 * Not the phone's own exam board (`local/ownBoard.ts`): the demo's exams are
 * its made-up class feed's, and nothing about a board is read or fetched.
 */
export function demoLocalSources(now: Date = new Date()): LocalSources {
  return demoSourcesFrom(todaysDemo(now), userSettings(), now, TIMEZONE, {
    manualExams: readManualExams(storage),
    examPrefs: readExamPrefs(storage),
    homeworkState: readHomeworkStates(storage),
    taskEdits: readDemoTaskEdits(storage),
  });
}
