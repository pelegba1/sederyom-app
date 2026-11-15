/**
 * A school's Shahaf timetable site (plan Phase 3): one rule for the server
 * and the phone (shared/src/logic/shahaf-site.ts), the forms a student pastes,
 * the order the phone takes a site in (app/src/local/schoolSite.ts), and
 * "without a site", which leaves the class alone on a refresh.
 */
import { describe, expect, it } from 'vitest';
import { normalizeShahafUrl, shahafSiteOf } from '@sederyom/shared/logic/shahaf-site';
import { normalizeShahafUrl as serverRule } from '../src/lib/devices.js';
import {
  SCHOOL_SITE_KEYS, chooseSchoolSite, classReads, isWithoutSite, keepsExamCalendar, pastedSite, savePastedSite, setWithoutSite,
} from '../../app/src/local/schoolSite';

function memoryKv(entries: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(entries));
  return {
    map,
    getString: (k: string) => map.get(k),
    set: (k: string, v: string) => void map.set(k, v),
    remove: (k: string) => void map.delete(k),
  };
}

const SITE = 'https://ironi-d.shahaf.site';

describe('the site rule', () => {
  it('is the one the server checks by', () => {
    expect(serverRule).toBe(normalizeShahafUrl);
  });

  it('takes the forms a student pastes, down to the bare address', () => {
    for (const pasted of [
      'ironi-d.shahaf.site',
      'https://ironi-d.shahaf.site/',
      'https://ironi-d.shahaf.site/?tab=changes&class=12',
      'http://Ironi-D.shahaf.site/#top',
      'HTTPS://ironi-d.SHAHAF.site/index.html',
      '  https://ironi-d.shahaf.site\n',
      // Copied off a right-to-left page, with its direction marks.
      '‏https://ironi-d.shahaf.site/‎',
      '⁦ironi-d.shahaf.site⁩',
    ]) {
      expect(shahafSiteOf(pasted), JSON.stringify(pasted)).toBe(SITE);
    }
  });

  it('takes nothing that is not a Shahaf school, whatever follows the host', () => {
    for (const bad of [
      '', '   ', 'ironi-d', 'shahaf.site', 'https://shahaf.site/', 'https://www.shahaf.site/?tab=1', 'https://a.b.shahaf.site/',
      'https://-x.shahaf.site', 'https://user@x.shahaf.site/', 'https://x.shahaf.site:8080/', 'https://x.shahaf.site.evil.com/',
      'https://evil.example/x.shahaf.site', 'https://evil.example?x.shahaf.site', 'file:///etc/passwd', 'ftp://x.shahaf.site',
      'האתר: https://x.shahaf.site', 'x.shahaf.site extra words',
    ]) {
      expect(shahafSiteOf(bad), bad).toBeNull();
    }
  });

  it('stays strict where the server fetches: no page, query or anchor', () => {
    expect(normalizeShahafUrl('ironi-d.shahaf.site')).toBe(SITE);
    expect(normalizeShahafUrl('https://ironi-d.shahaf.site/')).toBe(SITE);
    for (const withMore of ['https://ironi-d.shahaf.site/?tab=1', 'https://ironi-d.shahaf.site/x', 'https://ironi-d.shahaf.site#top']) {
      expect(normalizeShahafUrl(withMore), withMore).toBeNull();
    }
  });
});

describe('the site the phone takes', () => {
  const asked = () => {
    const calls: string[] = [];
    const mashov = (answer: string | null | Error) => async () => {
      calls.push('mashov');
      if (answer instanceof Error) throw answer;
      return answer;
    };
    return { calls, mashov };
  };

  it("is the followed class's, then the pasted one, then Mashov's, asking Mashov only when it must", async () => {
    const { calls, mashov } = asked();
    const other = 'https://school-c.shahaf.site';
    expect(await chooseSchoolSite({ feed: other, pasted: SITE }, mashov(SITE))).toEqual({ url: other, from: 'class' });
    expect(await chooseSchoolSite({ feed: null, pasted: SITE }, mashov(other))).toEqual({ url: SITE, from: 'pasted' });
    expect(calls).toEqual([]);
    expect(await chooseSchoolSite({ feed: undefined, pasted: null }, mashov(`${SITE}/`))).toEqual({ url: SITE, from: 'mashov' });
    expect(calls).toEqual(['mashov']);
  });

  it('tells "Mashov named none" from "Mashov could not be asked"', async () => {
    const { mashov } = asked();
    expect(await chooseSchoolSite({}, mashov(null))).toEqual({ url: null, from: 'none' });
    expect(await chooseSchoolSite({}, mashov(''))).toEqual({ url: null, from: 'none' });
    // A site that is not Shahaf's is no site the server would read.
    expect(await chooseSchoolSite({}, mashov('https://www.school.org.il/timetable'))).toEqual({ url: null, from: 'none' });
    expect(await chooseSchoolSite({}, mashov(new Error('Mashov returned 401')))).toEqual({ url: null, from: 'unknown' });
    // Not asked at all (a class list is kept).
    expect(await chooseSchoolSite({})).toEqual({ url: null, from: 'unknown' });
  });

  it('keeps a pasted address, and a site had ends "without a site"', () => {
    const kv = memoryKv();
    expect(pastedSite(kv)).toBeNull();
    expect(isWithoutSite(kv)).toBe(false);
    setWithoutSite(kv, true);
    expect(isWithoutSite(kv)).toBe(true);
    savePastedSite(kv, SITE);
    expect(pastedSite(kv)).toBe(SITE);
    expect(isWithoutSite(kv)).toBe(false);
    setWithoutSite(kv, true);
    setWithoutSite(kv, false);
    expect(kv.map.has(SCHOOL_SITE_KEYS.withoutSite)).toBe(false);
  });

  it('reads back no address that is not one', () => {
    expect(pastedSite(memoryKv({ [SCHOOL_SITE_KEYS.pasted]: 'https://evil.example' }))).toBeNull();
  });
});

describe('a refresh, by the class', () => {
  it('follows the picked class and reads its feed', () => {
    expect(classReads('12144', false)).toEqual({ follow: true, feed: true });
  });

  it('reads the feed with no class picked, as before', () => {
    expect(classReads('', false)).toEqual({ follow: false, feed: true });
  });

  it('"without a site" does neither, so it reports no missing site and no missing class', () => {
    expect(classReads('', true)).toEqual({ follow: false, feed: false });
    expect(classReads('12144', true)).toEqual({ follow: false, feed: false });
  });
});

describe('the "בית ספר" calendar', () => {
  it('is kept once a class is picked or the student went on without a site, not mid-setup', () => {
    expect(keepsExamCalendar('12144', false)).toBe(true);
    expect(keepsExamCalendar('', true)).toBe(true);
    expect(keepsExamCalendar(null, true)).toBe(true);
    expect(keepsExamCalendar('', false)).toBe(false);
    expect(keepsExamCalendar(null, false)).toBe(false);
  });
});
