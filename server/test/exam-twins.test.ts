/**
 * One entry per exam the class's site and the grade's exam calendar both
 * list (`withoutSiteTwins`). The site's exams were read as empty until
 * 2026-10-28 (ideas ל2), so the two sources never met. The titles below are
 * as the sites and the calendars write them.
 */
import { describe, expect, it } from 'vitest';
import type { ClassExam, ClassFeed } from '@sederyom/shared';
import { DEFAULT_SETTINGS } from '@sederyom/shared';
import { splitSiteTwins, withoutSiteTwins } from '@sederyom/shared/logic/exam-match';
import { localExamsFrom, type LocalSources } from '../../app/src/local/days';

const site = (date: string, subject: string) => ({ naturalKey: `shahaf-exam|${date}|${subject}`, date, subject, source: 'shahaf' as const });
const calendar = (date: string, subject: string) => ({ naturalKey: `school_site|${date}|${subject}`, date, subject, source: 'school_site' as const });
const keys = (exams: { naturalKey: string }[]) => exams.map((e) => e.naturalKey);

describe('an exam both list', () => {
  it('is the calendar\'s, by date and subject', () => {
    const exams = [
      calendar('2026-11-16', 'י"ב מבחן באנגלית'),
      site('2026-11-16', 'מבחן באנגלית שכבה יא'),
      site('2026-11-04', 'מבחן בתנ"ך שכבה י"א'),
      calendar('2026-11-04', 'תנ"ך'),
    ];
    expect(keys(withoutSiteTwins(exams))).toEqual(['school_site|2026-11-16|י"ב מבחן באנגלית', 'school_site|2026-11-04|תנ"ך']);
  });

  it('is the calendar\'s for a block too, and for a subject spelled another way', () => {
    expect(keys(withoutSiteTwins([calendar('2027-02-22', ' י"ב- מבחן בגוש ב '), site('2027-02-22', 'מבחן בגוש ב שכבה יב')])))
      .toEqual(['school_site|2027-02-22| י"ב- מבחן בגוש ב ']);
    expect(keys(withoutSiteTwins([calendar('2026-11-10', 'מבחן בעברית'), site('2026-11-10', 'מבחן בלשון שכבה יא')])))
      .toEqual(['school_site|2026-11-10|מבחן בעברית']);
  });

  it('leaves what only one of them lists, another day, and another source', () => {
    const exams = [
      calendar('2026-11-16', 'מבחן באנגלית'),
      site('2026-11-17', 'מבחן באנגלית שכבה יא'),
      site('2026-11-16', 'מבחן במתמטיקה שכבה יא'),
      site('2026-11-04', 'מבחן עמי"ת'),
      { naturalKey: 'mashov|1', date: '2026-11-16', subject: 'מבחן באנגלית', source: 'mashov' as const },
    ];
    expect(withoutSiteTwins(exams)).toEqual(exams);
  });

  it('leaves an exam without a date alone', () => {
    const exams = [calendar('2026-11-16', 'מבחן באנגלית'), { naturalKey: 'shahaf-exam|x', date: null, subject: 'מבחן באנגלית', source: 'shahaf' as const }];
    expect(withoutSiteTwins(exams)).toEqual(exams);
  });

  it('changes nothing without an exam calendar', () => {
    const exams = [site('2026-11-16', 'מבחן באנגלית שכבה יא'), site('2026-11-16', 'מבחן באנגלית שכבה יב')];
    expect(withoutSiteTwins(exams)).toEqual(exams);
  });
});

describe('the exams withoutSiteTwins takes out', () => {
  it('are the site\'s that the calendar lists, and the rest is exactly withoutSiteTwins', () => {
    const exams = [
      calendar('2026-11-16', 'י"ב מבחן באנגלית'),
      site('2026-11-16', 'מבחן באנגלית שכבה יא'),
      site('2026-11-17', 'מבחן באנגלית שכבה יא'),
      site('2026-11-04', 'מבחן בתנ"ך שכבה י"א'),
      calendar('2026-11-04', 'תנ"ך'),
      { naturalKey: 'mashov|1', date: '2026-11-16', subject: 'מבחן באנגלית', source: 'mashov' as const },
      { naturalKey: 'shahaf-exam|x', date: null, subject: 'מבחן באנגלית', source: 'shahaf' as const },
    ];
    const { kept, twins } = splitSiteTwins(exams);
    expect(kept).toEqual(withoutSiteTwins(exams));
    expect(keys(twins)).toEqual(['shahaf-exam|2026-11-16|מבחן באנגלית שכבה יא', 'shahaf-exam|2026-11-04|מבחן בתנ"ך שכבה י"א']);
    // Every exam is in one of the two, in the order it came.
    expect(keys([...kept, ...twins]).sort()).toEqual(keys(exams).sort());
  });

  it('are none without a calendar, or when the calendar lists none of them', () => {
    const exams = [site('2026-11-16', 'מבחן באנגלית שכבה יא'), site('2026-11-17', 'מבחן במתמטיקה שכבה יא')];
    expect(splitSiteTwins(exams)).toEqual({ kept: exams, twins: [] });
    const withCalendar = [...exams, calendar('2026-12-01', 'פיזיקה')];
    expect(splitSiteTwins(withCalendar)).toEqual({ kept: withCalendar, twins: [] });
    expect(splitSiteTwins([])).toEqual({ kept: [], twins: [] });
  });
});

describe('on the phone', () => {
  const exam = (source: 'shahaf' | 'school_site', date: string, subject: string): ClassExam => ({
    naturalKey: `${source}|${date}|${subject}`, date, subject, details: null, source,
  });
  const feed: ClassFeed = {
    class: { siteUrl: 'https://school.shahaf.site', classId: '7', className: 'יא1', examCalendarId: 'cal' },
    lastOkAt: '2026-10-28T10:00:00.000Z',
    freshness: null,
    lessons: [],
    changes: [],
    exams: [
      exam('shahaf', '2026-11-04', 'מבחן בתנ"ך שכבה י"א'),
      exam('school_site', '2026-11-04', 'מבחן בתנ"ך'),
      exam('shahaf', '2026-11-08', 'מבחן במתמטיקה שכבה יא'),
    ],
    events: [],
    messages: [],
  };
  const src: LocalSources = {
    feed, mashov: [], bagrut: [], google: [], settings: { ...DEFAULT_SETTINGS, classId: '7', className: 'יא1' },
    zone: 'Asia/Jerusalem', now: new Date('2026-10-28T10:00:00Z'),
  };

  it('lists, builds the days and mirrors each exam once', () => {
    expect(localExamsFrom(src, '2026-10-28', '2026-10-28').map((e) => [e.date, e.subject, e.source])).toEqual([
      ['2026-11-04', 'מבחן בתנ"ך', 'school_site'],
      ['2026-11-08', 'מבחן במתמטיקה שכבה יא', 'shahaf'],
    ]);
  });
});
