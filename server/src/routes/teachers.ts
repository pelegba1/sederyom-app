/**
 * `GET /v2/teachers[?site=]`: "איפה המורה?" (docs/superpowers/specs/2026-11-04-teacher-search-design.md).
 *
 * Today's day of every teacher at a school, for a device that follows a class
 * there: its own, or a parent's child's. The site is public, but the route is
 * not a way to read any school's staff: only a school the device is at.
 *
 * The day is read from every class on the site (`teachers/day.ts`) and kept
 * on the school's row for half an hour: the students of one school searching
 * in one break are one read of the site, not one each. A failed read serves
 * the day kept, when it is today's, with the time it was read.
 */
import type { PrismaClient } from '@prisma/client';
import type { TeachersResponse } from '@sederyom/shared';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../app.js';
import { normalizeShahafUrl } from '../lib/devices.js';
import { todayStr } from '../lib/time.js';
import { readTeacherDay, type StoredTeacherDay } from '../teachers/day.js';

/** How long a read is good for: changes are published during the day, and a period is 45 minutes. */
export const TEACHER_DAY_FRESH_MS = 30 * 60_000;

/** The schools the device follows a class at, its own class's first. */
async function sitesOf(prisma: PrismaClient, deviceId: string): Promise<string[]> {
  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    include: {
      class: { select: { school: { select: { shahafUrl: true } } } },
      follows: { select: { class: { select: { school: { select: { shahafUrl: true } } } } } },
    },
  });
  if (!device) return [];
  const sites = [device.class?.school.shahafUrl, ...device.follows.map((f) => f.class.school.shahafUrl)];
  return [...new Set(sites.filter((s): s is string => Boolean(s)))];
}

export function registerTeacherRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { services } = deps;
  const { prisma } = services;
  /** One read per site at a time on this instance; the others wait for it. */
  const reading = new Map<string, Promise<StoredTeacherDay>>();

  app.get('/v2/teachers', async (request, reply): Promise<TeachersResponse | { error: string; message: string }> => {
    const sites = await sitesOf(prisma, request.device!.id);
    const asked = (request.query as { site?: unknown }).site;
    let siteUrl: string | null = sites[0] ?? null;
    if (asked !== undefined) {
      siteUrl = typeof asked === 'string' ? normalizeShahafUrl(asked) : null;
      if (!siteUrl || !sites.includes(siteUrl)) {
        void reply.code(403);
        return { error: 'not_your_school', message: 'אפשר לחפש מורים רק בבית ספר שיש בו כיתה שלך.' };
      }
    }
    if (!siteUrl) {
      void reply.code(409);
      return { error: 'no_class', message: 'עוד לא נבחרה כיתה.' };
    }

    const school = await prisma.school.findUnique({ where: { shahafUrl: siteUrl } });
    if (!school) {
      void reply.code(409);
      return { error: 'no_class', message: 'עוד לא נבחרה כיתה.' };
    }
    const now = new Date();
    const today = todayStr(services.env.TIMEZONE);
    const kept = (school.teacherDay as StoredTeacherDay | null) ?? null;
    const keptToday = kept !== null && kept.forDate === today && school.teacherDayReadAt !== null;
    const answer = (day: StoredTeacherDay, readAt: Date): TeachersResponse =>
      ({ siteUrl, date: day.date, readAt: readAt.toISOString(), teachers: day.teachers });

    if (keptToday && now.getTime() - school.teacherDayReadAt!.getTime() < TEACHER_DAY_FRESH_MS) {
      return answer(kept, school.teacherDayReadAt!);
    }

    let pending = reading.get(siteUrl);
    if (!pending) {
      pending = readTeacherDay(services.shahafFor(siteUrl), today, now).finally(() => reading.delete(siteUrl));
      reading.set(siteUrl, pending);
    }
    try {
      const day = await pending;
      await prisma.school.update({
        where: { id: school.id },
        data: { teacherDay: day as object, teacherDayReadAt: now, teacherDayError: null },
      });
      return answer(day, now);
    } catch (err) {
      request.log.warn({ siteUrl, err: String(err) }, 'could not read the school\'s teachers');
      await prisma.school
        .update({ where: { id: school.id }, data: { teacherDayError: String(err).slice(0, 500) } })
        .catch(() => undefined);
      if (keptToday) return answer(kept, school.teacherDayReadAt!);
      void reply.code(502);
      return { error: 'site_unreachable', message: 'לא הצלחנו לקרוא את אתר המערכת של בית הספר. כדאי לנסות שוב בעוד רגע.' };
    }
  });
}
