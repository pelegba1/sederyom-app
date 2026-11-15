# SederYom — Design Document

> **The original design (v1, August 2026).** It describes a single-owner app
> whose server held the owner's Mashov session and Google tokens. The app now
> works differently: the phone reads Mashov and Google itself and the server
> keeps only public per-class data. See [architecture.md](architecture.md).
> Sections marked *(v1)* describe the old single-owner mode, which has been
> removed from the server's code (its database tables are dropped in a later
> migration); the widgets, the Shahaf site, the exam schedule, the notification
> and settings model, and the verification principles still apply.

**Codename:** SederYom (סדר יום) — provisional, rename freely.
**Status:** Binding design doc, v1.0 (August 2026)
**Scope (v1):** a single-user personal app, not intended for distribution at the time.

---

## 1. Product summary

A personal Android app that unifies everything about the owner's day and week into one place:

1. **Google Calendar** — personal events (read + write).
2. **Google Tasks** — tasks (read + write; Google Tasks is the source of truth for tasks).
3. **Mashov (משוב)** — timetable, homework, grades, teacher messages, bagrut, and attendance (absences and lates, for the absence tracker; ux-plan §17). Login is via the Ministry of Education unified identification (הזדהות אחידה) — see §6.3.
4. **dugma.shahaf.site** — the school's public timetable/changes site (תיכון הדוגמה): merged timetable+changes, changes list, exams, events, general messages.
5. **school.mashov.info** — the school's own website. Its "לוח מבחנים שכבה י״ב" page embeds a public Google calendar holding the grade's whole exam schedule; the server reads that calendar's ICS feed (§6.4). Which of those exams are the owner's is a setting (§7).

The app presents a unified "Today" and "Week" view, sends push notifications on meaningful deltas (schedule change for tomorrow, new homework/exam, configurable per-type), delivers a daily morning summary, and exposes Android home-screen widgets.

### Non-goals (v1)
- iOS.
- Multi-user / distribution. No signup, no user management.
- Writing back to Mashov or the Shahaf site (read-only sources).
- Google Calendar webhooks (polling with sync tokens is sufficient; see §6.2).

---

## 2. Architecture overview *(v1)*

```
┌─────────────────────────────┐        ┌──────────────────────────────────┐
│  Android app (Expo RN)      │  HTTPS │  Backend (Oracle Always Free VM) │
│  - Today / Week / Tasks /   │◄──────►│  Docker Compose:                 │
│    School / Settings        │        │   - Fastify API (TypeScript)     │
│  - Onboarding: Google OAuth │        │   - Postgres (Prisma)            │
│    + Mashov WebView login   │        │   - Caddy (TLS, reverse proxy)   │
│  - Widgets (2)              │        │  In-process scheduler:           │
│  - expo-notifications       │        │   - Pollers per source           │
└─────────────┬───────────────┘        │   - Delta engine                 │
              │ push                   │   - Notification engine          │
       Expo Push API ◄─────────────────┤   - Morning summary cron         │
                                       └───────┬──────────────────────────┘
                                               │ outbound only
                    ┌──────────────┬───────────┼──────────────┬───────────┐
                    ▼              ▼           ▼              ▼           │
             Google Calendar  Google Tasks  Mashov API   dugma.shahaf.site
             (OAuth2, poll)   (OAuth2, poll)(captured     (HTML scrape)
                                            session)
```

**Why a backend at all:** Mashov and the Shahaf site have no push. Someone must poll them and detect deltas; device-side polling (WorkManager) is unreliable under Android battery optimization, especially for the critical "tomorrow's schedule changed" evening notification. The backend is also the only holder of Google tokens and the Mashov session.

**Hosting decision:** Oracle Cloud Always Free (Ampere ARM VM, 4 OCPU / 24 GB). Truly free and always-on. Known caveat: Oracle reclaims *idle* Always Free ARM instances; our pollers generate continuous CPU/network activity, but add an uptime monitor (free tier of UptimeRobot or similar) and document the "upgrade to PAYG account, stay within free limits" mitigation if a reclaim notice ever arrives. Fallback plan if Oracle signup fails: Render free web service + external keep-alive ping (degraded), or a cheap VPS.

**Domain/TLS:** one subdomain pointed at the VM (any domain you control, or a free DDNS name), Caddy for automatic HTTPS. Required for the Google OAuth redirect URI.

---

## 3. Mobile app

- **Stack:** Expo (React Native, TypeScript). Android-only. Requires a **development build / EAS build** (not Expo Go) because of the widget native module.
- **Navigation:** bottom tabs — **היום** (Today), **שבוע** (Week), **משימות** (Tasks), **בית ספר** (School), plus Settings via header. FAB on Today/Tasks → new task.
- **Language/direction:** Hebrew, RTL-native. `I18nManager.forceRTL(true)`. All source data is Hebrew; there is no LTR mode.
- **Local state:** react-query against the backend API; MMKV for the widget feed cache and small persisted state.

### 3.1 Screens

| Screen | Content |
|---|---|
| **היום (Today)** | Hero: date + Hebrew date (`@hebcal/core`). Merged day timeline: school lessons (with changes already merged in — cancelled lessons struck through, substitutions labeled), Google Calendar events, tasks due today. "Now" indicator line. Chips for exams today/tomorrow. Pull-to-refresh triggers backend sync. |
| **שבוע (Week)** | Sunday–Friday grid, same merged model per day; week navigation (matching the Shahaf site's `week` offset). Exams and events rendered as day-level chips above the grid. |
| **משימות (Tasks)** | Google Tasks lists; create/complete/edit inline (writes go to Google Tasks via backend). Homework items from Mashov appear in a separate "שיעורי בית" section with a one-tap "הפוך למשימה" action (creates a linked Google Task; link stored in backend metadata). |
| **בית ספר (School)** | Sub-tabs: ציונים (grades feed, newest first), שיעורי בית (homework by date), הודעות (teacher messages from Mashov + general messages from the Shahaf site, merged, source-labeled), מבחנים (upcoming exams with countdown), בגרות, חיסורים (absences against the semester's 15% limit; ux-plan §17). |
| **התראות (Notification log)** | Reachable from Today header: chronological log of every push the backend sent (backed by `notification_log`). Answers "did I miss something?". |
| **הגדרות (Settings)** | §7. Links to the three screens below; every toggle from §7. |
| **מצב חיבורים (Connections)** | Reachable from Settings and from the Today banner: one card per source with its state, last successful sync, the school site's own freshness, reconnect actions and "סנכרון עכשיו". "לא מחובר" means the server holds no credentials; a captured session that has not polled yet reads "ממתין לסנכרון". |
| **השיעורים שלי (My lessons)** | Every line the school site publishes for the class, with a switch each; Mashov's personal timetable can set the switches in one tap (§7). |
| **יומן Google (Calendars)** | Per-calendar switches and the list of events hidden by long-press on Today, with a way back (§7). |

### 3.2 Onboarding (first run) *(v1)*
1. Pair with backend (the app ships with the backend URL + a static bearer token; see §8).
2. Google sign-in: system browser → backend OAuth callback → done.
3. Mashov sign-in: in-app WebView on the הזדהות אחידה flow; on success the app captures the session and posts it to the backend (§6.3).
4. Class selection for the Shahaf site: fetched list of classes from backend (scraped `<select>`).
5. Notification permission + settings defaults.

---

## 4. Widgets (Android)

Library: `react-native-android-widget` via Expo config plugin.

| Widget (provider name) | Size | Content |
|---|---|---|
| **מערכת** (`Today`) | 4x2, resizable | One day's lessons with changes merged (cancelled in red with "בוטל", substitution/moved in amber with the detail), the lesson in progress highlighted, a changes badge and the day's exam. Header pages the day: the two pills name the previous and next day (previous at the start edge, next at the end edge), the title returns to today. Paging happens in the widget task from the cached feed — no network on a tap — and each placed copy keeps its own cursor by widget id, reset when the feed's date rolls over. Rows follow the widget's height. Tap → app. |
| **משימות** (`TasksExams`) | 2x2, resizable | Every open Google task, ordered late → due today → this week → later → undated, with a due label per row and a badge summarising the urgent count. Tap → app. |
| **סדר יום** (`Overview`) | 4x3, resizable | The day at a glance: lessons on the start side; on the end side what is next in the calendar, the coming exams with countdown, and the tasks that are late, due today or due this week. Leads with today until the last lesson has ended, then with the next school day ("מחר"), because the evening question is tomorrow. Tap → app. |

The provider names `Today` and `TasksExams` predate the current widgets and are kept on purpose: the native provider class is derived from the name, and renaming one makes every placed copy disappear on update.

**Data path:** widgets never call the network directly. The backend exposes `GET /widget-feed` returning one compact JSON: a window of days from two days back to six ahead (each with its merged lessons, calendar events, tasks due and exams), every open task, the next exams, and a generated-at timestamp. The app stores it in MMKV; the widgets render from MMKV. Both palettes are rendered and Android picks by system theme.

**Refresh strategy (three triggers, all cheap):**
1. Periodic widget update (Android minimum ~30 min) → headless task fetches `/widget-feed`, writes MMKV, re-renders.
2. Every push notification also carries a data payload → notification receipt triggers the same refresh.
3. App foreground → refresh.

**Staleness rule:** widget footer shows "עודכן HH:MM"; if the feed is older than 3 hours, render the footer in the warning color. Never show stale data as fresh — this is a product invariant.

More widgets may be requested during implementation; the widget-feed endpoint and MMKV cache are designed so a new widget is UI-only work.

---

## 5. Backend *(v1)*

- **Stack:** Fastify + TypeScript, Prisma + Postgres, node-cron in-process scheduler. Single process, single container (+ Postgres container + Caddy). No queue infrastructure — cron + DB rows are enough at this scale.
- **API surface (all bearer-token authed):**
  - `GET /day?date=` , `GET /week?offset=` — merged view models (the merge logic lives server-side so app and widget render the same truth).
  - `GET /widget-feed`
  - `GET /tasks` `POST /tasks` `PATCH /tasks/:id` — proxied to Google Tasks.
  - `GET /school/grades|homework|messages|exams`
  - `GET /notifications` — notification log.
  - `GET/PUT /settings`
  - `POST /push-token` — register Expo push token; `DELETE /push-token` takes one off (the owner's key forgotten on a phone).
  - `POST /sessions/mashov` — receive captured Mashov session from the app.
  - `GET /status` — per-source sync health (drives the Settings status view).
  - `GET /oauth/google/start` , `GET /oauth/google/callback`

### 5.1 Sync engine
Each source implements a common `Adapter` interface:

```ts
interface Adapter {
  source: 'google_calendar' | 'google_tasks' | 'mashov' | 'shahaf';
  poll(): Promise<NormalizedEntity[]>;   // full or incremental fetch, normalized
}
```

The **delta engine** is source-agnostic: every normalized entity has a stable `(source, kind, natural_key)` and a `content_hash`. On each poll, compare against the stored snapshot → emit `created | updated | deleted` events into `change_event`. The **notification engine** consumes `change_event` rows against the user's notification settings and quiet hours, dedupes (never notify twice for the same `(event, day)`), sends via Expo Push API, and records to `notification_log`.

**Poll cadences (defaults, configurable via env):**
- Shahaf site: every 15 min, 06:00–22:30 Asia/Jerusalem; every 60 min otherwise.
- Mashov: every 30 min, same day window.
- Google Calendar: every 10 min with `syncToken` incremental sync.
- Google Tasks: every 10 min with `updatedMin`.

**Failure policy:** an adapter failing does not block others. After 3 consecutive failures, mark the source degraded in `/status`; after 24h degraded (or an auth error immediately), send a single "הסנכרון עם X נשבר / נדרשת התחברות מחדש" push. Silent failure is forbidden — this is a product invariant.

### 5.2 Exams → Calendar sync (write path)
The backend creates (once) a dedicated Google calendar named **"בית ספר"** and upserts the owner's exams (every source, minus the "my exams" hide-list of §7) and school events into it (idempotent via private extended properties carrying our natural key). An exam hidden after it was mirrored is removed from the calendar by the same prune. Deleting the calendar in Google is a supported user action; the backend recreates it only if the setting is on. Toggle in Settings. The hourly job is the steady state; saving the exam selection mirrors right away, after the response, so the picker's effect is visible in Google within seconds.

### 5.3 Morning summary
Cron at the configured time (default 07:00 Asia/Jerusalem), school days only: skip Saturday always; skip holidays/vacations via `@hebcal/core` (Israeli school calendar approximation) plus a manual "חופש" toggle in Settings. Content: today's timetable with changes, exams today + tomorrow, tasks due today, calendar events today. Sent as one rich push; tapping opens Today.

---

## 6. Source integrations

### 6.1 Shahaf site (dugma.shahaf.site)
- Server-rendered HTML; scrape with `cheerio`. Tabs: `changestable` (timetable with changes merged), `timetable`, `changes`, `exams`, `events`, `messages`; params `cls`, `tab`, `week` (relative offset).
- **Class id:** the student's class's `cls` value must be read from the `<option value>` attributes of the class `<select>` at implementation time (likely ~21 by position — do not trust position; read the value). Store the mapping; expose the full class list to the app for the onboarding picker.
- The page footer carries "מעודכן ל: <date>, שעה: <time>" — parse it and store as source freshness; if it stops advancing for >48h on school days, mark degraded.
- The site shows a "כניסה למערכת" link; the class views appeared publicly accessible in August (empty summer tables). **Open risk:** some tabs may require login during the school year. If so, reuse the WebView session-capture pattern from §6.3. Spike verifies this in week 1 of the school year.
- Parsing rules follow the Rollback discipline: fixtures are saved copies of real HTML responses; the parser under test is the shipping parser; a green fixture suite does not close a task — verify against the live site by hand once real data exists (September).

### 6.2 Google Calendar + Google Tasks *(v1)*
- OAuth2 authorization-code flow: app opens system browser → Google → backend `/oauth/google/callback` stores refresh token. Scopes: `calendar` (read/write needed for the "בית ספר" calendar) + `tasks`.
- **GCP consent screen gotcha:** an External app left in *Testing* expires refresh tokens after 7 days. Set the OAuth consent screen to **Production** and click through the unverified-app warning once during consent (fine for personal use; no verification needed under 100 users). Document this in the runbook.
- Calendar sync: incremental with `syncToken`; on `410 GONE`, full resync. Tasks: `updatedMin` + `showDeleted`.
- Google Tasks is the **source of truth for tasks**. The backend keeps only a cache + metadata (e.g., homework↔task links). Task writes go straight through to Google and the cache updates optimistically.

### 6.3 Mashov via הזדהות אחידה — highest-risk component *(v1)*
Mashov login for this school goes through the Ministry of Education unified identification (SSO), which may involve OTP and device trust — not automatable headlessly in a reliable, ToS-comfortable way. **Design decision: the human logs in; the server reuses the session.**

- **Capture:** the app opens an in-app WebView on the Mashov web login (which redirects through הזדהות אחידה). The user completes login, including OTP if prompted. On landing back in Mashov, the app extracts the session cookies (and CSRF token if present) from the WebView cookie store and POSTs them to `POST /sessions/mashov`. Stored encrypted (§8).
- **Use:** the backend replays the session against the known Mashov REST API (`web.mashov.info/api/...`) for timetable, homework, grades, and mail. Endpoint discovery is part of Spike 1 (observe the WebView's own network traffic).
- **Lifetime:** unknown until measured — Spike 1 must answer: how long does a session live? Does the API refresh it on use? On expiry (401/redirect-to-login), the backend marks Mashov degraded and sends a re-login push; the notification deep-links to the WebView login screen. Target UX: re-login rarely (weeks), takes <30 seconds.
- **Verified on capture:** `POST /sessions/mashov` stores the session and then polls Mashov with it *before answering*, returning the verdict (`verified`, `error`). The app shows that verdict, not the fact that the POST succeeded, and a successful verification is what marks the source ok in `/status` — so "connected" on the login screen and "connected" in Settings can never disagree. A rejected session is reported on screen and does not also trigger the re-login push.
- **Isolation:** the Mashov adapter is quarantined behind the Adapter interface with its own fixtures; the unofficial API can change without notice, and when it breaks the failure must be loud (§5.1), never silent.
- Same capture pattern is the fallback for the Shahaf site if it turns out to need login (§6.1).

### 6.4 School website — the grade's exam schedule
- The site is WordPress/Elementor; the exam page is nothing but an embedded public Google calendar (`calendar/embed?src=<id>`), one per grade. The server never scrapes the page: it fetches `calendar.google.com/calendar/ical/<id>/public/basic.ics` — no credentials, a well-known path, and the calendar id (`EXAM_CALENDAR_ID`) changes only if the school creates a new calendar. Where to find a new id is in the runbook.
- Own source (`school_site`), own poll (hourly, around the clock), own row in `/status`, own failure policy — it is a different website from Shahaf with a different way of breaking.
- Every non-cancelled event inside the current school year (1 September – 31 August) becomes an `exam`; a multi-day event becomes one exam per day. Titles lose their "י"ב" prefix, nothing else. Recurring events are skipped with a warning — an exam that repeats weekly is a parser bug, not a fact. The `exam` kind is a complete scope, so an exam removed from the site is pruned.
- The owner also subscribes to this calendar in Google, so the Google adapter delivers the same events as all-day timeline entries. The exams win: the exam calendar is kept off the timeline exactly like the "בית ספר" mirror (§7, calendar filter), and the Calendars screen says so instead of offering a switch.
- Fixture: the real feed, captured 2026-09-17, three school years deep.

---

## 7. Notifications & settings model

Every notification type is an independent toggle. Defaults reflect the owner's stated preferences:

| Key | Trigger | Default |
|---|---|---|
| `schedule_change_tomorrow` | Delta in tomorrow's merged timetable (Shahaf `changestable`) | **on** |
| `schedule_change_today` | Delta in today's timetable after 06:00, until the reader's last lesson of the day has ended | **on** |
| `new_exam` | New exam appears (school website calendar / Shahaf exams / Mashov) | **on** |
| `new_homework` | New homework item (Mashov) | **on** |
| `new_grade` | New grade (Mashov) | off |
| `teacher_message` | New Mashov mail / Shahaf general message | off |
| `morning_summary` | Daily cron, school days | **on**, time configurable (default 07:00) |
| `sync_broken` / `relogin_needed` | §5.1 failure policy | always on (not user-disableable) |

Additional settings: quiet hours (default 23:00–06:30, morning summary exempt), exams→Calendar sync toggle (§5.2, default on), class selection, vacation mode ("חופש" — pauses school-source notifications), morning summary time.

**My lessons** (`lessons.hiddenSubjects`): the school site publishes the whole class's grid, and the owner attends a subset. The hide list holds published lines — a subject exactly as the site prints it, or `subject @ teacher` when the same subject runs as two groups. Mashov's personal timetable only ever lists the owner's own groups, so the server matches each published line against it (fuzzy on subject, strict on teacher when both name one) and the app can hide everything unmatched in one tap; the switches remain authoritative.

**Calendar filter** (`calendars.hiddenCalendarIds`, `calendars.hiddenEventIds`): whole calendars by id, single events by Google event id, or a recurring series by the id that precedes Google's `_<instance>` suffix. The "בית ספר" calendar the server itself maintains (§5.2) is never shown on the timeline — its events are the exams already shown as chips.

**My exams** (`exams.hiddenKeys`): the school website's schedule is the whole grade's — a block exam lists six subjects of which a student sits one — so every upcoming exam, whatever its source, gets a switch, and the hide-list holds natural keys. A hide-list rather than an opt-in list on purpose: a new exam appears, notifies, and is visible until switched off, so nothing is ever silently missing. The filter applies wherever exams are read — Today, Week, the widget feed, the morning summary, `/school` and the Google mirror (§5.2). `new_exam` pushes are not filtered: the push is how the owner learns there is something to decide about. `GET /settings` carries the full list with each exam's state, for the picker.

All three filters apply at read time, in the view loader and in the notification engine, so Today, Week, the widget, the morning summary and the pushes describe the same day. Changing a switch needs no re-projection.

**First poll is a backfill:** creations produced by a source's first *successful* poll carry `initial` and never notify (lessons excepted — a lesson published already cancelled is news). Without this, the first Mashov login would fire one push per homework item. The flag is per poll, not per kind: the first homework of the year, arriving after a login that found none, is news.

Settings live in the backend (`user_settings` JSON) so the notification engine reads them directly; the app edits via `PUT /settings`.

---

## 8. Security *(v1)*

- Single user. Backend API guarded by a long random static bearer token, generated at provision time, delivered to the app via EAS secret / config. TLS via Caddy. No CORS exposure (native app only). Rate limiting nice-to-have, not required.
- **Secrets at rest:** Google refresh token and Mashov session blob encrypted with AES-256-GCM; key in the server env (outside the DB). DB backups (nightly `pg_dump` to the VM disk + optional rclone offsite) therefore never contain usable secrets.
- The backend makes outbound calls only to the four sources + Expo Push. No third-party analytics, no telemetry.
- Threat model is honest: this protects against DB-dump exposure and casual access, not against a compromised server. Acceptable for a personal app; revisit before any distribution.

---

## 9. Data model (Prisma sketch) *(v1)*

```
user_settings(id=1, json)
push_token(token, platform, updated_at)
google_auth(id=1, refresh_token_enc, scopes, updated_at)
mashov_session(id=1, blob_enc, captured_at, last_ok_at, status)
snapshot(source, kind, natural_key, content_hash, payload_json, first_seen, last_seen, deleted_at)
change_event(id, source, kind, natural_key, change, payload_json, created_at, notified_at?)
lesson(date, hour_index, subject, teacher, room, status[regular|cancelled|substitution|moved], substitute?, note?)   -- materialized merged timetable
exam(natural_key, date, subject, details, source)
homework(natural_key, due_date, subject, text, linked_task_id?)
grade(natural_key, date, subject, value, weight?, notes?)
school_message(natural_key, source, date, title, body)
task_cache(google_id, list_id, title, due, status, updated)
calendar_event_cache(google_id, calendar_id, start, end, summary)
sync_status(source, last_ok_at, consecutive_failures, degraded_since?)
notification_log(id, type, title, body, payload_json, sent_at)
```

`lesson` is the one materialized/merged table because three surfaces (Today, Week, widget) need the identical merge of timetable+changes; everything else can be served from snapshots/caches.

---

## 10. Risks (ordered)

| # | Risk | Mitigation |
|---|---|---|
| 1 | **הזדהות אחידה session capture** doesn't yield a server-reusable session, or lifetime is hours not weeks | Spike 1 before anything else. Fallback ladder: (a) frequent re-login UX, (b) device-side Mashov fetch on app-open only (degraded: no Mashov pushes, school pushes still come from Shahaf), (c) drop Mashov to manual-refresh-only. |
| 2 | Shahaf site needs login for real data during the school year | Same WebView capture pattern; verify in September (Spike 2 rerun on real data). |
| 3 | Mashov unofficial API changes | Quarantined adapter, fixtures, loud failure, re-spike. |
| 4 | Empty-data development window (site is empty until Sept 1) | Build parsers against fixture HTML now; schedule a mandatory live-data verification pass in week 1 of school. |
| 5 | Oracle reclaims idle instance / signup friction | Continuous poller activity + uptime monitor; PAYG-conversion mitigation; Plan B hosting documented. |
| 6 | Android widget/headless update limits (Doze) | Three-trigger refresh + explicit staleness display; never fake freshness. |
| 7 | Google unverified-app consent friction | One-time click-through; runbook note. |

## 11. Standing verification principles (inherited from Rollback)
- A green fixture suite does not mean on-screen correctness — hand-verify each source against real September data, numbered-findings style.
- Assert the composed result (merged day view), not just individual adapters.
- Parsers read stable structure (option values, header labels), not positional indices.
- All failure paths must be loud: degraded status, re-login push, stale widget footer.
