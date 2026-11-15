# Swiping between the main tabs: design

2026-11-03. A short design: a contained change to the tab navigator, agreed with the user in conversation.

## Why

Testers asked for Apple's design guidelines wholesale. The user declined a restyle (the notebook look stays) but wants selected touches that make the app feel premium. Moving between the bottom-bar tabs with a finger, instead of only tapping each tab, is the first one.

## Goals

- Drag anywhere on a main tab's page sideways and the neighbouring page follows the finger. Past about halfway, or with a flick, it snaps to that page. Otherwise it springs back.
- Order follows the bar, right to left (Today → Week → Planning → Tasks → School). The page moves with the finger, so dragging the finger to the right pulls in the tab to the left, and dragging it to the left goes back. There's no wrap-around at the ends.
  - Corrected 2026-11-03, after the build. The first version of this line, and the playback to the user, said "swiping left brings in the tab to the left". With the page under the finger that's backwards: what's on the left comes in when the finger moves right, as in any right-to-left pager. The user chose "follow the finger", so the behaviour follows the finger and this line was fixed. The user confirmed this direction the same day.
- The bar's highlighter pill slides along the bar with the finger. The arriving tab's label goes from muted to ink as the pill reaches it.
- One light haptic tick when a page settles after a swipe. Taps on the bar don't tick.
- Tapping a tab still works and slides the page there.
- **Dragging along the bar itself** (added 2026-11-03, after the build: the user meant the bar first, and keeps the page swipe as well).
  - The highlighter follows the finger along the bar, and each tab's icon and label brighten as it passes.
  - The page changes only when the finger lifts: it slides to the tab the finger is over, as a tap on that tab would (user's choice, over changing pages live mid-drag).
  - A light tick each time the highlighter enters another tab (user's choice, over one tick on release or none).
  - Off either end of the bar the highlighter stops at the end tab. A drag that's more up-and-down than sideways is ignored, and a tap is still a tap.

## Non-goals

- Any restyle of the bar or the pages. Same pill, labels, ruled line and sizes (`bottomBarLayout`, `TAB_BAR`, `tabBarScale`).
- Swiping inside stack screens (Settings, Buddy, etc.). They stay as they are.

## Anti-goals (a failure even if it works)

- An existing sideways gesture breaks. These are Tasks' `ChipRow` and School's `UnderlineTabs` when they overflow, and Android's edge back gesture.
- Startup or the first taps get slower (see the JS-thread tap-lag work of 2026-11-01).
- RTL order gets mixed up: the wrong page comes in, or the pill moves the opposite way to the page.
- The bar looks different from today when no one is swiping.

## Constraints

- Expo SDK 57, Android-first, iPhone build on TestFlight. There are no over-the-air updates, so every change ships as a build anyway.
- Native RTL is forced (`src/lib/rtl.ts`, `I18nManager.forceRTL`), and `NavigationContainer` has `direction="rtl"`.
- A parent without Google sees three tabs (Today, Week, School). Swiping goes through whichever tabs are shown.
- 15 places navigate into a specific tab (pushes, bridges, in-app links). They must keep working.
- Today and Week listen for `tabPress` (scroll to top on a second tap). That must keep working.
- Nothing is pushed or released without the user's go.

## Approaches

1. **`@react-navigation/material-top-tabs` with the bar at the bottom (chosen).** It's built on `react-native-pager-view` (8.0.2, the version Expo SDK 57 pins), so swipe physics and nested horizontal scrolling are native. The route names, params, deep links and `tabPress` all stay. Costs:
   - a new native module, plus `expo-haptics` (~57.0.2);
   - a custom bar component rebuilding today's look;
   - hide-on-keyboard rebuilt by hand;
   - navigation-prop types change in Today, Week, Planning and School.
2. **Hand-built pager on gesture-handler and Reanimated (already installed).** No new library and full control. But resolving the conflict with the inner sideways rows becomes our job, and it's more code for the same feel.
3. **Dragging along the bar.** It doesn't give the page-follows-finger feel the user chose.

The user picked 1. Dragging along the bar (3) was then added on top of it, at the user's request. It uses gesture-handler (already installed) on the bar, so there's no new library.

## Decided

- The page follows the finger (user).
- Built on the swipeable tab navigator (user).
- A light tick on settle after a swipe, not on taps (user agreed to the proposal).
- The highlighter pill slides with the finger, and labels brighten as it arrives (proposed, not objected to).
- Pages load only when first reached (`lazy`), as today (my call, to protect startup).

## Left to the builder

- How the pill's slide is drawn. It's driven by the navigator's `position` and must stay pixel-identical at rest.
- How the tick tells a swipe from a tap. For example, a flag set on `swipeStart` and consumed when the focused tab changes. It should use `Haptics.selectionAsync()` or the lightest impact, whichever feels lighter on Android.
- Hide-on-keyboard: a `Keyboard` show/hide listener in the custom bar, matching `tabBarHideOnKeyboard` (Android hides; iOS behaviour as today).
- How many neighbouring pages to keep rendered (`lazyPreloadDistance`, the pager's offscreen limit). Decide this after checking startup.

## How it's checked

- `npm test` and `npx tsc --noEmit -p .` in `app/` pass.
- In RTL, on the five-tab and three-tab layouts:
  - swipe direction and pill direction match the bar;
  - deep links land on the right tab;
  - a second tap on Today or Week scrolls to the top;
  - Tasks chips and School sub-tabs scroll at the largest text size before the pager takes over;
  - Android's back gesture still works from the edges.
- Some of this needs a device (haptics, native pager feel). Whatever couldn't be checked off a device is listed in the hand-over.
