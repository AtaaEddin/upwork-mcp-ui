# 06 — Freelancer dashboard + job search/detail

status: proposed
parent: `main.md` (depends on 04 tool discovery log)

## Scope
- Dashboard: one screen with cards — invitations count, offers, unread messages, matched
  jobs, Connects balance (bound to discovered tool names; graceful degradation when a tool
  is missing or errors)
- Jobs: search form (keywords, category, budget range, type), results list in Upwork list
  style (title, budget/hourly, skills chips, client meta, posted time), pagination;
  detail view (description, requirements, client history, apply panel)
- Apply panel: proposal CTA → hands off to proposal flow (plan 07); favorites toggle
  (if the MCP exposes it — else record gap in main.md)
- Skeleton loading, empty states, error retry; pull-to-refresh on mobile

## Acceptance
- Endpoint/service tests for any server-side mapping; UI component tests
- Browser-verified mobile+desktop, light+dark, with real (authenticated) data where
  available; empty state verified
- DoD: build 0 warnings, tests green, lint clean
