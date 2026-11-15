/**
 * Google read by the phone (app/src/google, plan Phase 2d), with the shared
 * adapters, the snapshot merge and a fake Google. The native sign-in is
 * stubbed.
 */
import { describe, expect, it, vi } from 'vitest';
import { applyRead } from '@sederyom/shared/logic/snapshot';
import { withQuery } from '@sederyom/shared/logic/http';
import type { GoogleRequester } from '@sederyom/shared/logic/google/requester';
import type { GoogleSignInState } from '../../app/src/google/sync';

const tokens = { current: 'tok-1', cleared: [] as string[] };
const signIn = { previous: true, silent: async (): Promise<{ type: string }> => ({ type: 'success' }) };
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: () => {},
    hasPreviousSignIn: () => signIn.previous,
    signInSilently: () => signIn.silent(),
    getTokens: async () => ({ accessToken: tokens.current, idToken: null }),
    clearCachedAccessToken: async (t: string) => {
      tokens.cleared.push(t);
      tokens.current = 'tok-2';
      return null;
    },
  },
  isCancelledResponse: () => false,
  isSuccessResponse: () => true,
}));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));

// Loaded by a path TypeScript does not follow: the module's import of the
// native sign-in brings React Native's global fetch types into the server's
// typecheck, where they clash with Node's.
const PHONE = '../../app/src/google/phone';
const { phoneGoogleRequester, googleSignInState } = (await import(/* @vite-ignore */ PHONE)) as {
  phoneGoogleRequester: (fetchImpl?: typeof fetch) => GoogleRequester;
  googleSignInState: () => Promise<GoogleSignInState>;
};
const { syncGoogle, syncGoogleBehindSignIn, googleKept, googleStatus, GOOGLE_KEYS } = await import('../../app/src/google/sync');

const NOW = new Date('2026-10-19T10:00:00Z');

function memoryKv() {
  const map = new Map<string, string>();
  return { map, getString: (k: string) => map.get(k), set: (k: string, v: string) => void map.set(k, v) };
}

describe('withQuery', () => {
  it('builds what URLSearchParams would, leaving out the empty values', () => {
    expect(withQuery('https://x/y', { a: 1, b: 'ש ל&ם', c: undefined, d: null, e: true })).toBe('https://x/y?a=1&b=%D7%A9%20%D7%9C%26%D7%9D&e=true');
    expect(withQuery('https://x/y', {})).toBe('https://x/y');
  });
});

describe('applyRead', () => {
  const ev = (key: string, cal: string, title: string) => ({ source: 'google_calendar' as const, kind: 'calendar_event' as const, naturalKey: key, partition: cal, payload: { title } });
  it('replaces what a read returned, and prunes only inside the scopes it covered in full', () => {
    const kept = applyRead([], [ev('a|1', 'a', 'one'), ev('a|2', 'a', 'two'), ev('b|1', 'b', 'other')], [{ kind: 'calendar_event', partition: 'a' }, { kind: 'calendar_event', partition: 'b' }]);
    expect(kept).toHaveLength(3);
    // An incremental read of calendar a: one event changed, nothing complete.
    const next = applyRead(kept, [ev('a|1', 'a', 'one, moved')], []);
    expect(next.find((e) => e.naturalKey === 'a|1')?.payload).toEqual({ title: 'one, moved' });
    expect(next).toHaveLength(3);
    // A full re-read of calendar a without event 2: it goes; calendar b stays.
    const full = applyRead(next, [ev('a|1', 'a', 'one, moved')], [{ kind: 'calendar_event', partition: 'a' }]);
    expect(full.map((e) => e.naturalKey).sort()).toEqual(['a|1', 'b|1']);
  });
});

/** A Google that serves one calendar and one task list, and counts what it was asked. */
function fakeGoogle(opts: { failTasks?: boolean } = {}) {
  const asked: string[] = [];
  const requester: GoogleRequester = {
    async request<T>(url: string): Promise<T> {
      asked.push(url);
      if (url.includes('/users/me/calendarList')) return { items: [{ id: 'cal-1', summary: 'אישי', primary: true }] } as T;
      if (url.includes('/calendars/cal-1/events')) {
        const incremental = url.includes('syncToken=');
        return {
          items: incremental
            ? [{ id: 'e2', status: 'cancelled' }]
            : [
                { id: 'e1', summary: 'חוג', start: { dateTime: '2026-10-20T15:00:00+03:00' }, end: { dateTime: '2026-10-20T16:00:00+03:00' } },
                { id: 'e2', summary: 'רופא', start: { dateTime: '2026-10-21T09:00:00+03:00' }, end: { dateTime: '2026-10-21T10:00:00+03:00' } },
              ],
          nextSyncToken: incremental ? 'sync-2' : 'sync-1',
        } as T;
      }
      if (opts.failTasks) throw new Error('Google 500');
      if (url.includes('/users/@me/lists')) return { items: [{ id: 'list-1', title: 'משימות' }] } as T;
      if (url.includes('/lists/list-1/tasks')) return { items: [{ id: 't1', title: 'לקנות מחברת', status: 'needsAction', updated: '2026-10-19T09:00:00Z' }] } as T;
      throw new Error(`unexpected ${url}`);
    },
  };
  return { requester, asked };
}

describe('syncGoogle', () => {
  it('reads in full first, then incrementally from the saved cursors', async () => {
    const kv = memoryKv();
    const g = fakeGoogle();
    const first = await syncGoogle({ kv, requester: g.requester, zone: 'Asia/Jerusalem', now: () => NOW });
    expect(first).toMatchObject({ kind: 'ok', counts: { calendar: 1, calendar_event: 2, task_list: 1, task: 1 } });
    expect(g.asked.some((u) => u.includes('timeMin='))).toBe(true);

    const later = new Date(NOW.getTime() + 20 * 60_000);
    const second = await syncGoogle({ kv, requester: g.requester, zone: 'Asia/Jerusalem', now: () => later });
    expect(second.kind).toBe('ok');
    expect(g.asked.some((u) => u.includes('syncToken=sync-1'))).toBe(true);
    expect(g.asked.some((u) => u.includes('updatedMin='))).toBe(true);
    // The cancellation came as a change and is kept as one, for the views to drop.
    const e2 = googleKept(kv).find((e) => e.naturalKey === 'cal-1|e2');
    expect((e2?.payload as { cancelled?: boolean }).cancelled).toBe(true);
  });

  it('leaves data and cursors as they were when a read fails halfway', async () => {
    const kv = memoryKv();
    await syncGoogle({ kv, requester: fakeGoogle().requester, zone: 'Asia/Jerusalem', now: () => NOW });
    const keptBefore = kv.map.get(GOOGLE_KEYS.kept);
    const cursorsBefore = kv.map.get(GOOGLE_KEYS.cursors);
    const out = await syncGoogle({ kv, requester: fakeGoogle({ failTasks: true }).requester, zone: 'Asia/Jerusalem', now: () => new Date(NOW.getTime() + 3600_000) });
    expect(out.kind).toBe('failed');
    expect(kv.map.get(GOOGLE_KEYS.kept)).toBe(keptBefore);
    expect(kv.map.get(GOOGLE_KEYS.cursors)).toBe(cursorsBefore);
  });
});

describe("the phone's sign-in check", () => {
  it('says signed out only when the phone never signed in', async () => {
    signIn.previous = false;
    expect(await googleSignInState()).toEqual({ kind: 'out' });
  });

  it('says signed in when Google renews the sign-in quietly', async () => {
    signIn.previous = true;
    signIn.silent = async () => ({ type: 'success' });
    expect(await googleSignInState()).toEqual({ kind: 'in' });
  });

  it('says the person has to sign in again when Google keeps no sign-in for the account on the phone', async () => {
    signIn.previous = true;
    signIn.silent = async () => ({ type: 'noSavedCredentialFound' });
    expect((await googleSignInState()).kind).toBe('needs-login');
  });

  it("keeps Google's code when the quiet sign-in throws", async () => {
    signIn.previous = true;
    signIn.silent = async () => {
      throw Object.assign(new Error('DEVELOPER_ERROR'), { code: '10' });
    };
    const state = await googleSignInState();
    expect(state.kind).toBe('failed');
    expect(state).toMatchObject({ error: expect.stringContaining('10') });
  });
});

describe('a read behind the sign-in check', () => {
  const deps = (kv: ReturnType<typeof memoryKv>, g = fakeGoogle(), at = NOW) => ({ kv, requester: g.requester, zone: 'Asia/Jerusalem', now: () => at });

  it('reads nothing and says nothing for a phone that never signed in', async () => {
    const kv = memoryKv();
    const g = fakeGoogle();
    expect(await syncGoogleBehindSignIn(deps(kv, g), { kind: 'out' })).toBeNull();
    expect(g.asked).toEqual([]);
    expect(kv.map.has(GOOGLE_KEYS.status)).toBe(false);
  });

  it('reads when signed in', async () => {
    const kv = memoryKv();
    expect((await syncGoogleBehindSignIn(deps(kv), { kind: 'in' }))?.kind).toBe('ok');
    expect(googleStatus(kv).lastOkAt).toBe(NOW.toISOString());
  });

  it('records a lost sign-in instead of going quiet, keeping what was read and when', async () => {
    const kv = memoryKv();
    await syncGoogleBehindSignIn(deps(kv), { kind: 'in' });
    const kept = kv.map.get(GOOGLE_KEYS.kept);
    const later = new Date(NOW.getTime() + 6 * 86_400_000);
    const g = fakeGoogle();
    const out = await syncGoogleBehindSignIn(deps(kv, g, later), { kind: 'needs-login', error: 'no saved sign-in' });
    expect(out).toEqual({ kind: 'needs-login', error: 'no saved sign-in' });
    expect(g.asked).toEqual([]);
    expect(googleStatus(kv)).toEqual({ lastTriedAt: later.toISOString(), lastOkAt: NOW.toISOString(), lastError: 'no saved sign-in', needsLogin: true });
    expect(kv.map.get(GOOGLE_KEYS.kept)).toBe(kept);
  });

  it('records a sign-in that failed, without asking for a new login', async () => {
    const kv = memoryKv();
    const out = await syncGoogleBehindSignIn(deps(kv), { kind: 'failed', error: 'sign-in 7: network' });
    expect(out).toEqual({ kind: 'failed', error: 'sign-in 7: network' });
    expect(googleStatus(kv)).toMatchObject({ lastError: 'sign-in 7: network', needsLogin: false });
  });

  it('clears the trouble with the next good read', async () => {
    const kv = memoryKv();
    await syncGoogleBehindSignIn(deps(kv), { kind: 'needs-login', error: 'no saved sign-in' });
    const later = new Date(NOW.getTime() + 3600_000);
    await syncGoogleBehindSignIn(deps(kv, fakeGoogle(), later), { kind: 'in' });
    expect(googleStatus(kv)).toMatchObject({ lastError: null, needsLogin: false, lastOkAt: later.toISOString() });
  });
});

describe('the phone\'s Google requests', () => {
  it('retries once with a fresh token after a 401, then gives up as "needs login"', async () => {
    const seen: string[] = [];
    let refuse = 1;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push((init.headers as Record<string, string>).authorization!);
      if (refuse-- > 0) return new Response('', { status: 401 });
      return new Response('{"ok":true}', { status: 200 });
    }) as unknown as typeof fetch;
    expect(await phoneGoogleRequester(fetchImpl).request('https://x')).toEqual({ ok: true });
    expect(seen).toEqual(['Bearer tok-1', 'Bearer tok-2']);
    expect(tokens.cleared).toEqual(['tok-1']);

    const always401 = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
    await expect(phoneGoogleRequester(always401).request('https://x')).rejects.toMatchObject({ needsReauth: true });
  });
});

describe("the phone's Google writes", () => {
  it('say their body is JSON, and only when there is one', async () => {
    const seen: Record<string, string>[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
    await phoneGoogleRequester(fetchImpl).request('https://x', { method: 'POST', body: '{"title":"t"}' });
    await phoneGoogleRequester(fetchImpl).request('https://x');
    expect(seen[0]!['content-type']).toBe('application/json');
    expect(seen[1]!['content-type']).toBeUndefined();
  });
});
