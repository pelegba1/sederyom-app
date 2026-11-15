/**
 * The notification log kept on the phone (app/src/notify/log.ts, plan 2f):
 * every delivery once, newest first, kept 30 days and at most 200, and what
 * the tray holds reconciled against what is already logged.
 */
import { describe, expect, it } from 'vitest';
import {
  LOG_KEY, MAX_AGE_DAYS, MAX_ENTRIES, SAME_DELIVERY_MS, appendDeliveries, isSameDelivery, readNotificationLog, typeFromTitle,
  typeOfDelivery, unloggedDeliveries, type Delivery,
} from '../../app/src/notify/log';

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

const NOW = new Date('2026-10-23T12:00:00.000Z');
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (msBeforeNow: number) => NOW.getTime() - msBeforeNow;

const grade = (identifier: string, when: number, over: Partial<Delivery> = {}): Delivery => ({
  identifier,
  at: when,
  title: 'ציון חדש באנגלית',
  body: '92, מבחן יחידה',
  data: { type: 'new_grade', deepLink: 'school', tab: 'grades', refreshWidget: true },
  ...over,
});

describe('appending', () => {
  it('logs a delivery with an id, its kind, its text, its payload and when it came', () => {
    const kv = memoryKv();
    const added = appendDeliveries(kv, [grade('g-1', at(5 * MIN))], NOW);
    expect(added).toEqual([{
      id: 1,
      type: 'new_grade',
      title: 'ציון חדש באנגלית',
      body: '92, מבחן יחידה',
      payload: { type: 'new_grade', deepLink: 'school', tab: 'grades', refreshWidget: true },
      sentAt: new Date(at(5 * MIN)).toISOString(),
    }]);
    expect(readNotificationLog(kv, NOW)).toEqual(added);
    // The identifier is the log's own business: not in what the screens get.
    expect(JSON.parse(kv.map.get(LOG_KEY)!).items[0].identifier).toBe('g-1');
  });

  it('keeps the newest first, and ids keep rising across appends', () => {
    const kv = memoryKv();
    appendDeliveries(kv, [grade('a', at(3 * DAY), { title: 'א' }), grade('b', at(1 * DAY), { title: 'ב' })], NOW);
    appendDeliveries(kv, [grade('c', at(2 * DAY), { title: 'ג' })], NOW);
    const log = readNotificationLog(kv, NOW);
    expect(log.map((e) => e.title)).toEqual(['ב', 'ג', 'א']);
    expect(log.map((e) => e.id)).toEqual([2, 3, 1]);
  });

  it('never dates one later than now, and dates one without a time now', () => {
    const kv = memoryKv();
    appendDeliveries(kv, [grade('future', NOW.getTime() + DAY, { title: 'א' }), grade('none', Number.NaN, { title: 'ב' })], NOW);
    expect(readNotificationLog(kv, NOW).map((e) => e.sentAt)).toEqual([NOW.toISOString(), NOW.toISOString()]);
  });

  it('starts again from a log that does not parse', () => {
    const kv = memoryKv();
    kv.set(LOG_KEY, '{nope');
    expect(readNotificationLog(kv, NOW)).toEqual([]);
    expect(appendDeliveries(kv, [grade('g-1', at(MIN))], NOW).map((e) => e.id)).toEqual([1]);
  });
});

describe('one delivery, seen more than once', () => {
  it('is logged once when the listener, the tap and the tray each see it, a little apart; the first time stays', () => {
    const kv = memoryKv();
    appendDeliveries(kv, [grade('g-1', at(10 * MIN))], NOW); // the listener, as it arrived
    appendDeliveries(kv, [grade('g-1', at(10 * MIN) + 20_000)], NOW); // the tray: posted 20 seconds later
    appendDeliveries(kv, [grade('g-1', at(10 * MIN) - 3 * MIN)], NOW); // a push's tap: the time it was sent
    const log = readNotificationLog(kv, NOW);
    expect(log).toHaveLength(1);
    expect(log[0]!.sentAt).toBe(new Date(at(10 * MIN)).toISOString());
  });

  it('is logged once when two sightings in one batch are the same', () => {
    const kv = memoryKv();
    expect(appendDeliveries(kv, [grade('g-1', at(MIN)), grade('g-1', at(MIN) + 1000)], NOW)).toHaveLength(1);
  });

  it('is two deliveries under one identifier a day apart ("משוב התנתק" once an outage)', () => {
    const kv = memoryKv();
    const relogin = (when: number): Delivery => ({
      identifier: 'mashov.relogin', at: when, title: 'משוב התנתק', body: 'ציונים ושיעורי בית לא מתעדכנים',
      data: { type: 'relogin_needed', deepLink: 'mashov-login', refreshWidget: true },
    });
    appendDeliveries(kv, [relogin(at(DAY + 5 * MIN))], NOW);
    appendDeliveries(kv, [relogin(at(5 * MIN))], NOW);
    expect(readNotificationLog(kv, NOW)).toHaveLength(2);
  });

  it('is one when the identifiers differ but the text is the same and close (a push the system drew, then tapped)', () => {
    const tray: Delivery = {
      identifier: 'expo-notifications://foreign_notifications?tag=FCM-Notification%3A1&id=0', at: at(9 * MIN),
      title: 'שינוי במערכת של מחר', body: 'שיעור 3 מתמטיקה מבוטל', data: { 'android.title': 'שינוי במערכת של מחר' },
    };
    const tap: Delivery = { ...tray, identifier: '0:1729000000%abc', at: at(10 * MIN), data: { type: 'schedule_change_tomorrow', deepLink: 'week', date: '2026-10-24', refreshWidget: true } };
    const kv = memoryKv();
    appendDeliveries(kv, [tray], NOW);
    expect(appendDeliveries(kv, [tap], NOW)).toEqual([]);
    expect(readNotificationLog(kv, NOW)).toHaveLength(1);
  });

  it('isSameDelivery: the window is strict, and different text under different identifiers is two', () => {
    const a = { identifier: 'x', title: 'א', body: 'ב', sentAt: NOW.toISOString() };
    expect(isSameDelivery(a, { ...a, sentAt: new Date(NOW.getTime() + SAME_DELIVERY_MS - 1).toISOString() })).toBe(true);
    expect(isSameDelivery(a, { ...a, sentAt: new Date(NOW.getTime() + SAME_DELIVERY_MS).toISOString() })).toBe(false);
    expect(isSameDelivery(a, { ...a, identifier: 'y', body: 'ג' })).toBe(false);
    expect(isSameDelivery(a, { ...a, identifier: 'y' })).toBe(true);
  });
});

describe('what is kept', () => {
  it(`drops what is older than ${MAX_AGE_DAYS} days, and never logs it`, () => {
    const kv = memoryKv();
    appendDeliveries(kv, [grade('old', at((MAX_AGE_DAYS - 1) * DAY), { title: 'א' })], NOW);
    expect(appendDeliveries(kv, [grade('older', at((MAX_AGE_DAYS + 1) * DAY), { title: 'ב' })], NOW)).toEqual([]);
    expect(readNotificationLog(kv, NOW)).toHaveLength(1);
    // Two days on, the first one is past the limit as well.
    const later = new Date(NOW.getTime() + 2 * DAY);
    expect(readNotificationLog(kv, later)).toEqual([]);
    appendDeliveries(kv, [grade('new', later.getTime(), { title: 'ג' })], later);
    expect(JSON.parse(kv.map.get(LOG_KEY)!).items.map((e: { title: string }) => e.title)).toEqual(['ג']);
  });

  it(`keeps at most ${MAX_ENTRIES}, the newest`, () => {
    const kv = memoryKv();
    const many = Array.from({ length: MAX_ENTRIES + 5 }, (_v, i) => grade(`g-${i}`, at((i + 1) * MIN), { title: `ציון ${i}` }));
    appendDeliveries(kv, many, NOW);
    const log = readNotificationLog(kv, NOW);
    expect(log).toHaveLength(MAX_ENTRIES);
    expect(log[0]!.title).toBe('ציון 0');
    expect(log.at(-1)!.title).toBe(`ציון ${MAX_ENTRIES - 1}`);
  });
});

describe('the kind of a notification', () => {
  it('comes from its payload when it has one', () => {
    expect(typeOfDelivery({ title: 'כל כותרת', data: { type: 'morning_summary' } })).toBe('morning_summary');
    expect(typeOfDelivery({ title: 'מבחן חדש', data: { type: 'not-a-type' } })).toBe('new_exam');
  });

  it('is read off the title of a push the tray holds without its data', () => {
    expect(typeFromTitle('שינוי במערכת של מחר')).toBe('schedule_change_tomorrow');
    expect(typeFromTitle('3 שינויים במערכת של היום')).toBe('schedule_change_today');
    expect(typeFromTitle('מבחן חדש')).toBe('new_exam');
    expect(typeFromTitle('ציון חדש באנגלית')).toBe('new_grade');
    expect(typeFromTitle('שיעורי בית בהיסטוריה')).toBe('new_homework');
    expect(typeFromTitle('הודעה מהמחנכת')).toBe('teacher_message');
    expect(typeFromTitle('משוב התנתק')).toBe('relogin_needed');
    expect(typeFromTitle('יום שלישי, כ״ה בתשרי')).toBeNull();
  });

  it('a sighting whose kind cannot be told, or with no text, is left out; one told by its title has no payload', () => {
    const kv = memoryKv();
    const unknown: Delivery = { identifier: 'u', at: at(MIN), title: 'יום שלישי', body: '7 שיעורים', data: {} };
    const empty: Delivery = { identifier: 'e', at: at(MIN), title: '', body: null, data: { type: 'new_exam' } };
    const byTitle: Delivery = { identifier: 't', at: at(MIN), title: 'מבחן חדש', body: 'אנגלית', data: { 'android.title': 'מבחן חדש' } };
    expect(appendDeliveries(kv, [unknown, empty, byTitle], NOW)).toEqual([
      { id: 1, type: 'new_exam', title: 'מבחן חדש', body: 'אנגלית', payload: null, sentAt: new Date(at(MIN)).toISOString() },
    ]);
  });
});

describe('reconciling the tray', () => {
  it('adds only what the log does not have, each once', () => {
    const logged = [{ identifier: 'g-1', title: 'ציון חדש באנגלית', body: '92, מבחן יחידה', sentAt: new Date(at(30 * MIN)).toISOString() }];
    const tray = [
      grade('g-1', at(30 * MIN) + 400), // logged by the listener already
      grade('summary|2026-10-23', at(5 * 60 * MIN), { title: 'יום שישי', data: { type: 'morning_summary', deepLink: 'today', refreshWidget: true } }),
      grade('summary|2026-10-23', at(5 * 60 * MIN), { title: 'יום שישי', data: { type: 'morning_summary', deepLink: 'today', refreshWidget: true } }),
    ];
    const fresh = unloggedDeliveries(logged, tray, NOW);
    expect(fresh.map((e) => e.identifier)).toEqual(['summary|2026-10-23']);
    expect(fresh[0]!.type).toBe('morning_summary');
  });

  it('a second look at the same tray adds nothing and writes nothing', () => {
    const kv = memoryKv();
    const tray = [grade('a', at(MIN), { title: 'א' }), grade('b', at(2 * MIN), { title: 'ב' })];
    expect(appendDeliveries(kv, tray, NOW)).toHaveLength(2);
    const written = kv.map.get(LOG_KEY);
    kv.set = () => { throw new Error('written again'); };
    expect(appendDeliveries(kv, tray, NOW)).toEqual([]);
    expect(kv.map.get(LOG_KEY)).toBe(written);
  });
});
