/**
 * The Shahaf list tabs as seven other schools served them on 2026-10-28
 * (ideas ל2). The first school's fixtures had no exams and no events, so the
 * list parser had only ever met an empty page, and it read every real one as
 * empty. The markup below is the sites' own; the names are made up.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseChanges, parseDatedList, parseMessages } from '../src/adapters/shahaf/parser.js';
import { MemorySnapshotStore, applyDelta } from '../src/sync/delta.js';
import type { NormalizedEntity, Scope } from '../src/adapters/types.js';

const OPTS = { zone: 'Asia/Jerusalem', year: 2026 };

/** A list tab's page: the module, its tabs, the list, and the "מעודכן ל" line. */
const page = (tab: string, items: string[]) => `<!DOCTYPE html><html><body><main role="main" class="pb-3">
<section class="card mb-3 tt-module" dir="rtl"><div class="card-body">
<ul class="nav nav-tabs mb-3"><li class="nav-item"><a class="nav-link active" href="/?cls=16&amp;tab=${tab}">${tab}</a></li></ul>
<ul class="list-unstyled tt-changes-list mb-0">
${items.map((i) => `<li class="ChangesInfo">${i}</li>`).join('\n')}
</ul>
<div class="UpdateDate"> מעודכן ל: 28.10.2026, שעה: 13:53 </div>
</div></section></main></body></html>`;

describe('exams', () => {
  const exams = parseDatedList(page('exams', [
    '04.11.2026, <b>מבחן בתנ"ך שכבה י"א</b> משיעור 5 עד שיעור 6 לכיתות: יא\'- 1 בקבוצה של אלון רותם, חדר: 50 הקבצה יא-1',
    '04.11.2026, <b>מבחן בתנ"ך שכבה י"א</b> משיעור 5 עד שיעור 6 לכיתות: יא\'- 1 בקבוצה של ברק נועה, חדר: 49 יא-1',
    '08.11.2026, <b>מבחן במתמטיקה שכבה יא</b> משיעור 2 עד שיעור 3 לכיתות: יא\'- 1 בקבוצה של גל עמית, חדר: 50 הקבצה יא-1',
  ]), 'shahaf-exam', OPTS);

  it('reads each line\'s date, its bold title and the rest as details', () => {
    expect(exams.map((e) => [e.date, e.title])).toEqual([
      ['2026-11-04', 'מבחן בתנ"ך שכבה י"א'],
      ['2026-11-08', 'מבחן במתמטיקה שכבה יא'],
    ]);
    expect(exams[1]!.details).toBe('משיעור 2 עד שיעור 3 לכיתות: יא\'- 1 בקבוצה של גל עמית, חדר: 50 הקבצה יא-1');
  });

  it('keeps an exam the grade sits in groups as one, its groups a line each', () => {
    expect(exams[0]!.naturalKey).toBe('shahaf-exam|2026-11-04|מבחן בתנ"ך שכבה י"א');
    expect(exams[0]!.details!.split('\n')).toEqual([
      'משיעור 5 עד שיעור 6 לכיתות: יא\'- 1 בקבוצה של אלון רותם, חדר: 50 הקבצה יא-1',
      'משיעור 5 עד שיעור 6 לכיתות: יא\'- 1 בקבוצה של ברק נועה, חדר: 49 יא-1',
    ]);
  });

  it('is still nothing on an empty page', () => {
    const empty = '<section class="tt-module"><div class="EmptyList py-3">אין מבחנים</div></section>';
    expect(parseDatedList(empty, 'shahaf-exam', OPTS)).toEqual([]);
  });
});

describe('events', () => {
  it('read like exams, a day each for a trip of three', () => {
    const events = parseDatedList(page('events', [
      '10.11.2026, <b>טיול שנתי יא</b> משיעור 0 עד שיעור 10 לכיתות: יא\' 1- מב"ר...יא\' 9',
      '11.11.2026, <b>טיול שנתי יא</b> משיעור 0 עד שיעור 10 לכיתות: יא\' 1- מב"ר...יא\' 9',
      '19.11.2026, <b>תדריך למשואה לכיתות יא1, יא2 </b> שיעור 6 לכיתות: יא\'- 1, יא\'- 2',
    ]), 'shahaf-event', OPTS);
    expect(events.map((e) => [e.date, e.title])).toEqual([
      ['2026-11-10', 'טיול שנתי יא'],
      ['2026-11-11', 'טיול שנתי יא'],
      ['2026-11-19', 'תדריך למשואה לכיתות יא1, יא2'],
    ]);
    expect(events[2]!.details).toBe('שיעור 6 לכיתות: יא\'- 1, יא\'- 2');
  });
});

describe('changes, as other schools word them', () => {
  const changes = parseChanges(page('changes', [
    '28.10.2026, שיעור 2, ארד שקד, מילוי מקום הדר יואב, חדר: אולם ספורט',
    '28.10.2026, שיעור 7, הדר יואב, הביתה',
    '28.10.2026, שיעור 1, זיו אורית, ביטול שעור',
  ]), OPTS);

  it('reads "מילוי מקום" as a substitute and "הביתה" as a lesson not held', () => {
    expect(changes.map((c) => [c.date, c.hourIndex, c.kind])).toEqual([
      ['2026-10-28', 2, 'substitution'],
      ['2026-10-28', 7, 'cancelled'],
      ['2026-10-28', 1, 'cancelled'],
    ]);
  });
});

describe('a list tab answered with the timetable', () => {
  // One site serves its timetable for `tab=messages`; this is a timetable page of the same kind.
  const timetable = readFileSync(join(__dirname, '..', 'fixtures', 'shahaf-schools', 'school-e', 'changestable.html'), 'utf8');

  it('has no messages, exams or events on it', () => {
    expect(parseMessages(timetable, OPTS)).toEqual([]);
    expect(parseDatedList(timetable, 'shahaf-exam', OPTS)).toEqual([]);
  });
});

describe('the first exams a class ever has', () => {
  const exam = (key: string): NormalizedEntity => ({ source: 'shahaf', kind: 'exam', naturalKey: key, payload: { date: '2026-11-04', subject: key, details: null } });
  const scopes: Scope[] = [{ kind: 'exam' }];
  const NOW = new Date('2026-10-28T10:00:00Z');

  it('are its backlog, not news; the next ones are news', async () => {
    const store = new MemorySnapshotStore();
    const first = await applyDelta(store, 'shahaf', [exam('a'), exam('b')], scopes, NOW, { backlogKinds: ['exam'] });
    expect(first.events.map((e) => e.payload.initial)).toEqual([true, true]);
    const next = await applyDelta(store, 'shahaf', [exam('a'), exam('b'), exam('c')], scopes, NOW, { backlogKinds: ['exam'] });
    expect(next.events.map((e) => [e.naturalKey, e.payload.initial ?? false])).toEqual([['c', false]]);
  });
});
