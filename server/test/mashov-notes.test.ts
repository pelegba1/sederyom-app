/**
 * Notifications from the phone's own Mashov reads (app/src/notify/mashovNotes.ts):
 * what is new since the last read, in the student's words, by their switches,
 * and when the quiet hours allow.
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type UserSettings } from '@sederyom/shared';
import type { NormalizedEntity } from '@sederyom/shared/logic/entities';
import type { MashovApi } from '@sederyom/shared/logic/mashov/api';
import {
  MAX_NOTES, RELOGIN_NOTE_ID, RELOGIN_NOTED_KEY, addedItems, deliverAt, noteRelogin, planMashovNotes, planReloginNote, type LocalNote, type ReloginDeps,
} from '../../app/src/notify/mashovNotes';
import { KEYS as MASHOV_KEYS, localStatus, syncMashov } from '../../app/src/mashov/sync';

const ZONE = 'Asia/Jerusalem';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v), remove: (k: string) => void map.delete(k) };
}
const entity = (kind: string, naturalKey: string, payload: object): NormalizedEntity =>
  ({ source: 'mashov', kind, naturalKey, payload }) as unknown as NormalizedEntity;

const grade = entity('grade', 'g-1', { subject: 'אנגלית 5 יח"ל (יב2)', value: 92, valueText: null, notes: 'מבחן יחידה' });
const homework = entity('homework', 'h-1', { subject: 'היסטוריה', text: 'לקרוא את פרק 4' });
const message = entity('message', 'm-1', { from: 'המחנכת', title: 'טיול שנתי', body: '' });
const slot = entity('timetable_slot', 's-1', { subject: 'אנגלית' });

// Grades and messages are off by default (the student turns them on); here everything is on.
const ALL_ON = { ...DEFAULT_SETTINGS.notifications, new_grade: true, teacher_message: true };
const settings = (patch: Partial<UserSettings> = {}): UserSettings => ({ ...DEFAULT_SETTINGS, notifications: ALL_ON, ...patch });

describe('what is new since the last read', () => {
  it('takes new grades, homework and messages, and nothing on a first read', () => {
    expect(addedItems(null, [grade, homework])).toEqual([]);
    expect(addedItems([grade], [grade, homework, message, slot])).toEqual([homework, message]);
  });

  it('announces no message older than the newest one already known, so a deeper read is quiet', () => {
    const dated = (key: string, date: string | null) => entity('message', key, { from: 'המחנכת', title: key, body: '', date });
    const known = dated('m-10-08', '2026-10-08T12:00:00+03:00');
    const older = dated('m-09-01', '2026-09-01T10:00:00+03:00');
    const newer = dated('m-10-20', '2026-10-20T09:00:00+03:00');
    expect(addedItems([known], [known, older, newer])).toEqual([newer]);
  });

  it('still announces a new message Mashov gave no date', () => {
    const known = entity('message', 'm-10-08', { from: 'המחנכת', title: 'ישנה', body: '', date: '2026-10-08T12:00:00+03:00' });
    const undated = entity('message', 'm-new', { from: 'המחנכת', title: 'חדשה', body: '', date: null });
    expect(addedItems([known], [known, undated])).toEqual([undated]);
  });
});

describe('the notes', () => {
  it('says what came, in the app\'s words', () => {
    const notes = planMashovNotes([grade, homework, message], settings(), null);
    expect(notes.map((n) => [n.title, n.body, n.data.tab])).toEqual([
      ['ציון חדש באנגלית', '92, מבחן יחידה', 'grades'],
      ['שיעורי בית בהיסטוריה', 'לקרוא את פרק 4', 'homework'],
      ['הודעה מהמחנכת', 'טיול שנתי', 'messages'],
    ]);
  });

  it('keeps to the student\'s switches, and says nothing during "חופש"', () => {
    const off = settings({ notifications: { ...ALL_ON, new_grade: false } });
    expect(planMashovNotes([grade, homework], off, null).map((n) => n.data.type)).toEqual(['new_homework']);
    expect(planMashovNotes([grade, homework], settings({ vacationMode: true }), null)).toEqual([]);
  });

  it('keeps to the defaults: homework on, grades and messages off until turned on', () => {
    expect(planMashovNotes([grade, homework, message], DEFAULT_SETTINGS, null).map((n) => n.data.type)).toEqual(['new_homework']);
  });

  it('turns many items after a long gap into one summary', () => {
    const many = Array.from({ length: MAX_NOTES + 1 }, (_, i) => entity('grade', `g-${i}`, { subject: 'מתמטיקה', value: 80 }));
    const notes = planMashovNotes([...many, homework], settings(), null);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ title: 'עדכונים חדשים ממשוב', body: `${MAX_NOTES + 1} ציונים, 1 שיעורי בית` });
  });
});

describe('"משוב התנתק"', () => {
  const WORKED = '2026-10-22T07:00:00.000Z';
  const out = (failedAt: string) => ({ needsLogin: true, failedAt, lastOkAt: WORKED });

  it('tells of each outage once, by when it began', () => {
    const first = planReloginNote(out('2026-10-22T13:00:00.000Z'), null);
    expect(first).toMatchObject({ title: 'משוב התנתק', data: { type: 'relogin_needed', deepLink: 'mashov-login' }, identifier: RELOGIN_NOTE_ID });
    // The same outage, read again an hour later: already told.
    expect(planReloginNote(out('2026-10-22T13:00:00.000Z'), '2026-10-22T13:00:00.000Z')).toBeNull();
    // Logged in again, then a new outage: told again.
    expect(planReloginNote(out('2026-10-23T09:00:00.000Z'), '2026-10-22T13:00:00.000Z')).not.toBeNull();
  });

  it('says nothing while the session works', () => {
    expect(planReloginNote({ needsLogin: false, failedAt: null, lastOkAt: WORKED }, null)).toBeNull();
    // A network failure keeps the outage's start but needs no login.
    expect(planReloginNote({ needsLogin: false, failedAt: '2026-10-22T13:00:00.000Z', lastOkAt: WORKED }, null)).toBeNull();
    expect(planReloginNote({ needsLogin: true, failedAt: null, lastOkAt: WORKED }, null)).toBeNull();
  });

  it('says nothing when no session ever worked on this phone', () => {
    expect(planReloginNote({ needsLogin: true, failedAt: '2026-10-22T13:00:00.000Z', lastOkAt: null }, null)).toBeNull();
    expect(planReloginNote({ needsLogin: true, failedAt: '2026-10-22T13:00:00.000Z' }, null)).toBeNull();
  });

  const refused = async (): Promise<MashovApi> => { throw Object.assign(new Error('no Mashov login on this phone'), { needsReauth: true }); };
  // A read that works: Mashov answers every list empty.
  const empty = async () => [];
  const works = async (): Promise<MashovApi> => ({
    timetable: empty, homework: empty, grades: empty, behave: empty, lessonsCount: empty, groups: empty, bells: empty, mail: empty,
    conversation: async () => ({}), bagrutGrades: empty, bagrutSheelonim: empty,
  }) as unknown as MashovApi;
  const t = (h: number) => new Date(Date.parse('2026-10-22T10:00:00Z') + h * 3600_000);

  /** A phone's reads, each followed by what run.ts does after it (`noteRelogin`), with the system's notes logged. */
  function phone(over: Partial<Pick<ReloginDeps, 'show' | 'settings'>> = {}) {
    const kv = memoryKv();
    const shown: { note: LocalNote; at: Date | null; failedAt: string | null }[] = [];
    const withdrawn: string[] = [];
    const read = async (at: Date, api: () => Promise<MashovApi>) => {
      const outcome = await syncMashov({ kv, api, zone: ZONE, now: () => at }, { force: true, bagrut: false });
      await noteRelogin(outcome.kind, {
        kv,
        status: () => localStatus(kv),
        show: async (note, when) => void shown.push({ note, at: when, failedAt: localStatus(kv).failedAt ?? null }),
        withdraw: async (id) => void withdrawn.push(id),
        settings: () => settings(),
        now: at,
        zone: ZONE,
        ...over,
      });
    };
    return { kv, shown, withdrawn, read };
  }

  it('follows the outages syncMashov records: one note however many reads fail, one more after a new outage', async () => {
    const p = phone();
    await p.read(t(0), works);
    await p.read(t(1), refused);
    await p.read(t(2), refused);
    await p.read(t(3), refused);
    await p.read(t(4), works);
    await p.read(t(5), refused);
    await p.read(t(6), refused);
    expect(p.shown.map((s) => s.failedAt)).toEqual([t(1).toISOString(), t(5).toISOString()]);
    expect(p.shown.every((s) => s.note.identifier === RELOGIN_NOTE_ID)).toBe(true);
  });

  it('says nothing on a phone that never connected Mashov', async () => {
    const p = phone();
    await p.read(t(0), refused);
    await p.read(t(1), refused);
    expect(p.shown).toEqual([]);
  });

  it('says nothing after the student pressed "ניתוק"', async () => {
    const p = phone();
    await p.read(t(0), works);
    // What friend.ts's disconnectMashov does: the cookies cleared and the status gone.
    p.kv.map.delete(MASHOV_KEYS.status);
    await p.read(t(1), refused);
    await p.read(t(2), refused);
    expect(p.shown).toEqual([]);
  });

  it('records the outage only once the note was shown, so a failed one is tried again', async () => {
    let fails = true;
    const shown: string[] = [];
    const p = phone({
      show: async () => {
        if (fails) throw new Error('notifications are off');
        shown.push('shown');
      },
    });
    await p.read(t(0), works);
    await p.read(t(1), refused);
    expect(p.kv.getString(RELOGIN_NOTED_KEY)).toBeUndefined();
    fails = false;
    await p.read(t(2), refused);
    await p.read(t(3), refused);
    expect(shown).toEqual(['shown']);
    expect(p.kv.getString(RELOGIN_NOTED_KEY)).toBe(t(1).toISOString());
  });

  it('holds it for the end of the quiet hours, and takes it back once Mashov reads again', async () => {
    const p = phone({ settings: () => settings({ quietHours: { enabled: true, from: '23:00', to: '06:30' } }) });
    // 02:00 in Jerusalem: held for 06:30.
    const night = new Date('2026-10-22T23:00:00Z');
    await p.read(new Date('2026-10-22T18:00:00Z'), works);
    await p.read(night, refused);
    expect(p.shown).toHaveLength(1);
    expect(p.shown[0]!.at?.toISOString()).toBe('2026-10-23T03:30:00.000Z');
    // 06:15: the student logged in again, the read works, and the note waiting for 06:30 goes.
    await p.read(new Date('2026-10-23T03:15:00Z'), works);
    expect(p.withdrawn).toEqual([RELOGIN_NOTE_ID]);
    expect(p.kv.getString(RELOGIN_NOTED_KEY)).toBeUndefined();
    // Nothing more to take back on the reads after it.
    await p.read(new Date('2026-10-23T04:15:00Z'), works);
    expect(p.withdrawn).toEqual([RELOGIN_NOTE_ID]);
  });
});

describe('when to show them', () => {
  const quiet = settings({ quietHours: { enabled: true, from: '22:00', to: '07:00' } });

  it('now outside the quiet hours', () => {
    expect(deliverAt(quiet, new Date('2026-10-22T12:00:00Z'), ZONE)).toBeNull();
  });

  it('when the quiet hours end, across midnight', () => {
    // 23:30 in Jerusalem (UTC+3 in October): the next 07:00 is 7.5 hours away.
    const at = deliverAt(quiet, new Date('2026-10-22T20:30:00Z'), ZONE);
    expect(at?.toISOString()).toBe('2026-10-23T04:00:00.000Z');
    // 05:00: the same morning's 07:00.
    expect(deliverAt(quiet, new Date('2026-10-23T02:00:00Z'), ZONE)?.toISOString()).toBe('2026-10-23T04:00:00.000Z');
  });

  it('now when the student has no quiet hours', () => {
    expect(deliverAt(settings({ quietHours: { enabled: false, from: '22:00', to: '07:00' } }), new Date('2026-10-22T20:30:00Z'), ZONE)).toBeNull();
  });
});
