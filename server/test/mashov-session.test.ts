/**
 * The Mashov session as a live thing. Replaying the jar captured at login and
 * dropping every Set-Cookie Mashov answers with would keep sending a stale
 * token once Mashov rotates it on use. These tests pin the merge the phone
 * reads its Mashov session through (`@sederyom/shared/logic/mashov/session`).
 */
import { describe, expect, it } from 'vitest';
import { mergeSetCookies } from '@sederyom/shared/logic/mashov/session';

const NOW = new Date('2026-10-08T12:00:00Z');

describe('merging Set-Cookie into the jar', () => {
  const jar = 'MashovAuthToken=t1; Csrf-Token=c1; uniquId=u1';

  it('updates a rotated cookie in place and reports its name, not its value', () => {
    const merged = mergeSetCookies(jar, ['MashovAuthToken=t2; Path=/; Domain=.web.mashov.info; Secure; HttpOnly'], NOW);
    expect(merged.cookieHeader).toBe('MashovAuthToken=t2; Csrf-Token=c1; uniquId=u1');
    expect(merged.changed).toEqual(['MashovAuthToken']);
  });

  it('appends a cookie the jar did not have', () => {
    const merged = mergeSetCookies(jar, ['IdmAppName=students; Max-Age=14400; Path=/'], NOW);
    expect(merged.cookieHeader).toBe('MashovAuthToken=t1; Csrf-Token=c1; uniquId=u1; IdmAppName=students');
    expect(merged.changed).toEqual(['IdmAppName']);
  });

  it('removes a cookie the server clears — by Max-Age, by a past Expires, or by an empty value', () => {
    expect(mergeSetCookies(jar, ['uniquId=gone; Max-Age=0'], NOW).cookieHeader).toBe('MashovAuthToken=t1; Csrf-Token=c1');
    expect(mergeSetCookies(jar, ['uniquId=gone; Max-Age=-1'], NOW).cookieHeader).toBe('MashovAuthToken=t1; Csrf-Token=c1');
    expect(mergeSetCookies(jar, ['uniquId=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT'], NOW).cookieHeader)
      .toBe('MashovAuthToken=t1; Csrf-Token=c1');
    const cleared = mergeSetCookies(jar, ['Csrf-Token=; Path=/'], NOW);
    expect(cleared.cookieHeader).toBe('MashovAuthToken=t1; uniquId=u1');
    expect(cleared.changed).toEqual(['Csrf-Token']);
  });

  it('keeps a cookie whose Expires is still in the future, and lets Max-Age win over Expires', () => {
    expect(mergeSetCookies(jar, ['uniquId=u2; Expires=Fri, 08 Oct 2027 12:00:00 GMT'], NOW).cookieHeader)
      .toBe('MashovAuthToken=t1; Csrf-Token=c1; uniquId=u2');
    expect(mergeSetCookies(jar, ['uniquId=u2; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=600'], NOW).cookieHeader)
      .toBe('MashovAuthToken=t1; Csrf-Token=c1; uniquId=u2');
  });

  it('reports no change — and returns the jar byte for byte — when the values are the same', () => {
    const odd = 'MashovAuthToken=t1;Csrf-Token=c1 ;uniquId=u1';
    const merged = mergeSetCookies(odd, ['MashovAuthToken=t1; Path=/', 'gone=; Max-Age=0'], NOW);
    expect(merged).toEqual({ cookieHeader: odd, changed: [] });
  });

  it('applies several lines in order and collapses duplicate names to one value', () => {
    const merged = mergeSetCookies('a=1; b=2; a=3', ['a=9', 'c=4', 'b=; Max-Age=0'], NOW);
    expect(merged.cookieHeader).toBe('a=9; c=4');
    expect(merged.changed.sort()).toEqual(['a', 'b', 'c']);
  });

  it('ignores lines it cannot read', () => {
    expect(mergeSetCookies(jar, ['', '=nameless', 'no-equals-sign'], NOW)).toEqual({ cookieHeader: jar, changed: [] });
  });
});
