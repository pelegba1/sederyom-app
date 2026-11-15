const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { transformFileSync } = require('@babel/core');

/** Loads a module of app/src through Babel, its relative imports the same way (as school-tabs.test.cjs does). */
function loadSrc(file, cache) {
  if (cache.has(file)) return cache.get(file).exports;
  const { code } = transformFileSync(file, {
    configFile: false, babelrc: false, presets: ['@babel/preset-typescript'],
    plugins: ['@babel/plugin-transform-modules-commonjs'],
  });
  const module = { exports: {} };
  cache.set(file, module);
  const requireSrc = (id) => (id.startsWith('.') ? loadSrc(path.resolve(path.dirname(file), `${id}.ts`), cache) : require(id));
  new Function('module', 'exports', 'require', code)(module, module.exports, requireSrc);
  return module.exports;
}

const a = loadSrc(path.join(__dirname, '../src/lib/attendance.ts'), new Map());
const plain = (s) => s.replace(/[⁦⁩‏]/g, '');

const subject = (over) => ({
  groupId: '1', subject: 'מתמטיקה', held: 10, remaining: 90, remainingFrom: 'grid', weeklyHours: 5,
  absences: 1, lates: 0, justifiedAbsences: 0, justifiedLates: 0, events: [], ...over,
});

test('the user\'s example: 1 absence of 10 lessons is 10% now, 1% of 100 at the end, 14 more to miss', () => {
  const st = a.standing(subject(), 0.15, 3);
  assert.equal(st.nowShare, 0.1);
  assert.equal(st.total, 100);
  assert.equal(st.allowed, 15);
  assert.equal(st.endShare, 0.01);
  assert.equal(st.safe, 14);
  assert.equal(st.level, 'ok');
  // At 10% a lesson, the semester would end at 10 of 100.
  assert.equal(st.paceCount, 10);
  assert.equal(plain(a.safeLine(st)), 'עוד 14 חיסורים');
  assert.equal(plain(a.nowLine(subject(), st)), 'עכשיו: חיסור אחד מתוך 10 שיעורים, 10%');
});

test('"up to and including 15%": exactly 15% is allowed, and the limit rounds down', () => {
  assert.equal(a.allowedOf(20, 0.15), 3);
  assert.equal(a.allowedOf(21, 0.15), 3);
  assert.equal(a.allowedOf(100, 0.15), 15);
  assert.equal(a.allowedOf(0, 0.15), 0);
  const edge = a.standing(subject({ held: 10, remaining: 10, absences: 3 }), 0.15, 3);
  assert.equal(edge.level, 'close');
  assert.equal(edge.safe, 0);
  assert.equal(plain(a.safeLine(edge)), 'בדיוק על הגבול');
  const over = a.standing(subject({ held: 10, remaining: 10, absences: 5 }), 0.15, 3);
  assert.equal(over.level, 'over');
  assert.equal(plain(a.safeLine(over)), '2 מעל הגבול');
});

test('lates count in whole groups of latesPerAbsence; justified ones never count', () => {
  const st = a.standing(subject({ absences: 2, lates: 5, justifiedAbsences: 4 }), 0.15, 3);
  assert.equal(st.counted, 3);
  // 15 allowed, 2 absences: lates may reach (15 - 2 + 1) * 3 - 1 = 41, so 36 more.
  assert.equal(st.safeLates, 36);
  assert.equal(a.standing(subject({ absences: 2, lates: 5 }), 0.15, 2).counted, 4);
  assert.equal(a.standing(subject({ absences: 0, lates: 5 }), 0.15, 0).counted, 5, 'a bad ratio is read as 1');
  assert.equal(plain(a.extrasLine(subject({ lates: 5, justifiedAbsences: 4 }), 3, st)), '5 איחורים (כל 3 הם חיסור). 4 מוצדקים, לא נספרים. עוד 36 איחורים בלי לעבור');
});

test('no lessons yet: nothing to divide by', () => {
  const st = a.standing(subject({ held: 0, remaining: 0, absences: 0 }), 0.15, 3);
  assert.equal(st.nowShare, null);
  assert.equal(st.endShare, null);
  assert.equal(st.paceCount, null);
  assert.equal(a.nowLine(subject({ held: 0 }), st), 'עוד לא היו שיעורים');
  assert.equal(a.endLine(st), '');
});

test('most at risk first: over, then over at the current pace, then the fewest left', () => {
  const rows = [
    subject({ subject: 'אזרחות', absences: 0, held: 5, remaining: 15 }),
    subject({ subject: 'היסטוריה', held: 10, remaining: 10, absences: 5 }),
    subject({ subject: 'חינוך', absences: 13 }),
    // 6 of 21 so far, 122 in all: 18 allowed, 12 left — but 35 at this pace.
    subject({ subject: 'מתמטיקה', held: 21, remaining: 101, absences: 6 }),
  ].map((s) => ({ subject: s, standing: a.standing(s, 0.15, 3) }));
  assert.deepEqual(rows.sort(a.byRisk).map((r) => r.subject.subject), ['היסטוריה', 'חינוך', 'מתמטיקה', 'אזרחות']);
  const math = rows[2].standing;
  assert.equal(math.paceOver, true);
  assert.equal(math.level, 'close');
  assert.equal(math.paceCount, 35);
  assert.equal(plain(a.paceLine(math)), 'בקצב הנוכחי: 35 חיסורים, 28.7%, מעל הגבול');
  // 0 of 5 is not a pace toward anything; 3 allowed of 20 leaves 3.
  assert.equal(rows[3].standing.paceOver, false);
  assert.equal(rows[3].standing.level, 'ok');
});

test('percent: one decimal at most', () => {
  assert.equal(plain(a.percent(0.0667)), '6.7%');
  assert.equal(plain(a.percent(0.15)), '15%');
  assert.equal(plain(a.percent(2 / 7)), '28.6%');
});

test('days off: a vacation is one range, the owner\'s days stay one by one', () => {
  const r = a.dayOffRanges([
    { date: '2026-10-27', name: 'יום הבחירות', own: false },
    { date: '2026-11-04', name: 'יום חופש שלך', own: true },
    { date: '2026-11-05', name: 'יום חופש שלך', own: true },
    { date: '2026-12-06', name: 'חופשת חנוכה', own: false },
    { date: '2026-12-07', name: 'חופשת חנוכה', own: false },
    { date: '2026-12-11', name: 'חופשת חנוכה', own: false },
  ]);
  assert.deepEqual(r.map((x) => [plain(a.rangeLabel(x)), x.name]), [
    ['27.10', 'יום הבחירות'], ['4.11', 'יום חופש שלך'], ['5.11', 'יום חופש שלך'], ['6.12–7.12', 'חופשת חנוכה'], ['11.12', 'חופשת חנוכה'],
  ]);
  assert.deepEqual(a.toggleDayOff(['2026-11-05'], '2026-11-04'), ['2026-11-04', '2026-11-05']);
  assert.deepEqual(a.toggleDayOff(['2026-11-04', '2026-11-05'], '2026-11-04'), ['2026-11-05']);
});
