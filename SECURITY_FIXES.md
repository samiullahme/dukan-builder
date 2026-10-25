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

No finding is reported as fixed until its checks pass. Later phase results and the ordered ops checklist will be added below.
