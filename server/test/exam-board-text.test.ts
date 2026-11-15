/**
 * The one text cleaner of the exam board (final review, S-M1), in shared: what a board keeps of a title or of a line
 * of details, on the server (a save, the extractor) and on the phone (its own board), and what the calendar reader
 * keeps of a title. A stranger's text may carry characters a database refuses (NUL, half a surrogate pair), controls,
 * and marks that are not seen but reorder a line or make two spellings of one title (bidi controls, zero-width
 * characters). The key of a row is made of cleaned text, so a title with and without such marks is one exam, and an
 * ordinary title keeps the key it always had.
 */
import { describe, expect, it } from 'vitest';
import { calendarExams } from '@sederyom/shared/logic/exam-board/calendar';
import { normTitle, uploadedExamKey } from '@sederyom/shared/logic/exam-board/keys';
import { BOARD_DETAILS_MAX, BOARD_ROWS_MAX, BOARD_TITLE_MAX, isBoardDay } from '@sederyom/shared/logic/exam-board/rows';
import { parseIcs } from '@sederyom/shared/logic/exam-board/ics';
import { cleanLines, cleanText, withoutMarks } from '@sederyom/shared/logic/exam-board/text';

describe('cleanText', () => {
  it('turns tabs and line breaks into a space, removes every other control, and collapses the spaces', () => {
    expect(cleanText('  מבחן\tבמתמטיקה\r\nפרק  א\n')).toBe('מבחן במתמטיקה פרק א');
    expect(cleanText('מבחן\u0000 ב\u0007מתמטיקה\u001B\u007F\u0085\u009F')).toBe('מבחן במתמטיקה');
  });

  it('removes bidi controls and zero-width characters', () => {
    for (const mark of ['‎', '‏', '‪', '‫', '‬', '‭', '‮', '⁦', '⁧', '⁨', '⁩', '​', '‌', '‍', '﻿']) {
      expect(cleanText(`${mark}מבחן ${mark}באנגלית${mark}`), mark.codePointAt(0)!.toString(16)).toBe('מבחן באנגלית');
    }
  });

  it('removes half a surrogate pair and keeps a whole one', () => {
    expect(cleanText('א\uD83Dב\uDE00ג')).toBe('אבג');
    expect(cleanText('מבחן 😀')).toBe('מבחן 😀');
  });

  it('is empty for a text of nothing but such characters', () => {
    expect(cleanText('​‏\u0000\t\n ﻿')).toBe('');
  });

  it('leaves ordinary text as it is', () => {
    expect(cleanText('מבחן ב"מתמטיקה" (שאלון 035481) - 5 יח׳')).toBe('מבחן ב"מתמטיקה" (שאלון 035481) - 5 יח׳');
  });
});

describe('cleanLines', () => {
  it('cleans each line as cleanText does, drops the lines left empty, and keeps the line breaks', () => {
    expect(cleanLines('שאלון 1\u0000\r\n‮חלק  ב​\n\n  \u0090‏\r שאלון\t3 ')).toBe('שאלון 1\nחלק ב\nשאלון 3');
  });

  it('is empty for a text of nothing but such characters, and leaves one ordinary line as it is', () => {
    expect(cleanLines('​\n\u0000\n \t')).toBe('');
    expect(cleanLines('שאלון 471 - 4 יח"ל')).toBe('שאלון 471 - 4 יח"ל');
  });
});

describe('withoutMarks', () => {
  it('removes the bidi controls and zero-width characters, and nothing else', () => {
    expect(withoutMarks('‏https://a.org/​x‬ ')).toBe('https://a.org/x ');
    expect(withoutMarks('a\tb\nc')).toBe('a\tb\nc');
  });
});

describe('the key of a row', () => {
  it('is made of the cleaned title: with and without marks, one key', () => {
    expect(uploadedExamKey('2026-11-20', '‏מבחן​ במתמטיקה\u0000')).toBe(uploadedExamKey('2026-11-20', 'מבחן במתמטיקה'));
    expect(normTitle(' מבחן\t ב"מתמטיקה"‏ ')).toBe('מבחן במתמטיקה');
  });
});

describe('the rules of a row, one copy for the server and the phone', () => {
  it('has the limits a save holds a board to', () => {
    expect([BOARD_TITLE_MAX, BOARD_DETAILS_MAX, BOARD_ROWS_MAX]).toEqual([200, 500, 400]);
  });

  it('knows a day of the calendar from a string of its shape', () => {
    expect(isBoardDay('2026-11-20')).toBe(true);
    expect(isBoardDay('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-5', '20261120', '', '2026-11-20T00:00']) expect(isBoardDay(bad), bad).toBe(false);
  });
});

describe('the calendar reader', () => {
  it('keeps a title clean of controls and marks', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:e1', 'DTSTART;VALUE=DATE:20261124', 'DTEND;VALUE=DATE:20261125', 'SUMMARY:י"ב- ‏מבחן\u0007 בהיסטוריה​', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(calendarExams(ics, '2026-11-10', 'Asia/Jerusalem').exams.map((e) => e.subject)).toEqual(['מבחן בהיסטוריה']);
  });

  it('keeps the lines of the details, each cleaned of a NUL, a C1 control, a bidi mark and a zero-width character (S-M1)', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:e1', 'DTSTART;VALUE=DATE:20261124', 'DTEND;VALUE=DATE:20261125', 'SUMMARY:מבחן בהיסטוריה',
      'DESCRIPTION:שאלון 1\u0000\\, פרק א\u0090\\n‮שאלון 2​\\n\\n ‏ \\nחלק ב',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, { zone: 'Asia/Jerusalem' }).events[0]!.description).toBe('שאלון 1, פרק א\nשאלון 2\nחלק ב');
    // and that is what a class keeps, and what goes to every phone that follows it
    expect(calendarExams(ics, '2026-11-10', 'Asia/Jerusalem').exams.map((e) => e.details)).toEqual(['שאלון 1, פרק א\nשאלון 2\nחלק ב']);
  });

  it('has no details for a description of nothing but such characters', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:e1', 'DTSTART;VALUE=DATE:20261124', 'DTEND;VALUE=DATE:20261125', 'SUMMARY:מבחן', 'DESCRIPTION:\u0000\\n​\\n ', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    expect(parseIcs(ics, { zone: 'Asia/Jerusalem' }).events[0]!.description).toBeNull();
  });
});
