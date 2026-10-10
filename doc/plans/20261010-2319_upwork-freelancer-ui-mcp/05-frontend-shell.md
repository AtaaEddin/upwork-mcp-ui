# 05 — Frontend shell: Upwork design system, layout, login, re-auth banner

status: proposed
parent: `main.md`

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

## Acceptance
- Browser-verified: mobile (375px) + desktop, light + dark, for login, banner, nav, layout
- Unit tests for status-poll hook + banner visibility logic (vitest + testing-library)
- DoD: build 0 warnings, tests green, lint clean
