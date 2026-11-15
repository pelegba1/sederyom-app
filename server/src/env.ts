import { normalizeChatCode } from '@sederyom/shared';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

/**
 * The fixed code that links a chat to the demo data (chat connection design, §6).
 * Kept in its normalized form, so a route compares it with a typed code as it is.
 * Unset or blank means no demo. A value that is not a code means no demo too, with
 * a warning at startup (`loadEnv`): one wrong variable must not take every route
 * down, and the demo is only for store review.
 */
const chatDemoCode = z.string().optional();

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  PORT: z.coerce.number().int().default(3000),
  LOG_LEVEL: z.string().default('info'),

  DATABASE_URL: z.string().min(1),
  /** Unpooled connection for migrations; required by Neon, ignored elsewhere. */
  DIRECT_URL: z.string().optional(),

  /**
   * Guards /cron/tick, the only route outside `/v2` that does any work. Hex, as
   * it may travel as a query parameter (`openssl rand -hex 32`).
   */
  CRON_SECRET: z.string().min(16, 'set CRON_SECRET to a long random value (openssl rand -hex 32)'),

  TIMEZONE: z.string().default('Asia/Jerusalem'),

  /** Runs the tick in-process every minute (the VM). Off on serverless, where /cron/tick is the trigger. */
  SCHEDULER_ENABLED: bool.default('true'),
  /** Minutes between polls of one followed class's Shahaf site, inside and outside the active window. */
  POLL_SHAHAF_ACTIVE_MIN: z.coerce.number().int().default(15),
  POLL_SHAHAF_IDLE_MIN: z.coerce.number().int().default(60),
  /** A class's exam calendar changes a few times a term; hourly is plenty. */
  POLL_SCHOOL_SITE_MIN: z.coerce.number().int().default(60),
  /** Daily window (Asia/Jerusalem) in which the Shahaf sites poll at the fast cadence. */
  ACTIVE_WINDOW_START: z.string().default('06:00'),
  ACTIVE_WINDOW_END: z.string().default('22:30'),

  /**
   * How many weeks ahead of the current one the Shahaf adapter fetches. Three
   * covers the 21-day lesson horizon with the school's own data: checked live
   * on 2026-10-08, `?tab=changestable&week=N` serves the class's full recurring
   * grid, holiday headers included, for any future week.
   */
  SHAHAF_WEEKS_AHEAD: z.coerce.number().int().default(3),
  /**
   * Most followed classes one tick polls (plan Phase 2). Each is about eight
   * page reads, so this is what keeps a serverless tick inside its time limit
   * however many classes there are; the rest wait for the next tick, oldest first.
   */
  CLASS_POLLS_PER_TICK: z.coerce.number().int().positive().default(8),
  /**
   * Most past days one tick freezes into a class's history (`history/run.ts`).
   * A day is frozen once, so this only matters while a class catches up.
   */
  HISTORY_DAYS_PER_TICK: z.coerce.number().int().positive().default(14),
  /** Most past weeks one tick reads from the site for all classes together (`history/backfill.ts`): a page each. */
  HISTORY_BACKFILL_WEEKS_PER_TICK: z.coerce.number().int().min(0).default(2),

  /**
   * The server's own public address: the chat connection's OAuth metadata, the
   * authorize page's redirects and the `/mcp` resource all name it. The default
   * is for a local server; in production an address that is not https warns at
   * startup and turns the chat's side off (`publicUrlConfigured`).
   */
  PUBLIC_URL: z.string().url().default('http://localhost:3000'),
  /** See `chatDemoCode`. */
  CHAT_DEMO_CODE: chatDemoCode,
  /** The token OpenAI's plugin portal shows, served as it is at `/.well-known/openai-apps-challenge`; unset, that address is a 404. */
  OPENAI_APPS_CHALLENGE: z.string().trim().min(1).optional(),
});

export type Env = z.infer<typeof schema>;

/**
 * Whether the chat connection can be offered: outside production any address
 * will do, and in production only https (the default, `http://localhost:3000`,
 * is not). A chat's side answers 503 otherwise (`app.ts`), so linking fails
 * where somebody sees it rather than against an address nobody can reach.
 */
export function publicUrlConfigured(env: Pick<Env, 'NODE_ENV' | 'PUBLIC_URL'>): boolean {
  return env.NODE_ENV !== 'production' || env.PUBLIC_URL.startsWith('https://');
}

let cached: Env | null = null;

/**
 * The environment, checked. A variable the server cannot run without throws; the
 * chat connection's two only warn (`warn`, which never gets a value): a demo code
 * that is not one turns the demo off, and a production `PUBLIC_URL` that is not
 * https turns the chat's side off.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env, warn: (line: string) => void = console.warn): Env {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${issues}`);
  }
  const env = parsed.data;
  const demo = env.CHAT_DEMO_CODE;
  if (demo === undefined || demo.trim() === '') {
    env.CHAT_DEMO_CODE = undefined;
  } else {
    const code = normalizeChatCode(demo);
    if (code === null) warn('CHAT_DEMO_CODE is not 8 characters of A-Z (without I, O) and 2-9: the chat demo is off');
    env.CHAT_DEMO_CODE = code ?? undefined;
  }
  if (!publicUrlConfigured(env)) {
    warn('!!! PUBLIC_URL is not an https address in production: the chat connection (/.well-known, /oauth, /mcp) answers 503 until it is set to this server\'s public https origin');
  }
  return env;
}

export function env(): Env {
  cached ??= loadEnv();
  return cached;
}
