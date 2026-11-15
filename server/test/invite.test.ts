/**
 * The class's invite link (ideas ה2, app/src/lib/invite.ts): the link the
 * app shares, and the class the app reads back from it, from the app's own
 * scheme, from the page's address, and from the store's install referrer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUDDY_BOX_STALE_DAYS, BUDDY_INVITE_TTL_DAYS, MAX_BUDDIES } from '@sederyom/shared';
import { inviteMessage, inviteUrl, joinOf, schoolOfSite } from '../../app/src/lib/invite';

const BASE = 'https://api.example';
const SITE = 'https://school-a.shahaf.site';

describe('the invite link', () => {
  it('names the school and the class, and reads back as them', () => {
    const url = inviteUrl(BASE, SITE, '36');
    expect(url).toBe('https://api.example/join?s=school-a&c=36');
    expect(joinOf(url)).toEqual({ siteUrl: SITE, classId: '36' });
  });

  it('is read back from the app\'s scheme and from the store\'s referrer', () => {
    expect(joinOf('sederyom://join?s=school-a&c=36')).toEqual({ siteUrl: SITE, classId: '36' });
    expect(joinOf('s=school-a&c=36')).toEqual({ siteUrl: SITE, classId: '36' });
    expect(joinOf('sederyom://join/?c=36&s=SCHOOL-A#x')).toEqual({ siteUrl: SITE, classId: '36' });
  });

  it('is no link without a site and a class it can carry', () => {
    expect(inviteUrl('', SITE, '36')).toBeNull();
    expect(inviteUrl(BASE, 'https://example.com', '36')).toBeNull();
    expect(inviteUrl(BASE, SITE, 'י"א 2')).toBeNull();
    expect(schoolOfSite('https://www.shahaf.site')).toBeNull();
  });

  it('reads no class from anything else', () => {
    for (const link of [
      null, '', 'utm_source=google-play&utm_medium=organic', 'sederyom://today', 'sederyom://join?s=school-a',
      'https://evil.example/other?s=school-a&c=36', 'https://api.example/join?s=a.b&c=36', 'https://api.example/join?s=school-a&c=..%2F1',
      'sederyom://join?s=www&c=36', 'javascript://join?s=school-a&c=36',
    ]) {
      expect(joinOf(link)).toBeNull();
    }
  });

  it('says what it is before the link, about the people and not a class, with the copy rules', () => {
    const text = inviteMessage('https://api.example/join?s=school-a&c=36');
    expect(text.endsWith('\nhttps://api.example/join?s=school-a&c=36')).toBe(true);
    expect(text).toContain('שלנו');
    expect(text).not.toMatch(/כיתה/);
    expect(text).not.toMatch(/·| — /);
  });
});

describe('the page at /join', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'public', 'join.html'), 'utf8');
  const vercel = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf8')) as { rewrites: { source: string; destination: string }[] };

  it('is served at /join, before every other path goes to the API', () => {
    const at = vercel.rewrites.findIndex((r) => r.source === '/join' && r.destination === '/join.html');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(vercel.rewrites.findIndex((r) => r.source === '/(.*)'));
  });

  it('opens the app\'s package, and checks the link as the app does', () => {
    const app = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app', 'app.json'), 'utf8')) as { expo: { android: { package: string }; scheme: string } };
    expect(html).toContain(`var PACKAGE = '${app.expo.android.package}'`);
    expect(html).toContain(`scheme=${app.expo.scheme};`);
    expect(html).toContain("'intent://join?' + join");
    // An iPhone opens the scheme itself: Chrome's intent link is Android's.
    expect(html).toContain("'sederyom://join?' + join");
    // The link's values reach the page's links only past the same checks, never as markup.
    expect(html).not.toMatch(/innerHTML|document\.write/);
  });
});

/**
 * The friend invite's page (spec 4.3): the pairing secret is the URL fragment, which no server sees,
 * so nothing on the page may send it anywhere, and Google Play must not get it as an install referrer.
 */
describe('the page at /b', () => {
  const html = readFileSync(join(__dirname, '..', '..', 'public', 'buddy.html'), 'utf8');
  const vercel = JSON.parse(readFileSync(join(__dirname, '..', '..', 'vercel.json'), 'utf8')) as { rewrites: { source: string; destination: string }[] };
  const app = JSON.parse(readFileSync(join(__dirname, '..', '..', 'app', 'app.json'), 'utf8')) as { expo: { android: { package: string }; scheme: string } };
  const SECRET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOP_';

  /** Runs the page's script on a stand-in for the few elements it touches. */
  function open(hash: string, userAgent: string, maxTouchPoints = 0) {
    const els: Record<string, { hidden: boolean; href: string }> = {};
    for (const id of ['open', 'store', 'lead', 'bad', 'installed', 'update', 'iphone', 'other']) {
      els[id] = { hidden: id === 'bad' || id === 'iphone' || id === 'other', href: '' };
    }
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
    new Function('window', 'document', 'navigator', script)({ location: { hash } }, { getElementById: (id: string) => els[id] }, { userAgent, maxTouchPoints });
    return els;
  }
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14) Chrome/120';

  it('is served at /b, before every other path goes to the API', () => {
    const at = vercel.rewrites.findIndex((r) => r.source === '/b' && r.destination === '/buddy.html');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(at).toBeLessThan(vercel.rewrites.findIndex((r) => r.source === '/(.*)'));
  });

  it("opens the app's own scheme with the secret from the fragment", () => {
    expect(SECRET).toHaveLength(43);
    const els = open(`#${SECRET}`, ANDROID);
    expect(els.open).toMatchObject({ hidden: false, href: `intent://buddy?k=${SECRET}#Intent;scheme=${app.expo.scheme};package=${app.expo.android.package};end` });
    expect(els.bad!.hidden).toBe(true);
  });

  it('tells a phone whose app is older than the invitations to update it and tap again', () => {
    // An old app opens on the link and shows nothing: the page is the only place that can say why (spec §7).
    expect(html).toContain('אם סדר יום נפתחת ולא מופיעה הזמנה, צריך לעדכן אותה ב־Google Play ואז ללחוץ שוב על הקישור.');
    expect(open(`#${SECRET}`, ANDROID).update!.hidden).toBe(false);
  });

  it('says nothing in its source of the internal words or papers', () => {
    // A public file: its comment names no internal document, and not the retired word for the feature.
    const comments = html.match(/<!--[\s\S]*?-->/g) ?? [];
    expect(comments.length).toBeGreaterThan(0);
    for (const comment of comments) expect(comment).not.toMatch(/friend|docs\/|superpowers|\.md\b/i);
  });

  it('calls a missing or malformed secret an incomplete link', () => {
    for (const hash of ['', '#', `#${SECRET.slice(1)}`, `#${SECRET}x`, `#${SECRET.slice(1)}=`, `#${SECRET.slice(1)}+`, `#k=${SECRET}`]) {
      const els = open(hash, ANDROID);
      expect(els.open!.hidden, hash).toBe(true);
      expect(els.bad!.hidden, hash).toBe(false);
      expect(els.update!.hidden, hash).toBe(true);
    }
    expect(html).toContain('הקישור לא שלם. כדאי לבקש קישור חדש.');
  });

  it('opens the app on its own scheme on an iPhone or an iPad, with no Google Play button', () => {
    const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari';
    const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari';
    for (const els of [open(`#${SECRET}`, IPHONE), open(`#${SECRET}`, IPAD, 5)]) {
      expect(els.open).toMatchObject({ hidden: false, href: `${app.expo.scheme}://buddy?k=${SECRET}` });
      expect(els.store!.hidden).toBe(true);
      expect(els.update!.hidden).toBe(true);
      expect(els.iphone!.hidden).toBe(false);
      expect(els.other!.hidden).toBe(true);
    }
    // An incomplete link is one on an iPhone too.
    const bad = open('#', IPHONE);
    expect(bad.open!.hidden).toBe(true);
    expect(bad.bad!.hidden).toBe(false);
    expect(bad.iphone!.hidden).toBe(true);
  });

  it('asks a computer to open the link on the phone', () => {
    // A Mac without a touch screen is a computer, not an iPad.
    const els = open(`#${SECRET}`, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari');
    expect(els.open!.hidden).toBe(true);
    expect(els.other!.hidden).toBe(false);
    expect(els.update!.hidden).toBe(true);
  });

  it('sends nothing anywhere, and hands the store no install referrer', () => {
    expect(html).not.toMatch(/referrer=|fetch\(|XMLHttpRequest|sendBeacon|innerHTML|document\.write|localStorage|document\.cookie/);
    expect(html).toContain('https://play.google.com/store/apps/details?id=site.sederyom.app"');
    expect(html).toContain('אחרי ההתקנה צריך ללחוץ שוב על הקישור.');
    expect(html.replace(/<!--[\s\S]*?-->/, '')).not.toMatch(/·| — /);
  });
});

/** What the public pages promise about friends' boxes must be what the code does (friends spec §5, §6). */
describe('the public pages, about friends', () => {
  const page = (name: string) => readFileSync(join(__dirname, '..', '..', 'public', name), 'utf8');
  const privacy = page('privacy.html');

  it('name sharing with a friend as the one exception to the data staying on the phone', () => {
    expect(page('index.html')).toContain('המידע האישי נשאר בטלפון של התלמיד, חוץ ממה שבוחרים לשתף עם חבר או עם צ׳אט שמחברים, וזה עובר מוצפן.');
    // Friends stay the first exception; the chat connection (spec 7) adds the second, in the same sentence, and the
    // class's exam board (the exam-board design) the third.
    expect(privacy).toContain('המידע לא נמכר, ולא מועבר לאף אחד חוץ מהחברים והצ׳אטים שהתלמיד בוחר לשתף איתם: לחבר, מוצפן, ולצ׳אט, רק מה שהתלמיד סימן, כשהצ׳אט שואל, ומהכיתה, שמקבלת את לוח המבחנים שמשתמש אישר לה.');
    // A parent may approve a board for the class too: "a user", as the Hebrew's "שמשתמש אישר לה"; friends and chats stay the student's.
    expect(privacy).toContain('none is shared\n      with anyone except the friends a student chooses to share with (encrypted),\n      the chats the student links (only what the student marked, when the\n      chat asks), and the class, which gets the exam schedule a user approves\n      for it.');
  });

  it("say what is kept of a box besides the ciphertext, and the numbers the code uses", () => {
    expect(privacy).toContain('את סוג הקופסה (הזמנה, תשובה להזמנה או חברות), איזה מכשיר כתב אותה, ומתי היא נוצרה ומתי עודכנה לאחרונה');
    expect(privacy).toContain(`עד ${MAX_BUDDIES} חברים, כולל הזמנות שעוד לא אושרו, בכל טלפון.`);
    expect(privacy).toContain(`אחרי ${BUDDY_BOX_STALE_DAYS} יום בלי עדכון`);
    expect(privacy).toContain(`not updated for ${BUDDY_BOX_STALE_DAYS} days`);
    expect(privacy).not.toMatch(/\b60 (יום|days)/);
  });

  /**
   * An invite or a reply is never simply deleted: its mark stays (`routes/buddies.ts`), when its writer
   * deletes it, when the sweep finds it still live `BUDDY_INVITE_TTL_DAYS` after it was written (an
   * invite or a reply alike), and when its device is deleted.
   */
  it('say that an invite or a reply leaves a mark, whoever or whatever removes it, and for how long', () => {
    const flat = privacy.replace(/\s+/g, ' ');
    expect(privacy).toContain(`כשהטלפון מוחק אותן, או כשעברו ${BUDDY_INVITE_TTL_DAYS} ימים מאז שהזמנה או תשובה נכתבו, נשאר מהן רק סימון ריק, בלי שום תוכן, כדי שלא יהיה אפשר להשתמש שוב בקישור שלהן. הסימון נמחק אחרי ${BUDDY_BOX_STALE_DAYS} יום מאז שנעשה, גם אם הרישום של הטלפון אצל סדר יום נמחק בינתיים.`);
    expect(flat).toContain(`when the phone deletes it, or when ${BUDDY_INVITE_TTL_DAYS} days have passed since an invitation or its answer was written, only an empty marker with no content stays, for ${BUDDY_BOX_STALE_DAYS} days from then, so that the link cannot be used again. The marker stays even if the phone's record is deleted in the meantime`);
    // No promise that an unanswered invitation is deleted after its week: it becomes a mark.
    expect(privacy).not.toContain(`נמחקת אחרי ${BUDDY_INVITE_TTL_DAYS} ימים`);
    expect(flat).not.toContain(`nobody accepted after ${BUDDY_INVITE_TTL_DAYS} days`);
    expect(flat).not.toContain('nobody accepted an invitation within');
    // The deleted thing is the phone's record with the service, not the phone.
    expect(privacy).not.toContain('גם אם הטלפון נמחק בינתיים');
  });

  it('say what "delete my data" leaves: only the empty marks, pending invitations included, with nothing that ties them to the phone', () => {
    const flat = privacy.replace(/\s+/g, ' ');
    expect(privacy).toContain(`נשארים רק סימונים ריקים של הזמנות ותשובות להזמנות, כולל הזמנות שעוד לא אושרו: בלי שום תוכן ובלי שום דבר שקושר אותם לטלפון, עד ${BUDDY_BOX_STALE_DAYS} יום, כדי שלא יהיה אפשר להשתמש בקישורים שלהן שוב.`);
    expect(flat).toContain(`What stays is only empty markers of invitations and their answers, those not yet accepted included, with no content and nothing that ties them to the phone, for up to ${BUDDY_BOX_STALE_DAYS} days, so that nobody can use those links again.`);
    // Not restricted to the links already used or expired: a pending invitation is emptied too.
    expect(privacy).not.toContain('שכבר שימשו או שפג תוקפם');
    expect(flat).not.toContain('already used or expired');
  });
});
