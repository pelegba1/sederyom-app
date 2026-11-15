/**
 * The package that goes to OpenAI's plugin portal (`chatgpt-plugin/`): the limits the portal's final check
 * enforces, the tools it names against the ones the server registers, and its review cases against the demo
 * the reviewers sign in to, on every day of the week, since a reviewer's day is not ours to choose.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SETTINGS, type ChatShares } from '@sederyom/shared';
import { DateTime } from 'luxon';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dayAnswer, examsAnswer, gradesAnswer, homeworkAnswer, weekAnswer } from '../src/chat/answers.js';
import { buildChatSnapshot } from '../../app/src/chat/snapshot';
import { DEMO_CLASS, demoData, demoSettings } from '../../app/src/demo/data';
import { demoSourcesFrom } from '../../app/src/demo/sources';

const ROOT = join(__dirname, '..', '..', 'chatgpt-plugin');
const read = (name: string) => JSON.parse(readFileSync(join(ROOT, name), 'utf8'));
const plugin = read('plugin.json');
const mcp = read('mcp.json');
const openai = plugin.extensions['com.openai'];
const listing = openai.interface;
const cases = openai.review.test_cases;
const ZONE = 'Asia/Jerusalem';
const ALL: ChatShares = { homework: true, grades: true, bagrut: true, absences: true, messages: true };

/** WCAG contrast of two `#RRGGBB` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, c] = [1, 3, 5].map((i) => {
      const v = parseInt(hex.slice(i, i + 2), 16) / 255;
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * c!;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('the listing', () => {
  it('fits the limits of the final submission', () => {
    expect(plugin.name).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(plugin.description.length).toBeLessThanOrEqual(1024);
    expect(listing.displayName.length).toBeLessThanOrEqual(30);
    expect(listing.shortDescription.length).toBeLessThanOrEqual(30);
    expect(listing.longDescription.length).toBeLessThanOrEqual(4000);
    expect(listing.developerName.length).toBeLessThanOrEqual(80);
    expect(listing.capabilities.length).toBeLessThanOrEqual(20);
    for (const capability of listing.capabilities) expect(capability.length).toBeLessThanOrEqual(120);
    expect(listing.defaultPrompt.length).toBeLessThanOrEqual(3);
    expect(new Set(listing.defaultPrompt).size).toBe(listing.defaultPrompt.length);
    for (const prompt of listing.defaultPrompt) expect(prompt.length).toBeLessThanOrEqual(128);
    for (const translation of Object.values<{ subtitle: string; description: string }>(openai.publication.translations)) {
      expect(translation.subtitle.length).toBeLessThanOrEqual(30);
      expect(translation.description.length).toBeLessThanOrEqual(4000);
    }
  });

  it('uses a category the portal knows, and colours it accepts', () => {
    expect(listing.category).toBe('Education & Research');
    expect(contrast(listing.brandColor, '#FFFFFF')).toBeGreaterThanOrEqual(2);
    expect(contrast(listing.brandColorDark, '#212121')).toBeGreaterThanOrEqual(2);
  });

  it('has all four public addresses, and each page exists in `public/`', () => {
    for (const key of ['websiteURL', 'supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) expect(listing[key]).toMatch(/^https:\/\/sederyom\.app(\/|$)/);
    const vercel = JSON.parse(readFileSync(join(ROOT, '..', 'vercel.json'), 'utf8')) as { rewrites: { source: string; destination: string }[] };
    for (const key of ['supportURL', 'privacyPolicyURL', 'termsOfServiceURL']) {
      const rewrite = vercel.rewrites.find((r) => r.source === new URL(listing[key]).pathname);
      expect(rewrite, key).toBeDefined();
      expect(existsSync(join(ROOT, '..', 'public', rewrite!.destination))).toBe(true);
    }
  });

  it('never targets children under 13, and does not present itself as a connector to a school system', () => {
    const text = `${plugin.description} ${listing.longDescription} ${listing.shortDescription}`;
    expect(text).toContain('aged 13 and over');
    expect(text).not.toMatch(/mashov|shahaf|connector/i);
  });

  it('has square icons of an accepted size', () => {
    for (const path of [listing.logo, listing.composerIcon]) {
      expect(path).toMatch(/^\.\//);
      const png = readFileSync(join(ROOT, path));
      expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
      const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect(width).toBe(height);
      expect(width).toBeGreaterThanOrEqual(48);
      expect(width).toBeLessThanOrEqual(4096);
      expect(png.length).toBeLessThanOrEqual(5 * 1024 * 1024);
    }
  });
});

describe('the package', () => {
  it('names the one remote server, through OAuth, with nothing secret', () => {
    const servers = Object.values<Record<string, any>>(mcp.mcpServers);
    expect(servers).toHaveLength(1);
    expect(servers[0]!.url).toBe('https://sederyom.app/mcp');
    expect(servers[0]!.headers).toBeUndefined();
    // `extensions` may have to go if the portal refuses it (docs/chatgpt-submission.md): the server's own discovery says the same.
    expect(servers[0]!.extensions?.['com.openai']?.auth?.type ?? 'oauth').toBe('oauth');
    expect(JSON.stringify(servers[0])).not.toMatch(/secret|token/i);
  });

  it('keeps out what the portal rejects', () => {
    const text = JSON.stringify([plugin, mcp]);
    for (const banned of ['test_credentials', 'reviewer_instructions', 'clientSecret', '"apps"', '.app.json']) expect(text).not.toContain(banned);
  });

  it('points at an onboarding skill with a name and a description', () => {
    const skill = readFileSync(join(ROOT, openai.onboardingSkill), 'utf8');
    expect(skill).toMatch(/^---\nname: [a-z-]+\ndescription: .{1,1024}\n---\n/);
  });

  it('asks for exactly the five and three cases the first review needs', () => {
    expect(cases.positive).toHaveLength(5);
    expect(cases.negative).toHaveLength(3);
    for (const c of cases.positive) {
      for (const key of ['description', 'prompt', 'tools_triggered', 'expected_behavior']) expect(c[key].trim()).not.toBe('');
    }
    for (const c of cases.negative) for (const key of ['description', 'prompt']) expect(c[key].trim()).not.toBe('');
  });

  it('names only tools the server has', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'routes', 'mcp.ts'), 'utf8');
    const tools = new Set([...source.matchAll(/registerTool\('(\w+)'/g)].map((m) => m[1]));
    expect(tools.size).toBeGreaterThan(0);
    for (const c of cases.positive) for (const tool of c.tools_triggered.split(/,\s*/)) expect(tools).toContain(tool);
  });
});

describe('the review cases on the demo', () => {
  afterEach(() => vi.useRealTimers());

  // Fourteen days in a row, in four parts of the school year: every weekday, as a reviewer may meet them.
  // Not the end of June: the exams case reads to the end of the semester, and by then the demo has none left.
  const days = ['2026-11-08', '2026-12-13', '2027-03-07', '2027-05-09'].flatMap((start) =>
    Array.from({ length: 14 }, (_, i) => DateTime.fromISO(start, { zone: ZONE }).plus({ days: i, hours: 10 })));

  it.each(days.map((day) => [day.toISODate()!, day] as const))('holds on %s', (_date, day) => {
    const now = day.toJSDate();
    // The demo's dates follow the clock, so the clock is the reviewer's day.
    vi.useFakeTimers({ toFake: ['Date'], now });
    const s = buildChatSnapshot(demoSourcesFrom(demoData(now, ZONE), demoSettings(DEFAULT_SETTINGS), now, ZONE), ALL, { name: 'בית ספר להדגמה', className: DEMO_CLASS.name }, now.toISOString());

    // "next Sunday": the coming one, and a week from today on a Sunday.
    const sunday = day.plus({ days: day.weekday === 7 ? 7 : 7 - day.weekday }).toISODate()!;
    const shown = dayAnswer(s, sunday, now, ZONE).structured as { found: boolean; lessons: unknown[] };
    expect(shown.found).toBe(true);
    expect(shown.lessons.length).toBeGreaterThan(0);

    expect((examsAnswer(s, {}, now, ZONE).structured as { exams: unknown[] }).exams.length).toBeGreaterThan(0);
    expect((homeworkAnswer(s, {}, now, ZONE).structured as { homework: unknown[] }).homework.length).toBeGreaterThan(0);
    expect((gradesAnswer(s, { subject: 'מתמטיקה' }, now, ZONE).structured as { grades: unknown[] }).grades.length).toBeGreaterThan(0);
    expect((weekAnswer(s, 1, now, ZONE).structured as { missing: unknown[] }).missing).toEqual([]);
  });
});
