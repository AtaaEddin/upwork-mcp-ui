# 07 — Proposals, invitations/offers, messages, contracts, earnings, profile

status: proposed
parent: `main.md` (depends on 04 tool discovery log)

## Scope (one section per session slice if needed — split into 07a/07b if it grows)
- Proposals: list (status filter), detail, **draft → review → confirm-submit** two-step UI
  (MCP draft-confirm; Connects cost shown before confirm; binding notice where applicable)
- Invitations & offers: inbox list, detail, accept / decline / ask-changes actions
  (binding acceptance → notice + link to finish on upwork.com)
- Messages: inbox (threads, unread badges), thread view, composer (send), attachments
  upload/download (streaming proxy, size caps)
- Contracts: active/past list, detail, milestone work view, work diary
- Earnings: balance + earnings summary; Profile: availability, employment, languages,
  education, portfolio (read + updates the MCP supports)
- Every write action: confirm modal showing exactly what will happen + Connects/cost where
  known; results toast with error surface

## Acceptance
- HTTP/service tests incl. draft-confirm guard (submit requires draft id), attachment caps,
  401 → re-auth banner trigger
- Browser-verified mobile+desktop, light+dark, per section
- DoD: build 0 warnings, tests green, lint clean
