# SederYom — runbook

Everything an operator needs to stand the server up, keep it running, and
rebuild it from nothing. No CI.

> Written for the original single-owner design, which has since been removed
> from the server's code: the phone signs in to Google and reads Mashov itself,
> and the server serves only devices (`/v2`, with the friends' boxes under
> `/v2/buddies/*`, see §5), `/cron/tick` and `/health` (see
> [architecture.md](architecture.md)). The owner's tables were dropped
> (`20261023200000_drop_owner_tables`). The hosting sections (§1) and
> operating notes (§5–§6) apply as they are. §2 (Google OAuth on the server)
> and §3 (Mashov on the server) are kept as a record only; nothing on the
> server uses them any more. §7 is a record of the September 2026 checkpoint.

---

## 0. What a human has to do that the code cannot

In order. Item 1 gates everything else.

1. **Provision the server** (§1) — Vercel + Neon (~30 min), or your own VM.
2. ~~Create the GCP OAuth client (§2)~~ — no longer needed by the server: the
   phone signs in to Google with the app's own clients (`app/app.json`).
3. **Spike 1** (`docs/spike-findings.md`), the Mashov login: done; kept as a record.
4. **Build the app** (§4) — EAS or a local dev build; Expo Go cannot host the
   widget native module.
5. **The September checkpoint** (§7): done in September 2026; kept as a record.

---

## 1. Hosting — pick one

|  | Vercel + Neon | Own VM (Oracle) |
|---|---|---|
| Cost | free | free |
| Setup | ~30 min | 1–2 h, plus A1 capacity roulette |
| Deploy | `git push` | `docker compose up -d --build` |
| Scheduler | external pinger → `/cron/tick` | node-cron in-process |
| Ops | none | firewalls, TLS, backups, updates |

Both run the **same** scheduling policy: `runTick` decides what is due, and the
only difference is what calls it. Switching later is a redeploy, not a rewrite.

---

## 1A. Vercel + Neon (recommended)

### 1A.1 The repository

Vercel deploys from Git, so the code has to be on GitHub: fork this repository,
or push your copy:

```bash
gh repo create sederyom --source=. --remote=origin --push
```

### 1A.2 Neon (Postgres)

`neon.tech` → new project.

- **Name:** `sederyom`
- **Region:** **AWS Europe (Frankfurt)** — see the note below; the default is
  US East and it is the wrong choice here
- **Services:** only *Postgres database*. Object storage, Functions, AI gateway
  and Neon Auth are all irrelevant — Vercel runs the code, and each device
  carries its own token (the server keeps only its hash).

> **Region matters, and both halves must agree.** The hot path is
> function↔database: one tick issues dozens of queries, so a cross-region hop
> is paid dozens of times per tick. Frankfurt also happens to be far closer than
> US East to both the phone and the two Israeli sources the poller fetches. Pick
> Frankfurt here **and** set Vercel's function region to `fra1` (§1A.3);
> matching them is the point, and picking the near one is the bonus.

From the dashboard copy **two** connection strings:

- the **pooled** one (host contains `-pooler`) → `DATABASE_URL`
- the **direct** one → `DIRECT_URL`

Both are needed. A serverless function opens a connection per invocation and
would exhaust a direct connection; migrations, on the other hand, cannot run
through the pooler.

### 1A.3 Vercel

`vercel.com` → Add New → Project → import the repo. Leave the framework preset
as-is; `vercel.json` in the repo already sets the build command and routes every
path to the function.

**Set the function region to match Neon:** Settings → Functions → Function
Region → **Frankfurt (fra1)**. The default is `iad1` (US East), which would put
every database round trip across the Atlantic. Choosing a single region is
available on Hobby; only *multiple* regions require Pro.

Add the environment variables (Settings → Environment Variables), for all
environments:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Neon pooled string |
| `DIRECT_URL` | Neon direct string |
| `CRON_SECRET` | **required**, at least 16 characters: `openssl rand -hex 32` — **hex, not base64**: it travels in a query string, and base64's `+` `/` `=` would need escaping |
| `PUBLIC_URL` | for the chat connection: this server's public address as a bare https origin, e.g. `https://<domain>` (no path; a trailing `/` is dropped). The OAuth metadata, the authorize page's redirects and the `/mcp` resource all name it |
| `CHAT_DEMO_CODE` | optional, and **only while a store review is on**: a fixed code (8 characters of A-Z without I and O, and 2-9, e.g. `DEMA2345`) that links a chat to the built-in demo data. Remove it once the review is done |

Without `CRON_SECRET` the server does not start, and every route, `/health`
included, answers 500 `bootstrap_failed` naming the missing variable. It
guards `/cron/tick` only; it no longer falls back to any other token.

`PUBLIC_URL` defaults to `http://localhost:3000`, for a local server. In
production, an address that is not https (the default included) logs a warning
at startup (`PUBLIC_URL is not an https address in production`) and the chat's
side — `/.well-known/*`, `/oauth/*` and `/mcp` — answers 503
`{"error":"not_configured"}` until it is set; the rest of the server is
unaffected. A `CHAT_DEMO_CODE` that is not a valid code does not stop the server
either: it logs `CHAT_DEMO_CODE is not 8 characters …: the chat demo is off`
and the demo code is refused like any wrong code.

Deploy. The build runs `prisma migrate deploy`, so the Neon schema is created on
the first deploy with nothing to do by hand.

```bash
curl https://<domain>/health          # {"ok":true,...}
```

> **The single-owner variables are gone.** `API_BEARER_TOKEN`,
> `ENCRYPTION_KEY`, `PUBLIC_BASE_URL`, `GOOGLE_CLIENT_ID`,
> `GOOGLE_CLIENT_SECRET`, `SHAHAF_BASE_URL`, `MASHOV_BASE_URL`,
> `EXAM_CALENDAR_ID`, `POLL_MASHOV_MIN`, `MASHOV_KEEPALIVE_MIN`,
> `POLL_GOOGLE_MIN`, `DEGRADE_AFTER_FAILURES` and `BROKEN_PUSH_AFTER_HOURS` are
> no longer read; an old deployment that still has them is unaffected, since
> unknown variables are ignored. Remove them from Vercel. `ENCRYPTION_KEY` was
> the only key to the encrypted Mashov session and Google token in the owner's
> tables; with the tables dropped it guards nothing, unless an older dump or
> database branch that still has them is kept.

### 1A.4 The scheduler

This is the one piece Vercel does not provide. **Vercel's own cron is limited to
once per day on the Hobby plan**, with ±59 minutes of jitter — `*/15 * * * *`
fails at deploy time. Polling a timetable every 15 minutes is the point of the
service, so the trigger comes from outside.

`cron-job.org` (free, minute resolution):

- URL: `https://<domain>/cron/tick?secret=<CRON_SECRET>`
- Schedule: **every 15 minutes**
- Method: GET

> **Why 15 and not 5 — Neon's free tier is the constraint.** The Free plan
> gives 100 CU-hours a month and suspends the compute after **5 minutes** of
> inactivity, a timeout that cannot be changed below the Launch plan. A pinger
> every 5 minutes therefore never lets the database sleep: ~730 hours a month at
> 0.25 CU ≈ **182 CU-hours**, nearly double the allowance. At 15 minutes the
> compute is awake roughly 5 minutes in every 15 — about 61 CU-hours, with
> comfortable headroom.
>
> This is the one real cost of the serverless route. On the VM there is no such
> ceiling and the design's own cadences apply unmodified.

Fifteen minutes is the *pinger's* interval, and it happens to match Shahaf's
active cadence, which is exactly the case that needs care: a pinger does not
fire at precisely 900.000s, and arriving twenty seconds early would make a
class "not due" and push the real cadence out to 30 minutes. The class poll
allows two minutes of slack for that (`DEFAULT_SLACK_MINUTES` in
`server/src/sync/tick.ts`).

Each tick asks the database when each followed class (and its exam calendar)
was last polled and only polls what is due, at most `CLASS_POLLS_PER_TICK`
classes, so the pinger's interval and the poll cadences stay independent.

Prefer the header over the query string — put the secret in
`Authorization: Bearer <CRON_SECRET>` under Advanced → Headers, since anything
in a URL is written to logs at every hop. Both forms work.

Also turn on **Save responses in job history** and **notify on failure after 2
failures**; a pinger that quietly stops is the one failure the whole design is
built to prevent, and nothing else would notice it.

> **The tick answers `202` immediately and works in the background.** Free
> pingers cap their read timeout near 30 seconds, while a tick that polls
> several sources legitimately takes longer — Vercel allows 300. Waiting on it
> made the pinger report a timeout for work that had in fact succeeded, and
> after enough of those it disables the job. `waitUntil` keeps the invocation
> alive past the response, so the pinger now monitors reachability and
> authorisation only.
>
> That is the right split: **a poll failing is not an HTTP failure.** Sync
> health lives on each class row (`school_class."lastOkAt"`, `"lastError"`,
> `"examsError"`) and in the log.

To see a tick's actual result, ask for it synchronously:

```bash
curl -H "Authorization: Bearer <CRON_SECRET>" "https://<domain>/cron/tick?wait=1"
# {"ok":true,"ms":812,"classes":{"polled":1,"failed":0,"events":0,"sent":0,"deferred":0,"closed":0,"examCalendars":0},"errors":[]}
```

Without the secret, or with a wrong one, `/cron/tick` answers 401.

### 1A.5 Backups

Neon's free tier restores **six hours** back, no more: a mistake found the next
day is not covered by it. The copy that covers it is ours.

**The nightly backup** (`.github/workflows/db-backup.yml`) runs at 01:30 UTC,
dumps the database with `pg_dump`, encrypts the dump with a passphrase and keeps
it as a workflow artifact for 30 days. It needs two repository secrets (Settings
→ Secrets and variables → Actions):

| Secret | Value |
|---|---|
| `BACKUP_DATABASE_URL` | Neon's **unpooled** connection string (`DIRECT_URL`) |
| `BACKUP_PASSPHRASE` | a long random passphrase, kept somewhere outside GitHub too: without it the copies cannot be opened |

Run it once by hand after adding them (Actions → db-backup → Run workflow) and
check that the run is green and lists an artifact. A dump under 100 KB fails the
run. The artifact is private only while the repository is: it holds the class
history, hashed device tokens, and friends' and chats' ciphertext.

**Restoring.** Download the night's artifact, then, into a new Neon branch or
database (never over the live one before looking at what it holds):

```bash
gpg -d sederyom-2026-11-11.dump.gpg > sederyom.dump
pg_restore --no-owner -d "<the new branch's DIRECT_URL>" sederyom.dump
```

A copy by hand, from anywhere:

```bash
pg_dump "<DIRECT_URL>" | gzip > sederyom-$(date +%F).sql.gz
```

The device tables hold no secrets: device tokens are stored only as hashes. A
dump taken before the single owner's tables were dropped also holds that owner's
Mashov session and Google token as ciphertext, readable only with the old
`ENCRYPTION_KEY` (§1A.3).

### 1A.6 Updating

`git push`. Vercel builds, runs migrations and swaps the deployment.

> **The commit author has to be you.** Vercel only builds commits whose author
> email belongs to an account with access to the project, and GitHub resolves
> authorship by **email**, never by name. A commit made under any other address
> is silently skipped — no build, no error, the dashboard simply shows nothing
> new. If a push does not produce a deployment, check this before anything else:
>
> ```bash
> git log -1 --format='%an <%ae>'
> ```
>
> This repository pins the identity locally so it cannot drift:
>
> ```bash
> git config --local user.email "<id>+<login>@users.noreply.github.com"
> ```
>
> The `<id>+<login>@users.noreply.github.com` form is guaranteed to map to the
> GitHub account; a personal address only works if it is verified there.
>
> A commit that was already skipped will not build retroactively. Redeploy the
> latest deployment by hand once (Deployments → `⋯` → Redeploy), and subsequent
> pushes behave normally.

### 1A.6b The function entry must stay CommonJS

`api/index.ts` requires `server/dist/handler.cjs`, not the `.js` next to it, and
that is deliberate. The repo root has no `"type": "module"`, so Vercel compiles
the entry as CommonJS — and its function runtime uses a custom loader that
cannot `require()` an ES module:

```
Error [ERR_REQUIRE_ESM]: require() of ES Module /var/task/server/dist/handler.js
from /var/task/api/index.js not supported
```

Plain Node 22 *can* do this, which makes the trap worse: it works locally and
fails only once deployed. `tsup` therefore emits both formats — ESM for the
long-lived server and Docker, CJS for the function. To exercise the deployed
path locally, require the `.cjs` build from a `.cjs` file; requiring the `.js`
one proves nothing.

### 1A.7 Changing an environment variable

Vercel does **not** rebuild when a variable changes. After editing one, redeploy
by hand: Deployments → the top entry → `⋯` → **Redeploy**.

---

## 1B. Your own VM (alternative)

Everything below is verified and stays supported — take this route if you would
rather not depend on two hosted services, or want the always-on process.


### 1.0 Getting the code onto the VM

`docker compose up` on the VM needs the repository there. Two ways:

**A GitHub repo (recommended)**: your fork, or your own copy. It makes every
later deploy a `git pull`, and §1.4 assumes it. The repo carries no secrets:
they all live in `server/.env`.

**Or copy it directly**, if you would rather not host it:

```bash
rsync -av --exclude node_modules --exclude .git --exclude android   ./ ubuntu@<public-ip>:~/sederyom/
```

Updating then means rsyncing again rather than `git pull`.

Either way `infra/.env` is **never** committed or copied — it is created on the
VM in §1.3 and exists nowhere else.

### 1.1 Oracle account and VM

1. **Sign up** at `cloud.oracle.com` → "Start for free". A credit card is
   required for identity verification; Always Free resources are not charged.
2. **Choose the home region carefully.** It cannot be changed afterwards, and
   Always Free capacity exists *only* in the home region. Frankfurt, Amsterdam
   and London are the usual picks from Israel.
3. **Create an SSH key first**, so it can be pasted during instance creation:

   ```bash
   ssh-keygen -t ed25519 -C sederyom -f ~/.ssh/sederyom
   cat ~/.ssh/sederyom.pub
   ```

4. **Create the instance.** Compute → Instances → Create instance.
   - Image: **Ubuntu 24.04**
   - Shape: **VM.Standard.A1.Flex**, 4 OCPU / 24 GB (all of the ARM free tier)
   - Networking: leave the defaults; it creates a VCN and assigns a public IPv4
   - SSH keys: paste the public key from step 3

> **The one thing that actually blocks people:** `Out of host capacity` on the
> A1 shape. It is extremely common and has nothing to do with your account. Two
> ways through:
> - Retry, and try each availability domain in the region. Capacity frees up
>   irregularly; people often succeed within a day.
> - Or take **VM.Standard.E2.1.Micro** (1 OCPU, 1 GB) instead, which is almost
>   always available. It is tight for Postgres + Node + Caddy but workable for
>   one user — add swap:
>   ```bash
>   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
>   sudo mkswap /swapfile && sudo swapon /swapfile
>   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
>   ```
>   Moving to A1 later is a rebuild, not a migration — but §6 makes that cheap.

### 1.2 Open the ports — both firewalls

Oracle has **two** firewalls and both must be opened. Missing the second is the
classic "the VM is up but nothing answers" symptom.

**a. The VCN security list** (in the console): Networking → Virtual Cloud
Networks → your VCN → Security Lists → Default → Add Ingress Rules. Two rules,
both stateless = No, source `0.0.0.0/0`, IP protocol TCP, destination port 80,
then again for 443.

**b. The instance's own iptables.** Oracle's Ubuntu images ship with rules that
drop everything except SSH:

```bash
ssh -i ~/.ssh/sederyom ubuntu@<public-ip>
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

Verify from your own machine — this must connect (a refusal is fine, a *timeout*
means a firewall is still closed):

```bash
nc -vz <public-ip> 443
```

### 1.2b A domain name

Caddy needs a real hostname to obtain a certificate; a bare IP cannot get one.

**If you own a domain:** add an `A` record, e.g. `sederyom.yourdomain.com` →
`<public-ip>`, TTL 300.

**If you do not:** `duckdns.org` is free, takes two minutes and works fine with
Let's Encrypt. Sign in, pick a name, point it at the public IP, and the domain
is `<name>.duckdns.org`.

Wait for DNS to actually resolve before deploying — Caddy will fail the
certificate challenge otherwise:

```bash
dig +short sederyom.yourdomain.com     # must print the public IP
```

### 1.2c Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit    # log out and back in for the group to take effect
```

### 1.3 First deploy

```bash
git clone <repo> sederyom && cd sederyom/infra
cp .env.example .env
```

Fill `infra/.env`:

```bash
# generate it, do not reuse anything
openssl rand -hex 32      # → CRON_SECRET   (required; the server will not start without it)
```

`SEDERYOM_DOMAIN` is the hostname from §1.2b (no scheme, no trailing slash).

```bash
docker compose up -d --build
curl https://<domain>/health          # {"ok":true,...}
```

Migrations run on container boot (`prisma migrate deploy` in the Dockerfile
CMD), so a deploy is always just `docker compose up -d --build`.

### 1.4 Updating

```bash
cd sederyom && git pull && cd infra && docker compose up -d --build
docker compose logs -f api
```

### 1.5 Backups

Nightly `pg_dump` to the VM disk. `infra/backups` is already mounted into the
`db` container:

```cron
15 3 * * * cd /home/ubuntu/sederyom/infra && docker compose exec -T db \
  pg_dump -U sederyom sederyom | gzip > backups/sederyom-$(date +\%F).sql.gz \
  && find backups -name 'sederyom-*.sql.gz' -mtime +14 -delete
```

Restore:

```bash
gunzip -c backups/sederyom-YYYY-MM-DD.sql.gz | \
  docker compose exec -T db psql -U sederyom -d sederyom
```

The device tables hold no secrets (device tokens are stored only as hashes).
A dump taken before the single owner's tables were dropped holds that owner's Mashov
session and Google token as AES-256-GCM ciphertext, readable only with the old
`ENCRYPTION_KEY`; nothing on the server reads them any more.

---

## 2. Google (GCP) *(single-owner mode, removed — a record)*

> The server no longer has Google routes or a Google client: `/oauth/*` answers
> 404, and the phone signs in to Google itself. This section is kept as a
> record of how the owner's connection was set up.

> **Cost: none, and no billing account.** Some Google APIs (Maps, Vertex)
> refuse to work without billing enabled; the Workspace ones used here do not.
> Default quotas are in the millions of Calendar calls a day against the ~150
> this makes, and leaving the app unverified is free — it caps you at 100 users
> and shows one "Google hasn't verified this app" screen, both irrelevant for a
> single user.

**1. Project.** Name it `sederyom`. The generated project ID (`sederyom-123456`
or similar) is never used by this app — ignore it.

**2. Enable two APIs**, APIs & Services → Library:

- **Google Calendar API**
- **Google Tasks API**

Nothing else. Enabling an API you do not use only widens what a leaked token
could reach.

**3. Consent screen.** In current consoles this sits under **Google Auth
Platform**; older ones call it *OAuth consent screen*.

| Field | Value |
|---|---|
| User type | **External** (Internal exists only for Workspace orgs) |
| App name | `SederYom` — Latin, to avoid any argument with the review heuristics |
| User support email | your own |
| Developer contact | your own |
| Scopes | `.../auth/calendar` and `.../auth/tasks` |
| Publishing status | **Publish app → In production** |

Production is not a nicety, and it is the step people skip. In *Testing*, only
accounts explicitly listed as **test users** may authorize at all — everyone
else is refused outright:

```
Error 403: access_denied
```

There is nothing wrong with the app when this happens; Google is stopping the
flow at the door. And even for a listed test user, Testing expires the
authorization and its refresh token after **7 days**, which presents later as a
mysterious weekly disconnect. Adding yourself as a test user therefore looks
like a fix and quietly buys the second problem.

Publishing does not require verification. An unverified production app with
sensitive scopes shows a one-time "Google hasn't verified this app" screen
(Advanced → continue) and is capped at 100 users — both irrelevant here.
Verification is only demanded of apps that actually distribute.

Two things about that screen. **Publish app** lives on **Audience**, while the
fields live on **Branding**, and Branding is half required and half not — get
that backwards and you either cannot publish or you accidentally sign up for
verification.

**Required** (attempting to publish without them fails with *"Your app's OAuth
configuration is incomplete"*, which does not say which field):

- **App name** — `SederYom`
- **User support email**
- **Developer contact information**

**Leave empty** — these exist for verification, not for publishing:

- App logo. Uploading one is the single action on the page that actively
  *triggers* a verification requirement, as the page itself warns in passing.
- Application home page, privacy policy link, terms of service link
- Authorized domains

`auth/calendar` is read **and** write on purpose — the "בית ספר" calendar in
design-doc §5.2 cannot be created with a read-only scope.

**4. Credentials** → Create credentials → **OAuth client ID**:

| Field | Value |
|---|---|
| Application type | **Web application** |
| Name | `sederyom-server` (internal label only) |
| Authorised redirect URI | `https://<domain>/oauth/google/callback` |
| Authorised JavaScript origins | leave empty — no browser code calls Google |

The redirect URI must match byte for byte: `https`, no trailing slash, no
`www`. A mismatch produces `redirect_uri_mismatch` at consent time and nothing
else explains it.

**5.** Put the client id and secret into the deployment — Vercel environment
variables (then **Redeploy**, since a variable change does not rebuild), or
`infra/.env` followed by `docker compose up -d`.

**6.** Open `https://<domain>/oauth/google/start` in a browser, or use
Settings → יומן Google → **התחבר מחדש** in the app.

Signs it worked: `GET /status` shows `google_calendar` and `google_tasks` with a
`lastOkAt` within one poll cycle (10 min).

---

## 3. Mashov *(single-owner mode, removed — a record)*

> The server no longer reads Mashov: `/sessions/mashov` and `/status` answer
> 404, and the phone reads Mashov with its own session. This section is kept as
> a record.

The server never logs in. Settings → משוב → **התחבר מחדש** opens a WebView on the
Mashov login, which redirects through הזדהות אחידה. Complete it (OTP included);
the app captures the cookie jar and POSTs it to `/sessions/mashov`, where it is
stored encrypted.

The capture is verified on the spot: before answering, the server polls Mashov
with the new session, and the screen shows that verdict — "ההתחברות אומתה", or
the error Mashov returned. A successful verification is also what makes
`/status` report Mashov as connected right away; it no longer waits for the
next scheduled poll. In `/status`, `configured` says a session exists and
`lastOkAt` says it worked; **מצב חיבורים** in the app shows the two apart
("ממתין לסנכרון" between them).

When the session expires the server sends exactly one **נדרשת התחברות מחדש**
push, which deep-links straight back to that screen. Expect this to be needed
periodically — how often is what Spike 1 measures.

---

## 4. App build

The app needs a **development build or an EAS build**; Expo Go cannot load the
widget native module.

Build-time configuration (EAS environment variables, or local `app/.env`):

```
EXPO_PUBLIC_SEDERYOM_API_URL=https://<domain>
```

No server token is built into the app: every phone registers as a device on
`/v2` and keeps its own.

Local:

```bash
cd app
npx expo prebuild -p android
npx expo run:android      # device connected over USB
```

An installable production APK (no Metro/dev server required), from the repository root:

```bash
npm run app:build
```

The wrapper runs `eas-cli build --platform android --profile production` in
`app/`. Do not run EAS directly in the repository root: root-level Expo files
refer to a different project and the default entry tries to import `../../App`.
The canonical config is `app/app.json`; its project ID is also used for push.

Configure `EXPO_PUBLIC_SEDERYOM_API_URL` as a variable in that project's
**production** EAS environment. An ignored local `.env` is not sufficient for a
remote build.

For a development client, run `npx eas-cli build -p android --profile development`
from `app/` and set the same variable in the development environment.

For Android push, register `site.sederyom.app` in Firebase. Put the downloaded
`google-services.json` in `app/` for local builds, or upload it as an EAS **File**
variable named `GOOGLE_SERVICES_JSON` in production. `app/app.config.js` maps it
to `android.googleServicesFile`. Also configure the matching FCM V1 service
account credential in EAS; this is a separate server credential, not the
`google-services.json` file. See https://docs.expo.dev/push-notifications/fcm-credentials/.
Rebuild after adding this configuration, then grant notifications on the phone.

Note `app.json` has `"newArchEnabled": true`; `react-native-mmkv` v4 requires it.

---

## 5. Operating

### Health at a glance

`GET /health` says the function is up. `GET /cron/tick?wait=1` with the secret
(§1A.4) runs a tick and reports what it polled. Per class, the row itself is
the record: when it was last polled, last read successfully, the last error,
the freshness the Shahaf site reports about itself, and the same for its exam
calendar. Each phone shows its own Mashov and Google state in מצב חיבורים; the
server knows neither.

### When something fails

| Situation | What happens |
|---|---|
| A class's site fails to load | the error is kept on its row (`lastError`), the class waits its turn and is polled again on the next due tick; other classes are unaffected |
| An exam calendar fails to load | the same, in `examsError`; its last good exams stay in the feed |
| Expo refuses a push | the event stays open and is retried on the next tick; a token Expo reports as unregistered is dropped from its device |
| First read of a class | its timetable is published, not announced — no burst of pushes; only a lesson that is already cancelled or changed is news |
| An event still undelivered a day later | closed: by then it is not news |
| The friends' cleanup fails | `buddy boxes: …` in the tick's `errors`, and `forgetting stale buddy boxes threw` in the log; the rest of the tick runs, and the next tick tries again |
| A student's exam-board preview fails | the phone shows the sentence for the code (table in "Exam board"); a 500 `preview_failed` is a bug, and the log has the error's name only |
| An exam-board announcement fails | `exam board announcement failed` (warning): the mark is taken back, so the next calendar read or save tells the class. With `exam board announcement mark not taken back` (error) the class looks told and was not: set its `examBoardAnnouncedAt` to null by hand |

Mashov's and Google's failures are the phone's own, and the phone says so.

### Poll cadences

Each followed class's Shahaf site every 15 min inside 06:00–22:30
Asia/Jerusalem and every 60 min outside; each class's exam calendar every 60
min around the clock (it is a public ICS feed — a few times a term it changes).
Only a class whose board is a calendar is polled; a board brought from a file or a page is kept as confirmed.
At most `CLASS_POLLS_PER_TICK` classes a tick, least recently polled first.
All tunable through the `POLL_*` env vars.

### Friends (חברים)

A student can share a timetable, exams and absence counts with a friend (design:
`docs/superpowers/specs/2026-10-29-friends-design.md`). The server holds none of
it in the clear, and that is the thing to keep true when touching this code.

- **The table: `buddy_box`** (migration `20261030120000_buddy_boxes`, a new table
  only; nothing existing changes; `20261030140000_buddy_marks_outlive_device`
  then makes `writerDeviceId` nullable and its foreign key `ON DELETE SET NULL`,
  and changes no row). One row per box: a random 22-character `id`
  that both phones derive from a secret the server never sees, the
  `writerDeviceId` of the device that wrote it first (a foreign key with
  `ON DELETE SET NULL`: a deleted device leaves its marks behind with no
  writer, and `DELETE /v2/device` has settled its other boxes first, below), a
  `kind` (`invite`, `reply` or `pair`), the `ciphertext` (base64url, at most
  4 096 characters for an `invite` or a `reply`, 32 768 for a `pair`) and the
  two times. There is no column for a reader, and nothing in a row says whose it
  is. A row whose `ciphertext` is `''` is a used link's mark (below), not a
  broken row, and a row with no `writerDeviceId` is always a mark.
- **Routes**, all under a device token:
  - `PUT /v2/buddies/boxes`: up to 25 boxes. Each answers `ok`, `taken` (another
    device wrote the id first, or it is a mark, one with no writer included) or `too_many` (a
    device keeps at most 60 live boxes; marks do not count), as a per-box
    `error` inside a 200 response; a taken box is not an HTTP 409. A box over
    its kind's cap makes the whole request a 400 `invalid_boxes`.
  - `POST /v2/buddies/read`: up to 50 ids, POST so that the ids stay out of the
    URL logs. A box that does not exist, or a mark, comes back with a `null`
    ciphertext.
  - `DELETE /v2/buddies/boxes`: only what the calling device wrote goes. A
    `pair` row is deleted; an `invite` or a `reply` row is emptied
    (`ciphertext = ''`, `updatedAt` now) and stays as a mark, so nobody can
    write a used link's ids again under the inviter's name.
  - `DELETE /v2/device` ("delete my data"): in its one transaction, before the
    device row goes, the device's live `invite` and `reply` rows are emptied
    into marks (`updatedAt` now) and its `pair` rows are deleted; the row's
    delete then only clears `writerDeviceId`; and then the same is done to every
    live row with no writer (a box the device wrote in between, which the delete
    left live; normally there are none). So deleting a device never frees a used
    link, and a row with no writer is always a mark. Both steps are
    `settleBoxes` in `server/src/routes/buddies.ts`, which the box delete
    (`DELETE /v2/buddies/boxes`) uses too.
  - `GET /v2/class/feed?site=&cls=` also answers for a class that some device
    follows, so that a phone can show a friend's lessons. A class nobody follows
    is still `409 not_followed`.
- **The invite page: `/b#<secret>`** is `public/buddy.html`, rewritten in
  `vercel.json` as `/join` and `/privacy` are. The secret lives in the fragment,
  which a browser never sends. The page builds the Android link
  `sederyom://buddy?k=<secret>` from it and sends nothing anywhere. The VM (§1B)
  serves no static pages (Caddy hands every path to the API), so `/b`, `/join`
  and `/privacy` exist only on Vercel.
- **Cleanup**, in each `/cron/tick`, in this order: invite and reply boxes more
  than 7 days old (`BUDDY_INVITE_TTL_DAYS`) that are not marks are emptied into
  marks (`ciphertext = ''`, `updatedAt` now), not deleted, so that their links
  stay used; then any box, marks included (with a writer or without), not
  updated for 120 days (`BUDDY_BOX_STALE_DAYS`) is deleted, which covers a phone
  that lost the app or was left unopened over the summer. A mark lives 120 days
  from when it was made, whatever made it. A live phone rewrites its box at
  least once an hour while it refreshes (`BUDDY_REWRITE_MINUTES`), so a box is
  never 120 days old by waiting alone. These numbers, and the size caps
  (`BUDDY_INVITE_CIPHERTEXT_MAX`, `BUDDY_PAIR_CIPHERTEXT_MAX`) and the limits
  above, are compile-time constants in `shared/src/buddies.ts`, not env vars:
  changing one is a code change and a deploy (and, for what the phone reads, an APK).
- **A device may exist without a class.** A phone with a friend or a pending
  invite registers as a device even when it follows no class (a school without
  a Shahaf site): `device."classId"` is null, it gets no class notifications, and
  the phone deletes the device again when its last friend or invite is gone. A
  null `classId` in the query below is therefore normal now, not a leak.
- **Releasing:** the server first (migration, routes, `buddy.html`, privacy
  page), then the APK; Android only for now. A phone on an older app simply sees
  no friends. The server code and the `20261030140000_buddy_marks_outlive_device`
  migration go out together; the migration changes no row, and the APK's
  protocol is the same with or without it.

### Exam board (לוח המבחנים)

A student brings the class's exam schedule from a link (a school page, a public
Google calendar, a Google sheet) or an Excel file (design:
`docs/superpowers/specs/2026-11-10-exam-board-sources-design.md`; where the code
is: [architecture.md](architecture.md), "The exam board"). The server opens what
an anonymous device points it at, so the limits below are part of the feature.
They are constants in the code (`server/src/routes/examBoard.ts`,
`server/src/exam-board/`, `shared/src/logic/exam-board/`), not environment
variables: changing one is a deploy.

**Limits**

| What | Limit |
|---|---|
| Excel file as received | 1MB |
| Inflated (all parts of the archive) | 10MB, counted while inflating |
| XML elements, over all the parts read | 500,000 |
| Cells with a value | 20,000 |
| Text in the grid | 2,000,000 characters (a merged cell or a shared string counts once per cell it shows in) |
| Rows and skipped lines from one file together | 2,000 |
| Rows in one save | 400, each a day inside the school year, a title of 1 to 200 characters, details up to 500 |
| Previews | 10 an hour per device, counted before the work (`takePreviewTurn`); a refused call is not counted. The "choose a column" step is a second preview |
| Link typed on the phone | 2,000 characters (the zod limit; `MAX_LINK_CHARS` 4096 in `link.ts` is never reached from the phone) |
| Request bodies | preview 1.5MB, save 700KB; over the limit it answers `too_big` |
| What the server fetches | https only, no user name or port; the host is resolved first and every address must be public (private, loopback, link-local, shared, reserved and multicast ranges are refused, IPv4 and IPv6; checked again at each redirect); at most 3 redirects; 10 seconds a get; 2MB of body; no cookies and no headers of ours |
| One page's calendars | at most 10 offered; a page with no calendar is followed to exactly one `.xlsx` or Google sheet link, one hop |
| A calendar, wherever it is read | an event of more than 14 days is not an exam and is skipped (`MAX_EXAM_SPAN_DAYS`); more than 2,000 exams in the school year refuses the whole calendar (`MAX_CALENDAR_EXAMS`): `too_big` in a preview, a failed read on the server (`examsError`; the exams read before stay), the read before kept on the phone |
| A calendar kept on the phone alone | read by the phone itself, at most once an hour and at a pull to refresh; 15 seconds and 2,000,000 characters a read |
| A whole preview | 25 seconds (`PREVIEW_DEADLINE_MS`), then `unreachable`; the phone waits 30 |

**Known gap, recorded.** The address is checked, then resolved again by `fetch`
when it connects, so a hostile DNS server that answers differently the second
time (rebinding) could still get a request through to a private address. What
is left is a hostile name server, not a hostile page. Closing it means
connecting to the address that was checked; left out on purpose (`link.ts`,
header).

**Error codes** (the `error` field of a refusal; the app has its own sentence for each)

| Code | Status | Means |
|---|---|---|
| `no_class` | 409 | the device follows no class |
| `unreachable` | 422 | the link did not open: not https, a private address, a port, more than 3 redirects, over 10 seconds, an answer that is not 2xx, text with no address in it, no calendar of a page could be read, or the preview ran over 25 seconds |
| `no_board` | 422 | the page has no calendar, and not exactly one `.xlsx` or Google sheet link; or it is nested deeper than any real page |
| `private_sheet` | 422 | a Google sheet that is not shared with everyone (a redirect to accounts.google.com, or a page where a file should be) |
| `unsupported_file` | 422 | not an `.xlsx` (a PDF, csv, old xls, another zip), or not valid base64 |
| `too_big` | 422 | over any size limit above, a calendar that gives more than 2,000 exams, or a body over the request limit |
| `unknown_layout` | 422 | no layout of ours in the file (a list with a date column, or a table with a date column and a column per class) |
| `rate_limited` | 429 | the 11th preview in the hour |
| `bad_rows` | 422 | a save with no rows, over 400, a date outside the school year, an empty or over-long title or details |
| `calendar_locked` | 403 | the class has a board that another device brought, which still follows the class and was seen in the last 30 days (save or removal) |
| `invalid_preview`, `invalid_exam_board` | 400 | the body is not the shape (not exactly one of link and file; rows missing) |
| `preview_failed` | 500 | a bug, not a refusal: the log has the name of the error and nothing it said |

An app that is newer than the server gets a 404 from the preview and says "זה עוד לא זמין, כדאי לנסות שוב בעוד כמה ימים."

**Migrations and order.** Two, both safe to run on a live database:

- `20261110120000_exam_board` adds columns only: `school_class.examBoardKind`,
  `examBoardSetAt`, `examBoardAnnouncedAt`, and `device.boardPreviewCount`,
  `boardPreviewWindowAt`.
- `20261110130000_exam_board_announced_backfill` changes data only: it sets
  `examBoardAnnouncedAt` on every class that already has a calendar, so that the
  first tick does not push "לוח מבחנים חדש" to every follower of a class that
  has had its calendar for months.

**The server goes out before the app.** An old app against the new server is
untouched (the feed has one extra field it ignores, and an uploaded board goes
out as the same `school_site` exams). A new app against the old server gets 404s
from the preview and says it is not available yet. The app also needs a full
native build (`expo-document-picker`).

**Before the deploy**

1. **A rate limit per IP, at the edge.** The preview's limit in the code is per
   device, and registering a device (`POST /v2/devices`) is free and anonymous,
   so one client can make devices and multiply it. In Vercel → the project →
   Firewall, add a rate-limit rule per IP on `POST /v2/devices` and on
   `POST /v2/device/exam-board/preview`. The numbers are the owner's; a school's
   Wi-Fi puts many phones behind one address.
2. **The two migrations on a Neon branch first.** They have never run on
   Postgres: the conditional updates (the counter, the lock, the write) were
   tested only on the tests' stand-in database. Make a branch of the production
   database in Neon, run `npx prisma migrate deploy --schema server/prisma/schema.prisma`
   with `DATABASE_URL` and `DIRECT_URL` set to the branch, check step 1 of
   "After the deploy" there, and delete the branch.
3. **The lock on the day of the deploy.** Before this version `lastSeenAt` was
   written only by `PUT /v2/device` and `PUT /v2/device/classes`; now the class
   feed writes it too, at most once a day (`markSeen`). A phone that brought its
   class's calendar and changed no setting in 30 days looks unseen at the
   deploy, so it holds no lock (`SETTER_GONE_AFTER_DAYS`) until it next reads
   the class feed: in that window a classmate may replace or remove that board.
   To close it, just before the deploy (it also gives a setter that is really
   gone 30 more days of the lock):
   `update device set "lastSeenAt" = now() where id in (select "examCalendarSetBy" from school_class where "examCalendarSetBy" is not null);`
4. **Shahaf and an exam that has passed.** On a real Shahaf site, look at a
   class's exam list the day after one of its exams, and a week later: does the
   exam leave the list on its day, or stay? The feed reaches 7 days back
   (`CLASS_FEED_PAST_DAYS`), and a Shahaf exam a student moved to a later date
   relies on the site still listing it until its own date is 7 days old
   (`keptExams`, `forgetAbsentCopies` in `app/src/local/examPrefs.ts`). A site
   that drops it on its day makes the phone take it as removed by the school,
   and the moved exam disappears at the next refresh.
5. **Nothing of the feature has run on a phone.** On real devices, before the
   release: the file picker on Android and on an iPhone, with a real `.xlsx`;
   a link to a school page and to a public Google calendar; a calendar kept
   "רק אצלי" (the phone reads it from Google itself, at most hourly and at a
   pull to refresh); the push on a second phone of the class, and none on the
   phone that brought the board; "לשנות תאריך" and the Google "בית ספר" calendar
   showing the new date; the confirm sheet on iOS; a screen reader on the block
   and the sheet; a parent's phone with two children.

**After the deploy**

1. The build log shows both migrations applied. `select count(*) from school_class where "examCalendarId" is not null and "examBoardAnnouncedAt" is null;` is 0.
2. After the first tick, `select count(*) from class_change_event where kind = 'exam_board';` is 0. A number above 0 means followers of old calendar classes are about to be told that a board was added: mark them as told before the push run (`update class_change_event set "notifiedAt" = now() where kind = 'exam_board' and "notifiedAt" is null;`) and look at why the backfill did not hold.
3. **The function's time limit.** A preview may run 25 seconds and the phone waits 30. `vercel.json` sets no `maxDuration`; check the project's effective limit (Settings → Functions, and the plan's default) covers about 30 seconds. If it does not, the platform cuts a slow preview before `unreachable` is answered, and the phone sees a gateway error instead of a sentence.
4. From a phone with a class and a build of the new app: paste the link of a school page that embeds a calendar (the Hadarim page of the design doc is one), then a link to a public Google calendar, then an Excel file; each should end in the confirm sheet. A link starting `http://` should answer the "לא הצלחנו לפתוח את הקישור" sentence. The 11th try in an hour should answer the "יותר מדי פעמים" sentence.
5. Confirm a board for a test class that has never had one, with a second test phone following it: that phone gets one push, the phone that brought the board gets none, and a second save (a replacement) sends none. A class told within the last 30 days is not told again, even after its board was removed.
6. In the logs, `exam board preview failed` (a bug), `exam board announcement failed` and `exam calendar not read at once` should be rare, and none of the lines should quote a link, a file name or a cell. If one does, that is a privacy bug: the privacy page promises the link, the file and what is in them are not logged.

**If the deploy is reverted.** Promoting the previous deployment, or building a
revert, undoes no migration (Prisma has no down migrations). What the older
server does then, as its code (`master` before the exam board) reads:

- The five new columns stay, with their values; its Prisma client does not know
  them and neither reads nor writes them.
- A board from a file (`examBoardKind = 'upload'`, no calendar id) still reaches
  the class: the old feed sends the row's `exams` as `school_site` exams. The old
  tick does not read it (it reads classes with a calendar id), the old lock reads
  "no calendar id" as no board, so any follower may set a calendar over it, and
  a removal (`examCalendar: null`) changes nothing on it.
- A calendar set over such a board under the old code leaves `examBoardKind =
  'upload'` behind, and once the new code is back the tick never reads that
  calendar (it reads only `examBoardKind` null). Before deploying forward again:
  `update school_class set "examBoardKind" = null where "examCalendarId" is not null and "examBoardKind" = 'upload';`
- An `exam_board` event not yet pushed is dropped by the old engine (it has no
  case for that kind, and marks it handled); the class's mark stays set, so the
  class is not told later either.
- Older app builds read the device answer and the feed as plain JSON and never
  look at `examBoard` or `siteTwins`; an uploaded board reaches them as ordinary
  exams. The new app gets 404 from both exam-board routes and says "זה עוד לא
  זמין, כדאי לנסות שוב בעוד כמה ימים."

**Clearing a class's board by hand.** There is no route for it, in the app or
for the owner: the app's "להסיר את הלוח" is the only removal, and only the phone
that brought the board may use it. Use this when a board was saved to a class by
someone who is not in it. Registration is open, so anyone can follow a class and
bring the first board to a class that has none, and the lock then protects that
board like any other: an accepted, stated risk (design doc, "סיכון שהתקבל").
Meanwhile the class's students can keep a board of their own ("רק אצלי"). The
update clears what the app's own removal clears (`PUT /v2/device`
`{examCalendar: null}` in `server/src/routes/devices.ts`):

```sql
select c.id, c.name, c."examBoardKind", c."examCalendarId", c."examCalendarSetBy", c."examBoardSetAt"
  from school_class c join school s on s.id = c."schoolId"
 where s."shahafUrl" = 'https://<school>.shahaf.site' and c.name = '<class name>';   -- find the class
update school_class
   set "examCalendarId" = null, "examCalendarSetBy" = null, "examBoardKind" = null, "examBoardSetAt" = null,
       exams = null, "examsPolledAt" = null, "examsOkAt" = null, "examsError" = null
 where id = '<class id>';
```

Leave `examBoardAnnouncedAt` as it is, as the app's removal does: it is the mark
of the class's last push, and with it a board brought again within 30 days tells
no one (`ANNOUNCE_EVERY_DAYS`). The phones find the class with no board at their
next refresh.

**Handy queries**

```sql
select name, "examBoardKind", "examCalendarId" is not null as calendar, "examBoardSetAt", "examBoardAnnouncedAt",
       jsonb_array_length(exams) as exams, "examsError"
  from school_class where "examBoardKind" is not null or "examCalendarId" is not null;      -- the boards, by kind
select kind, change, "createdAt", "notifiedAt" from class_change_event
  where kind = 'exam_board' order by id desc limit 20;                                      -- the "board added" pushes
select count(*) from device
  where "boardPreviewCount" >= 10 and "boardPreviewWindowAt" > now() - interval '1 hour';   -- devices at the limit now
update school_class set "examCalendarSetBy" = null where id = '<class id>';                 -- hand a board to the class: with no setter, any follower may replace or remove it
```

### Useful commands

```bash
docker compose logs -f api                                    # follow
docker compose exec db psql -U sederyom -d sederyom           # poke the DB
curl https://<domain>/health
curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/cron/tick?wait=1"   # run a tick now
```

Handy queries:

```sql
select name, "polledAt", "lastOkAt", "lastError", "examsError" from school_class;   -- health
select count(*), "classId" from device group by "classId";                          -- who follows what (null: friends only)
select kind, ciphertext = '' as mark, count(*), min("createdAt"), min("updatedAt")
  from buddy_box group by kind, mark;                                               -- friends' boxes; a live invite or reply over 7 days (mark = false), or any row not updated for 120, means the cleanup is not running
select type, title, "sentAt" from device_notification order by "sentAt" desc limit 20;
select kind, change, "createdAt" from class_change_event
  where "notifiedAt" is null order by id;                                           -- stuck deltas
```

### Timezone

Everything is Asia/Jerusalem, explicitly: the cron expressions, the date maths,
"tomorrow" for the schedule-change push, and the `TZ` on all three containers.
Nothing reads the host clock's zone.

---

## 6. Rebuilding from scratch

1. New VM per §1.1, ports per §1.2, DNS per §1.2b.
2. `git clone`, restore `infra/.env` from your offline copy (or generate a new
   `CRON_SECRET` and give it to the pinger).
3. `docker compose up -d --build`.
4. Restore the newest dump per §1.5. It brings back the devices and the classes
   they follow; without it, every phone registers again by itself. All class
   data re-polls itself.
5. Re-point the uptime monitor.

---

## 7. The September 2026 checkpoint (a record)

The whole system was built against an empty summer site. In the first week of
school, in this order:

1. Re-run Spike 2 against live data; fix the parsers where the real markup
   differs from `server/fixtures/shahaf/`. Save the new fixtures.
2. Confirm the class views still need no login. If they do, wire the WebView
   capture into `createShahafFetcher`'s `cookieHeader`.
3. Hand-verify Today / Week / widget against the physical reality of a school
   day, side by side with the site and Mashov, findings numbered.
4. Confirm one real schedule change produces exactly one push, and that it
   reaches the home-screen widget without opening the app.

Only after this pass is v1 shipped. Every place that needs re-checking is marked
`TODO(verify-live)` in the source.
