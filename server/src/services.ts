/**
 * Composition root: builds what the routes and the tick share from the
 * environment, so both see one wiring.
 */
import { promises as dns } from 'node:dns';
import type { PrismaClient } from '@prisma/client';
import type { Env } from './env.js';
import type { Logger } from './lib/logger.js';
import { ShahafAdapter, type ShahafFetcher } from './adapters/shahaf/index.js';
import { SchoolSiteAdapter, type SchoolSiteFetcher } from './adapters/school-site/index.js';
import type { LinkDeps } from './exam-board/link.js';
import { icsFetcher } from './exam-board/preview.js';
import { ExpoPusher, type Pusher } from './notify/push.js';

export interface Services {
  env: Env;
  prisma: PrismaClient;
  logger: Logger;
  pusher: Pusher;
  /** Any school's Shahaf site, by its normalized `https://<school>.shahaf.site` (plan Phase 2). */
  shahafFor(siteUrl: string): ShahafAdapter;
  /** Any public exam calendar, by its Google calendar id (plan Phase 2e: one per followed class). */
  schoolSiteFor(calendarId: string): SchoolSiteAdapter;
  /** What the exam board's link reader reaches the network with (`exam-board/link.ts`): the real `fetch` and DNS. */
  link: LinkDeps;
  /** A public Google calendar's ICS, by its id: https, 10 seconds, 2MB, at most 3 redirects (`exam-board/preview.ts`). */
  fetchIcs(calendarId: string): Promise<string>;
}

export interface ServiceOverrides {
  /** Test seam: serves any school's Shahaf site from fixtures, by its URL. */
  shahafFetcherFor?: (siteUrl: string) => ShahafFetcher;
  /** Test seam: serves the exam calendar's ICS from a fixture. */
  schoolSiteFetcher?: SchoolSiteFetcher;
  /** Test seam: a fake network for the exam board's link reader. */
  link?: LinkDeps;
  /** Test seam: serves a calendar's ICS, instead of fetching it. */
  fetchIcs?: (calendarId: string) => Promise<string>;
}

/** The real network: the global `fetch`, and every address a name has, so that the link reader can refuse a private one. */
const realLink: LinkDeps = {
  fetch: (input, init) => fetch(input, init),
  lookup: async (host) => (await dns.lookup(host, { all: true })).map((a) => a.address),
};

export function buildServices(
  env: Env,
  prisma: PrismaClient,
  logger: Logger,
  pusher: Pusher = new ExpoPusher(),
  overrides: ServiceOverrides = {},
): Services {
  const link = overrides.link ?? realLink;
  return {
    env,
    prisma,
    logger,
    pusher,
    link,
    fetchIcs: overrides.fetchIcs ?? icsFetcher(link),
    shahafFor(siteUrl) {
      return new ShahafAdapter({
        baseUrl: siteUrl,
        zone: env.TIMEZONE,
        weeksAhead: env.SHAHAF_WEEKS_AHEAD,
        fetcher: overrides.shahafFetcherFor?.(siteUrl),
      });
    },
    schoolSiteFor(calendarId) {
      return new SchoolSiteAdapter({ calendarId, zone: env.TIMEZONE, fetcher: overrides.schoolSiteFetcher });
    },
  };
}
