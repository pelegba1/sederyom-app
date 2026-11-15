# Phase 0 — Spike findings

> **A research record, kept for what it maps:** Mashov's login chain, cookies and
> endpoints, and the Shahaf site's markup. Later measurements superseded parts of
> it: a Mashov session lasts about 8 hours from login while its hourly token
> keeps renewing (measured 2026-10-21); Mashov is now read on the phone, not the
> server; and the widgets and the hosting (Spikes 3 and 4) were built and run.
> See [architecture.md](architecture.md) for how the app works now.

Companion to `implementation-plan.md`. One section per spike, written as the plan
requires: what worked, the real shape of the data, and the decisions taken.

Status at the time of writing (2026-08-28): **Spike 2 done. Spikes 1, 3 and 4 are
blocked on things only a human with credentials and a device can do** — they are
specified below with exactly what to run and what to record.

---

## Spike 1 — Mashov session capture — **PARTIAL (the gate)** — endpoints confirmed, headers and lifetime open

This is the one spike that can invalidate part of the design, and it cannot be
run from a build environment: it needs a real הזדהות אחידה login, possibly with
OTP, and then several days of elapsed time to measure session lifetime.

### Round 1 — confirmed from a real login (2026-08-28)

A DevTools capture of one real login gave the request *URLs* (no headers, no
bodies yet). What it settles:

**The login flow has four steps, not two.**

1. `https://lgn.edu.gov.il/nidp/app/login?sid=0&csrt=…` — the Ministry's unified
   identification. `nidp` is NetIQ Access Manager, i.e. a standard SSO IdP.
2. redirect back to `web.mashov.info/students`
3. `GET /api/idm/token` — exchanges the SSO state for a Mashov token
4. `GET /api/idm/login/{schoolId}/{year}` — selects the school and school year
   and is what actually establishes the usable session

Observed: `GET /api/idm/login/123456/2027`. So **schoolId = 123456** and
**year = 2027** — Mashov names a school year by the Gregorian year it ends in,
so תשפ"ז (Sept 2026 – Jun 2027) is `2027`. This has to be re-derived each
September, or read from `/api/schools`, which the SPA fetches before login.

**The student is a GUID**, visible in `GET /api/user/{guid}/picture`. That is
the value the `/api/students/{userId}/…` calls need, and it is what the WebView
capture must extract. It is a personal identifier: it belongs in the encrypted
`mashov_session` blob and nowhere else — never in code, config or git.

**Endpoints seen on the dashboard load:**

| Path | Note |
|---|---|
| `GET /api/schools` | fetched *before* login — the school picker |
| `GET /api/idm/token` | SSO → Mashov token |
| `GET /api/idm/login/{schoolId}/{year}` | establishes the session |
| `GET /api/user/notifications?skip=0&take=7` | paged |
| `GET /api/mail/labels` | |
| `GET /api/mail/counts?$select=unreadConversations` | note the OData-style `$select` |
| `GET /api/adminmessages/popup`, `/api/help/links` | not needed |
| `GET /api/shahaf/coolSite` | Mashov itself links out to the Shahaf site |

**This changes the capture logic.** The session is not ready when the browser
lands back on `web.mashov.info` — it is ready only after step 4, which is an
XHR, invisible to a navigation listener. Capturing on navigation would grab a
half-formed cookie jar and call it success. `MashovLoginScreen` now waits for
positive evidence that the SPA is authenticated (the student GUID appearing in
web storage) and additionally always offers a manual "שמור סשן עכשיו" button, so
a failed auto-detect degrades to one tap instead of a silent bad capture.

### Round 2 — the data endpoints, confirmed live (2026-08-28)

A second capture, this time navigating every screen. **All four paths the
adapter had guessed are correct**, and three more matter:

| Path | Status | Used for |
|---|---|---|
| `GET /api/students/{guid}/timetable` | guessed → **confirmed** | the weekly grid |
| `GET /api/students/{guid}/homework` | guessed → **confirmed** | שיעורי בית |
| `GET /api/students/{guid}/grades` | guessed → **confirmed** | ציונים |
| `GET /api/students/{guid}/behave` | guessed → **confirmed** | absences and lates (ux-plan §17) |
| `GET /api/mail/inbox/conversations?skip=0&take=20` | guessed path, **missing paging** | teacher messages |
| `GET /api/bells` | **new** | period number → clock times |
| `GET /api/students/{guid}/groups` | **new** | group → subject + teachers |

`/api/bells` is the important find. Mashov's timetable rows carry a *period
number* and a *group id* — no subject, no clock time. Without bells the Mashov
fallback timetable had `startTime: null` on every lesson, which would have
rendered as a timeless list on Today and sorted by a synthetic key. Bells and
groups together are what turn a row into a lesson, and both are now joined in
`normalizeSlot`.

The mail endpoint needed `?skip=0&take=20`; the adapter now mirrors the SPA's
own request exactly.

**The full SSO chain**, decoded from the analytics beacon on the login page:

```
lgn.edu.gov.il/nidp/oauth/nam/authz
  ?response_type=code
  &client_id=e12f2fe2-9bc1-4916-a414-7b17f5a932b0
  &redirect_uri=https://web.mashov.info/api/idm/callback
  &scope=profile+eduorg+edustudent
```

Standard OAuth2 authorization-code against the Ministry's NetIQ IdP, auth method
`EduCombinedAuthUidPwd` (username + password). Mashov's own callback is
`/api/idm/callback`.

**Also seen, not in scope:** `/api/students/{guid}/bagrut/{grades,sheelonim,subjectGrades}`,
`lessonsCount`, `outBehave`, `justificationrequests`, `/api/achvas`,
`/api/user/notifications?skip=0&take=7`, `/api/shahaf/coolSite` (Mashov links out
to the same Shahaf site this app scrapes). Bagrut data is genuinely interesting
for a יב student, but it is not in the design doc — adding it means updating the
design doc first.

### Round 3 — the cookie jar, and the finding that matters most (2026-08-28)

| Cookie | Domain | Lifetime | Role |
|---|---|---|---|
| `MashovAuthToken` | `.web.mashov.info` | **session, JWT `exp` = +60 min** | the bearer of the whole session |
| `Csrf-Token` | `.web.mashov.info` | session | double-submit CSRF; its value is what the SPA echoes in `x-csrf-token` |
| `MashovIdmTokenID` | `.web.mashov.info` | session | opaque handle, almost certainly the refresh key for `/api/idm/token` |
| `IdmAppName` = `students` | `.web.mashov.info` | a few hours | which portal was logged into |
| `IdmLoginData` | `.web.mashov.info` | a few hours | empty when observed |
| `uniquId` | `.web.mashov.info` | **~13 months** | device fingerprint — likely what device-trust keys off |
| `_ga`, `_ga_*` | `.mashov.info` | months | analytics; irrelevant |

All the Mashov cookies are `HttpOnly` + `Secure`, which confirms the design's
choice of `CookieManager` over `document.cookie`.

**`MashovAuthToken` is a JWT, and it is self-describing.** Its payload carries
`UserId` (the student GUID), `Semel` (school), `Year`, `iat` and `exp` — so the
server derives all of that itself and the app no longer scrapes anything out of
the page. The payload *also* carries the student's national ID number and
display name; `parseMashovToken` deliberately reads neither, and a test asserts
that the parsed object contains only the five fields the app needs.

> ⚠️ **The measured lifetime is 60 minutes, not weeks.**
> `exp − iat = 3600` exactly. The design doc's stated target was "re-login
> rarely (weeks), takes <30 seconds" (§6.3). A captured session that dies within
> the hour cannot, on its own, drive a server that polls for days.

**But the token almost certainly renews.** Three pieces of evidence: the payload
has a `LastActivity` claim distinct from `LoginTime`; the SPA calls
`GET /api/idm/token` repeatedly, not once; and `MashovIdmTokenID` is a separate
cookie that outlives no single token. So the real question — the one that now
*is* the Spike 1 gate — is:

> Can the server mint a fresh `MashovAuthToken` by calling `/api/idm/token` with
> the captured `MashovIdmTokenID` + `uniquId`, without a live SSO session at
> `lgn.edu.gov.il`?

**The decisive test needs no waiting and no code.** `/api/idm/token` has
*already* fired several times in the captured session. Open that request in
DevTools → Response Headers and look for `Set-Cookie: MashovAuthToken=…`:

- **It is there** → the endpoint mints tokens, using only cookies the WebView
  can capture. The server can renew, and the only question left is whether it
  works from another IP.
- **It is not** → renewal is being driven by the SSO session at
  `lgn.edu.gov.il`, on a domain this app does not currently capture. Then the
  choice is between widening the capture to the Ministry portal — which means
  the server holds a national-portal credential, a materially bigger blast
  radius than a Mashov session, and design-doc §8 should be revisited before
  doing it — or taking the fallback ladder.

Fallback, if it comes to that (design-doc §10.1 rung (b)): the phone fetches
Mashov on app-open, and Mashov stops being a *polled* source. Note what that
does and does not cost. The flagship notification — tomorrow's timetable changed
— comes from the Shahaf site, which needs no login at all. What degrades is push
for new homework, new grades and teacher messages; the data itself still appears
whenever the app is opened. Note also that leaving Mashov as a polled source in
that world would mean a `relogin_needed` push every hour, which is loud in the
wrong way — demoting it is part of the fallback, not an afterthought.

Until that is answered, the server does the honest thing: it reads `exp` out of
the cookie and refuses to poll once the hour is up, reporting *when* the session
lapsed instead of discovering it through a 401.

### Round 4 — `/api/idm/token` sets no cookie (2026-08-29)

Response headers, captured live:

```
cf-cache-status: DYNAMIC          content-type: application/json; charset=utf-8
date: Sat, 29 Aug 2026 09:20:05 GMT   server: cloudflare
strict-transport-security: …      x-content-type-options: nosniff
```

**No `Set-Cookie`.** So `/api/idm/token` does not mint a `MashovAuthToken`, and
the hypothesis that the server could renew the session by calling it is dead.
Given `Csrf-Token` is HttpOnly and the SPA still sends it as a header, what this
endpoint almost certainly returns in its JSON body is the CSRF token — it is a
"tell me my current CSRF" call, not a refresh call.

**And yet the response is a 200 with JSON.** The token captured the previous
afternoon was issued 16:45Z and expired 17:45Z on 28 Aug; this response is dated
**09:20Z on 29 Aug — more than fifteen hours later**. If that request rode the
same session (see the open question below), then `exp` is not what Mashov
actually enforces. The payload carries a `SessionId` and a `LastActivity` claim,
which fits a server-side session store with sliding expiry, where the JWT's
`exp` is a hint the server does not treat as binding.

**This reverses a change made an hour earlier.** The client had started refusing
to poll once `exp` passed, on the reasoning that failing early beats discovering
it through a 401. That reasoning does not survive this evidence: nothing the
server can call renews the cookie, so if `exp` were enforced by us, a session
that Mashov still honours would be declared dead by SederYom. The check is now a
warning, not a gate — Mashov's own 401 is the authority, and `expiredForMinutes`
exists to say so out loud in the log rather than to decide anything.

**Answered: there was a fresh login that morning.** So the 09:20Z response rode
a new session and says nothing about lifetime. The 60-minute `exp` stands
unrefuted, and there is now no evidence either way about renewal. The softening
above still holds on its own merits — we know nothing the server can call
renews the cookie, so enforcing `exp` ourselves could only ever turn a live
session into a dead one.

**One test remains, and it is free:** leave a logged-in tab untouched for ~70
minutes, then click into ציונים.

- **It loads** → something renews transparently. The question narrows to whether
  it still works from another IP, and Mashov stays a polled source.
- **It bounces to login** → the hour is real. Fallback ladder (§10.1 rung b).

### Consequence already handled: the push must not nag

If the session really is an hour and only a human can renew it, the failure
policy as written would fire a `relogin_needed` push **every hour** — each
re-login clears `brokenNotifiedAt`, so each lapse is technically a new outage.
That is loud in the wrong way. The dedupe key is now per source **per day**, so
the interruption is bounded while the failure stays fully visible where
visibility is free: `/status` stays red and the app keeps its banner. An
integration test drives three break/re-login cycles and asserts exactly one
push.

### The CSRF token rotates on login

The four `/api/idm/token` calls captured are really two (DevTools emits a
`credentials: "include"` and a `credentials: "omit"` variant of each). What
matters is that they carry **different** CSRF tokens:

| Call | Referrer | `x-csrf-token` |
|---|---|---|
| 1 | `/students/login` | `0a1b2c3d-…` |
| 2 | `/students/main/home` | `6827f3d8-…` |

`0a1b2c3d-…` is exactly what the `Csrf-Token` cookie held in the jar dump, so
the cookie rotates when the session is established — almost certainly at
`/api/idm/login/{school}/{year}`. A capture taken a moment too early would
therefore pin the *pre-login* CSRF value while carrying a post-login auth token,
and every request would be rejected for a reason that looks nothing like the
cause. The client now reads `Csrf-Token` out of the stored cookie header at
request time instead of trusting the separately captured copy.

There is a second, sharper implication. `Csrf-Token` is flagged **HttpOnly**, so
the SPA's own JavaScript cannot read it from `document.cookie` — yet it puts the
value in a header. Something must hand it to the page, and `/api/idm/token` is
the only candidate that fires at the right moments. That makes its response body
the single most informative thing still uncaptured: it very likely carries both
the CSRF token and whatever else the SPA needs to keep a session alive.

### 2026-09-02 — the capture now answers the replay question itself

The app reported "ההתחברות הושלמה" as soon as `POST /sessions/mashov` returned,
while Settings kept saying "לא מחובר": the route only stored the blob, and
"connected" in the app is `lastOkAt`, which only a successful poll sets — up to
30 minutes later, and never outside 06:00–22:30. The route now polls Mashov
with the captured session before it answers and returns the verdict; the app
shows that. Consequence for this spike: the first login after this change *is*
the "replay from another IP" test (item 2 below) — the server's own address,
the same instant, with the error text on screen if it fails.

### Still missing

1. **Does the token renew** (above). This is now the gate.
2. **Replay from another IP** — answered by the first verified capture; record the outcome here.
3. **Response bodies.** `/api/bells` is captured and real
   (`server/fixtures/mashov/bells.json`); the rest are not. Every normalizer
   reads through `pick()`, which tries several aliases and looks one level down,
   and drops a row it cannot understand rather than half-parsing it —
   `server/test/mashov.test.ts` pins that behaviour.

### `/api/bells` — captured (2026-08-28)

Flat array, 11 rows, `{ lessonNumber, startTime, endTime }` with times as
`"HH:MM:SS"`. The field is **`lessonNumber`** — none of the four aliases the
normalizer had guessed (`bell`, `bellId`, `lesson`, `hour`) matched, so every
bell was being dropped and the Mashov fallback timetable would have had no times
at all. Fixed, and the real body is now a fixture.

Worth recording: these times match the `span.hour-time` labels on the Shahaf
grid **exactly**, for all ten periods the two sources share. Two independent
sources agreeing is the closest thing to a correctness proof available before
September, and a test now asserts it — if the school changes its bell schedule,
that test is where the disagreement will show up.

| Period | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Start | 08:00 | 08:45 | 09:45 | 10:30 | 11:30 | 12:15 | 13:25 | 14:10 | 15:00 | 15:45 | 16:30 |
| End | 08:45 | 09:30 | 10:30 | 11:15 | 12:15 | 13:00 | 14:10 | 14:55 | 15:45 | 16:30 | 17:15 |

**Why the rest was built anyway.** The Mashov adapter is quarantined behind the
`Adapter` interface (design-doc §6.3): it is one file plus one client, it shares
no code path with the other three sources, and every failure in it surfaces as a
degraded source in `/status` plus a re-login push. If Spike 1 forces the fallback
ladder from design-doc §10.1, the blast radius is `server/src/adapters/mashov/`
and `app/src/screens/MashovLoginScreen.tsx` — nothing else moves.

### Exit criteria (unchanged from the plan)

A documented, reproducible path from "human logs in on the phone" to "server
fetches timetable JSON", with a measured session lifetime. If that fails, apply
the fallback ladder in design-doc §10.1 **and update the design doc** before
changing code.

---

## Spike 2 — Shahaf scraper — **DONE (live, 2026-08-28)**

Run against the real site, not a fixture.

### Findings

1. **The class views are publicly readable.** No cookie, no login. `GET /?cls=36&tab=changestable`
   returns 200 with the full page. The site does show a "כניסה למערכת" link
   (`/Account/SignIn`), but nothing in the six class tabs required it.
   *Open risk stands*: this was verified over the summer. If it changes in
   September, `ShahafAdapter` already throws `AuthError` on a 401/403 or a
   redirect to `/Account/SignIn`, and `createShahafFetcher` takes a
   `cookieHeader` — the WebView capture pattern from §6.3 drops straight in.

2. **יב2 is `cls=36`.** The design doc guessed "likely ~21 by position — do not
   trust position". Good instinct: position 21 in the list is `יב1`, and 36 is
   not even close to any index. The parser reads `option[value]`, and a test
   asserts specifically that the value is not the index.

3. **URL shape:** `https://dugma.shahaf.site/?cls=<id>&tab=<tab>&week=<offset>`.
   Tabs: `changestable`, `timetable`, `changes`, `exams`, `events`, `messages`.
   `week` is a relative integer; omitted means the current week.

4. **Timetable markup** (`tab=changestable` and `tab=timetable` are identical in
   structure):
   - `table.TTTable`
   - header cells `td.CTitle[data-day="0..5"]`, text `"יום ראשון 30.08"` — **no year**
   - row labels `td.CName` → `<b>3<br/><span class="hour-time">09:45</span><br/><span class="hour-time">10:30</span></b>`
   - body cells `td.TTCell[data-day]`
   - the week runs **Sunday → Friday**, six columns, periods 0–10

5. **Change taxonomy comes from the stylesheet**, and is the reliable signal —
   more reliable than parsing Hebrew free text:

   | CSS class | meaning | mapped status |
   |---|---|---|
   | `TableFreeChange` (red) | cancelled / free | `cancelled` |
   | `TableFillChange` (lime) | substitute teacher | `substitution` |
   | `TableRemoteChange` (orange) | remote learning | `remote` |
   | `TableExamChange` (yellow) | exam in that slot | `exam` |
   | `TableEventChange` (silver) | event in that slot | `event` |

   Inside a cell, `.TTLesson` is the base lesson and `.TTChange` is the change
   stacked under it. The parser folds them into one lesson so no downstream code
   has to know.

6. **List tabs** render `div.EmptyList` when empty (`"אין שינויים"`, `"אין מבחנים"`,
   `"אין אירועים"`, `"אין הודעות"`), and use `.ChangesDate` / `.ChangesInfo` /
   `.MsgCell` when populated.

7. **Freshness footer** on every page: `div.UpdateDate` → `"מעודכן ל: 11.08.2026, שעה: 22:52"`.
   Parsed and stored as `sync_status.sourceFreshness`; if it stops advancing for
   more than 48h **on a school day**, the source is marked degraded. The
   school-day gate matters: over the summer the footer legitimately stands still
   for weeks.

8. **Year inference.** Header cells carry `DD.MM` only. The parser takes the year
   from the Sunday it asked for, and if the header disagrees it trusts the header
   and reports a warning (rolling the year across a December/January boundary).

### Fixtures

`server/fixtures/shahaf/` holds the real responses captured on 2026-08-28:
`root-classlist.html`, `{changestable,timetable,changes,exams,events,messages}-cls36.html`,
`changestable-cls36-week1.html`. All are the **empty-summer** variants — a
fixture class of their own, and the reason for the next point.

### September checkpoint — run 2026-09-01, the first school day

The parser met real data for the first time and got the skeleton right: 21
lessons this week and 31 next, correct periods, correct clock times, correct
subjects and teachers, week navigation working, freshness parsed. It also got
three things wrong, and each was invisible to a fixture I had written myself.

**1. A changed cell has no base lesson.** A normal cell is
`<div class="TTLesson"><b>אנגלית 5 יח"ל</b><br/>נקש ירדנה</div>`. A cancelled
one is *only* the change div:
`<div class="TTChange TableFreeChange">ביטול אנגלית 5 יח"ל, נקש ירדנה</div>`.
The whole sentence became the subject, so Today would have listed a lesson
called "ביטול אנגלית 5 יח״ל, נקש ירדנה". The change text is now split as
`<verb> <subject>, <teacher>[ לשעה N]`.

**2. The colour lies about moved lessons.** The school publishes
`הזזת כישורי חיים, שחם בועז לשעה 4` with `TableFillChange` — the same lime
class as a substitute teacher. Reading the class, as the stylesheet-derived
parser did, reported "מ״מ" for a lesson that had merely changed hour. **The
written verb now outranks the class**, and the class is only consulted when no
verb is present. This is the finding most worth keeping: the site's own words
are more reliable than its formatting.

A moved lesson appears twice — in the slot it left and the slot it entered. The
departing one carries `הועבר לשעה 4`; the arriving one needs no note.

**3. `tab=changes` was returning nothing on a tab that was not empty.** The real
markup is a flat list with the date inside each line:

```html
<li class="ChangesInfo">02.09.2026, שיעור 1, נקש ירדנה, ביטול שעור</li>
<li class="ChangesInfo">02.09.2026, שיעור 7, הזזת שיעור : שחם בועז, כישורי חיים<b> לשיעור 4</b></li>
```

There is no `.ChangesDate` heading — the structure the parser was written
against, and walked the siblings of, does not exist here. Note the trap in the
second line: the slot is `שיעור 7` and `לשיעור 4` is where it lands, so the
first period mentioned is the one that counts.

**Cross-source confirmation:** the grid's hour labels match Mashov's
`/api/bells` exactly, for every period the two share. Two independent publishers
agreeing is as close to proof as this gets, and a test asserts it.

**Still unverified:** exams, events and general messages — the school had
published none by 2026-09-01. Those parsers keep their `TODO(verify-live)`
markers.

### The gap, stated plainly

Weeks −1, −8, −12 and −20 were also fetched: **all empty**. The site does not
retain last year's data, so there is no way to see a *populated* cell before
September. The filled-cell parsing is therefore written against the stylesheet
and the legacy Shahaf markup, is covered by **synthetic** fixtures in
`server/test/shahaf-parser.test.ts`, and is marked `TODO(verify-live)` in
`server/src/adapters/shahaf/parser.ts`. This is exactly risk #4 in design-doc §10
and the reason the plan mandates a September checkpoint.

---

## Spike 3 — Widget hello-world — **NOT RUN (needs a device build)**

The widget code is written (`app/src/widget/`, `app/widget-task.tsx`), registered
in `app/index.js`, and declared in `app.json` with both widgets from design-doc §4.
What cannot be checked here is the thing the spike exists for: **whether Hebrew
RTL renders correctly in RemoteViews**, and whether the headless task runs under
Doze.

To run it: `cd app && npx expo prebuild -p android && npx expo run:android` on a
connected device (or an EAS dev build), add the "היום שלי" widget to the home
screen, and check (a) Hebrew reads right-to-left, (b) the `עודכן HH:MM` footer
appears, (c) leaving the phone overnight still shows correct data in the morning.

Note the design's own escape hatch: RemoteViews has no RTL layout engine worth
relying on, so the widgets are laid out with explicit rows and a `flex: 1` spacer
rather than depending on direction inheritance. If text still renders wrong,
the fix is local to `app/src/widget/widgets.tsx`.

---

## Spike 4 — Infrastructure — **NOT RUN (needs an Oracle account and a domain)**

Everything that can be prepared is prepared:

- `infra/docker-compose.yml` — Postgres + API + Caddy, with healthchecks
- `infra/Dockerfile` — multi-stage, migrations run on boot
- `infra/Caddyfile` — automatic HTTPS for one subdomain
- `infra/.env.example`, `server/.env.example`
- `GET /health` for the uptime monitor

What a human must do is in `docs/runbook.md`: provision the VM, point a
subdomain at it, create the GCP OAuth client (**consent screen set to
Production**, or refresh tokens expire after 7 days), and point an uptime
monitor at `/health`.

The local equivalent *was* run end to end:

- `infra/docker-compose.dev.yml` brings up Postgres; `prisma migrate dev`
  created all 18 tables.
- The server completed a live sync against dugma.shahaf.site, with `/day`,
  `/week`, `/widget-feed`, `/status` and `/settings` all answering correctly.
- `docker build -f infra/Dockerfile .` was run, and the resulting image was
  started against that Postgres: migrations applied on boot, the server came up,
  `/health` answered, and an unauthenticated `/day` was refused with 401.

Two things that build surfaced, both now fixed, both of which would have failed
the *first* real deploy:

1. `COPY /repo/server/node_modules` — npm workspaces hoist everything to the
   repo root, so that directory does not exist and the COPY aborted the build.
2. Prisma on Alpine needs OpenSSL installed, in the build stage *and* the
   runtime stage. Without it, `prisma generate` picks the wrong engine target
   and `migrate deploy` dies on an unparseable engine response.
