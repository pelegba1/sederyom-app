/**
 * What the screens are told while the demo is on (`demo/mode.ts`), and the
 * one place that chooses: `appApi`, which every hook calls through
 * (`api/hooks.ts`), asks `isDemo()` on each call.
 *
 * The demo answers as the phone does, from the sources `loadLocalSources`
 * gives it in the demo (the days, the week, the school, the widget, the
 * homework ticks), and differs only where the phone would ask someone:
 * - the connections: all there, with nothing to say;
 * - the class list: the demo's one class, never the school's site, and no
 *   site to open from a lesson;
 * - the settings: kept on the phone, with no class followed and no device told;
 * - bagrut and absences: the made-up ones, read "a moment ago";
 * - the tasks: the demo's own copy (`DEMO_TASKS_KEY`), never Google;
 * - a pasted site address: not kept (`DEMO_COPY.notSaved`);
 * - "לבדוק עכשיו", connecting and disconnecting: nothing to do;
 * - "איפה המורה?": the demo class's own teachers, from its lessons today.
 */
import { applySettingsPatch } from '@sederyom/shared/logic/options';
import { buildTeacherDays } from '@sederyom/shared/logic/teachers';
import { todayStr } from '@sederyom/shared/logic/time';
import { ApiError } from '../api/client';
import { TIMEZONE } from '../config';
import { taskListOf } from '../google/tasks';
import { toTask } from '../local/days';
import { homeworkLinkedTo, linkHomeworkTask } from '../local/homeworkState';
import { attendanceFrom, phoneApi, settingsResponse, type AppApi } from '../local/phoneApi';
import { saveUserSettings, userSettings } from '../local/userSettings';
import { storage } from '../widget/feedCache';
import { DEMO_CLASS, DEMO_SITE, demoStatus } from './data';
import { DEMO_COPY, addDemoTask, changeDemoTask, dropDemoTask } from './mode';
import { demoGoogle, demoLocalSources, isDemo, todaysDemo } from './phone';

const NO_TASK = 'המשימה הזאת כבר לא כאן.';

/** When the demo's Mashov was "read": as the connections say, a few minutes ago. */
const aMomentAgo = (): string => new Date(Date.now() - 4 * 60_000).toISOString();

export const demoApi: AppApi = {
  ...phoneApi,
  status: async () => demoStatus(new Date()),
  settings: async () => ({
    ...(await settingsResponse(async () => ({ classes: [DEMO_CLASS], site: { url: null, from: 'unknown', withoutSite: false } }))),
    // A lesson's "לאתר בית הספר" would open a site that does not exist.
    schoolSiteUrl: null,
  }),
  saveSettings: async (patch) => {
    const settings = applySettingsPatch(userSettings(), patch, todayStr(TIMEZONE));
    saveUserSettings(settings);
    return { settings };
  },
  notifications: async () => ({ items: todaysDemo().notifications }),
  bagrut: async () => ({ exams: todaysDemo().bagrut, fetchedAt: aMomentAgo() }),
  attendance: async () => attendanceFrom(demoLocalSources(), aMomentAgo()),
  tasks: async () => taskListOf(demoGoogle()),
  createTask: async (body) => {
    const task = addDemoTask(storage, demoGoogle(), body);
    if (body.fromHomeworkKey) linkHomeworkTask(storage, body.fromHomeworkKey, task.googleId);
    return { ...toTask(task), linkedHomeworkKey: body.fromHomeworkKey ?? null };
  },
  updateTask: async (id, body) => {
    const task = changeDemoTask(storage, demoGoogle(), id, body);
    if (!task) throw new ApiError(404, NO_TASK);
    return toTask(task);
  },
  deleteTask: async (id) => {
    dropDemoTask(storage, demoGoogle(), id);
    // A homework item made into this task is open again, as after a real delete.
    const homework = homeworkLinkedTo(storage, id);
    if (homework) linkHomeworkTask(storage, homework, null);
    return { ok: true };
  },
  lookUpSchoolSite: async () => {
    throw new ApiError(0, DEMO_COPY.notSaved);
  },
  teachers: async () => {
    const today = todayStr(TIMEZONE);
    const teachers = buildTeacherDays([{ className: DEMO_CLASS.name, lessons: todaysDemo().feed.lessons }], today);
    return { siteUrl: DEMO_SITE, date: teachers.length > 0 ? today : null, readAt: aMomentAgo(), teachers };
  },
  goWithoutSite: async () => ({ ok: true }),
  joinClass: async () => {
    throw new ApiError(0, DEMO_COPY.notSaved);
  },
  sync: async () => ({ ok: true, at: new Date().toISOString() }),
  disconnectMashov: async () => ({ ok: true }),
  disconnectGoogle: async () => ({ ok: true }),
};

/** The demo's answers while it is on, the phone's otherwise: chosen on every call. */
const current = (): AppApi => (isDemo() ? demoApi : phoneApi);

export const appApi: AppApi = {
  day: (date) => current().day(date),
  week: (offset) => current().week(offset),
  agenda: (days) => current().agenda(days),
  widgetFeed: () => current().widgetFeed(),
  status: () => current().status(),
  settings: () => current().settings(),
  saveSettings: (patch) => current().saveSettings(patch),
  notifications: () => current().notifications(),
  school: () => current().school(),
  bagrut: () => current().bagrut(),
  attendance: () => current().attendance(),
  setHomeworkDone: (key, done) => current().setHomeworkDone(key, done),
  tasks: () => current().tasks(),
  createTask: (body) => current().createTask(body),
  updateTask: (id, body) => current().updateTask(id, body),
  deleteTask: (id) => current().deleteTask(id),
  lookUpSchoolSite: (address) => current().lookUpSchoolSite(address),
  teachers: () => current().teachers(),
  goWithoutSite: () => current().goWithoutSite(),
  joinClass: (target) => current().joinClass(target),
  sync: () => current().sync(),
  disconnectMashov: () => current().disconnectMashov(),
  disconnectGoogle: () => current().disconnectGoogle(),
};
