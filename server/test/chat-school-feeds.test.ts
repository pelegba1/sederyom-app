/**
 * The school's feeds (grades, homework, messages, absences) and the demo's
 * sources as the server can build them (app/src/local/schoolFeeds.ts,
 * app/src/demo/sources.ts): pure modules, so the chat connection's snapshot can
 * be built over the made-up student in node, with no phone storage. And that
 * snapshot's own builder (app/src/chat/snapshot.ts), which the server runs too.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import type { NormalizedTask } from '@sederyom/shared/logic/google/tasks';

const ZONE = 'Asia/Jerusalem';
/** A plain school Wednesday, 4.11.2026, 10:00 in Jerusalem. */
const NOW = new Date('2026-11-04T10:00:00+02:00');

const { demoData, demoSettings } = await import('../../app/src/demo/data');
const { demoSourcesFrom } = await import('../../app/src/demo/sources');
const { attendanceFrom, gradesOf, homeworkOf, messagesOf } = await import('../../app/src/local/schoolFeeds');

const demo = () => demoData(NOW, ZONE);
const sources = () => demoSourcesFrom(demo(), demoSettings(DEFAULT_SETTINGS), NOW, ZONE);

describe('demoSourcesFrom', () => {
  it('builds the phone\'s sources from the made-up ones, for the zone and the moment asked', () => {
    const src = sources();
    const d = demo();
    expect(src.zone).toBe(ZONE);
    expect(src.now).toBe(NOW);
    expect(src.feed).toEqual(d.feed);
    expect(src.mashov).toEqual(d.mashov);
    expect(src.bagrut).toEqual(d.bagrut);
    expect(src.google).toEqual(d.google);
    expect(src.changeSeen).toEqual(d.changeSeen);
    expect(src.homeworkState).toEqual(d.homeworkState);
    expect(src.calendars).toEqual({ school: null, exam: null });
    expect(src.settings).toEqual(demoSettings(DEFAULT_SETTINGS));
  });

  it('puts what the visitor kept on the made-up sources', () => {
    const d = demo();
    const madeUp = Object.keys(d.homeworkState);
    expect(madeUp.length).toBeGreaterThan(0);
    const manual = { naturalKey: 'manual|1', date: '2026-11-20', subject: 'מתמטיקה', details: null, createdAt: '2026-11-04T07:00:00.000Z' };
    const examPrefs = { renames: { 'exam|1': 'בוחן שלי' }, calendarSkip: ['exam|2'], dates: {} };
    const kept = demoSourcesFrom(d, demoSettings(DEFAULT_SETTINGS), NOW, ZONE, {
      manualExams: [manual],
      examPrefs,
      homeworkState: { 'hw|extra': { done: true, linkedTaskId: null }, [madeUp[0]!]: { done: false, linkedTaskId: 'task-1' } },
    });
    expect(kept.manualExams).toEqual([manual]);
    expect(kept.examPrefs).toEqual(examPrefs);
    // Kept ticks come on top of the made-up ones: they add to them and win where both speak.
    expect(Object.keys(kept.homeworkState ?? {})).toEqual(expect.arrayContaining([...madeUp, 'hw|extra']));
    expect(kept.homeworkState?.[madeUp[0]!]).toEqual({ done: false, linkedTaskId: 'task-1' });
    expect(kept.homeworkState?.['hw|extra']).toEqual({ done: true, linkedTaskId: null });
  });

  it('puts the visitor\'s task edits on the made-up Google', () => {
    const d = demo();
    const task = d.google.find((e) => e.kind === 'task');
    expect(task).toBeDefined();
    const original = task!.payload as NormalizedTask;
    const edited: NormalizedTask = { ...original, title: 'שונה בהדגמה' };
    const src = demoSourcesFrom(d, demoSettings(DEFAULT_SETTINGS), NOW, ZONE, { taskEdits: { [original.googleId]: edited } });
    const titles = src.google.filter((e) => e.kind === 'task').map((e) => (e.payload as NormalizedTask).title);
    expect(titles).toContain('שונה בהדגמה');
    expect(titles).not.toContain(original.title);
  });
});

describe('the school feeds over the made-up student', () => {
  it('has grades, newest first, none marked new without the phone\'s map', () => {
    const grades = gradesOf(sources());
    expect(grades.length).toBeGreaterThan(0);
    const dates = grades.map((g) => g.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(grades.every((g) => g.firstSeen === null)).toBe(true);
    // The exam flag is Mashov's own and does not reach the screens.
    expect(grades.some((g) => 'isExam' in g)).toBe(false);
  });

  it('stamps the grades with the map it is given', () => {
    const src = sources();
    const [first] = gradesOf(src);
    const stamped = gradesOf(src, { [first!.naturalKey]: '2026-11-03T07:00:00.000Z' });
    expect(stamped.find((g) => g.naturalKey === first!.naturalKey)?.firstSeen).toBe('2026-11-03T07:00:00.000Z');
    expect(stamped.filter((g) => g.firstSeen !== null)).toHaveLength(1);
  });

  it('has homework, soonest due first', () => {
    const homework = homeworkOf(sources());
    expect(homework.length).toBeGreaterThan(0);
    const due = homework.map((h) => h.dueDate ?? '9999-12-31');
    expect(due).toEqual([...due].sort());
  });

  it('leaves out the homework of a subject the student hides', () => {
    const src = sources();
    const all = homeworkOf(src);
    const subject = all[0]!.subject;
    const hidden = homeworkOf({ ...src, settings: { ...src.settings, lessons: { ...src.settings.lessons, hiddenSubjects: [subject] } } });
    expect(hidden.length).toBeLessThan(all.length);
    expect(hidden.some((h) => h.subject === subject)).toBe(false);
  });

  it('has messages, newest first', () => {
    const messages = messagesOf(sources());
    expect(messages.length).toBeGreaterThan(0);
    const dates = messages.map((m) => m.date);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(messages.every((m) => m.source === 'mashov')).toBe(true);
  });

  it('dates a message Mashov gave no date to by the read it is given, else by the moment of the sources', () => {
    const src = sources();
    const payload = { title: 'ללא תאריך', body: '', from: null, date: null, bodyFor: null };
    const undated = { ...src, mashov: [{ kind: 'message', naturalKey: 'm-undated', partition: 'x', payload }] as unknown as typeof src.mashov };
    const byDefault = messagesOf(undated);
    expect(byDefault).toHaveLength(1);
    expect(byDefault[0]).toMatchObject({ date: NOW.toISOString(), dateIsFirstSeen: true, bodyPending: true });
    expect(messagesOf(undated, '2026-11-02T06:00:00.000Z')[0]!.date).toBe('2026-11-02T06:00:00.000Z');
  });

  it('adds up the absences of the made-up semester', () => {
    const att = attendanceFrom(sources(), null);
    expect(att.subjects.length).toBeGreaterThan(0);
    expect(att.fetchedAt).toBeNull();
    expect(attendanceFrom(sources(), '2026-11-04T07:50:00.000Z').fetchedAt).toBe('2026-11-04T07:50:00.000Z');
  });
});

describe('purity', () => {
  /** Every module the files load (type-only imports are erased and do not count), and every package they name. */
  function graphOf(entries: string[]): { files: Set<string>; packages: Set<string> } {
    const files = new Set<string>();
    const packages = new Set<string>();
    const queue = [...entries];
    while (queue.length > 0) {
      const file = queue.pop()!;
      if (files.has(file)) continue;
      files.add(file);
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+'([^']+)'/gm)) {
        const spec = m[1]!;
        if (!spec.startsWith('.')) {
          packages.add(spec);
          continue;
        }
        const base = resolve(dirname(file), spec);
        const found = [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts')].find((f) => existsSync(f));
        if (!found) throw new Error(`${relative(process.cwd(), file)} imports ${spec}, which is not a file`);
        queue.push(found);
      }
    }
    return { files, packages };
  }

  it('keeps the school feeds, the demo sources, the demo data and the snapshot free of the phone\'s storage, config and native modules', () => {
    const app = resolve(import.meta.dirname, '../../app/src');
    // And `demo/data.ts`, the third module the chat server loads for the demo (it only types `DemoData` in `sources.ts`),
    // and `chat/snapshot.ts`, the fourth: the snapshot is built by the phone and, for the demo, by the server.
    const { files, packages } = graphOf([
      join(app, 'local/schoolFeeds.ts'), join(app, 'demo/sources.ts'), join(app, 'demo/data.ts'), join(app, 'chat/snapshot.ts'),
    ]);
    const names = [...files].map((f) => relative(app, f).split('\\').join('/'));
    expect(names).toEqual(expect.arrayContaining([
      'local/schoolFeeds.ts', 'demo/sources.ts', 'demo/data.ts', 'demo/mode.ts', 'chat/snapshot.ts', 'lib/attendance.ts', 'local/days.ts',
      // The averages go by the grades tab's own code, which has to stay as pure as the rest.
      'lib/school.ts', 'lib/gradeWeights.ts', 'lib/format.ts',
    ]));
    expect(names).not.toContain('config.ts');
    expect(names.filter((n) => /feedCache|mmkv|storage|source\.ts$|phoneApi/i.test(n))).toEqual([]);
    // Shared's logic and luxon only: nothing that needs a phone.
    expect([...packages].filter((p) => !p.startsWith('@sederyom/shared') && p !== 'luxon')).toEqual([]);
  });
});
