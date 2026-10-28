# Project rules

Permanent rules for the IT Service and Maintenance Management System. They
apply to every change, every conversation, and every generated file.

## Frozen surfaces

- The login page is frozen: `login.html`, `css/login.css`, `js/login.js`, and
  the login images. Do not edit their markup, styles, assets, copy, or
  behavior. Prove the freeze with `git diff` and a render comparison.
- The colour theme is frozen. Token values live in `docs/THEME_SNAPSHOT.md`
  and come from `css/app.css`, `css/green.css`, and `css/kit.css`. Do not
  change those values. New styles go in `css/console.css`, use the existing
  tokens plus white and black alpha overlays, and add no new brand colours.
- Do not change the business workflow, the eight status labels, routes, data
  model, API contract, or security rules for presentation work.

## Status labels

Use exactly these eight labels, with no alternatives:
Submitted, Needs Information, Assigned, In Progress, On Hold, Resolved,
Closed, Cancelled.

## Roles and permission enforcement

- One permission map: `permissions.json`, mirrored in `js/permissions.js` and
  the backend. Navigation, actions, columns, filters, reports, and widgets are
  driven by it.
- Every role sees only its own features. Hide what a role cannot use instead
  of showing a disabled control, and state who must act next in plain text.
- The backend must keep rejecting actions outside the role even when called
  directly. UI hiding is an additional layer, never the only one.
- Office users never see internal notes, internal cost details, or other
  offices.

## Security and data

- Google sign-in is restricted to `@upcebu.edu.ph` on the trusted layer.
  Unprovisioned accounts see "Access not granted".
- Demo accounts exist only behind an explicit demo flag, never in production.
- No secrets or credentials in client code. Do not add a second database.
  Browser storage is a demo transport, not the production database.
- Audit history is append-only and cannot be edited or deleted by clients.
- Attachments are validated on the trusted layer: jpg, png, webp, pdf, docx,
  xlsx, csv, txt; at most 10 MB per file and 10 files per upload.

## Writing and honesty

- Do not use em dashes in UI copy, comments, documentation, or commit
  messages.
- Run the build, lint, and tests after every phase. Never claim a check you
  did not run. List limitations honestly.
- Work in phases, update `docs/IMPLEMENTATION_CHECKLIST.md`, and commit after
  each phase.
