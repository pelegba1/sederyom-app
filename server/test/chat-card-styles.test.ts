/**
 * The day card's styles (chat day card plan, Task 2): the notebook's colours as CSS variables, once
 * for each scheme, and rules that take their colours from them only.
 */
import { describe, expect, it } from 'vitest';
import { dark, light } from '../../app/src/theme';
import { cardCss } from '../src/chat/card/styles.js';

const css = cardCss(light, dark);

/** The declarations of the rule on its own line whose selector is `selector`. */
function rule(selector: string): string {
  const lines = `\n${css}`;
  const start = lines.indexOf(`\n${selector}{`);
  if (start < 0) throw new Error(`no rule for ${selector}`);
  return lines.slice(start + selector.length + 2, lines.indexOf('}', start));
}

describe('cardCss', () => {
  it('is the same text every time', () => {
    expect(cardCss(light, dark)).toBe(css);
  });

  it('gives each scheme its own variables, from theme.ts', () => {
    const lightRule = rule(':root,:root[data-theme=light]');
    const darkRule = rule(':root[data-theme=dark]');
    expect(lightRule).toContain(`--cancel:${light.cancel}`);
    expect(lightRule).toContain(`--change:${light.change}`);
    expect(lightRule).toContain(`--margin:${light.margin}`);
    expect(lightRule).toContain(`--border-soft:${light.borderSoft}`);
    expect(darkRule).toContain(`--cancel:${dark.cancel}`);
    expect(darkRule).toContain(`--change:${dark.change}`);
    expect(darkRule).toContain(`--margin:${dark.margin}`);
    expect(darkRule).toContain(`--text-faint:${dark.textFaint}`);
  });

  it('is light with no theme, and follows the device in the dark until the host names one', () => {
    const media = css.split('\n').find((l) => l.startsWith('@media (prefers-color-scheme:dark){'));
    expect(media).toBeDefined();
    expect(media).toContain(':root:not([data-theme]){');
    expect(media).toContain(`--cancel:${dark.cancel}`);
    expect(media).toContain(`--margin:${dark.margin}`);
  });

  it('takes every colour from a variable', () => {
    const rules = css.slice(css.indexOf('\nhtml,body{'));
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toMatch(/rgba?\(/);
  });

  it('keeps the page transparent and the card its own', () => {
    expect(rule('html,body')).toContain('background:transparent');
    const card = rule('#card');
    expect(card).toContain('border:1px solid var(--border)');
    expect(card).toContain('border-radius:12px');
    expect(card).toContain('background:var(--bg)');
    expect(rule('#card:empty')).toContain('display:none');
  });

  it('draws the margin line at the start edge, in the margin colour', () => {
    expect(rule('#card::before')).toContain('inset-inline-start:34px');
    expect(rule('#card::before')).toContain('background:var(--margin)');
  });

  it('paints the margin line over the rows, which are positioned and tinted', () => {
    // A positioned row with no z-index of its own paints after the line (which comes first in the card) and over it.
    expect(rule('.row')).toContain('position:relative');
    expect(rule('#card::before').split(';')).toContain('z-index:1');
    expect(rule('#card::before')).toContain('pointer-events:none');
  });

  it('lets a row wrap, with its note on a line of its own, and gives adjacent spans a gap', () => {
    expect(rule('.row')).toContain('flex-wrap:wrap');
    expect(rule('.note')).toContain('flex-basis:100%');
    for (const selector of ['.m', '.hd small', '.foot']) expect(rule(selector), selector).toMatch(/gap:\d+px/);
  });

  it('wraps long text and never scrolls sideways', () => {
    expect(rule('#card')).toContain('overflow-wrap:anywhere');
    expect(rule('#card')).toContain('overflow:hidden');
    expect(rule('.s')).toContain('min-width:0');
    expect(rule('.m')).toContain('min-width:0');
  });

  it('strikes the subject of a cancelled lesson, and not its tag', () => {
    expect(rule('.cx .s')).toContain('text-decoration:line-through');
    expect(css).not.toMatch(/\.cx \.tag|\.cx \.t-cx|\.cx \*/);
  });

  it('colours the tags and the banner as the app does', () => {
    expect(rule('.t-cx')).toContain('color:var(--cancel)');
    expect(rule('.t-cx')).toContain('background:var(--cancel-soft)');
    expect(rule('.t-ch')).toContain('color:var(--change)');
    expect(rule('.t-ch')).toContain('background:var(--change-soft)');
    expect(rule('.t-ex')).toContain('color:var(--exam)');
    expect(rule('.t-ex')).toContain('background:var(--exam-soft)');
    expect(rule('.banner')).toContain('background:var(--exam-soft)');
    expect(rule('.banner')).toContain('color:var(--exam)');
  });

  it('tints an exam row and a changed row, softer than their tags, with a plain tint where color-mix is missing', () => {
    expect(rule('.row.ex')).toBe('background:var(--exam-soft);background:color-mix(in srgb,var(--exam-soft) 45%,transparent)');
    expect(rule('.row.ch')).toBe('background:var(--change-soft);background:color-mix(in srgb,var(--change-soft) 45%,transparent)');
  });

  it('keeps an exam row yellow when it also changed: the exam tint comes after the change tint (spec 2.3)', () => {
    // both rules are one class deep, so the later one wins on a row that has both classes
    expect(css.indexOf('\n.row.ch{')).toBeGreaterThan(-1);
    expect(css.indexOf('\n.row.ex{')).toBeGreaterThan(css.indexOf('\n.row.ch{'));
  });

  it('starts every line of text past the margin line, and keeps the hour numbers outside it', () => {
    for (const selector of ['.hd', '.line', '.plain', '.foot']) expect(rule(selector), selector).toContain('padding-inline-start:40px');
    expect(rule('.banner')).toContain('margin-inline-start:40px');
  });

  it('keeps every line of a row past the margin line, and only the hour number in the margin column', () => {
    // The row itself starts its content 40px in, after its padding shorthand (which would reset it if it came later),
    // so a teacher and a room, or a note, that wrap onto a line of their own start there too.
    const row = rule('.row').split(';');
    expect(row).toContain('position:relative');
    expect(row).toContain('padding-inline-start:40px');
    expect(row.indexOf('padding-inline-start:40px')).toBeGreaterThan(row.indexOf('padding:7px 14px'));
    // The number leaves the flow and stands in the margin column: 14px in, 16px wide, so it ends at 30px, left of the line at 34px.
    const number = rule('.n').split(';');
    expect(number).toContain('position:absolute');
    expect(number).toContain('inset-inline-start:14px');
    expect(number).toContain('width:16px');
    // Nothing else shifts a line of the row: a note's own start padding would add to the row's.
    for (const selector of ['.s', '.m', '.note']) expect(rule(selector), selector).not.toMatch(/padding-inline-start|margin-inline-start|padding-left|margin-left/);
  });

  it('asks for nothing outside, and loads no font', () => {
    for (const outside of ['url(', '@import', '@font-face', 'http', 'src:']) expect(css).not.toContain(outside);
    expect(rule('body')).toContain('font-family:"Assistant","Segoe UI",Arial,sans-serif');
  });

  it('sets no size below the notebook\'s floor of 12', () => {
    const sizes = [...css.matchAll(/font-size:(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
    expect(sizes.length).toBeGreaterThan(3);
    expect(Math.min(...sizes)).toBeGreaterThanOrEqual(12);
  });

  it('has no carriage return', () => {
    expect(css).not.toContain('\r');
  });
});
