/**
 * What the chat page shows (app/src/chat/view.ts): one row for each chat linked,
 * with the line that says whether it has used the copy, or is waiting for the
 * student's word, whether another chat can be added, and when the phone last
 * wrote its copy. All of it pure: the status the server gave, what the student
 * shares, the clock and the zone in; plain data out.
 */
import { describe, expect, it } from 'vitest';
import { CHAT_GRANTS_PER_DEVICE, DEFAULT_CHAT_SHARES, type ChatLinkView, type ChatShares, type ChatStatusResponse } from '@sederyom/shared';
import { CHAT_COPY } from '../../app/src/chat/copy';
import { chatScreenModel, codeOutcome, timeIn } from '../../app/src/chat/view';

const ZONE = 'Asia/Jerusalem';
/** Thursday 5.11.2026, 17:30 in Jerusalem (winter time, UTC+2). */
const NOW = new Date('2026-11-05T17:30:00+02:00');

const SHARES: ChatShares = { ...DEFAULT_CHAT_SHARES, grades: true };

const chat = (over: Partial<ChatLinkView> = {}): ChatLinkView => ({
  id: 'c1',
  name: 'ChatGPT',
  host: 'chatgpt.com',
  known: true,
  approved: true,
  createdAt: '2026-11-01T08:00:00.000Z',
  lastUsedAt: null,
  ...over,
});
const status = (chats: ChatLinkView[], snapshotAt: string | null = null): ChatStatusResponse => ({ chats, snapshotAt });
const lineOf = (over: Partial<ChatLinkView>, now: Date = NOW, zone: string = ZONE): string =>
  chatScreenModel(status([chat(over)]), SHARES, now, zone).chats[0]!.line;

describe('a chat that is known and approved', () => {
  it('says when it was last used: today with the time, yesterday with the time, an older day by its date', () => {
    expect(lineOf({ lastUsedAt: '2026-11-05T17:20:00+02:00' })).toBe('מחובר, השתמש לאחרונה היום 17:20');
    expect(lineOf({ lastUsedAt: '2026-11-04T09:05:00+02:00' })).toBe('מחובר, השתמש לאחרונה אתמול 09:05');
    expect(lineOf({ lastUsedAt: '2026-11-02T12:00:00+02:00' })).toBe('מחובר, השתמש לאחרונה ב־2.11');
  });

  it('says it has not been used yet', () => {
    expect(lineOf({ lastUsedAt: null })).toBe('מחובר, עוד לא השתמש');
    // A time that is not one is no use either.
    expect(lineOf({ lastUsedAt: 'לא תאריך' })).toBe('מחובר, עוד לא השתמש');
  });

  it('goes by the day and the time in the zone, not by the clock of the machine', () => {
    // 00:30 on the 5th in Jerusalem is still the 4th at 22:30 UTC.
    expect(lineOf({ lastUsedAt: '2026-11-04T22:30:00Z' })).toBe('מחובר, השתמש לאחרונה היום 00:30');
    expect(lineOf({ lastUsedAt: '2026-11-04T22:30:00Z' }, NOW, 'UTC')).toBe('מחובר, השתמש לאחרונה אתמול 22:30');
    // And "today" is the zone's too: 01:00 on the 6th in Jerusalem is the 5th in UTC.
    const night = new Date('2026-11-05T23:00:00Z');
    expect(lineOf({ lastUsedAt: '2026-11-05T21:00:00Z' }, night)).toBe('מחובר, השתמש לאחרונה אתמול 23:00');
  });

  it('is a row with the chat\'s own name, id and host', () => {
    const [row] = chatScreenModel(status([chat({ id: 'c9', name: 'Claude', host: 'claude.ai' })]), SHARES, NOW, ZONE).chats;
    expect(row).toMatchObject({ id: 'c9', title: 'Claude', host: 'claude.ai', known: true, needsApproval: false });
  });

  it('is titled by its host when it has no name', () => {
    expect(chatScreenModel(status([chat({ name: '' })]), SHARES, NOW, ZONE).chats[0]!.title).toBe('chatgpt.com');
  });
});

describe('a chat that is not known and not approved', () => {
  it('waits for the student\'s word, and says where it comes from', () => {
    const [row] = chatScreenModel(status([chat({ id: 'x', name: 'Mystery', host: 'example.dev', known: false, approved: false })]), SHARES, NOW, ZONE).chats;
    expect(row).toEqual({
      id: 'x', title: 'Mystery', line: 'מחכה לאישור שלך, מ־example.dev', needsApproval: true, host: 'example.dev', known: false,
    });
  });

  it('is a chat that is not approved, whatever its host', () => {
    const [row] = chatScreenModel(status([chat({ approved: false })]), SHARES, NOW, ZONE).chats;
    expect(row!.needsApproval).toBe(true);
    expect(row!.line).toBe('מחכה לאישור שלך, מ־chatgpt.com');
  });

  it('once approved, is a chat like the others, though no known host', () => {
    const [row] = chatScreenModel(status([chat({ host: 'example.dev', known: false, approved: true, lastUsedAt: '2026-11-05T17:20:00+02:00' })]), SHARES, NOW, ZONE).chats;
    expect(row).toMatchObject({ needsApproval: false, known: false, line: 'מחובר, השתמש לאחרונה היום 17:20' });
  });
});

describe('the count', () => {
  const many = (n: number) => status(Array.from({ length: n }, (_v, i) => chat({ id: `c${i}` })));

  it('lets another be added while there is room, and not at the limit', () => {
    expect(chatScreenModel(many(CHAT_GRANTS_PER_DEVICE - 1), SHARES, NOW, ZONE).canAdd).toBe(true);
    expect(chatScreenModel(many(CHAT_GRANTS_PER_DEVICE), SHARES, NOW, ZONE).canAdd).toBe(false);
  });

  it('keeps the chats in the order the server gave them', () => {
    expect(chatScreenModel(many(3), SHARES, NOW, ZONE).chats.map((c) => c.id)).toEqual(['c0', 'c1', 'c2']);
  });
});

describe('the last write', () => {
  it('says when the phone last sent its copy', () => {
    expect(chatScreenModel(status([chat()], '2026-11-05T16:40:00+02:00'), SHARES, NOW, ZONE).updatedLine).toBe('המידע נשלח לאחרונה היום 16:40');
    expect(chatScreenModel(status([chat()], '2026-11-04T08:15:00+02:00'), SHARES, NOW, ZONE).updatedLine).toBe('המידע נשלח לאחרונה אתמול 08:15');
    expect(chatScreenModel(status([chat()], '2026-10-30T08:15:00+02:00'), SHARES, NOW, ZONE).updatedLine).toBe('המידע נשלח לאחרונה ב־30.10');
  });

  it('says nothing before there is one', () => {
    expect(chatScreenModel(status([chat()], null), SHARES, NOW, ZONE).updatedLine).toBeNull();
    expect(chatScreenModel(status([chat()], 'לא תאריך'), SHARES, NOW, ZONE).updatedLine).toBeNull();
  });
});

describe('no status', () => {
  it('is an empty list that can take another chat, with the shares as they are', () => {
    expect(chatScreenModel(null, SHARES, NOW, ZONE)).toEqual({ shares: SHARES, chats: [], canAdd: true, updatedLine: null });
  });

  it('is the same for a status with no chats', () => {
    expect(chatScreenModel(status([]), SHARES, NOW, ZONE)).toEqual({ shares: SHARES, chats: [], canAdd: true, updatedLine: null });
  });
});

describe('the words', () => {
  it('keep the copy rules: a maqaf, no middle dot, no apostrophe, no long dash', () => {
    const lines = [
      lineOf({ lastUsedAt: '2026-11-05T17:20:00+02:00' }),
      lineOf({ lastUsedAt: '2026-11-04T09:05:00+02:00' }),
      lineOf({ lastUsedAt: '2026-11-02T12:00:00+02:00' }),
      lineOf({ lastUsedAt: null }),
      lineOf({ approved: false }),
      chatScreenModel(status([chat()], '2026-11-05T16:40:00+02:00'), SHARES, NOW, ZONE).updatedLine!,
    ];
    for (const line of lines) expect(line).not.toMatch(/[·'"—–]/);
    expect(Object.values(CHAT_COPY).filter((v) => typeof v === 'string').join('')).not.toMatch(/[·'"—]/);
  });
});

/** Every string `copy` can say: its plain strings, what its functions say for these arguments, and what its nested objects say. */
function allWords(copy: Record<string, unknown>): string[] {
  const words: string[] = [];
  for (const value of Object.values(copy)) {
    if (typeof value === 'string') words.push(value);
    else if (typeof value === 'function') {
      for (const args of [['דוגמה', 'example.dev'], [1], [3], [0]]) words.push(String((value as (...a: unknown[]) => unknown)(...args)));
    } else if (typeof value === 'object' && value !== null) words.push(...allWords(value as Record<string, unknown>));
  }
  return words;
}

describe('the page\'s copy', () => {
  it('says how many chats are linked', () => {
    expect(CHAT_COPY.rowLinked(1)).toBe('צ׳אט אחד מחובר');
    expect(CHAT_COPY.rowLinked(3)).toBe('3 צ׳אטים מחוברים');
  });

  it('says the code is good until a time, and what to do with it', () => {
    expect(CHAT_COPY.codeValid('17:40')).toBe('הקוד תקף עד 17:40');
    expect(CHAT_COPY.connect).toBe('להתחבר לצ׳אט');
    expect(CHAT_COPY.copy).toBe('להעתיק');
    expect(CHAT_COPY.copied).toBe('הקוד הועתק');
    expect(CHAT_COPY.copyFailed).toBe('לא הצלחנו להעתיק את הקוד.');
    expect(CHAT_COPY.linkedToast).toBe('הצ׳אט מחובר');
    // The code goes when a chat that waits for the student's word came, and this is what tells them why.
    expect(CHAT_COPY.waitingToast).toBe('צ׳אט חדש מחכה לאישור שלך.');
  });

  it('names the chat and where it comes from in the question about an unknown host, and the chat in the questions about cutting', () => {
    const asked = CHAT_COPY.approvePrompt('Mystery', 'example.dev');
    expect(asked).toContain('Mystery');
    expect(asked).toContain('example.dev');
    expect(CHAT_COPY.cutConfirm('Claude')).toBe('לנתק את Claude?');
    expect(CHAT_COPY.cutAllConfirm).toContain('לנתק את כל הצ׳אטים');
  });

  it('says the limit from the shared constant, not a number of its own', () => {
    expect(CHAT_COPY.full).toContain(String(CHAT_GRANTS_PER_DEVICE));
  });

  it('has a label for each share, in the order of the defaults, and none for any other', () => {
    expect(Object.keys(CHAT_COPY.shares)).toEqual(Object.keys(DEFAULT_CHAT_SHARES));
    for (const label of Object.values(CHAT_COPY.shares)) expect(label.length).toBeGreaterThan(0);
  });

  it('writes צ׳אט with a geresh, and has no apostrophe, middle dot, tick, long dash or straight quote in anything it says', () => {
    const words = allWords(CHAT_COPY as unknown as Record<string, unknown>);
    // The functions and the nested object were reached, not only the plain strings.
    expect(words).toContain('3 צ׳אטים מחוברים');
    expect(words).toContain(CHAT_COPY.shares.homework);
    for (const word of words) {
      expect(word).not.toMatch(/['"·✓—–]/);
      expect(word).not.toMatch(/צ'אט/);
      expect(word).not.toContain('להצטרף לכיתה');
    }
  });
});

describe('the time a code is good until', () => {
  it('is the hour and minute in the zone, not the machine\'s', () => {
    expect(timeIn('2026-11-05T17:40:00+02:00', ZONE)).toBe('17:40');
    expect(timeIn('2026-11-05T15:40:00Z', ZONE)).toBe('17:40');
    expect(timeIn('2026-11-05T15:40:00Z', 'UTC')).toBe('15:40');
    // Midnight is 00:00, and summer time is an hour on.
    expect(timeIn('2026-11-05T22:00:00Z', ZONE)).toBe('00:00');
    expect(timeIn('2026-07-05T15:40:00Z', ZONE)).toBe('18:40');
  });

  it('is empty for text that is not a time', () => {
    expect(timeIn('לא תאריך', ZONE)).toBe('');
  });
});

describe('what became of a code on the screen', () => {
  const rows = (...chats: ChatLinkView[]) => chatScreenModel(status(chats), SHARES, NOW, ZONE).chats;
  const known = chat({ id: 'k1' });
  const waiting = chat({ id: 'u1', name: 'Mystery', host: 'example.dev', known: false, approved: false });

  it('is still waiting while no chat has come', () => {
    expect(codeOutcome([], rows())).toBe('waiting');
    expect(codeOutcome(['k1'], rows(known))).toBe('waiting');
  });

  it('is linked, and said, when a chat that can read came', () => {
    expect(codeOutcome([], rows(known))).toBe('linked');
    expect(codeOutcome(['u1'], rows(waiting, known))).toBe('linked');
  });

  it('is spent but not said when every chat that came waits for the student\'s word', () => {
    expect(codeOutcome([], rows(waiting))).toBe('approval');
    expect(codeOutcome(['k1'], rows(known, waiting))).toBe('approval');
  });

  it('is said when one of several that came can read, even beside one that waits', () => {
    expect(codeOutcome([], rows(waiting, known))).toBe('linked');
  });

  it('still counts the next chat after one was cut while the code was out', () => {
    // k1 was there when the code was made and is gone now: the new one is still news.
    expect(codeOutcome(['k1'], rows(chat({ id: 'k2' })))).toBe('linked');
    expect(codeOutcome(['k1'], rows())).toBe('waiting');
  });
});
