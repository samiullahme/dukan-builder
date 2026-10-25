# Dukan Builder — Handoff for Qoder

> Read this first. Architecture, integration details, current state and guardrails.

## What this is (v0.3.0)

**Dukan Builder** is a multi-tenant AI website builder for small/local businesses.
An owner submits a brief (name, phone, address, hours, services, category) and can
optionally upload a **design reference image**. The system produces a complete
8-page static site — home, about, services, gallery, contact, login, customer
dashboard, owner dashboard — which the owner previews, refines via chat, publishes
to `https://<slug>.dukanbot.website`, or downloads as a zip.

- The AI customizes **index.html + styles.css + site.json** (the public look).
- The other 7 pages and all JS are **locked template files**, restored after every
  agent turn. Dashboards are one working design reused across sites (owner-approved).
- The dashboards are a **localStorage demo backend**, not a server database. They
  capture bookings, enquiries and newsletter signups submitted in that browser.

## Infrastructure

- VPS: ec2-32-236-141-229.ap-southeast-2.compute.amazonaws.com (Ubuntu)
- SSH: `ssh -i ~/.ssh/builder-vps.pem ubuntu@[host]`
- App dir: `/opt/builder` (Next.js 16 + TypeScript, systemd `builder-app`)
- Database: `/opt/builder/data/builder.db` (SQLite)
- Uploads: `/opt/builder/data/uploads/` (private, mode 0640)
- Tenant workspaces: `/opt/tenants/<user-id>/<slug>/`
- Published sites: `/opt/www/published/<slug>/`
- Builder URL: https://builder.dukanbot.website (bottom-left badge shows the version)
- Preview URL: https://preview.dukanbot.website (deliberately UNPROTECTED — owner decision)
- Client sites: https://<slug>.dukanbot.website (wildcard, on-demand TLS)

## How a build works

1. `POST /api/sites` (multipart): brief fields + optional `design` image
   (PNG/JPEG/WebP ≤ 8 MB). Image is sniffed, saved privately, and copied into the
   workspace as `design/reference.*`.
2. The in-process worker (`worker/build-worker.ts`, polls every 8 s, one build at a
   time) copies `template/` into the tenant workspace.
3. **Vision:** `lib/vision.ts` runs
   `opencode run --standalone -m opencode/glm-5.3-flash-free --format json --file <image>`
   and parses a design plan (style, layout, sections, colours, typography,
   image/video search queries). Saved to `briefs.design_plan` and `design/plan.json`.
   Vision failure is non-fatal; the build continues with category direction.
4. **Media:** `lib/media.ts` searches Pixabay (images + optional video) using the
   plan's queries plus category queries, then pins exact URLs into `site.json`
   (`hero_image`, `about_image`, `gallery[]`, `hero_video`, `media_credits`).
   Falls back to curated Unsplash IDs if the key is missing or results are thin.
   `media` JSON is stored on the brief and reused by refinements.
5. **Agent:** `opencode serve` (Basic auth, random password) gets a prompt with the
   design plan, media and brief. It may edit only `site.json`, `index.html`,
   `styles.css`; `AGENTS.md` enforces this.
6. **Post-build:** locked files are restored, media fields re-pinned, slug/name
   sanity-checked, palettes applied from the design plan.
7. **QA gate:** `qa/qa-check.cjs` + `qa/browser-check.cjs` check every page at
   390/768/1440, broken images, JS errors, overflow, contrast, tap targets, slots,
   booking/enquiry forms, customer + owner dashboards, CSV export, auth guards.
   Lazy images are force-loaded before the broken-image check; a URL that is
   reachable but did not load in Chromium is a warning, not a failure.
   One repair turn is allowed, then QA runs again. Any error → build fails.
8. Status → `ready`. Preview, refine, publish or download.

Normal wall time is **8–15 minutes** (agent 4–6, QA ~1, one repair turn 2–5).
A build still "building" after ~20 minutes is a bug, not normal slowness.

**Never restart `builder-app` while a build is queued/building** — the worker is
in-process and the restart kills it. On startup the worker fails any leftover
`building` row ("interrupted by a server restart") and resets its site to draft,
so it cannot show "building" forever.

## OpenCode integration — CRITICAL

Version: v2.0.30. Binary: `/home/builder/.opencode/bin/opencode`.
V1 backup `/home/builder/.opencode/bin/opencode-v1.19.0.bak` — do not delete.

- `opencode serve` requires Basic auth (`opencode` + `OPENCODE_SERVER_PASSWORD`).
- Prompt endpoint: `POST /api/session/{id}/prompt` with `{text}`.
- Idle detection reads `session_v2` / `session_message` (ordered by `seq`) from
  `/home/builder/.local/share/opencode/opencode.db`; v1 tables are a fallback.
- Models: build `opencode/deepseek-v4.1-flash-free` (`lib/agent.ts`),
  vision `opencode/glm-5.3-flash-free` (`lib/vision.ts`).
- **Pipe gotcha:** `opencode run` hangs forever when stdout/stderr are pipes
  (including `child_process.execFile`). `lib/vision.ts` therefore spawns it with
  stdout/stderr redirected to temp files. Keep it that way.

## Preview (fixed 2026-10-18)

Caddy root is `/opt/preview-current`, a root-owned symlink →
`/opt/preview/current`, a builder-owned symlink → the active workspace.
The API updates the inner link; Caddy cannot traverse builder-private
`/opt/builder`, so never move the inner link back under it.
`POST /api/sites/<id>/preview` retargets it.

## Key files

- `lib/agent.ts` — OpenCode v2 serve lifecycle, prompt, abort, idle polling.
- `lib/vision.ts` — vision design plan (and the pipe workaround).
- `lib/media.ts` — Pixabay search + fallback, media shape.
- `lib/prompts.ts` — build/refine prompts; embeds the design plan.
- `lib/categories.ts` — category defaults, palettes, fallback media.
- `lib/provision.ts` — workspace seeding (site.json, design reference copy).
- `worker/build-worker.ts` — queue, media injection, locked-file restore, QA/repair.
- `template/` — 8 pages, locked JS store/dashboards, `AGENTS.md` design rules.
- `qa/qa-check.cjs`, `qa/browser-check.cjs` — static + browser QA.
- `lib/db.ts` — schema (`sites.category`, briefs design/media columns).
- `app/api/sites/[id]/design/route.ts` — authenticated design image.
- `app/api/sites/[id]/preview/route.ts` — preview symlink.

## Known limitations / next

1. Dashboards are demo localStorage, one fixed working design; connecting real
   server-side data is a separate project.
2. Secondary public pages (about/services/gallery/contact) use the fixed template
   layout and inherit the site's tokens/media; only index.html is fully custom.
3. The free build model occasionally ships mobile overflow; the QA repair turn
   fixes it, but it costs a turn.
4. Vision is best-effort: if the model fails twice the build continues without a
   plan (category direction only).
5. Quota: 5 beta builds per user. Refund test-consumed quota after testing.

## Guardrails (non-negotiable)

- NEVER read/copy/reproduce `auth.json`, `.pem`, `.env` or API keys.
- NEVER use Kimi/Moonshot models.
- ASK the owner before architectural changes.
- VERIFY LIVE before claiming something works.
- Preview stays unprotected.
- Caddy has `admin off` — `systemctl restart caddy`, never reload.
- Keep the v1 OpenCode binary backup.

## Run / test

  sudo -u builder bash -lc 'cd /opt/builder && npm run build'
  sudo systemctl restart builder-app
  sudo -u builder /home/builder/.opencode/bin/opencode --version   # v2.0.30
  # QA (needs Chromium available to the builder user):
  sudo -u builder node /opt/builder/qa/qa-check.cjs /opt/tenants/<uid>/<slug> --out /tmp/qa-run
