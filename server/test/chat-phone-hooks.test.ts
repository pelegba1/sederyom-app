/**
 * The chat page's hooks (app/src/api/hooks.ts): the query's key and timing, and
 * that every change invalidates the page when it settles, whether it worked or
 * not. React Query is a fake that hands back the options each hook gave it, so
 * nothing renders; the phone's natives are fakes, as in chat-phone-run.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CHAT_SHARES } from '@sederyom/shared';

const h = vi.hoisted(() => {
  const nothing = () => Promise.resolve(null);
  const invalidated: unknown[] = [];
  const asked: unknown[] = [];
  return { nothing, invalidated, asked };
});

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: unknown) => options,
  useMutation: (options: unknown) => options,
  useQueryClient: () => ({ invalidateQueries: (filter: { queryKey: unknown }) => void h.invalidated.push(filter.queryKey) }),
}));
vi.mock('react', () => ({ useCallback: (fn: unknown) => fn }));
// What the hooks call: recorded, and answered.
vi.mock('../../app/src/chat/run', () => ({
  chatScreen: async (now: Date) => {
    h.asked.push(['chatScreen', now]);
    return { shares: {}, chats: [], canAdd: true, updatedLine: null };
  },
  makeChatCode: async () => (h.asked.push(['makeChatCode']), 'full'),
  setChatShares: async (shares: unknown) => void h.asked.push(['setChatShares', shares]),
  approveChat: async (id: string) => void h.asked.push(['approveChat', id]),
  cutChat: async (id: string) => void h.asked.push(['cutChat', id]),
  cutAllChats: async () => void h.asked.push(['cutAllChats']),
}));
vi.mock('react-native-mmkv', () => ({ createMMKV: () => ({ getString: () => undefined, getBoolean: () => undefined, set: () => {}, remove: () => {}, clearAll: () => {} }) }));
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }));
vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => crypto.getRandomValues(new Uint8Array(n)) }));
vi.mock('@react-native-cookies/cookies', () => ({ default: { get: async () => ({}), set: h.nothing, clearAll: h.nothing } }));
vi.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: {
    configure: () => {}, hasPreviousSignIn: () => false, getCurrentUser: () => null, signIn: h.nothing, signInSilently: h.nothing,
    hasPlayServices: h.nothing, getTokens: h.nothing, clearCachedAccessToken: h.nothing, revokeAccess: h.nothing, signOut: h.nothing,
  },
  isCancelledResponse: () => false,
  isSuccessResponse: () => true,
}));
vi.mock('expo-notifications', () => ({
  SchedulableTriggerInputTypes: { DATE: 'date' }, scheduleNotificationAsync: h.nothing, cancelScheduledNotificationAsync: h.nothing,
  dismissNotificationAsync: h.nothing, getAllScheduledNotificationsAsync: async () => [], getPresentedNotificationsAsync: async () => [],
  cancelAllScheduledNotificationsAsync: h.nothing, dismissAllNotificationsAsync: h.nothing,
}));
vi.mock('expo-background-task', () => ({ BackgroundTaskStatus: { Available: 2 }, BackgroundTaskResult: { Success: 1 }, getStatusAsync: h.nothing, registerTaskAsync: h.nothing }));
vi.mock('expo-task-manager', () => ({ defineTask: () => {}, isTaskRegisteredAsync: h.nothing }));
vi.mock('../../app/src/widget/update', () => ({ requestWidgetUpdate: () => undefined }));

// Loaded by a path TypeScript does not follow, as chat-phone-run.test.ts does: the hooks reach the native sign-in.
const APP = '../../app/src';
const hooks = (await import(/* @vite-ignore */ `${APP}/api/hooks`)) as unknown as {
  keys: { chat: readonly string[] };
  useChat: (opts: { polling: boolean }) => { queryKey: readonly string[]; queryFn: () => Promise<unknown>; refetchInterval: number | false; staleTime: number };
  useMakeChatCode: () => Mutation;
  useSetChatShares: () => Mutation;
  useApproveChat: () => Mutation;
  useCutChat: () => Mutation;
  useCutAllChats: () => Mutation;
};
interface Mutation {
  mutationFn: (arg?: never) => Promise<unknown>;
  onSettled: () => unknown;
}

beforeEach(() => {
  h.invalidated.length = 0;
  h.asked.length = 0;
});

describe('the chat page\'s query', () => {
  it('is under ["chat"], reads the page at the clock, and is fresh for 30 seconds', async () => {
    expect(hooks.keys.chat).toEqual(['chat']);
    const query = hooks.useChat({ polling: false });
    expect(query.queryKey).toEqual(['chat']);
    expect(query.staleTime).toBe(30_000);
    await query.queryFn();
    expect(h.asked).toHaveLength(1);
    expect((h.asked[0] as [string, Date])[1]).toBeInstanceOf(Date);
  });

  it('reads again every three seconds only while a chat is expected', () => {
    expect(hooks.useChat({ polling: true }).refetchInterval).toBe(3000);
    expect(hooks.useChat({ polling: false }).refetchInterval).toBe(false);
  });
});

describe('the changes', () => {
  const calls: Array<[string, () => Mutation, unknown, unknown[]]> = [
    ['useMakeChatCode', () => hooks.useMakeChatCode(), undefined, [['makeChatCode']]],
    ['useSetChatShares', () => hooks.useSetChatShares(), DEFAULT_CHAT_SHARES, [['setChatShares', DEFAULT_CHAT_SHARES]]],
    ['useApproveChat', () => hooks.useApproveChat(), 'c1', [['approveChat', 'c1']]],
    ['useCutChat', () => hooks.useCutChat(), 'c1', [['cutChat', 'c1']]],
    ['useCutAllChats', () => hooks.useCutAllChats(), undefined, [['cutAllChats']]],
  ];

  it.each(calls)('%s asks the phone and invalidates the page when it settles', async (_name, hook, arg, expected) => {
    const mutation = hook();
    await mutation.mutationFn(arg as never);
    expect(h.asked).toEqual(expected);
    expect(h.invalidated).toEqual([]);
    mutation.onSettled();
    expect(h.invalidated).toEqual([['chat']]);
  });
});
