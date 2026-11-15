# How SederYom works

SederYom is split so that everything personal stays on the student's phone,
except what the student chooses to share with a friend or with a chat they link,
which leaves encrypted. The server keeps only what is public and shared by a
whole class, the encrypted boxes friends leave for each other, which it cannot
read, and the encrypted copy a linked chat reads, which it opens only while that
chat's request is in hand (see "Chat connection (MCP)").

```
 phone (one per student)                               server (shared)
 ─────────────────────────────────────                 ─────────────────────────────────
 Mashov: login page in a WebView, then reads           devices: anonymous, a hashed token each
   with the phone's own cookie jar                     per school and class:
 Google: native sign-in, narrow scopes        /v2        the Shahaf timetable and its changes
 settings, homework ticks, added exams      ───────▶     the class's exam board
 days, week, planner and widgets built here  ◀───────    pushes for timetable changes
 background refresh                          class feed
```

## On the phone

**Mashov.** The student logs in on Mashov's own page, inside a WebView; the
password is typed there and nowhere else, whether it is Mashov's or the
Ministry of Education's (הזדהות אחידה). The session lands in the phone's cookie
jar, and the app reads Mashov with that jar (`app/src/mashov`), using the same
endpoints Mashov's website does: timetable, homework, grades, messages,
attendance and bagrut. The parsing is shared code (`shared/src/logic/mashov`).

A Mashov session's token lasts an hour and renews with every read, and Mashov
ends the session about 8 hours after login regardless. So:

- a background task (Android's WorkManager, and the widgets' own periodic
  update) reads now and then with the app closed, which keeps the token renewing
  (`app/src/background`);
- the login ticks Mashov's "personal device" option, and when a session ends the
  phone asks Mashov for a new one with the pass Mashov issued for the device,
  with nobody typing (`app/src/mashov/device.ts`). This uses a Mashov feature
  its own app relies on, and is still being verified;
- otherwise the app asks the student to log in again.

**Google.** The student signs in on the phone (native Google sign-in), with
narrow scopes: read the calendar list and events, read and write tasks, and
manage only the calendars the app itself creates. The phone reads Calendar and
Tasks, writes tasks, and keeps a "בית ספר" calendar of the student's exams up to
date (`app/src/google`). No Google token reaches the server.

**Everything else personal** lives on the phone too: settings (which lessons
and exams are the student's, quiet hours), homework ticked off or turned into a
task, exams the student added by hand, an exam board of their own and the dates
they set for exams (see "The exam board"). The part of that the student shares
with a friend (timetable, exams, absence counts) is one exception: it
leaves the phone encrypted, as a friends' box (see below). What the student
chooses to share with a linked chat is the other: a sealed copy the phone puts
on the server for the chat to read (see "Chat connection (MCP)").

**The days.** The phone builds the Today, Week and planner views and the widget
feed itself (`app/src/local`), from Mashov's read, Google's, and the class feed,
with the same code the server once used (`shared/src/logic`: the timetable
merge, homework due dates, exam matching, filters, the absence tracker).

## On the server

The server (`server/`, Fastify, Prisma, Postgres) knows devices and classes,
never students.

- **Devices** (`POST /v2/devices`): an install registers and gets a random
  token; the server keeps only its hash. A device follows one class and keeps
  its notification preferences and, optionally, a push token. A device may also
  have no class: a phone with a friend or a pending invite registers anyway
  (`Device.classId` is nullable), and gets no class notifications. The phone
  deletes such a device again when its last friend or invite is gone.
- **Schools and classes.** Mashov tells the phone its school's Shahaf site
  (`/api/shahaf/coolSite`); the phone lists that site's classes
  (`GET /v2/classes`) and follows one (`PUT /v2/device`). The server accepts
  only `https://<school>.shahaf.site` addresses.
- **Polling.** The server reads each followed class's Shahaf pages once, however
  many students follow it, a few classes per tick, and keeps a snapshot and its
  changes (`server/src/sync/classes.ts`). If the class's exam board is a public
  Google calendar, the server reads its ICS for the whole class, from Google's
  fixed calendar address; a board brought from a file or a page is kept as it was
  confirmed and is not polled. Besides that, the server opens an address a
  student pastes when bringing a board, under the guards listed in "The exam
  board".
- **The class feed** (`GET /v2/class/feed`): the class's lessons, changes,
  exams, events and messages, which the phone merges with its own reads. It
  answers for any class some device follows (`FOLLOWED` in
  `server/src/sync/classes.ts`), the device's own or not, so a phone can show a
  friend's lessons; a class nobody follows answers `409 not_followed`.
- **The class history** (`server/src/history`, `GET /v2/class/history`), for the
  year in review. The site forgets: a past week comes back as the regular grid
  with almost none of the changes it had, and the snapshot follows the site. So
  each tick writes every day that has passed into `class_lesson_history`, one
  row per lesson, **as the lesson was when it began**: the last change event at
  or before its start (`freeze.ts`). A cancellation taken back before the lesson
  is a regular lesson; whatever the site did after the lesson began changes
  nothing. A row is written once and never updated. Exams whose day has passed
  go to `class_exam_history` the same way. These rows are `observed`, and a
  class has them from the day after it was first read. The weeks before that,
  back to 1 September, are read from the site's past weeks a few pages a tick
  (`backfill.ts`) and marked `backfill`: they say what was scheduled, never what
  was cancelled, and vacation weeks come back with a full grid, so whoever
  counts takes days off away first. The endpoint answers the device's own class
  only, with what the rows cover (`coverage`).
- **Friends' boxes** (`buddy_box`, `/v2/buddies`): what a student shares with a
  friend (timetable, exams, absence counts; and grades, only when both friends
  chose to) is encrypted on the phone, and the server keeps only the ciphertext
  under a random id that both phones derive from a secret it never sees.
  Writing a box makes its first writer its owner;
  anyone who knows an id can read it, and only the owner can change or delete
  it. An invite or a reply is never deleted, only emptied into a mark (it reads
  as no box and nobody can write the id again), so a used link cannot be
  re-armed; a friendship's boxes are deleted outright. The server knows which
  devices exchange boxes, not who or what. The tick empties the invites and
  replies still live 7 days after they were written into marks and deletes any
  box not updated for 120 days, the marks included (`server/src/sync/tick.ts`).
  Deleting a device (`DELETE /v2/device`) empties its live invites and replies
  and deletes its friendship boxes first, then the device goes (the foreign key
  only clears the writer), then any live box left with no writer is settled the
  same way, so a mark outlives the device and a row with no writer is always a
  mark. The
  invite link is `/b#<secret>` (`public/buddy.html`), and the secret stays in
  the fragment.
  Grades are a second `pair` box per friend and direction (labels `a2b-grades`
  and `b2a-grades`, derived from the same secret as the main box's `a2b` and
  `b2a`), off by default. A phone writes it only while both friends have grades
  on, and its bagrut part only while both have bagrut on. It deletes it at once
  when its owner turns grades off, on its next sync when the friend does (once
  it reads the friend's main box saying so), and when the friendship ends; the
  sending phone enforces this
  (`app/src/buddies/protocol.ts`), the server cannot. It is written when its
  content changes and at least every 30 days, so the 120-day sweep never takes
  it. It holds each subject's average (by the sharer's own weights), each grade
  with its date, the assessment's name and its number or words (at most the
  newest 200, in whole days; older days are left out, with a `from` date), and,
  if both chose bagrut, per questionnaire the school grade (מגן), the exam grade
  and the final grade as Mashov reports them: no status codes, no estimates,
  nothing the student entered. The server did not change: it holds a second pair
  of boxes between the same two devices, and cannot tell what is in them. A
  grades box that is gone never ends a friendship; only the main box does. The
  friend's grades are then dropped from the phone, and the grades tab goes back
  to saying what has to happen before there are any.
- **Pushes.** When a class's timetable changes, the server notifies each device
  following it that registered a push token, filtered by that device's
  preferences and quiet hours (`server/src/notify/fanout.ts`). Pushes from the
  phone's own reads (new grades, homework) are planned as local notifications.

## Chat connection (MCP)

A student can link a chat (ChatGPT, Claude, or any chat that adds an MCP server
by its address) that answers questions about their school day. The personal data
lives on the phone, so the phone leaves the chat a sealed copy of what the
student chose to share (the timetable and exams always, homework by default;
grades, bagrut grades, absences and Mashov messages only when switched on; never
anything from Google, whose data policy forbids using it to develop, improve or
train AI models, and whose verification of the app covers on-phone use only), and
the server opens it only for a chat's request. A parent's phone has no chat
connection. The design is
`docs/superpowers/specs/2026-11-04-chat-connection-design.md`.

**The flow**

1. **Code.** On the "חיבור לצ׳אט" page the phone makes K when it has none (32
   random bytes, one for all the phone's chats, kept in its storage) and asks
   `POST /v2/chat/codes` for a code, sending K. The server keeps the code's
   hash, the device and K (`chat_code.key`) until the code is used or expires
   (at most ten minutes); an expired, unused row is deleted by the next tick.
2. **OAuth.** The chat registers itself (`POST /oauth/register`) and sends the
   student to `/oauth/authorize`, where they type the code (PKCE, S256 only). A
   right code is spent and makes a grant and an authorization code that holds K
   until it is traded or expires, sixty seconds (`chat_auth_code.key`; an
   expired, untraded row is deleted by the next tick), and the page redirects
   back to the chat. A chat whose address is not a known chat's reads nothing until the
   student approves it in the app.
3. **Tokens carrying K.** `POST /oauth/token` trades the authorization code for
   an access token (an hour) and a refresh token (90 days, exchanged at every
   use), each `sya_<id>.<K>` or `syr_<id>.<K>`. The server keeps only a hash of each id; K is
   now only in the tokens and on the phone.
4. **`/mcp`.** Stateless Streamable HTTP, one server per request. The bearer
   token names the grant and carries K (`bearerGrant`); the device's
   `chat_snapshot` is opened with that K for this request only (`copyOf`), and
   the tools answer from it. Nothing is kept between requests.

**The write step.** `refreshLocalSources` (`app/src/local/source.ts`) runs
`refreshChat` (`app/src/chat/run.ts`) after the Mashov read, the class feed and
the friends' step. While a chat is linked it builds the copy
(`buildChatSnapshot`, pure, in `app/src/chat/snapshot.ts`; the server imports it
too, to build the demo's), seals it with K and puts it at `PUT
/v2/chat/snapshot`. An unchanged copy is skipped unless the last write is an
hour old, a change of what is shared writes at once, and the step is held to
`CHAT_STEP_MS`. With no chat linked it does nothing and never reaches the
network.

**The day card.** `get_day` names a card, `ui://sederyom/day.html`, which a chat
that supports MCP Apps shows in a frame; any other chat gets the same answer as
text. It is a static page served by `/mcp` as a resource: HTML with one inline
script, built by `npm run chat:card` from `server/src/chat/card/` into the
committed `dayCard.generated.ts` (a test fails when that file is stale). The page
draws only what the tool's result carries (`structuredContent`, or ChatGPT's
`window.openai.toolOutput`), makes no network request, and works out "tomorrow"
when it is drawn, not when the tool ran. A result that is not a day (no copy, not
approved, a day outside the copy, an error) is drawn as its text instead, the text
of `content` or else the `text` in `structuredContent`, so the frame is never
blank. An exam's `subject` is the school's own title ("מבחן באנגלית") or a bare
subject; the banner follows the phone (`examDisplayTitle` and `examSlot` in
`app/src/lib/school.ts`), adds a word only to a bare subject, and names an hour
only from lessons the school marked as an exam.

**Cutting.** `DELETE /v2/chat/clients/:id` cuts one chat (its tokens and
authorization codes; the last chat also deletes the copy), `DELETE /v2/chat` all
of them, and `DELETE /v2/device` the whole connection with the device. The tick
removes expired codes and tokens and any copy not written for 30 days
(`server/src/sync/tick.ts`).

**Where the code is**

- Phone: `app/src/chat/*` (state and K in `store.ts`, the copy in `snapshot.ts`,
  the write in `write.ts`, the refresh step and the page's actions in `run.ts`,
  the words in `copy.ts`) and the page `app/src/screens/ChatScreen.tsx`.
- Server: `server/src/chat/*` (tokens and hashes, the authorize page, the
  answers, CORS, the addresses) and `server/src/routes/{chatDevice,oauth,mcp}.ts`
  (the phone's `/v2/chat`, the chat's OAuth side, `/mcp`).
- The contract both sides share: `shared/src/chat.ts` (the limits and the copy's
  shape) and `shared/src/chatCrypto.ts` (sealing and the token format).

What is stored and who can read it: [SECURITY.md](../SECURITY.md).

## The exam board (לוח המבחנים)

A student brings the class's exam schedule from a link (a school page, a public
Google calendar, a Google sheet) or an Excel file; the class has one board, in
one of two forms, and every follower sees it as `school_site` exams in the class
feed. A student may keep a board of their own on the phone instead. Design:
`docs/superpowers/specs/2026-11-10-exam-board-sources-design.md`; limits and
error codes: [runbook.md](runbook.md), "Exam board".

**Server** (`server/src/routes/examBoard.ts`, `server/src/exam-board/`)

- **Preview**, `POST /v2/device/exam-board/preview`: a link or a file (base64) in,
  what was found out, nothing saved. `preview.ts` joins three pieces: `link.ts`
  (what is behind a link; the only code that makes a request: https only, public
  addresses, redirects checked, size and time capped), `xlsx.ts` (a limited
  reader: first visible sheet to a grid of text) and `extract.ts` (a pure
  function: grid to dated rows, the rows skipped, or the columns to choose from).
  The answer is a calendar (or several), rows, columns, or a code. The only
  write is the per-device counter (`takePreviewTurn`); the file lives in memory
  for the request.
- **Save**, `PUT /v2/device/exam-board`: the confirmed rows. `cleanRows` checks
  them again (the phone's copy of the rules is not the server's), `changeBoard`
  applies the lock and writes the board, its setter and its exams in one
  update, and `announceUploadedBoard` tells the class. A calendar is saved by
  the existing `PUT /v2/device {examCalendar}`, which reads the ICS at once
  (`readCalendarNow`); removing either kind is `{examCalendar: null}`.
- **Lock** (`store.ts`, `mayChangeBoard`): the board is a calendar id or an
  upload; the device that brought it replaces or removes it while it follows the
  class and has been seen in the last 30 days (`SETTER_GONE_AFTER_DAYS`; the
  class feed route notes `lastSeenAt` at most once a day, `markSeen` in
  `routes/devices.ts`). A classmate gets 403 `calendar_locked`, and the phone's
  sheet turns to "רק אצלי", so the next tap keeps the board for that person
  alone (`saveFailed`); once the setter has left or gone unseen, a classmate may
  replace it for the class.
- **Notification**: a board that comes to a class with none is one
  `ClassChangeEvent` of kind `exam_board` (`announceBoard`), at most once in 30
  days (`ANNOUNCE_EVERY_DAYS`). The mark, `examBoardAnnouncedAt`, stays when the
  board is removed; `announceAgain` clears it only when a new board comes where
  there was none and the mark is older than 30 days, so a board removed and
  brought again within them tells no one. A replacement tells no one. The fanout
  skips the device that brought it (`broughtBy`) and `notify/engine.ts` files it
  under the `new_exam` switch.
- **Tick**: `pollDueExamCalendars` reads only classes with a calendar and no
  upload (`examBoardKind: null`); `storeBoardExams` keeps the exams only if the
  class still has that calendar.
- **Shared** (`shared/src/logic/exam-board/`): the ICS reader, `calendarExams`
  (an event longer than 14 days is not an exam, `MAX_EXAM_SPAN_DAYS`; a calendar
  that gives more than 2,000 exams is refused, `CalendarTooBigError`, wherever it
  is read), `normalizeCalendarId`, `uploadedExamKey` (the key of a row is its day
  and title, so the same board brought again keeps the student's names and
  choices), the row rules (`rows.ts`) and the text cleaner (`text.ts`). The
  server and the phone use the same code.

**Phone**

- Bringing a board: `components/ExamBoard.tsx` (the block on "המבחנים שלי" and in
  onboarding), `ExamBoardConfirm.tsx` (the sheet: pick a calendar or a column,
  tick and fix rows, where to save), `lib/examBoard.ts` (who owns the board, the
  target, the words), `lib/pickBoardFile.ts` (`expo-document-picker`) and
  `previewExamBoard`/`saveExamBoard` in `device/v2.ts`. A save for the class by
  someone who holds a board of their own ends that board once the class's feed is
  read again (`replacesOwnBoard`, `afterClassSave`).
- A board of one's own: `local/ownBoard.ts`, under `exams.ownBoard`, as rows, a
  public calendar, or `none` ("בלי הלוח של הכיתה"). `withOwnBoard` lays it over
  the class feed wherever the phone reads exams (`local/source.ts`), so taking it
  away brings the class's back with no request. A calendar is read by the phone
  itself (`refreshOwnBoard`: the public ICS, 15 seconds, 2,000,000 characters), at
  most once an hour by itself and at every pull to refresh
  (`OWN_CALENDAR_EVERY_MS`); a first read that fails is a keep that failed, and
  the board before it is put back (`keepOwnCalendarRead`,
  `OwnCalendarUnreadError`). Never sent to the server (the preview of the link or
  file is the only trip). It goes with a change of class
  (`dropOwnBoardOnClassChange`) and is kept per child on a parent's phone
  (`local/children.ts`).
- A date of one's own: `local/examPrefs.ts` (`dates`, by the exam's key, with the
  source's date it was set against; it falls when the source's date moves), the
  controls in `components/ExamDateControls.tsx` and the rules in
  `lib/examDate.ts`. A hand-added exam changes its stored date
  (`setManualExamDate`). The phone shows it everywhere (`local/days.ts`,
  `api/hooks.ts`); a friend is built from the school's dates
  (`withSchoolDates`, `examsOf`), and so is "שליחה לקבוצה"; the sealed copy for a
  chat carries the exam as the student sees it, with `originalDate`.

## The single-owner mode

The app began as one person's tool: the server held that owner's Mashov session
and Google tokens and polled everything for them, behind one static token
([design-doc.md](design-doc.md) describes it). The owner's phone now runs as a
device like any other, and that mode is gone from the server's code: outside
`/v2` there is only `/health`, `/cron/tick` (which needs `CRON_SECRET`) and the
chat connection's own routes (`/.well-known/*`, `/oauth/*`, `/mcp`, see above),
and every other path answers 404. Its tables were dropped too
(`20261023200000_drop_owner_tables`).

## Limits worth knowing

- Mashov and Shahaf have no public API. Either may change their pages or
  endpoints and break a reader; the fixtures in `server/fixtures` and
  `server/test/fixtures` keep their real structure, with made-up content.
- Android decides when background work runs, much less often while the phone
  sleeps.
- Android only for now; iOS is in progress.

What is stored where, and how to report a problem: [SECURITY.md](../SECURITY.md).
