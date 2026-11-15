# SederYom · סדר יום

**סדר יום** מרכזת את כל היום של תלמיד במקום אחד: מערכת השעות עם השינויים של היום,
שיעורי בית, ציונים, הודעות ומבחנים ממשוב, יומן ומשימות של Google, ווידג׳טים למסך
הבית והתראות כשמשהו משתנה. לבתי ספר שעובדים עם משוב ושחף.

SederYom is a school-day app for Israeli students whose school uses **Mashov**
(grades, homework, messages, attendance) and **Shahaf** (the timetable site).
It merges the class timetable with today's changes, Mashov's homework, grades,
messages and absences, the class's exam board, Google Calendar and Google
Tasks into one day view, three Android home-screen widgets, and notifications.

Hebrew and right-to-left first, for Android and iPhone.

> **Not affiliated with Mashov (משו״ב), Shahaf, or the Israeli Ministry of
> Education.** SederYom reads Mashov through the same web endpoints Mashov's own
> website uses, with the student's own login, and reads Shahaf's public pages.
> Neither offers a public API, so either may change without notice and break
> parts of the app.

## How it works

```
 phone (one per student)                         server (shared, per class)
 ───────────────────────                         ──────────────────────────
 Mashov login in a WebView ─┐                    per school and class:
 reads Mashov itself        │  device token        Shahaf timetable and changes
 Google sign-in on device   ├─────────────────▶    the class's exam board
 builds days, widget feed   │  class, prefs        timetable-change pushes
 keeps settings, ticks      │◀─────────────────
 background refresh ────────┘   class feed
```

- **The phone holds everything personal.** Mashov is read from the phone with
  the student's own session; Google signs in natively on the phone. Grades,
  homework, messages and tokens never reach the server.
- **The server holds per-class data, shared by the class.** It polls
  each followed class's Shahaf page once (not once per student), keeps the
  class's exam board when a student brings one (a link or an Excel file), and
  sends timetable-change pushes. A phone registers as an anonymous device
  (`/v2`), which follows one class.
- **Mashov sessions** last about 8 hours from login. The app keeps the session
  alive with background reads, and tries Mashov's own "personal device" login
  so a new session needs no typing.

The original design had a **single-owner mode**, where the server polled Mashov
and Google for one person behind a static token. It has been removed from the
server; only `/v2`, `/cron/tick` and `/health` remain, and its database tables
were dropped.

## Layout

```
app/      Expo (React Native) app, the three Android widgets, the phone-side Mashov/Google readers
shared/   TypeScript shared by both sides: API contracts, and the logic both run (shared/src/logic)
server/   Fastify + Prisma + Postgres: Shahaf and exam-calendar polling, /v2 devices, pushes
api/      Vercel entry point
infra/    Dockerfile, docker-compose (Postgres for development, and a VM deployment)
docs/     design notes and research
```

## Running the server

```bash
npm install
docker compose -f infra/docker-compose.dev.yml up -d      # Postgres on :55433
cp server/.env.example server/.env                        # then fill it in
npm run prisma:dev                                        # create the schema
npm run server:dev
```

`server/.env` needs `DATABASE_URL` and `CRON_SECRET` (`openssl rand -hex 32`;
without it the server refuses to start). `server/.env.example` explains the
rest; devices bring their own school and class. `SCHEDULER_ENABLED=false` keeps
the pollers quiet while you work.

**Deploying:** Vercel + Neon (push to deploy; an external pinger calls
`/cron/tick` every few minutes), or your own VM with `docker compose`. See
[`docs/runbook.md`](docs/runbook.md).

## Running the app

The app needs a development or release build: Expo Go cannot load the widget
module. Before building your own copy, replace the project's identifiers in
[`app/app.json`](app/app.json) with yours:

| Where | What |
|---|---|
| `android.package`, `ios.bundleIdentifier` | your app id |
| `extra.eas.projectId` | your EAS project (`npx eas-cli init`) |
| `extra.googleWebClientId`, `extra.googleIosClientId` | your Google OAuth clients (Android sign-in matches the package and signing key) |

Then:

```bash
cp app/.env.example app/.env             # EXPO_PUBLIC_SEDERYOM_API_URL: your server
cd app && npx expo prebuild -p android && npx expo run:android
```

Push notifications need Firebase: put `google-services.json` in `app/` (it is
git-ignored) and upload an FCM v1 service-account key to EAS. For an installable
APK, `npm run app:build` builds on EAS; a local Gradle build works too.

## Tests

```bash
npm install
npm run prisma:generate -w @sederyom/server   # once after an install: the server's types and tests need the client
npm run typecheck                        # shared + server + app
npm run server:test                      # offline: parsers, delta, shared views, devices, the phone's Mashov and Google readers
RUN_DB_TESTS=1 npm run server:test       # + Postgres end-to-end tests (needs the dev database)
npm run app:test                         # the app's pure logic, copy rules, RTL rules
```

The fixtures under `server/fixtures` and `server/test/fixtures` keep the real
structure of Mashov's and Shahaf's answers with every name, school and value
made up.

## Contributing

Issues and pull requests are welcome. A different school's Shahaf page that
the parser misreads is especially useful: please attach the page with the
names replaced. Keep the tests green (`npm run typecheck`, `npm run app:test`,
`npm run server:test`), and never include a real student's or teacher's data.

## Security and license

To report a security problem, see [SECURITY.md](SECURITY.md). Please don't open a
public issue for it.

[MIT](LICENSE).
