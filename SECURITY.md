# Security

SederYom handles school accounts of minors, so security reports are taken
seriously.

## Reporting a problem

Please **do not open a public issue**. Report it privately through GitHub:
the repository's **Security** tab → **Report a vulnerability**. Describe what
you found, how to reproduce it, and what an attacker could reach. You should
hear back within a week.

Please don't test against other people's accounts or devices, and don't access
data that isn't yours.

## What is worth reporting

- Anything that lets one device read or change another device's data on the
  server (`/v2` device tokens, the class feed, push registration).
- Anything that lets a device read or change a friend box it should not
  (`/v2/buddies`: only the device that wrote a box can change or delete it),
  or lets the server or anyone else read what a box holds.
- A way to make the server fetch an address it shouldn't. The Shahaf site is
  restricted to `*.shahaf.site`; the exam board's link reader opens an address
  a student pastes, and is restricted to https, public addresses (checked again
  at each redirect), 3 redirects, 10 seconds and 2MB
  (`server/src/exam-board/link.ts`).
- Anything that leaks a Mashov session, a "personal device" pass or a Google
  token off the phone, or into logs.
- Anything that puts a chat connection's secret (the key K, a link code, a
  chat's token) or an opened copy of a student's data into logs, or lets a
  chat read a copy that is not its own device's, or after it was cut
  (`/v2/chat`, `/oauth`, `/mcp`).
- A way to run `/cron/tick` without its secret, or any route outside `/v2`,
  `/cron/tick`, `/health` and the chat connection's own (`/.well-known/*`,
  `/oauth/*`, `/mcp`) that answers with anything but 404.

## What the project stores, and where

- **On the phone:** the Mashov session (in the system's cookie store), Mashov's
  "personal device" pass if Mashov issued one, the Google sign-in (held by
  Google Play services), what was read from Mashov and Google, and the
  student's settings. With them, when a task was completed and when a homework
  item was ticked off: on the phone only.
- **On the server:** per device, a hashed device token, the followed class,
  notification preferences and an optional push token; per class, the public
  Shahaf timetable and the class's exam board (the exams a student approved,
  or the public calendar they come from); and, for each chat a student links,
  the chat connection's rows (below). An Excel file or a link sent to the exam
  board's preview is opened in memory and not kept or logged. No grades, messages,
  passwords or Mashov sessions in a form it can read. (A friend's grades box
  and a chat's sealed copy, below, can hold grades and messages, but only as
  ciphertext; the server opens a chat's copy only while that chat's request is
  in hand.) A device may have no class at all: a phone with a friend or a
  pending invite is registered anyway, and gets no class notifications.
- **Class history** (`class_lesson_history`, `class_exam_history`): what each
  lesson of a class was when it began, and the exams whose day has passed, for
  the school year. The same public timetable as above, kept past its day; no
  student is named in it, and a device reads only its own class's
  (`GET /v2/class/history`).
- **Backups:** a nightly dump of the database, encrypted with a passphrase, kept
  for 30 days as an artifact of a backup workflow in the project's private
  repository (`docs/runbook.md` §1A.5). A row deleted from the database is in those copies
  until they expire.
- **Chat connection rows** (`chat_*`; all but `chat_client` and `chat_attempt`,
  which have no device, are deleted with the device): `chat_client` (a chat that registered itself: its name and redirect
  addresses, with no device; one nobody linked goes after a week), `chat_code`
  (a link code the app made), `chat_auth_code` (the code a chat trades for
  tokens), `chat_grant` (one chat linked to one device, at most
  `CHAT_GRANTS_PER_DEVICE`, with whether the student approved it and when it
  was last used), `chat_token` (an access or refresh token), `chat_snapshot`
  (the device's sealed copy, ciphertext and the time it was written), and
  `chat_attempt` (the IP and time of a wrong try at a code, counted for ten
  minutes, `CHAT_CODE_LOCK_MS`). Link codes, authorization codes and the ids of
  tokens are kept only as SHA-256 hashes, never as given out (a hash, not a
  guarantee: an 8-character link code can be brute-forced from its hash while
  the row lives). The copy is only ciphertext (XSalsa20-Poly1305 under K, made on
  the phone).
  K, the key, is made on the phone (32 random bytes, `nacl.randomBytes`) and
  kept in the app's storage. It reaches the server only to be handed on: it
  waits in `chat_code.key` until the code is used or expires (at most ten
  minutes, `CHAT_CODE_TTL_MS`) and in `chat_auth_code.key` until it is traded or
  expires (sixty seconds, `CHAT_AUTH_CODE_TTL_MS`), then rides inside the tokens
  the chat holds (`sya_<id>.<K>` for an access token, `syr_<id>.<K>` for a
  refresh token) and is stored nowhere on the server. Those windows are the
  codes' lifetimes, not the rows': an expired code is refused but its row is
  deleted only by the next `/cron/tick` (about every 15 minutes,
  `docs/runbook.md`), and the same holds for `chat_attempt`; a row that was never
  used therefore keeps its K, or its IP, until that cleanup. The server sees K
  again only in a chat's request, in memory, to open the copy (`routes/mcp.ts`);
  it is not written to logs (`LOG_REDACT` strips the `Authorization` header and every
  request body, and the error handler on the chat's paths logs an error's name
  and code only).
- **Friends' boxes** (`buddy_box`): what a student shares with a friend (the
  timetable and exams, including exams added by hand, and absence counts per
  subject; and grades and bagrut grades only when both friends chose to, see
  below; never homework or messages) leaves the phone, encrypted under a key
  that only the two friends' phones hold.
  The invite's secret travels in the link's fragment, which is never sent to a
  server, and not through Google Play. The server stores, per box, a random id,
  its kind, the ciphertext, which device wrote it, and when it was created and
  last updated, and cannot read it. It knows which devices exchange boxes, not
  who uses them or what is in them. Only the device that wrote a box can change
  or delete it. A box is deleted when a friendship ends, and any box not
  updated for 120 days (`/cron/tick`). A link answers once: an invite or a
  reply box is never removed, only emptied into a mark that reads as no box
  and that no device (its writer included) can write again. It is emptied when
  its writer deletes it, when the sweep finds an invite or a reply still live
  7 days after it was written, and when its writer's device is deleted
  (`DELETE /v2/device` empties the device's live invites and replies and
  deletes its pair boxes, deletes the device, then settles in the same way any
  live row the delete left with no writer, all in one transaction; the foreign
  key only clears `writerDeviceId`, so a row with no writer is always a mark,
  and "delete my data" does not free a link either). A mark is forgotten 120 days after it
  was made, whatever made it, so a used, expired or withdrawn link cannot be
  re-armed under the inviter's name. A box's
  ciphertext is capped by its kind: 4 096 characters for an invite or a reply,
  32 768 for each of a friendship's boxes.
  Grades are off by default, for each friend, and travel in a second box per
  direction (a `pair` box like the main one, its id derived from the same
  secret under a label of its own). A phone writes it only while both friends
  have grades on, and its bagrut part only while both have bagrut on; the
  sending phone enforces this, so a grade does not leave a phone before the
  friend has agreed back. Its writer deletes it at once on turning grades
  off, on the writer's next sync when the friend turns them off, and when the
  friendship ends. It holds each subject's average (by the
  sharer's own weights), each grade with its date, the assessment's name and
  its number or words (at most the newest 200, in whole days; older days are
  left out, with a `from` date), and, if both chose bagrut, per questionnaire
  the school grade (מגן), the exam grade and the final grade as Mashov reports
  them: no status codes, no estimates, nothing the student entered. It is
  encrypted like the main box, so the server can tell that two devices hold a
  second pair of boxes, not what is in them. A grades box that is gone does not
  end a friendship; only the main box does.
- **Chat connection** (`/v2/chat`, `/oauth`, `/mcp`): a student can link a chat
  (ChatGPT, Claude or another) that reads a copy of what the student chose to
  share (the timetable and exams always, homework by default; grades, bagrut
  grades, absences and Mashov messages only when switched on). What is not
  chosen is never put into the copy, and nothing from Google ever is: Google's
  Workspace data policy forbids using Google user data to develop, improve or
  train AI models, and the app's Google verification covers on-phone use only,
  so calendar events and tasks stay on the phone (a student who wants a chat to
  see them connects Google to that chat directly). The phone seals
  the copy under K and puts it after each refresh while a chat is linked; the
  server keeps only the ciphertext. The threat this is built against is a leak
  of the database alone: it holds hashes, ciphertext and no K, so it opens
  nothing. The exceptions are the rows in which K sits (a link code until it is
  used or expires, at most ten minutes, and an authorization code, sixty seconds;
  an expired one is refused but stays until the next tick deletes it), and a
  chat's tokens: they carry K, so whoever holds a live token of a chat can read
  that device's copy through `/mcp`, and with the ciphertext could open it
  without the server. A token is therefore a bearer secret. The access token
  lasts an hour; the refresh token ninety days and is exchanged at every use, and
  one presented again after a minute is taken as copied and cuts the chat. A
  token belongs to one grant and so to one device: `/mcp` never opens another
  device's copy. A code is guessed at no more than five tries from one address in
  ten minutes, and a chat from an address that is not a known chat's
  (`CHAT_KNOWN_HOSTS`) reads nothing until the student approves it in the app.
  Cutting a chat deletes its tokens at once (the last one also deletes the copy);
  "disconnect all" and `DELETE /v2/device` delete every row of the device in one
  transaction; `/cron/tick` removes expired codes and tokens, a grant that never
  got tokens, and any copy not written for `CHAT_SNAPSHOT_STALE_DAYS` (30) days.
  What a chat is told goes to the company that runs it, which this project does
  not control. A demo grant (for a library's reviewers) belongs to no device, has
  no K and reads only made-up data. The day card (the page `get_day` names)
  runs in the chat's sandboxed frame: it asks for no network access and no
  permission, takes its data only from the tool's result and its messages only
  from the window that frames it, and escapes every piece of text it draws.
- A device may read the feed of any class some device follows, which is how a
  phone shows a friend's lessons. The feed is the class's public timetable; a
  class nobody follows stays closed (`409`).
- The single-owner mode that once stored one owner's encrypted Mashov session
  and Google refresh token has been removed from the server, and its tables
  were dropped from the database.

Passwords for Mashov or the Ministry of Education's login are never stored
anywhere: the student types them only into Mashov's own login page.
