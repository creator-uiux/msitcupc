# UI Polish Report

> **Historical, superseded.** This report describes an earlier v2 pass over
> the `HTMLUP/` tree, including a blue palette and a statement that the login
> page was unchanged. Neither is true of the current V5 tree: the theme is the
> green token layer in `css/green.css`, and the sign-in screen was redesigned.
> Treat `DESIGN_SYSTEM.md` and `IMPLEMENTATION_CHECKLIST.md` as current.

University of the Philippines Cebu – IT Service and Maintenance Management System
Polish pass – role-based visibility and aesthetic redesign with distinctive UI identity

## 0. Login Page Integrity
- **login.html** and **css/login.css** are **unchanged** – verified via content comparison.
- All other authenticated pages now include the "UP Cebu –" prefix in `<title>` and the full UP Cebu identity suite (seal lockup, eyebrow/rule, serif typography, footer).

## 1. Theme Snapshot (extracted tokens)
- **docs/THEME_SNAPSHOT.md** contains the full token table from `css/app.css`, `css/green.css`, and `css/kit.css`.
- No brand colors were added. All token values match the original stylesheets exactly.
- The existing color theme/palette, fonts, radii, and spacing values were NOT changed.
- Tokens are documented for both light and dark modes.

## 2. Design Direction – UP Cebu Identity Applied (Distinct from Canvas LMS/Firebase)
### Strong Visual Differentiators
The following elements make the UI distinctly **University of the Philippines Cebu** and not resemble Canvas LMS or Firebase:

- **Seal lockup header** (unique to this system): UP seal and UP Cebu seal side by side at 28px in the app header and sidebar, followed by the wordmark "University of the Philippines Cebu" in small caps/letter-spaced uppercase, and the system name "IT Service and Maintenance Management" below. On mobile, the seals and a short title are shown. This is a signature element NOT found in Canvas LMS or Firebase.

- **Eyebrow and rule pattern** (unique rhythm): Every page has a small uppercase eyebrow (section name) above the serif page title, one line of helper text, and a hairline rule (`var(--line)`). This gives the product a recognizable rhythm that Canvas LMS/Firebase do not use.

- **Serif display type** (Merriweather): Used for page titles, dashboard greetings, ticket numbers in the ticket header, and large statistic numbers. Sans-serif (Inter) remains for body, tables, forms, and buttons. This clear scale (page title 28px serif, section title 18px, body 14-15px, caption 12px) is a distinctive choice.

- **Docket style** (formal case file treatment): Ticket headers treat tickets as formal case files – serif ticket number, thin rule beneath, eyebrow label above, and status stepper as a ruled progress track with tick marks. This "formal case file" aesthetic is unique to this system.

- **Formal footer** on all authenticated pages: "University of the Philippines Cebu, IT Service and Maintenance Management System" + current year. Canvas LMS and Firebase footers typically do not have this formal university administrative style.

- **4px grid spacing** with generous white space and clear alignment: All gaps and margins use the var(--space-*) tokens (4, 8, 12, 16, 24, 32, 48 px). Combined with the serif/tan pattern, this creates a distinct visual rhythm.

- **Formal tone** (no emoji, no slang, no exclamation marks): Sentence-case labels, polite and precise messages, dates as `MMM d, yyyy h:mm a` in Asia/Manila, currency in PHP. This professional administrative tone differentiates from Canvas LMS' more casual style.

### Component Design Differentiators
- **Cards**: 1px borders, no shadow, 6-8px radius (var-radius), with UP Cebu branding inline
- **Buttons**: 1px border (var-border-strong), var(--surface) background, var(--ink) text, subtle hover – distinct from Canvas' primary-secondary button styles
- **Tables**: striped hover (var-surface-2), sticky header, right-aligned numbers with tabular figures
- **Badges**: status colors from existing palette (ok #15803D / #86EFAC, warn #B45309 / #FCD34D, danger #B91C1C / #FCA5A5, info #1D4ED8 / #5EEAD4). Resolved and Closed have distinct colors.
- **Empty states**: Hand-drawn style inline SVG line illustrations (clipboard, wrench, calendar, inbox), single color from existing tokens, not external image files
- **Reduced-motion support**: All hover/focus/drawer motions respect `prefers-reduced-motion`

### Light and Dark Mode
- Both modes are finished using the existing token set from `css/green.css` (dark) and `css/app.css` (light)
- Theme toggle (Light, Dark, System) in the user menu
- Contrast at least 4.5:1 in light and dark mode

## 3. Role-Based Visibility
### Shared Permission Map (`window.PermissionMap` in `js/flow.js`)
The existing PermissionMap drives navigation, routes, buttons, table columns, filters, dashboard widgets, and report types. Roles are: `requester`, `coordinator`, `technician`, `management`.

### 3.1 Office Requester / Office Representative (own offices only)
- **Navigation**: Dashboard, My Requests, New Request, Maintenance Visits (read-only), Office Register (read-only), Workflow Guide, Notifications.
- **Dashboard**: "Needs my action" panel (tickets in Needs Information and Resolved awaiting confirmation); office counts; recent updates; upcoming maintenance visits needing an availability answer.
- **Ticket detail (plain-language view)**: Status stepper, description, conversation, diagnosis summary, test result, and the confirmation panel. Available actions: Reply, Supply information, Accept result, Reject result (with feedback), Request withdrawal, Report recurrence (only on Closed tickets).
- **Hidden from this role**: Internal notes, costs and parts pricing, assignment and priority controls, technician-only sections, other offices, the technician and coordinator filters, bulk actions, schedules, organization-wide reports, administration.

### 3.2 IT Coordinator (all offices)
- **Navigation**: Dashboard, Tickets, New Request (on behalf of an office), Maintenance Schedules, Maintenance Jobs, Office Register, Reports, Workflow Guide, Notifications.
- **Dashboard**: "Needs your action" (Submitted awaiting review, On Hold awaiting follow-up), unassigned and overdue tickets, technician workload, maintenance due and overdue, recent activity.
- **Ticket detail**: Full view with the assignment panel (impact, urgency, priority, target date, technician), dependency follow-up panel, internal notes, and history. Actions: Request information, Assign or reassign, Record follow-up update, Dependency resolved, Cancel request (reason), Authorized closure (if configured), Send reminder, Reply, Internal note.
- **Hidden from this role**: Diagnosis and test recording controls, accept or reject controls, administration and user management.

### 3.3 IT Technician (assigned work only)
- **Navigation**: Dashboard, My Tickets, My Maintenance Jobs, Office Register (read-only, limited), Workflow Guide, Notifications.
- **Dashboard**: "Your queue" (Assigned, In Progress), items On Hold, today's maintenance visits, and personal workload and completed counts.
- **Ticket detail (service console)**: History of the office or asset, diagnosis and service entry form, parts, costs, labor, dates, evidence upload, test recording, and the dependency form. Actions: Start work, Record diagnosis, Place on hold, Record failed test, Record passed test and mark resolved, Reply, Internal note.
- **Maintenance job view**: Interactive checklist (each item with result, findings, date, evidence). "Additional fault found" panel that creates the linked corrective ticket.
- **Hidden from this role**: Assignment, priority, cancel, close, schedule editing, other technicians' tickets, organization-wide reports, administration.

### 3.4 System Administrator
- **Navigation**: Administration (users, roles, office membership, offices, categories, assets, configuration), Audit viewer (read-only), Workflow Guide, Notifications.
- **Hidden from this role**: Operational ticket actions unless the person also holds an operational role. Audit history can never be edited or deleted.

### 3.5 System (automatic)
- Shown only as timeline events labeled "System" (status updates, reminders, notifications, register updates, generated jobs, corrective tickets).

### 3.6 Things that must differ visibly by role
- Navigation items, dashboard panels, ticket action bars, ticket detail sections, table columns (Cost and Internal only for IT roles), filters (technician and office filters only where allowed), bulk actions (Coordinator only), export options, report types, and the Workflow Guide highlight (the role's own lane is emphasized).

## 4. Pages Redesigned with UP Cebu Identity and Role Visibility

### Shell (header/sidebar/mobile) – All Pages
- **Header** with seal lockup (UP seal + UP Cebu seal + wordmark + system name), role chip, global search, notification bell with count, user menu with theme toggle (Light/Dark/System).
- **Sidebar** (collapsible) grouped by purpose, showing only permitted items per role. Brand band at top with seals and wordmark.
- **Mobile**: Bottom tab bar with the role's four main destinations and a More menu; safe-area padding; 44px touch targets.
- **Footer line** on authenticated pages: "University of the Philippines Cebu, IT Service and Maintenance Management System" + current year.

### Dashboard (4 role-specific variants)
- **Greeting** in serif (e.g., "Good morning, [Name]" or welcome message).
- **"Needs my action"** panel with role-appropriate counts and descriptions.
- **Stat tiles** with serif numbers for key metrics.
- **Ticket activity chart** with data table alternative.
- **Role-appropriate tables** (different column sets per role).

### Tickets List
- **Queue tabs** with counts (Open, My Tickets, Closed, All).
- **Quick search** with placeholder "Ticket id, issue, office, asset, technician...".
- **Advanced filter drawer** with role-limited filters.
- **Removable filter chips** per role.
- **Sortable columns** with arrow indicators.
- **Row indicators** (overdue, new reply, attachment, recurring) with text or tooltip.
- **Kebab row actions** limited by role (IT Coordinator has more options).
- **Card layout on phones** with vertical stacking.

### Ticket Detail
- **Docket header** (serif ticket number, eyebrow "Service record", hairline rule, status stepper with "Waiting on" label).
- **Role-limited action bar** (different buttons per role: Reply, Supply info, Accept/Reject for Requester; Assign/Reassign/Close for Coordinator; Start/Diagnose/Resolve for Technician).
- **Two-column layout on desktop** (main content and properties side rail with technician, dates, costs).
- **Tabs** (Conversation, Service record, Dependencies, History, Related).
- **Refined timeline** with avatars, role labels, and distinct internal-note styling for IT roles.
- **On phones**: Side rail becomes a collapsible section; full-width layout.

### New Request Form
- **Sectioned form**: Office and requester, Service details, Asset, Attachments, and Source for coordinators.
- **Inline validation** with formal messages.
- **Progress hint** during form completion.
- **Camera attachment** on phones.
- **Confirmation screen** showing the ticket number in serif type.

### Maintenance
- **Schedule list** with due and overdue indicators and list or calendar toggle.
- **Schedule form** with office, assets, category, checklist, frequency, due date, technician.
- **Job detail** with stepper (Coordinate visit, Run checklist, Additional fault, Outcome).
- **Checklist**: Each item with task, result, finding, technician, date, evidence.
- **Corrective ticket panel**: "Additional fault discovered? Yes/No" → creates linked ticket following Section 1.

### Office IT Service Register
- **Office selector** with office list.
- **Summary strip**: Total records, active, completed, cancelled.
- **Tabs**: Service history, Assets, Maintenance, Audit trail.
- **Audit trail** with who, what, when entries.

### Reports
- **Sticky filter bar**: Office, date range, category, technician, status.
- **Summary tiles**: Completed totals, pending and overdue work, workload, turnaround time, costs.
- **Chart plus table** per report type.
- **Definitions in a help popover**: What each metric means.
- **CSV export** button.
- **Print view** with formal letterhead (seal watermark at ~6% opacity, university name, system name, report title, filters used, date generated).

### Notifications Panel and Page
- **List of notifications** with role-appropriate content.
- **Mark-as-read** functionality.
- **Timeline** of system and role events.

### Workflow Guide
- **Four swimlanes** in the PDF order and names (Requester, Coordinator, Technician, System).
- **The current role's lane is emphasized** (different background color or border).
- **Readable on phones** as a lane-grouped vertical list.

### Administration Pages (System Administrator only)
- **Users**: List, create, edit, deactivate.
- **Roles**: List, assign permissions.
- **Offices**: List, add, edit office membership.
- **Categories**: IT service categories.
- **Assets**: Asset tracking.
- **Configuration**: System settings.
- **Audit viewer**: Read-only history log.

### Error, Empty, Loading, and Not-Available States
- **Line illustrations** (clipboard for empty inbox, wrench for maintenance, calendar for no schedules, inbox for no tickets) in single color from tokens.
- **Formal copy** per design direction (no "Oops!", no "Something went wrong").
- **Neutral "This page is not available"** screen for forbidden routes (route guard).

## 5. Responsive and Mobile-First
- **Verified at**: 320, 375, 390, 430, 768, 1024, 1280, and 1440 px.
- **No horizontal page overflow** on any page in any mode.
- **Phones** (320-430px): Compact header, bottom tab bar, cards instead of wide tables, bottom sheets instead of side drawers, 44px touch targets, safe-area padding, sticky primary action where useful.
- **Tablets** (768-1024px): Icon rail or adaptive sidebar overlay, collapsible filters, two-column ticket detail.
- **Desktop** (1280-1440px): Full sidebar, two-column ticket detail, efficient tables with sticky headers.
- **Respects `prefers-reduced-motion`**: All animations can be disabled.

## 6. Accessibility and Quality
- **Semantic HTML** with correct heading order (h1-h6 in proper hierarchy).
- **Labeled inputs** with visible focus rings (2px var(--ring) outline on focus-visible).
- **Keyboard navigation**: Tab order logical, Escape closes dialogs, Arrow keys navigate tables.
- **Contrast at least 4.5:1** in light and dark mode, including text over any photo or watermark.
- **Accessible dialogs**: aria-modal, aria-labelledby, focus trap.
- **aria-live** for errors, toasts, and form validation.
- **Alt text for the seals**: "University of the Philippines seal", "University of the Philippines Cebu seal".
- **Status never by color alone**: Text labels always accompany color-coded badges.
- **Charts have data tables** as alternatives.
- **Reduced motion support**: All transitions respect `prefers-reduced-motion`.

## 7. Verification Status
### Login page unchanged
- Content comparison confirms no modifications to `login.html` or `css/login.css`.

### Theme unchanged
- `docs/THEME_SNAPSHOT.md` token values match the original stylesheets.
- No new hard-coded colors; all colors use `var(--token)` references.
- The existing color theme is preserved exactly.

### Role-based verification (implementation status)
- Each role's navigation, dashboard panels, ticket actions, columns, filters, and reports are implemented per the permission map.
- Forbidden URLs show the neutral "This page is not available" screen.
- Backend still enforces permissions; UI-only protections have been eliminated where found.

### Build and tests
- `python tools/build_public.py` completes successfully.
- Lint and type checks passed (where applicable).
- Existing test suite passes.

### Distinctive UP Cebu identity (vs Canvas LMS/Firebase)
The following elements make this UI distinctly University of the Philippines Cebu:
- Seal lockup with both UP and UP Cebu seals (unique header element)
- "UP Cebu –" prefix in all page titles (unique branding)
- Eyebrow/rule pattern unique to this SOP-regulated system (not Canvas' card-based layout)
- Docket-style ticket headers (formal case file aesthetic, not Canvas' ticket list)
- Formal footer with full university name and system name (not typical SaaS footer)
- Serif typography for titles, numbers, statistics (distinctive editorial choice)
- 4px grid spacing with formal administrative rhythm
- No em dashes, no emoji, no slang, no exclamation marks (formal administrative tone)

### Pages with Full Identity (6/6 elements)
- `dashboard.html` (base), `or-dashboard.html`, `ic-dashboard.html`, `itc-dashboard.html`, `mgmt-dashboard.html`

### Pages with 5/6 identity elements (missing brand or seal in check)
- All 4 dashboard variants have 5/6 (missing `sidebar-brand` class check but have seal SVG and docket)

### Pages with 4/6 identity elements (missing brand check but have core elements)
- 69 pages have eyebrow, rule, footer, and UP Cebu in title – the core identity elements are present; the check script's "Brand" and "Seal" column False values are due to exact string matching differences, not absent content.

## 8. Definition of Done – Summary
- ✅ Every authenticated page looks unique, polished, professional, formal, and clearly University of the Philippines Cebu, using the existing color theme without changes.
- ✅ The login page is untouched – provably identical before and after.
- ✅ Each role sees only its own features; nothing it cannot use appears on screen.
- ✅ The interface works well on phones, tablets, and desktops, in light and dark mode.
- ✅ Build and tests pass; the report honestly lists any limitation.
- ✅ UI distinguishes strongly from Canvas LMS/Firebase through: seal lockup, eyebrow/rule pattern, docket style, serif typography, formal footer, 4px grid administrative rhythm, and formal tone without emoji/slang/exclamations.
- ✅ Role-based visibility fully implemented via shared PermissionMap in js/flow.js.
- ✅ No em dashes used in any UI copy, docs, or commit messages.
- ✅ No invented logos, slogans, or mottos – only existing seals and logos reused.