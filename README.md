# Dukan Builder

AI website builder for small shops. A shop owner describes their business, the
app's AI agent (powered by the [OpenCode CLI](https://opencode.ai)) builds a
complete multi-page website with working customer and owner dashboards, a
headless-browser QA gate checks every page, and the site publishes to
`<slug>.yourdomain.com` behind Caddy with automatic TLS.

## What's in this repo

| Path | What it is |
|---|---|
| `app/` | Next.js App Router — all pages and API routes (frontend + backend) |
| `worker/` | In-process build worker: AI agent turns, media pipeline, QA gate |
| `lib/` | Shared code: DB (`pg`), Supabase Auth, model chains, publishing, site admin |
| `template/` | The locked site template the agent edits per build |
| `qa/` | Headless-Chromium QA suite run at the end of every build |
| `supabase/migrations/` | Postgres schema (run in the Supabase SQL editor) |
| `scripts/` | Migrations, ops tools, and `host-setup.sh` (one-shot installer) |
| `infra/` | Caddyfile, systemd units, TLS allowlist |

## Architecture

```
Browser ──HTTPS──> Caddy (:80/:443)
                     ├── builder.yourdomain.com ──> Next.js app 127.0.0.1:3010
                     │      (systemd builder-app.service, user "builder")
                     │      └─ in-process worker spawns "opencode serve" per build
                     ├── preview.yourdomain.com ──> /opt/preview-current (static files)
                     └── <slug>.yourdomain.com ──> /opt/www/published/<slug>
Supabase (managed Postgres + Auth)   ←   app data, users, build records
Pixabay API                          ←   stock media for generated sites
```

- The Next.js server is the whole backend: API routes, the build queue (polls
  every 8 s, one build at a time), and publishing.
- The AI agent runs through the **OpenCode CLI** (`opencode serve`, spawned per
  build into the tenant workspace). You must install the CLI and log in once.
- Tenant workspaces live in `/opt/tenants/<userId>/<slug>/`; published sites are
  static files in `/opt/www/published/<slug>/`.
- TLS for every subdomain is issued on demand by Caddy; the `tls-allowlist`
  service decides which hostnames may get a cert (only `<sub>.yourdomain.com`).

## Requirements

- Ubuntu 22.04 / 24.04 VPS, **2 GB RAM minimum**, ~10 GB disk
- A domain you control with DNS: `builder` A record, `preview` A record, and a
  wildcard `*.yourdomain.com` A record — all pointing at the VPS IP
- A free [Supabase](https://supabase.com) project (Postgres + Auth)
- A free [Pixabay API key](https://pixabay.com/api/docs/) for stock media
- An [OpenCode](https://opencode.ai) account (free models are used by default)

## Quick start

```bash
git clone https://github.com/samiullahme/dukan-builder.git
cd dukan-builder
sudo bash scripts/host-setup.sh --domain yourdomain.com
```

The script installs Node 22, Caddy, the OpenCode CLI, build tools, creates the
`builder` user and all directories, copies the app to `/opt/builder`, prompts
you for the secrets, writes `/opt/builder/.env.opencode`, runs `npm ci` and a
production build, and installs the systemd units and Caddyfile. Four steps
remain manual because they involve accounts or DNS:

1. **Supabase schema** — open your Supabase project's SQL editor and paste, in
   order: `supabase/migrations/001_init.sql`, `002_site_admins.sql`,
   `003_site_data.sql`.
2. **OpenCode login** (the AI models):
   ```bash
   sudo -u builder -i opencode auth login   # device-code flow
   sudo -u builder -i opencode models       # sanity check: lists free models
   ```
3. **DNS** — create the three A records listed above.
4. **First admin** — open `https://builder.yourdomain.com`, sign up, then run
   in the Supabase SQL editor:
   ```sql
   update public.profiles set is_admin = 1 where email = 'you@example.com';
   ```
   (`/admin` returns 404 for non-admins by design.)

You're live when the bottom-left badge shows a version and build time and a
test site builds and publishes successfully.

## Manual setup (what the script does, step by step)

### 1. System packages

```bash
sudo apt update && sudo apt install -y ca-certificates curl git build-essential python3 openssl
# Node 22 (NodeSource)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
# Caddy (official repo)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
```

### 2. User and directories

```bash
sudo useradd -m -s /bin/bash builder   # or: id builder || ...
sudo mkdir -p /opt/tenants /opt/www/published /opt/preview
sudo ln -sfn /opt/preview/current /opt/preview-current   # Caddy preview root
```

### 3. OpenCode CLI

```bash
sudo -u builder bash -c 'curl -fsSL https://opencode.ai/install | bash'
sudo -u builder -i opencode auth login
```

### 4. Code

```bash
sudo -u builder bash -c 'git clone https://github.com/samiullahme/dukan-builder.git /opt/builder'
sudo -u builder bash -c 'cd /opt/builder && npm ci'
```

### 5. Environment

Create `/opt/builder/.env.opencode` (mode 600, owner `builder`). Required:

```bash
# Supabase → Project Settings → Database → Connection string (use a pooler)
DATABASE_URL=postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
# Supabase → Project Settings → API
SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public key>
SUPABASE_SERVICE_ROLE_KEY=<service_role secret>
# pixabay.com — free API key for stock media
PIXABAY_API_KEY=<key>
# 32 bytes of hex; encrypts the generated site-owner passwords. Keep it safe —
# if it is lost, stored passwords are unrecoverable (rotation still works).
SITE_ADMIN_ENC_KEY=$(openssl rand -hex 32)
```

Optional overrides (defaults shown are in the code):

| Var | Default | Purpose |
|---|---|---|
| `OPENCODE_BIN` | `/home/builder/.opencode/bin/opencode` | CLI path |
| `OPENCODE_BUILD_MODELS` | `opencode/deepseek-v4.1-flash-free,opencode/nemotron-3.5-lightning-free,opencode/space-bunny-free,opencode/glm-5.3-flash-free` | build model fallback chain |
| `OPENCODE_VISION_MODELS` | `opencode/glm-5.3-flash-free,opencode/nemotron-3.5-super-vl-free,opencode/space-bunny-free,opencode/mimo-v2.6-flash-free` | vision (design-reference) chain |
| `TENANTS_ROOT` | `/opt/tenants` | build workspaces |
| `PUBLISHED_ROOT` | `/opt/www/published` | live sites |
| `TEMPLATE_DIR` | `/opt/builder/template` | locked template |
| `UPLOADS_DIR` | `/opt/builder/data/uploads` | design-reference images |
| `PREVIEW_LINK` | `/opt/preview/current` | Caddy preview symlink target |
| `BUILD_TIMEOUT_MS` | `1800000` | agent work cap per build |
| `REPAIR_TIMEOUT_MS` | `600000` | QA repair-turn cap |
| `QA_CHROMIUM` | Playwright's bundled Chromium | override QA browser binary |

### 6. Build and start

```bash
sudo -u builder bash -c 'cd /opt/builder && set -a && . ./.env.opencode && set +a && npm run build'
sudo cp infra/builder-app.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now builder-app
```

### 7. Caddy + TLS allowlist

```bash
sudo cp infra/tls-allowlist.py /opt/tls-allowlist.py   # set DOMAIN_SUFFIX to your domain
sudo cp infra/tls-allowlist.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now tls-allowlist
sudo sed 's/dukanbot\.website/yourdomain.com/g' infra/Caddyfile | sudo tee /etc/caddy/Caddyfile
sudo systemctl restart caddy   # Caddy runs with admin off: restart, never reload
```

## Model configuration

Models are provider-qualified (`provider/model`). `opencode/...` models use the
CLI's logged-in account and need **no key**. Third-party providers activate
automatically when their standard key env var is set (`OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY`,
`GOOGLE_GENERATIVE_AI_API_KEY`, `GROQ_API_KEY`, `XAI_API_KEY`,
`MISTRAL_API_KEY`). Add such models to the chain env vars, e.g.
`OPENCODE_BUILD_MODELS=opencode/deepseek-v4.1-flash-free,deepseek/deepseek-chat`.
A model whose provider has no key is skipped, never attempted.

## Optional: FreeLLMAPI gateway

For models not natively supported by OpenCode you can run the
[FreeLLMAPI gateway](https://github.com/tashfeenahmed/freellmapi) on the same
box (follow its README, set an admin password), then:

```bash
FREELLMAPI_BASE_URL=http://127.0.0.1:<gateway-port>
FREELLMAPI_KEY=<gateway api key>
```

and add `freellmapi/<model>` entries to `OPENCODE_BUILD_MODELS` /
`OPENCODE_VISION_MODELS`. The builder works without it — OpenCode's own free
models are the default.

## Optional: QA browser

The build QA gate needs Chromium. By default it uses Playwright's bundled
build:

```bash
sudo -u builder bash -c 'cd /opt/builder/qa && npm install && npx playwright install chromium'
```

or set `QA_CHROMIUM=/usr/bin/chromium` to use a system package.

## Upgrading

```bash
sudo -u builder bash -c 'cd /opt/builder && node check-builds.cjs'   # must print [] before restarting
sudo -u builder bash -c 'cd /opt/builder && git pull && npm ci && set -a && . ./.env.opencode && set +a && npm run build'
sudo systemctl restart builder-app
```

Never restart the app (or rebuild) while a site build is queued or running —
`check-builds.cjs` prints `[]` when it is safe. The bottom-left badge on
`builder.yourdomain.com` shows the running version and build time; it only
changes when you rebuild, not on restart.

## Backups

`scripts/backup.sh` tars the DB-adjacent runtime state (workspaces, published
sites, uploads). Run it from cron — on the reference deployment it runs daily
at 03:00 keeping 7 days. Site data (sites, builds, bookings, subscribers)
lives in Supabase; back that up on the Supabase side (project backups or
point-in-time recovery).

## Troubleshooting

- **Badge not updating after deploy** — the timestamp is written at build
  time. You rebuilt but the page shows the old badge? The old server process
  is still running: `sudo systemctl restart builder-app`.
- **"Failed to fetch" on signup/site-create** — usually a stalled Supabase
  pooler connection. Check `DATABASE_URL` uses a pooler host; the app already
  has fail-fast pool timeouts.
- **Site looks nothing like the uploaded design image** — the vision pass
  timed out and the build fell back to the category palette. Rebuild, or tune
  `OPENCODE_VISION_MODELS`.
- **Caddy errors after editing the Caddyfile** — admin API is off; use
  `sudo systemctl restart caddy`, never `caddy reload`.
- **Preview domain has no auth** — `preview.yourdomain.com` is deliberately
  unprotected so the QA browser can inspect builds.
- **Builds sit "queued" forever** — the worker runs inside the Next.js
  process; restart `builder-app` (after `check-builds.cjs` shows `[]`).
