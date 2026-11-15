/**
 * The two school sources never spell a subject the same way. These pin what
 * counts as the same published line (exact) and what counts as the same subject
 * across sources (fuzzy, conservative).
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalSubject, lessonInMashov, normalizeSubject, plainSubject, plainSubjects, subjectKey, subjectsMatch, teachersMatch,
} from '../src/lib/subjects.js';

describe('subject keys', () => {
  it('keeps two published lines apart when only a bracket differs', () => {
    // The live grid really does carry both, under different teachers.
    expect(subjectKey('היסטוריה (יא1)')).not.toBe(subjectKey('היסטוריה'));
  });

  it('unifies whitespace and the two spellings of the quote mark', () => {
    expect(subjectKey('אנגלית  5 יח״ל')).toBe(subjectKey('אנגלית 5 יח"ל'));
  });
});

describe('subject matching', () => {
  it('strips levels, groups and brackets', () => {
    expect(normalizeSubject('מתמטיקה 3 יח"ל (יא1)')).toBe('מתמטיקה');
    expect(normalizeSubject('אנגלית 5 יח״ל')).toBe('אנגלית');
    expect(normalizeSubject('פיזיקה מוגבר קבוצה ב')).toBe('פיזיקה ב');
  });

  it('reads the abbreviations the sources use', () => {
    expect(canonicalSubject('חנ״ג')).toBe('חינוך גופני');
    expect(subjectsMatch('חינוך גופני', 'חנ"ג')).toBe(true);
    expect(subjectsMatch('ספורט', 'חינוך גופני')).toBe(true);
    expect(subjectsMatch('מתמ׳', 'מתמטיקה 3 יח"ל')).toBe(true);
  });

  it('matches the live grid against plausible Mashov group names', () => {
    expect(subjectsMatch('אנגלית 5 יח"ל', 'אנגלית')).toBe(true);
    expect(subjectsMatch('תנ"ך (יא1)', 'תנך')).toBe(true);
    expect(subjectsMatch('עולם הערבים והאסלם (יא1)', 'עולם הערבים והאסלאם')).toBe(true);
    expect(subjectsMatch('כישורי חיים', 'כישורי חיים יב')).toBe(true);
  });

  it('does not confuse different subjects that share a word', () => {
    expect(subjectsMatch('מדעי המחשב', 'מדעי הסביבה')).toBe(false);
    expect(subjectsMatch('כימיה', 'כישורי חיים')).toBe(false);
    // Homeroom and PE share their first word; they are not the same lesson.
    expect(subjectsMatch('חינוך', 'חינוך גופני')).toBe(false);
    expect(subjectsMatch('חינוך (יא1)', 'חנ״ג')).toBe(false);
  });
});

describe('subjects as the app shows them (plainSubject)', () => {
  it('drops the group and the level, and keeps the subject', () => {
    expect(plainSubject('אנגלית 5 יח"ל (יב2)')).toBe('אנגלית');
    expect(plainSubject('מתמטיקה 5 יח״ל (יב2)')).toBe('מתמטיקה');
    expect(plainSubject('פיזיקה מורחב (מעבדת פיסיקה)')).toBe('פיזיקה');
    expect(plainSubject('שרותי רשת (מעבדת מחשבים 1)')).toBe('שרותי רשת');
    expect(plainSubject("מתמטיקה 5 יח'")).toBe('מתמטיקה');
    expect(plainSubject('ביולוגיה - 5 יחידות')).toBe('ביולוגיה');
  });

  it("keeps the school's own word and writes its quote marks in Hebrew", () => {
    expect(plainSubject('ספורט')).toBe('ספורט');
    expect(plainSubject('תנ"ך (יא1)')).toBe('תנ״ך');
    expect(plainSubject('חנ״ג')).toBe('חנ״ג');
    expect(plainSubject('אנגלית דוברי')).toBe('אנגלית דוברי');
  });

  it('falls back to the input when nothing would be left', () => {
    expect(plainSubject('(יב2)')).toBe('(יב2)');
    expect(plainSubject('')).toBe('');
  });

  it('names each subject once, in first-seen order', () => {
    expect(plainSubjects(['אנגלית 5 יח"ל (יב2)', 'פיזיקה מורחב (יב3)', 'אנגלית', 'פיזיקה מורחב (מעבדת פיסיקה)']))
      .toEqual(['אנגלית', 'פיזיקה']);
  });
});

describe('teachers and groups', () => {
  it('accepts a teacher named either way round', () => {
    expect(teachersMatch('נקש ירדנה', 'ירדנה נקש')).toBe(true);
    expect(teachersMatch('נקש ירדנה', 'כהן דנה')).toBe(false);
    expect(teachersMatch('נקש ירדנה', null)).toBeNull();
  });

  it('separates two groups of one subject by their teachers', () => {
    const groups = [{ subject: 'מתמטיקה', groupName: 'מתמטיקה 3 יח"ל', teacher: 'גאיה קשת' }];
    expect(lessonInMashov({ subject: 'מתמטיקה 3 יח"ל', teacher: 'קשת גאיה' }, groups)).toBe(true);
    expect(lessonInMashov({ subject: 'מתמטיקה 3 יח"ל (יא1)', teacher: 'אשל גאולה' }, groups)).toBe(false);
    expect(lessonInMashov({ subject: 'כימיה', teacher: 'לוי' }, groups)).toBe(false);
  });

  it('lets the subject alone decide when Mashov names no teacher', () => {
    const groups = [{ subject: 'מתמטיקה', groupName: null, teacher: null }];
    expect(lessonInMashov({ subject: 'מתמטיקה 3 יח"ל (יא1)', teacher: 'אשל גאולה' }, groups)).toBe(true);
  });
});
