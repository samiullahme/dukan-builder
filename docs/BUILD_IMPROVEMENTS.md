# Dukan Builder — Suggested Improvements to the Build Pipeline

Based on reading `worker/build-worker.ts`, `lib/agent.ts`, `lib/prompts.ts`, `lib/media.ts`, `lib/vision.ts`, `lib/chrome.ts` and the API routes. Ordered by value for effort. Nothing here has been implemented.

## A. Quality of the result

1. **Split the single agent turn into 2–3 focused passes.** Today one prompt asks for copywriting, a full homepage, and a whole CSS design system at once. A free model does all three poorly. Suggested: (1) content pass → `site.json` only, (2) layout pass → `index.html`, (3) style pass → `styles.css`. Each gets a short prompt and a smaller context. Cost: more turns, but each is faster and easier to validate.
2. **Add a visual check, not only rule checks.** QA already runs Chromium at 3 widths. Take the screenshots and send them to the vision model together with the reference image ("does this match? list the 3 biggest differences"), and feed that into the repair turn. Right now QA can pass a site that is technically valid but ugly or off-reference.
3. **Let the owner supply real photos.** Pixabay stock for "a tea house" rarely looks like their tea house. Add optional logo + 3–6 photo uploads that take priority over stock media (same sanitising/size checks as the design image).
4. **Secondary pages are the fixed template.** About/services/gallery/contact only inherit tokens and the header/footer. Consider letting the agent write a small, validated "page theme" block so those pages feel as custom as the homepage.
5. **More than one repair turn, smarter repair.** Only the first 12 QA errors are sent and only one repair is allowed. Allow 2 rounds, group errors by file, and stop early if the error count doesn't drop.
6. **Treat QA warnings as a score.** Warnings are ignored today. Track the count per build and flag regressions in the admin build page.

## B. Reliability and fairness

7. **Refund quota when a build fails for infra reasons.** Quota is consumed at the start of a `build` and never refunded, so a provider outage or a server restart costs the user one of their 5 builds. Refund when `failure_reason` is `infra_error`, `interrupted`, `agent_timeout` or `agent_error`.
8. **Reset the workspace before a fallback model runs.** When model 1 times out halfway, model 2 receives the same prompt on top of half-edited files. Restore the three editable files from the pre-turn snapshot first.
9. **Don't fall back on time alone.** A 30-minute timeout per model means 4 models could in theory run 2 hours. Cap total agent time per build (e.g. 20 min) and cap each fallback attempt lower than the first.
10. **Move the worker out of the web process.** The worker lives inside Next.js, so every deploy/restart kills the running build, and the docs say "never restart while building". Run it as its own systemd service. Replace polling with `SELECT … FOR UPDATE SKIP LOCKED` so more than one worker can run later.
11. **Don't depend on OpenCode's private SQLite file.** `waitForIdle` reads `/home/builder/.local/share/opencode/opencode.db` with hard-coded table names. An OpenCode upgrade can silently break completion detection. Prefer the server's event stream (`GET /api/event`, `session.idle`) with the DB as a fallback, and add a startup self-test that runs one trivial prompt.
12. **Heartbeat for stuck builds.** Only a restart recovers orphans. Write a `heartbeat_at` column every 30 s and let a timer fail builds whose heartbeat is stale.
13. **Make refinements remember context.** Each chat edit starts a fresh session, so "make it a bit darker than before" has no "before". Include the last N chat messages + a short diff summary in the refine prompt (the ops README still says sessions are reused — update it either way).

## C. Speed

14. **Parallelise stage 3.** Vision analysis and media downloads are sequential; media downloads (hero, about, each gallery image) are also sequential. Download in parallel (`Promise.all` with a small limit). Saves roughly 20–60 s.
15. **Cache vision plans by image hash** so a re-upload of the same reference costs nothing.
16. **Skip the full browser QA on tiny refinements** (e.g. text-only changes): run the static checks and only the affected viewport, or run it in the background after marking `ready`.
17. **Stream progress to the user.** The worker already writes stage markers (`[stage:agent]`, `[stage:qa]`…). Show them live with an estimated remaining time instead of a spinner.

## D. Safety and maintainability

18. **Validate the AI's HTML/CSS, not just file locks.** Locked files are restored, but `index.html` is free-form and can still contain `<script src=…>`, inline JS, iframes, or external form actions. Add a QA/static check that rejects external scripts, `javascript:` URLs, iframes and off-site form targets.
19. **Tests for the worker.** There are unit tests for env/config/publish but none for `processBuild`, `restoreLocked`, `syncChrome` or `mergeMedia`. These are pure-ish functions and the highest-risk code; add table-driven tests (e.g. AI deletes a locked file; AI invents `evil.js`; header markers missing).
20. **Split `build-worker.ts` (700 lines).** Suggested modules: `queue.ts` (claim/poll), `prepare.ts` (design + media), `agent-turn.ts`, `postprocess.ts` (restore/sync/merge), `qa.ts`, `finish.ts`. `processBuild` is one 230-line function today.
21. **Config in one place.** Hard-coded paths (`/opt/qa`, `/opt/builder/qa/qa-check.cjs`, `/opt/builder/template`, `/home/builder/...`) are scattered over six files. Centralise in one validated config module that fails fast at startup.
22. **Update stale docs.** `README-OPS.md` still says the workspace config allows `bash` and that refinements reuse one session; both are no longer true after the security fixes and the per-turn restart.
23. **Cost/quality telemetry.** Record per build: model used, number of fallbacks, turn durations, QA errors before/after repair, token usage if available. Then you can see which free model actually produces passing sites and reorder the chain by evidence rather than guess.

## Suggested order of work

| Priority | Items | Why |
|---|---|---|
| Do first (small, high impact) | 7, 8, 9, 14, 22 | Fairness to users, fewer weird failures, quick wins |
| Next | 1, 2, 5, 18, 19 | Biggest jump in output quality and safety |
| Then | 10, 11, 12, 13 | Operational robustness |
| Later | 3, 4, 15, 16, 17, 20, 21, 23 | Product depth and cleanup |
