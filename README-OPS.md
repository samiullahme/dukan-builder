# Dukan Builder — Operations Guide

Beta platform: AI website builder for non-technical shops.
Next.js 16 + better-sqlite3 + Tailwind. Monolith, no Docker/Redis/ORM.

## Services & ports

| Service | What | Port / path |
|---|---|---|
| `builder-app.service` | Next.js app (systemd, user `builder`) | `127.0.0.1:3010` |
| Build worker | inside the Next.js process (`instrumentation.ts` → `worker/build-worker.ts`), polls every 8s, one build at a time | — |
| Preview | Caddy serves `/opt/preview-current` → `/opt/preview/current` → active tenant workspace (no Python server) | — |
| `opencode serve` | spawned per build by the worker, random localhost port, password-protected | `127.0.0.1:<random>` |
| Caddy | reverse proxy + static file server + TLS | `80` / `443` |
| `wuzapi-wuzapi-1` (Docker) | WhatsApp gateway — **do not touch** | `8080` |

## Domains (Caddy)

| Domain | Serves |
|---|---|
| `builder.dukanbot.website` | the platform app (`127.0.0.1:3010`) |
| `preview.dukanbot.website` | the active workspace via `/opt/preview-current` (deliberately unprotected) |
| `<slug>.dukanbot.website` | published sites from `/opt/www/published/<slug>` (wildcard DNS + on-demand TLS) |

DNS: wildcard `*.dukanbot.website` and `builder` need A records → `32.236.141.229`.
The preview link chain is updated by `POST /api/sites/<id>/preview`; the inner link
must stay in `/opt/preview` because Caddy cannot traverse `/opt/builder`.

## Files

- App: `/opt/builder` (git-less working copy; source of truth is the local dev copy)
- Env/secrets: `/opt/builder/.env` (mode 600, `builder:builder`) — `DB_PATH`, `TENANTS_ROOT`, `PUBLISHED_ROOT`, `OPENCODE_BIN`, `PIXABAY_API_KEY`; `.env.opencode` has `OPENCODE_API_KEY`
- SQLite: `/opt/builder/data/builder.db`
- Tenant workspaces: `/opt/tenants/<userId>/<slug>/`
- Published sites: `/opt/www/published/<slug>/`
- Backups: `/opt/builder/backups/dukan-YYYYMMDD.tar.gz` (cron daily 03:00, keep 7 days)
- Caddyfile: `/etc/caddy/Caddyfile`

## AI build engine

- The worker spawns `opencode serve --port 0 --hostname 127.0.0.1` with cwd = tenant workspace, `OPENCODE_SERVER_PASSWORD` set to a random per-build secret.
- Models are fixed in code: build `opencode/deepseek-v4.1-flash-free` (`lib/agent.ts`), vision `opencode/glm-5.3-flash-free` (`lib/vision.ts`). Never use Kimi/Moonshot.
- Builds optionally start with a vision pass over an uploaded design reference. `opencode run` must write stdout/stderr to files, not pipes — piped stdio makes the CLI hang forever.
- Media (hero/about/gallery/video) is fetched from Pixabay before the agent runs and pinned in `site.json`. `PIXABAY_API_KEY` lives in `/opt/builder/.env`; without it the builder falls back to curated Unsplash URLs.
- Provider key: `OPENCODE_API_KEY` in `/opt/builder/.env.opencode` (loaded by systemd). Restart the app after changing it.
- Permissions: each workspace gets `opencode.json` allowing read/edit/glob/grep/list/bash and denying `external_directory`. The worker also auto-denies `external_directory` permission requests seen on the event stream; locked template files are restored after every turn.
- Quota: 5 builds per user (beta), tracked in `quota` table. Chat refinements are free and reuse the same agent session.
- Build timeout: 30 min of agent work → marked `failed`, never hangs. QA gets 5 min and one repair turn.

## Backups & restore

Backup runs nightly at 03:00 via builder's crontab (`/opt/builder/scripts/backup.sh`).
Restore:
```bash
cd /tmp && tar -xzf /opt/builder/backups/dukan-YYYYMMDD.tar.gz
systemctl stop builder-app
cp /tmp/builder.db /opt/builder/data/builder.db
cp -r /tmp/tenants/* /opt/tenants/
cp -r /tmp/www/published/* /opt/www/published/
chown -R builder:builder /opt/builder/data /opt/tenants /opt/www/published
systemctl start builder-app
```

## Troubleshooting

- App down: `systemctl status builder-app` → `journalctl -u builder-app -n 50`
- Build stuck in `building`: with v0.3.1, `systemctl restart builder-app` is enough — on startup the
  worker fails any leftover `building` row ("interrupted by a server restart") and resets the site to
  draft, so retry from the UI. Never restart while a build is queued/building: the worker is in-process,
  so the restart is what kills it. Check first:
  `sqlite3 /opt/builder/data/builder.db "SELECT id, status FROM builds WHERE status IN ('queued','building');"`
- Stray agent processes: `pgrep -fa "opencode (serve|run)"` → `kill`.
- Preview shows the wrong site: check `ls -l /opt/preview-current /opt/preview/current`; the inner link is retargeted by the preview API.
- Caddy has `admin off`: validate with `caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then `systemctl restart caddy` (never reload).
- Cert issues: `journalctl -u caddy -n 30 | grep -i acme` (usually DNS not yet pointing here).

## Security notes

- UFW: only 22/80/443. fail2ban on. SSH key-only.
- Sessions: random 256-bit tokens, SHA-256 hashed in DB, `httpOnly`, `SameSite=Lax`, 30-day TTL.
- Rate limits: signup/login/site-create/build/chat all token-bucketed in SQLite.
- Never commit `/opt/builder/.env` anywhere. Never log API keys.
