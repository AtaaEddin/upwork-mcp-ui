# 05 — Frontend shell: Upwork design system, layout, login, re-auth banner

status: done
parent: `main.md`
started: 2026-10-11 (parallel with plan 03 — no shared files except root `package-lock.json`)
done: 2026-10-11

## Scope
- Tailwind 4 `@theme` tokens per AGENTS.md (upwork.com sampled values), light default +
  class-based dark theme with toggle (persisted), font stack (Neue Montreal fallback)
- Layout: sticky top nav (upwork wordmark left; nav: Dashboard, Jobs, Proposals,
  Invitations, Messages, Contracts, Profile, Tools console; right: status pill + dark-mode
  toggle + account menu), mobile hamburger nav
- Login page (Upwork-style: white card, green primary button) → `/api/login`
- **Re-auth banner**: sticky top banner (up-red background) shown when
  `/api/upwork/status` = `needs_reauth` or `disconnected`: message + "Reconnect to Upwork"
  button (starts OAuth) + "Dismiss until next check"; polling 30 s + on visibility change
- Status pill in nav: Connected (green dot) / Needs re-auth (red) / Disconnected (gray)
- Routing (react-router), loading/empty/error states per section, accessible focus states

## Decisions (web-searched 2026-10-11)

- **Router: `react-router` 7.18.4, SPA "library mode"** (`BrowserRouter` + `Routes/Route`;
  not framework mode — the SPA is served as static files by the Hono middleware from plan
  02, and the server owns routing for `/api`). v8 exists but the project pins stable
  toolchains (cf. TS 5.9 over the TS 7 line); v7 is the maintained line and its peer deps
  fit (`react >= 19.2.7`; we have 19.3).
  Sources: https://www.npmjs.com/package/react-router (registry, 2026-10-11),
  https://reactrouter.com/upgrading/v7 (v8 baseline changes).
- **Dark mode: class-based Tailwind 4 variant** `@custom-variant dark (&:where(.dark, .dark *));`
  — the documented v4 approach (scaffold from plan 01 already had it; verified against
  https://tailwindcss.com/docs/dark-mode). FOUC avoided with a tiny inline script in
  `index.html` that applies `.dark` before first paint from `localStorage`/`prefers-color-scheme`.
- **Auth screen = login + first-run setup branch.** Plan 02 already ships `GET/POST
  /api/setup` (one-time) and `POST /api/login`. This plan's "login page" renders one auth
  screen that branches on `GET /api/setup` → `{ required: true }`: fresh instances without
  the `OWNER_PASSWORD` env var must be usable from the browser. Same route, same card, no
  new endpoints.
- **Re-auth reconnect = top-level form POST to `/api/upwork/connect`** (plan 03 endpoint).
  An SPA `fetch()` would follow the 302 cross-origin to Upwork's authorize URL and fail
  (CORS); a native form submit navigates the top-level window, which is what OAuth
  requires. ⚠ Contract note for plan 03: the connect endpoint should answer with a **3xx
  redirect** to the authorize URL (or, if it returns JSON `{ url }`, this button must
  change to `location.assign` — one line).
- **Status `unknown` state.** Before plan 03 lands (and whenever the API is unreachable)
  `GET /api/upwork/status` 404s/500s. The hook exposes `state: 'unknown'` in that case;
  the banner shows **only** on explicit `needs_reauth`/`disconnected` (no false re-auth
  prompts while 03 and 05 are in flight), the pill shows a gray "unknown" dot.
- **Tests: vitest 5.0.3 (same major as server) + jsdom 30.1.2 + `@testing-library/react`
  16.3.3 + `@testing-library/dom` 10.4.2 + `@testing-library/jest-dom` 7.0.1.** RTL ≥ 16
  requires `@testing-library/dom` as a separate install.
  Sources: https://testing-library.com/docs/react-testing-library/setup/ ,
  https://registry.npmjs.org/@testing-library/react (registry, 2026-10-11).
- **`?theme=light|dark` URL override** (checked before localStorage, then before
  `prefers-color-scheme`; same order in the pre-paint script and `useTheme`, which must
  stay in sync). Lets a user force a theme per URL and lets the browser-verification
  script screenshot both themes deterministically. Toggle writes persist the explicit
  choice.
- **Browser verification: `puppeteer-core` 25.13.0 (web devDependency) driving the
  system Chromium** — `puppeteer-core` (unlike `puppeteer`) downloads no browser binary,
  keeping the image/repo small (self-host constraint). `web/scripts/browser-verify.mjs`
  logs in through the real form against a running production server and screenshots
  login/dashboard/404 at 375px + 1440px, light + dark; `BANNER_SHOTS=1` mode points at a
  fake API for the re-auth banner. Reusable for plans 06/07. Dev-time only — not shipped.
  Sources: https://pptr.dev/ (puppeteer vs puppeteer-core),
  https://www.npmjs.com/package/puppeteer-core (registry, 2026-10-11).
- **Unknown-status pill = gray dot + `…` short label** with the full wording
  ("Upwork status unknown") in `aria-label`/`title`. Visible text stays minimal in the
  nav; screen readers still get the state.

## Out of scope (recorded, not expanded)
- Data binding for Dashboard/Jobs/feature pages → plans 06/07 (placeholders + empty states
  only).
- The re-auth banner's live end-to-end behavior (against the real OAuth flow) is verified
  with plan 03 once it lands; here it is verified against the plan-03 API contract in
  unit tests.
- Tools console UI → plan 04 (nav link + placeholder page only).

## Acceptance
- Browser-verified: mobile (375px) + desktop, light + dark, for login, banner, nav, layout
- Unit tests for status-poll hook + banner visibility logic (vitest + testing-library)
- DoD: build 0 warnings, tests green, lint clean

## Result (filled at close)
- **Shell delivered** (`web/` workspace): design tokens in `index.css` `@theme` (exact
  AGENTS.md values), pre-paint theme script in `index.html`, `useTheme` (toggle +
  persistence + `?theme=` override), `Layout` (skip link, sticky `TopNav` with 8 nav
  items, status pill, theme toggle, account menu, mobile hamburger panel, footer),
  `RequireAuth` guard, `LoginPage` (login + first-run setup branch, client-side
  validation, friendly 401/429 errors with `retry-after`), placeholder sections for all
  future pages + 404 page, `AuthProvider`/`useUpworkStatus` (30 s poll + visibility
  change, `unknown` state, `checkCount` for banner dismiss), `ReAuthBanner` (form POST
  to `/api/upwork/connect` per the contract note above) + `StatusPill`.
- **Tests**: 51 web tests / 7 files green (pure logic `lib/upwork`, hooks
  `useUpworkStatus` + `useTheme`, `ReAuthBanner`, `StatusPill`, `LoginPage` incl.
  setup/401/429/404 paths, `App` routing + guard + logout). Server suite unaffected
  (42 tests). Typecheck + lint clean; `vite build` 0 warnings (282 KB JS → 88.6 KB gzip,
  21 KB CSS).
- **Browser-verified on system Chromium 153 (headless) against a real production
  instance** (plan-02 server built in a clean worktree at HEAD, serving the built SPA on
  :8790; temporary `DATA_DIR`, owner password via env): 40/40 programmatic checks passed —
  computed design tokens (light bg `#f7faf7`, text `#181818`, primary button `#14a800`
  with white text, border `#e4ebe4`; dark bg `#181818`, `.dark` applied pre-paint),
  real login (scrypt verify + `session` cookie) → dashboard, no false re-auth banner on
  absent status endpoint (pill aria-label "Upwork status unknown"), no horizontal
  overflow at 375px, hamburger + mobile panel (8 links + account row) with
  `aria-expanded`, theme toggle persistence, 404 page. Re-auth banner verified against a
  throwaway fake API reporting `needs_reauth`: `role=alert` with explanatory copy, red
  `#c70e05` accent, working dismiss, reconnect button inside a form whose `action` is
  `/api/upwork/connect`. 12 screenshots captured to `/tmp/uwu-shots/` (not committed —
  regenerate with the script).
- **Server `npm run build` in the main tree was blocked during this window by plan 03's
  in-flight WIP** (untracked `server/src/upwork/`); the server build at HEAD is verified
  clean in the isolated worktree above. No plan-05 code touches the server.
- **Coexistence with plan 03**: only the root `package-lock.json` is shared; the commit
  for this plan contains web-only lockfile hunks (plan 03's `@modelcontextprotocol/client`
  entries stay uncommitted with that plan's own changes).
- **Notes for plan 03**: the `/api/upwork/status` contract (see Decisions) is consumed
  defensively — 404/500/unknown shapes render as `unknown`, never as a false banner;
  `expiresAt`/`accountSummary` are parsed but only displayed once plan 04/06 surfaces
  them. The banner's Reconnect button is a top-level form POST — endpoint must 3xx-redirect.
