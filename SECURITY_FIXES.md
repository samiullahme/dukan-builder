# Security Fixes

## Phase 0: Baseline

**Branch:** `security-fixes` (created from the clean `main` branch).

| Check | Baseline result |
|---|---|
| `npm ci` | Passed; installed 462 packages. npm reported Node 20.18.0, below the Node 22 engine required by current Supabase packages. |
| `npm audit` | Failed: 1 Critical advisory for Next.js 16.4.0 (three advisories; npm reports a fix at 16.4.3). |
| `npm run lint` | Failed: 150 errors and 19 warnings across the existing codebase. |
| `npx --no-install tsc --noEmit` | Passed. The package has no `typecheck` script. |
| `npm test` | Could not run: the package has no `test` script or configured test framework. |
| `npm run build` | Failed because the isolated environment could not fetch Inter and JetBrains Mono from Google Fonts. |

`npm audit` required registry access; the initial sandboxed attempt could not resolve `registry.npmjs.org`. The successful audit used the approved network-enabled command. The build result is not a code comparison until Google Fonts can be fetched or are available locally.

## Phase 1: Stop the Bleeding

### #1 — OpenCode permissions and process environment

**Verified:** the worker's generated OpenCode config granted `bash`; `agent.ts` and `vision.ts` passed `{ ...process.env }` to OpenCode; and `autoReplyPermission` was unused and would have allowed `bash` if called.

**Changed:** OpenCode config denies `bash` and `external_directory`; the unused permission responder was removed. `buildAgentEnv()` passes only `PATH`, `HOME`, `TMPDIR`, `NODE_ENV`, and provider keys for the selected model chain. `opencode serve` receives its newly generated server password separately.

**Regression checks:** `tests/agent-env.test.ts` checks the environment allowlist, excludes `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SITE_ADMIN_ENC_KEY`, and `PIXABAY_API_KEY`, and checks both permission denials. `npm test` passed (2 tests); `npx --no-install tsc --noEmit` passed. The restricted-environment Node smoke check passed. A full site build cannot run in this environment because it needs the database and OpenCode service context; the documented build is also blocked here by Google Fonts network access.

**Lint comparison for touched files:** baseline was `worker/build-worker.ts` 18 errors/1 warning, `lib/agent.ts` 12/2, `lib/vision.ts` 7/0, and `lib/model-chain.ts` 0/0. After the change these were 17/1, 10/1, 7/0, and 0/0; new files `lib/agent-env.ts`, `lib/opencode-config.ts`, and `tests/agent-env.test.ts` have 0 errors and 0 warnings. No new lint errors were introduced.

**Provider environment:** OpenCode needs `HOME` to find its saved OpenCode credentials for `opencode/...` models. A configured external model gets only its selected provider key (for example, `DEEPSEEK_API_KEY`); custom providers use `CUSTOM_API_KEY` or `FREELLMAPI_KEY` as configured. Run the agent as a separate low-privilege OS user.

### #3 — Workspace symlink exfiltration

**Verified:** `restoreLocked` read and wrote locked paths without checking for symlinks; publishing used recursive copy and `statSync`-based chmod; and downloads zipped the workspace without cleanup or `-y`.

**Changed:** shared `sanitizeWorkspace()` uses `lstatSync` and real paths to remove links and outside entries. It runs from `restoreLocked`, before revert restoration, inside `publishWorkspace` (used by site publish/revert), in admin `republishSite`, and before ZIP creation. Workspace publishing copies fail closed on symlinks/outside paths, and `chmodRecursive()` uses `lstatSync` and skips links. The ZIP command now uses `-y`.

**Regression checks:** `tests/workspace-security.test.ts` creates file and directory symlinks to `/etc/hostname` and `/etc` in temporary workspaces, verifies cleanup, rejects copying links, and verifies chmod does not alter the linked target. `npm test` passed (4 tests total); typecheck passed. The test targets remain intact. Targeted lint counts for `lib/admin-actions.ts` (16 errors), `lib/publish.ts` (1), and the download route (1) match their pre-change baselines; `worker/build-worker.ts` remains at its post-#1 count (17 errors/1 warning). New sanitizer/test files have no lint errors or warnings.

### #7 — Next.js security advisories

**Verified:** `npm audit` reported three Critical Next.js advisories for 16.4.0. The registry reported 16.4.3 as the latest version for both `next` and `eslint-config-next`.

**Changed:** upgraded `next` and `eslint-config-next` to 16.4.3. Vitest was also upgraded to 4.1.12 because the initial test-runner release introduced Critical and Moderate advisories; this is the same test tool, not additional tooling.

**Regression checks:** post-upgrade `npm audit` reported 0 vulnerabilities; `npm test` passed (4 tests); `npx --no-install tsc --noEmit` passed. Full lint reports 147 errors and 18 warnings versus the 150/19 baseline. The decreases are from removing the dead handler/config `any` in #1; no lint errors were added in changed files. Build remains blocked by Google Fonts network access.

### #4 — Public-table RLS

**Verified:** `lib/db.ts` uses `pg.Pool` with `DATABASE_URL`. The role is supplied at runtime and `DATABASE_URL` is unset in this environment, so it could not be verified here. Supabase client usage is server-side auth only; public data queries use the server-side `pg` module, with no client-side Supabase table queries found.

**Prepared, not applied:** `supabase/migrations/003_enable_rls.sql` enables RLS and revokes table grants for all current public tables, then revokes default grants for tables created later by the role running the migration. Its first line says not to apply until the owner verifies the DB role. `supabase/verification/003_verify_rls.sql` checks the connected role's `rolbypassrls`, RLS coverage, current grants, and default grants. No database was contacted and no migration was run.

**Checks:** `npm test` passed (4 tests); typecheck passed; full lint remains at 147 errors/18 warnings (baseline 150/19). The SQL scripts are the required manual verification because applying the migration is intentionally deferred to the owner.

**Manual check:** after the owner verifies the app connection role has `rolbypassrls = true`, apply the migration using the trusted schema-owner role, run the verification SQL, then check the anon REST endpoint:

```sh
curl -i "$SUPABASE_URL/rest/v1/profiles?select=id&limit=1" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY"
```

The endpoint must return no profile rows to the anon key.

## Ops Checklist

- [ ] Run `npm run build` with internet access.
- [ ] Verify the app DB role from `supabase/verification/003_verify_rls.sql`; require `rolbypassrls = true` before applying the guarded migration.
- [ ] Apply `supabase/migrations/003_enable_rls.sql` only after owner verification, then run the verification SQL and anon curl check above.

No finding is reported as fixed until its checks pass. Later phase results and the final ordered ops checklist will be added below.
