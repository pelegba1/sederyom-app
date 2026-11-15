import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconName =
  | 'day' | 'week' | 'calendar' | 'plan' | 'tasks' | 'school' | 'bell' | 'settings'
  | 'chevronLeft' | 'chevronRight' | 'chevronDown' | 'arrowRight'
  | 'exam' | 'homework' | 'change' | 'cancel' | 'summary' | 'grade' | 'message'
  | 'link' | 'help' | 'undo' | 'close' | 'check' | 'plus' | 'moreVert' | 'people';

/**
 * Consistent strokes stay legible in both Android themes and font scales.
 *
 * The chevrons are named by the physical direction they point, on purpose.
 * They used to be the text glyphs `‹` and `›`, which are bidi-mirrored
 * characters: next to Hebrew the shaper flips them, alone in a line it does
 * not, so the same glyph pointed left in one row and right in the next. An
 * SVG is not subject to the bidi algorithm. In this RTL app "open" and "next"
 * point left (`chevronLeft`), "previous" points right (`chevronRight`), and
 * so does "back" in a stack screen's header (`arrowRight`).
 *
 * `check` is the drawn tick (plan §16.2: never the tick character in a
 * string), for a chosen filter; `plus` is the "+" of the add button;
 * `moreVert` is Android's "⋮", a menu of more actions, drawn as three dots.
 *
 * For the same reason `undo` is drawn for a right-to-left reader: its arrow
 * turns back to the right, where a Hebrew line starts.
 */
export function AppIcon({ name, color, size = 24 }: { name: IconName; color: string; size?: number }): React.JSX.Element {
  return <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    {name === 'day' ? <><Rect x={4} y={3} width={16} height={18} rx={3} /><Path d="M8 8h8M8 12h8M8 16h4" /></> : null}
    {name === 'calendar' || name === 'week' ? <><Rect x={3} y={5} width={18} height={16} rx={3} /><Path d="M7 3v4M17 3v4M3 10h18" />
      {name === 'calendar' ? <><Circle cx={8} cy={14} r={.6} /><Circle cx={12} cy={14} r={.6} /><Circle cx={16} cy={14} r={.6} /><Circle cx={8} cy={18} r={.6} /><Circle cx={12} cy={18} r={.6} /></> : <Path d="M9 10v11M15 10v11M3 15h18" />}</> : null}
    {/* The "תכנון" tab: a calendar page with one large tick — something planned.
        Unlike `week` it has no grid, unlike `tasks` it has a frame, and unlike
        `exam` (a clipboard) it carries the calendar's pins and header. */}
    {name === 'plan' ? <><Rect x={3} y={5} width={18} height={16} rx={3} /><Path d="M7 3v4M17 3v4M3 10h18" /><Path d="m8.5 15.5 2.5 2.5 4.5-4.5" /></> : null}
    {name === 'tasks' ? <><Path d="m3 6 2 2 4-4M12 6h9m-18 8 2 2 4-4M12 14h9M12 20h9" /></> : null}
    {name === 'school' ? <><Path d="m2 9 10-5 10 5-10 5-10-5Zm4 2v6c4 3 8 3 12 0v-6M22 9v7" /></> : null}
    {name === 'bell' ? <><Path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 8H3c0-1 3-1 3-8ZM9 21h6" /></> : null}
    {/* A gear of eight teeth, symmetric about the centre: the hand-drawn outline it replaces was lopsided. */}
    {name === 'settings' ? <><Circle cx={12} cy={12} r={3} /><Path d="M10.37 5.19 10.42 2.53h3.16l.05 2.66 2.03.84 1.91-1.85 2.25 2.25-1.85 1.91.84 2.03 2.66.05v3.16l-2.66.05-.84 2.03 1.85 1.91-2.25 2.25-1.91-1.85-2.03.84-.05 2.66h-3.16l-.05-2.66-2.03-.84-1.91 1.85-2.25-2.25 1.85-1.91-.84-2.03-2.66-.05v-3.16l2.66-.05.84-2.03-1.85-1.91 2.25-2.25 1.91 1.85Z" /></> : null}
    {name === 'chevronLeft' ? <Path d="m15 6-6 6 6 6" strokeWidth={2} /> : null}
    {name === 'chevronRight' ? <Path d="m9 6 6 6-6 6" strokeWidth={2} /> : null}
    {name === 'chevronDown' ? <Path d="m6 9 6 6 6-6" strokeWidth={2} /> : null}
    {/* An arrow pointing right, which is back in a right-to-left stack. */}
    {name === 'arrowRight' ? <Path d="M5 12h14m-6-6 6 6-6 6" strokeWidth={2} /> : null}
    {/* A clipboard with a tick: an exam or a submission date. */}
    {name === 'exam' ? <><Rect x={5} y={4} width={14} height={17} rx={2.5} /><Path d="M9 2.5h6v3H9z" /><Path d="m9 13.5 2 2 4-4" /></> : null}
    {/* An open book: homework. */}
    {name === 'homework' ? <><Path d="M12 6.5C10.2 5 7.6 4.5 4 4.5v14c3.6 0 6.2.5 8 2 1.8-1.5 4.4-2 8-2v-14c-3.6 0-6.2.5-8 2Z" /><Path d="M12 6.5v14" /></> : null}
    {/* Two opposed arrows: something in the timetable moved or changed hands. */}
    {name === 'change' ? <><Path d="M4 8h14m-3-3 3 3-3 3" /><Path d="M20 16H6m3-3-3 3 3 3" /></> : null}
    {/* A struck-through circle: cancelled. */}
    {name === 'cancel' ? <><Circle cx={12} cy={12} r={9} /><Path d="m5.6 5.6 12.8 12.8" /></> : null}
    {/* A page with a folded corner and lines: a summary. */}
    {name === 'summary' ? <><Path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><Path d="M14 3v5h5M9 13h6M9 17h4" /></> : null}
    {/* A rosette: a grade. */}
    {name === 'grade' ? <><Circle cx={12} cy={9} r={6} /><Path d="m8.5 13.8-1.5 7.2 5-2.8 5 2.8-1.5-7.2" /></> : null}
    {/* A speech bubble: a message from a teacher. */}
    {name === 'message' ? <><Path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9Z" /><Path d="M8 9h8M8 12.5h5" /></> : null}
    {/* Two chain links: open the source, a link elsewhere. */}
    {name === 'link' ? <><Path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><Path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></> : null}
    {/* A question mark in a circle: help. */}
    {name === 'help' ? <><Circle cx={12} cy={12} r={9} /><Path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.4V14M12 17.3v.2" /></> : null}
    {/* A hooked arrow turning back to the right: undo, in a right-to-left UI. */}
    {name === 'undo' ? <><Path d="m15 14 5-5-5-5" /><Path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></> : null}
    {name === 'close' ? <Path d="M6 6l12 12M18 6 6 18" strokeWidth={2} /> : null}
    {name === 'check' ? <Path d="m5 12.5 4.5 4.5L19 7.5" strokeWidth={2} /> : null}
    {name === 'plus' ? <Path d="M12 5v14M5 12h14" strokeWidth={2} /> : null}
    {/* Three dots one over the other: Android's menu of more actions. Filled, not stroked. */}
    {name === 'moreVert' ? <><Circle cx={12} cy={5.5} r={1.9} fill={color} stroke="none" /><Circle cx={12} cy={12} r={1.9} fill={color} stroke="none" /><Circle cx={12} cy={18.5} r={1.9} fill={color} stroke="none" /></> : null}
    {/* Two heads and their shoulders, one a little behind the other: friends (the sketch's glyph). */}
    {name === 'people' ? <><Circle cx={9} cy={8} r={3.2} /><Path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" /><Circle cx={17} cy={9} r={2.6} /><Path d="M16.5 13.6c2.6.2 4.5 2 4.5 4.9" /></> : null}
  </Svg>;
}
