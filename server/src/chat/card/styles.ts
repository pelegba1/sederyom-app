/**
 * The day card's styles (chat connection spec 2.3, direction א of the sketch, the `.sy` rules): the
 * notebook's colours as CSS variables, once for each scheme, and rules that take every colour from them.
 *
 * `view.ts` adds the result as a `<style>` when the page starts, so the page itself holds no CSS and the
 * build script evaluates no TypeScript. Runs in the chat's frame: this file imports a type only.
 *
 * The scheme is the host's: `view.ts` sets `data-theme` on `<html>` from the host's answer. Until it
 * does, the page is light, or dark when the device is (the media query). The page declares no
 * `color-scheme`, which would paint the frame an opaque canvas whenever the host's scheme differs.
 *
 * The red margin line stands at the start edge, 34px in: the hour numbers sit outside it, in a column
 * of their own (`.n`, out of the row's flow), and every other line of text starts 40px in, where the
 * subjects start, so no text is cut by the line. A row has that 40px as its own start padding, so a
 * teacher and a room, or a note, that wrap onto a line of their own start there too.
 *
 * Long text wraps (`overflow-wrap: anywhere`, `min-width: 0` on what flexes), so a 320px chat never
 * scrolls sideways. One rule to a line: the build must give the same text on every machine.
 */
import type { Palette } from '../../../../app/src/theme';

/** The tokens of `theme.ts` the card uses. */
const KEYS = [
  'bg', 'border', 'borderSoft', 'text', 'textStrong', 'textMuted', 'textFaint',
  'cancel', 'cancelSoft', 'change', 'changeSoft', 'exam', 'examSoft', 'margin',
] as const satisfies readonly (keyof Palette)[];

/** A palette as `theme.ts` has it: every key a colour (`light` and `dark` have different literal types). */
export type CardPalette = Readonly<Record<(typeof KEYS)[number], string>>;

/** `borderSoft` → `--border-soft`. */
const variable = (key: string): string => `--${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
const variables = (palette: CardPalette): string[] => KEYS.map((key) => `${variable(key)}:${palette[key]}`);

/** A rule on one line: `selector{a:b;c:d}`. */
const rule = (selector: string, ...declarations: string[]): string => `${selector}{${declarations.join(';')}}`;

/** A row, a banner, a line or a footer starts where the subjects do, past the margin line. */
const START = 'padding-inline-start:40px';
/** A tint from the palette's soft colour at about the strength the sketch gave a row; plain soft where `color-mix` is missing. */
const tint = (token: string): string[] => [`background:var(${token})`, `background:color-mix(in srgb,var(${token}) 45%,transparent)`];

export function cardCss(light: CardPalette, dark: CardPalette): string {
  return [
    rule(':root,:root[data-theme=light]', ...variables(light)),
    rule(':root[data-theme=dark]', ...variables(dark)),
    `@media (prefers-color-scheme:dark){${rule(':root:not([data-theme])', ...variables(dark))}}`,
    rule('html,body', 'margin:0', 'padding:0', 'background:transparent'),
    rule('body', 'font-family:"Assistant","Segoe UI",Arial,sans-serif', 'font-size:14px', 'line-height:1.45', 'color:var(--text)'),
    rule('#card', 'position:relative', 'overflow:hidden', 'overflow-wrap:anywhere', 'border:1px solid var(--border)', 'border-radius:12px', 'background:var(--bg)', 'color:var(--text)'),
    rule('#card:empty', 'display:none'),
    // z-index: the rows are positioned (`.row` holds its hour number), so they would paint over a line that has none.
    rule('#card::before', 'content:""', 'position:absolute', 'z-index:1', 'top:0', 'bottom:0', 'inset-inline-start:34px', 'width:1px', 'background:var(--margin)', 'pointer-events:none'),
    rule('.hd', 'display:flex', 'flex-wrap:wrap', 'justify-content:space-between', 'align-items:baseline', 'gap:4px 10px', 'padding:10px 14px 8px', START, 'border-bottom:1px solid var(--border-soft)'),
    rule('.hd b', 'min-width:0', 'font-size:16px', 'color:var(--text-strong)'),
    rule('.hd small', 'display:flex', 'flex-wrap:wrap', 'gap:8px', 'min-width:0', 'font-size:12px', 'color:var(--text-faint)'),
    // The hour number is taken out of the flow and stands in the margin column (14px in, 16px wide, left of
    // the line at 34px); every line of the row, a wrapped teacher and room or a note, starts at the padding.
    // Its line height is the subject's (14px x 1.45), so its baseline is the subject's, give or take a pixel.
    rule('.row', 'position:relative', 'display:flex', 'flex-wrap:wrap', 'align-items:baseline', 'gap:4px 10px', 'padding:7px 14px', START, 'border-bottom:1px solid var(--border-soft)'),
    rule('.n', 'position:absolute', 'top:7px', 'inset-inline-start:14px', 'width:16px', 'text-align:center', 'font-size:12px', 'line-height:1.7', 'color:var(--text-faint)'),
    rule('.s', 'flex:1 1 9em', 'min-width:0'),
    rule('.m', 'display:flex', 'flex-wrap:wrap', 'gap:8px', 'min-width:0', 'font-size:12px', 'color:var(--text-muted)'),
    rule('.foot', 'display:flex', 'flex-wrap:wrap', 'gap:8px', 'padding:6px 14px 10px', START, 'font-size:12px', 'color:var(--text-faint)'),
    // Adjacent spans were told apart by a middle dot in the sketch; the copy has none, so a thin rule does it.
    rule('.m span+span,.hd small span+span,.foot span+span', 'padding-inline-start:8px', 'border-inline-start:1px solid var(--border)'),
    rule('.note', 'flex-basis:100%', 'font-size:12px', 'color:var(--text-muted)'),
    rule('.cx .s', 'text-decoration:line-through', 'color:var(--cancel)'),
    // A row that is both stays yellow (spec 2.3): same specificity, so `.row.ex` goes last. Its change tag still shows.
    rule('.row.ch', ...tint('--change-soft')),
    rule('.row.ex', ...tint('--exam-soft')),
    rule('.tag', 'display:inline-block', 'padding:1px 6px', 'border-radius:6px', 'font-size:12px', 'line-height:1.4'),
    rule('.s .tag', 'margin-inline-start:6px'),
    rule('.t-cx', 'color:var(--cancel)', 'background:var(--cancel-soft)'),
    rule('.t-ch', 'color:var(--change)', 'background:var(--change-soft)'),
    rule('.t-ex', 'color:var(--exam)', 'background:var(--exam-soft)'),
    rule('.banner', 'margin:10px 14px', 'margin-inline-start:40px', 'padding:8px 10px', 'border-radius:8px', 'font-size:13px', 'color:var(--exam)', 'background:var(--exam-soft)'),
    rule('.line', 'padding:7px 14px', START, 'font-size:13px', 'color:var(--text-muted)'),
    rule('.plain', 'padding:12px 14px', START, 'line-height:1.5'),
  ].join('\n');
}
