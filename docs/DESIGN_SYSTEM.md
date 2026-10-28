# Design system

The ITC Service and Maintenance Management System is a calm, institutional green
product. Four stylesheets define it on authenticated pages, loaded in this
order. The sign-in page loads the first three plus `css/login.css` and is
frozen.

| File | Role |
|---|---|
| `css/app.css` | the structure: the shell, the components, the responsive tiers |
| `css/green.css` | the token layer: the green palette, the radii, the shadows, the type scale |
| `css/kit.css` | the shared kit: the page composition, the utilities and the parity rules |
| `css/console.css` | the authenticated shell: icon rail, contextual panel, slim top bar and the role visibility rules |

`css/kit.css` is the single place where "how a screen is put together" is
decided, so a screen looks the same whichever role opens it. `css/console.css`
adds the Phase 10 shell and the hide-not-disable rules only. A page that needs
a new arrangement takes a class from the kit -- **there are no inline styles in
the markup**. The only exceptions are values that are computed at run time
(a bar width, a row index, a role accent colour), and those live in CSS
custom properties.

There are **no emoji in the interface**. Every pictogram is an inline SVG from
one outline set (`js/ui.js`, `ICONS`), 24 x 24, 2px stroke, so icons sit
together on a page and inherit the colour of their container.

---

## 1. Colour

### Light

| Token | Value | Used for |
|---|---|---|
| `--brand` | `#0E6B43` | primary buttons, active nav, links, chart stems |
| `--brand-2` | `#0A5233` | primary button hover, heading ink |
| `--brand-3` | `#17A268` | brand mark, live dot, meter fill |
| `--brand-soft` | `#E6F3EC` | soft buttons, notes, icon tiles, active nav |
| `--bg` | `#F4F7F5` | page canvas |
| `--surface` | `#FFFFFF` | cards, tables, dialogs |
| `--surface-2` | `#F7FAF8` | table headers, card headers, chips |
| `--surface-3` | `#EFF5F1` | meters, neutral illustration fills |
| `--ink` | `#10201A` | primary text |
| `--text-secondary` | `#40544A` | labels, secondary text |
| `--muted` | `#6B7C73` | helper text, column headers |
| `--line` | `#E3EAE6` | 1px borders |
| `--line-strong` | `#CFDCD5` | input borders, strong separators |
| `--ok` | `#15803D` | Closed, success |
| `--warn` | `#8A5B09` | Needs Information, On Hold |
| `--danger` | `#A32A1E` | Critical priority, destructive actions |
| `--info` | `#0B6A5B` | Resolved |

The page is mostly white, light grey and green. Colour is reserved for status,
priority and the single primary action on a screen.

### Dark

Dark mode is comfortable, never harsh: page `#0B1220`, surface `#111B2E`,
subtle surface `#16233A`, border `#24344F`, text `#E5EDF8`, secondary text
`#B4C2D6`, muted `#8FA1BA`, accent `#60A5FA` (the brand becomes `#2E9E6B` and
the bright accent `#5EEAD4`). No pure black backgrounds and no pure white
text. Every page, chart, badge, dialog and the Workflow Guide follow it,
because the whole palette is driven by variables.

### Status and priority badges

Badges always carry an icon **and** the exact status text, never colour alone.

| Status | Icon | Light | Dark |
|---|---|---|---|
| Submitted | inbox | `#E8F0EA` on `#3D5A4B` | `#93C5FD` on `#13294F` |
| Needs Information | help | `#FBF0D6` on `#8A5B09` | `#FCD34D` on `#3D2E0B` |
| Assigned | user | `#E3EBE6` on `#2C4A3C` | `#A5B4FC` on `#23275A` |
| In Progress | activity | `#E6F3EC` on `#0A5233` | `#93C5FD` on `#13294F` |
| On Hold | pause | `#FAE7D2` on `#94550C` | `#FDBA74` on `#47230D` |
| Resolved | check in circle | `#D6EFE7` on `#0B6A5B` | `#5EEAD4` on `#0F3A36` |
| Closed | archive | `#E3F3E8` on `#15803D` | `#86EFAC` on `#14391F` |
| Cancelled | ban | `#EDF1EF` on `#56655D` | `#CBD5E1` on `#1E293B` |

Resolved (teal) and Closed (green) stay clearly different in both themes.

Priority uses three bar icons that grow with urgency, plus `alert` for
Critical: `prioLow` (equal bars), `prioMed`, `prioHigh`, `alert`.

---

## 2. Typography

Inter with the fallback stack `system-ui, -apple-system, "Segoe UI", Roboto,
sans-serif`, so the interface never depends on a font that fails to load.
Headings use Sora with the same fallback, so a title keeps its shape when the
web font is unavailable.

| Role | Class | Size | Weight |
|---|---|---|---|
| Page title | `.sec-title h2` | 20px | 600 |
| Card title | `.card-head h3`, `.card-title` | 16px | 600 |
| Record subject | `.record-subject` | 18px | 600 |
| Body, table text | -- | 14px | 400 |
| Labels, badges, help | `.t-sm` | 13px | 500 |
| Captions | `.t-xs` | 12px | 500 |
| Stat tile number | `.kpi .value` | 30px | 700 |

Line height 1.55 for body text, 1.35 for headings. Sentence case everywhere,
no all-caps paragraphs. Counts, costs and dates use tabular numbers so columns
align. The scale is closed: `.t-xs .t-sm .t-md .t-lg .t-xl .t-2xl .t-3xl` are
the only sizes a page may use.

---

## 3. Spacing, shape, depth

4px grid: 4, 8, 12, 16, 24, 32, 48, exposed as `--space-1` … `--space-7`.
Page padding 24px on desktop, 12 to 16px on a phone. Card padding 16 to 20px.

- Radius 6px for inputs and buttons, 10px for cards and dialogs, 99px for
  pills. Nothing is heavily rounded.
- 1px borders are the main separator.
- One subtle shadow level for cards (`--shadow-sm`) and one for floating
  layers (dialogs, popovers).
- No decorative gradients, no dot-grid texture, no glow. The page canvas is a
  flat colour so long working sessions stay easy on the eye.

---

## 4. Page composition

Every screen is built from the same parts, in the same order.

```
.sec-title      the page title and its one-line helper
.grid-kpi       the stat tiles
.card           a card: optional .card-head, optional .card-pad
.filters        the filter bar: labelled controls plus .filter-action buttons
.card-foot      the action strip under a card
.card-block     a separated block inside a card
.card-head-row  a title with a chip or an action on the right
```

### The attachment viewer

The evidence behind a record opens **over** the record, so the person never
loses what they are reading.

```
.viewer-host    the backdrop: the record behind it stays visible
.viewer-card    the panel: head, body, foot
.viewer-head    the file name, its size, who attached it and when
.viewer-body    the file: an image, a PDF, a text preview, or the reason it is not here
.viewer-foot    Download and Close
```

- An image is shown as it is, a PDF is embedded, a text file is shown as
  text, and a type with no inline preview offers the download instead.
- The bytes are streamed from the server through the authorised endpoint, so
  the file is never on a public path; the server answers a range request, so
  a large file can be read without loading all of it first.
- A file whose bytes are not held here says so plainly, with the name and the
  details that are on record. Nothing pretends to be a broken image.
- Escape closes it, the backdrop closes it, and the focus goes back to the
  chip that opened it.

### The sign-in screen

The sign-in screen is the one page that is not a working screen. It follows
the `img/UPLoginUI.PNG` reference: **one split card** about 1000px wide and
548px tall over a full-bleed campus photograph. The left half is a glass hero
on the photograph; the right half is an off-white panel. The stylesheet is
`css/login.css`, loaded after the kit so it owns the screen outright.

```
.login-body       the full-bleed campus photograph plus a green scrim
.lp-theme         the Light / System / Dark switch, top right
.lp-main          the centred measure: max-width 1000px
.lp-card          one card: glass hero | off-white panel, 16px corners
.lp-hero          the brand pill, two-line headline, paragraph, three tiles
.lp-pill          "University of the Philippines Cebu", a translucent pill
.lp-hero-copy h1  serif, two lines: "Maintenance Management," / "from request to closure."
.lp-tiles         Live, Secure, Fast, each an outline icon over its label
.lp-panel         the off-white column
.lp-seals         the UP seal and the UP Cebu seal, side by side
.lp-panel h2      "Welcome back"
.lp-system        "IT Service and Maintenance Management System"
.lp-upm           the full-width "Login with UPMail" pill with the Google mark
.lp-hint          "Sign in using your existing UPMail."
.lp-domain        "Restricted to @upcebu.edu.ph UPMail accounts."
.lp-demo          the development account list, shown only behind the flag
.lp-denied        the "Access not granted" state for an unprovisioned account
.lp-foot          "University of the Philippines Cebu - IT Office"
```

There is no email field and no password field: the system is opened with a
UPMail Google account, and the only provider button is the Google mark. When
a Google client id is configured, Google's own button is rendered in the same
place; when it is not, the same control opens the list of demo accounts. An
account outside `@upcebu.edu.ph` is refused, and an account with no
provisioned role sees "Access not granted" rather than a default role.

The theme defaults to light. `?theme=dark`, the switch, or a saved
`itc_login_theme` switches to the dark card; the photograph stays and only the
scrim, the glass and the panel ink change.

### The sign-in measure

The sign-in screen stands on **one measure and one axis**:

- The card is fluid below its 1000px maximum, and every type step is a
  `clamp()` on the viewport, so the pair keeps its proportions from a phone
  to an ultrawide display.
- Below 900px the hero moves above the panel and both share one column.
  Below 760px the header becomes a stacked card; below 620px the composition
  compacts rather than hiding the paragraph or the tiles.
- The sign-in screen carries `data-fit="viewport"`: it is a single purpose
  screen, so it must stand on one screen and never need a scrollbar of its
  own. `tools/responsive.py` fails the build when it does. The card is the
  only element allowed to scroll internally, and only when the demo account
  chooser is open on a short viewport.
- The headline holds two lines from 320px up; the compact breakpoint moves
  the tiles instead of shrinking the type until it wraps.
- The demo account list moves its role chip under the name and the mail
  address on a phone, so neither is ever broken in half.

A card is always one of four shapes, and only these four:

```html
<div class="card">...</div>                          <!-- bare -->
<div class="card"><div class="card-head">..</div>..</div>
<div class="card"><div class="card-pad">..</div></div>
<div class="card"><div class="card-head">..</div><div class="card-pad">..</div></div>
```

A `.card-head` is never nested inside a `.card-pad`: that used to double the
padding and float a grey band inside the card.

### The kit classes

| Class | Use |
|---|---|
| `.sec-title` / `.sec-title h2` | the page title and its helper line |
| `.card-title` / `.card-sub` | a heading and a muted line inside a card body |
| `.card-head-row` | a heading with a chip or an action on the right |
| `.card-foot` | the action strip under a card |
| `.card-block` | a separated block inside a card |
| `.row-between` / `.row-end` / `.row-bottom` | the two-sided, right-aligned and baseline-aligned row |
| `.chip-row` | a run of chips or small badges that wraps |
| `.btn-stack` | a vertical run of full-width buttons |
| `.form-actions` | the right-aligned action row of a form |
| `.field-inline` | a control used inside a toolbar, not a stacked form field |
| `.filters` / `.filter-action` | the filter bar and its action buttons |
| `.toolbar` | a row of controls above a list |
| `.list-divided` | a list with a hairline above it |
| `.divided` | any block with a hairline above it |
| `.info` | the key/value grid |
| `.t-xs` … `.t-3xl` | the closed type scale |
| `.mt-xs` / `.mt-sm` / `.mt-md` | the small vertical steps |
| `.tr-sel` | the selected row of a worklist |
| `.link-arrow` | a text link that opens a record in another screen |
| `.record-subject` | the one headline above a key/value block |
| `.check-stack` | a run of checklist items |
| `.w-full` / `.nowrap` / `.grow` | the few size helpers a page still needs |

---

## 5. Components

| Component | Rules |
|---|---|
| Button | Primary (green fill), secondary (white with border), soft (green tint), danger. One primary per section. 40px tall on desktop, 44px on a phone, 34px for the small variant (`.btn-sm`). |
| Form control | Label above the input, helper text below, inline error in danger red with a message box. Focus ring is a 3px green halo. |
| Status badge | Pill, icon plus exact text. |
| Table | Sticky header, 14px text, 11px row padding, row hover, right aligned numbers, ticket number as a monospace link. The record column keeps a readable width (`.td-main`), a name column never breaks mid-word, and a date never breaks. Below 1024px the table becomes stacked cards with a `data-label` caption per row. |
| Card | White surface, 1px border, 10px radius, optional header strip in `--surface-2`. |
| Stat tile | Label, large tabular number, optional note, and a soft icon tile in the corner. |
| List row | 32px icon tile, title, secondary line, trailing time. |
| Note | Soft tinted panel with a leading icon. Tones: brand, warn, ok, danger. |
| Empty state | Short friendly artwork (`img/empty-*.svg`) with a one line explanation. |
| Timeline | Vertical line, 10px node, actor, Asia/Manila timestamp, internal notes on an amber background. |
| Toast | Bottom right stack, auto dismiss, dark surface, coloured left edge for the kind. Four at a time on a desktop, two on a phone. |
| Dialog | 10px radius, 16 to 20px padding, focus trapped, Escape closes, focus returns. |
| Chart | CSS only bars in the brand green, with the data table always present next to it. |
| Tabs | A row of underlined labels under a single rule. The selected tab carries the brand underline and `aria-selected`; the panel below shows one section at a time. 36px tall on a desktop, 44px on a phone. |
| Workflow stepper | The documented path, Submitted to Closed, with the current step filled in the brand colour and the completed steps in the success colour. Needs Information, On Hold and Cancelled are named as branch states below the path. |
| Waiting on label | A chip that names the role that must act next. It wraps, so a narrow column never cuts the role name. |
| Policy controls | The tick list and the impact by urgency matrix on the settings screen. The matrix is a label and a choice per row, so it never scrolls sideways and never cuts a label at any width. |
| Activity chart | A column per day with four series (submitted, resolved, closed, cancelled), a legend, and the same numbers in a table below it. |
| Loading skeleton | A soft shimmer block. The pages read their data synchronously, so the skeleton shows only where the app genuinely waits, for example an upload in flight. It honours `prefers-reduced-motion`. |

---

## 6. Imagery

Custom artwork lives in `img/` and is drawn in the brand green:

| File | Purpose |
|---|---|
| `img/logo.svg` | the mark (a monitor with a check) used as the favicon and the app mark |
| `img/empty-tickets.svg` | empty ticket list, register, reports |
| `img/empty-inbox.svg` | nothing waiting (inbox, audit, activity) |
| `img/empty-maintenance.svg` | no schedule or job |
| `img/empty-search.svg` | no search result |

The illustrations are inline SVG, so they scale, cost nothing and follow the
theme.

---

## 7. Shell and navigation

- **Desktop**: fixed 250px sidebar in deep green with white text, grouped
  navigation (Workspace, Service requests, Service delivery, Closure and
  oversight, Administration). Only the items the role may use are rendered.
- **Top bar**: page title and helper text on the left, notification bell with
  an unread count, avatar with the account menu on the right.
- **Tablet and phone**: the sidebar is replaced by a green app bar, and a
  bottom tab bar carries the role's four most used destinations plus a
  **More** sheet with the rest, so nothing is unreachable. The two dense
  reference screens, the **Workflow Guide** and **Roles & Access**, are not
  part of the phone navigation: the sidebar never offered them either, so
  they stay hidden on a phone and are reached by their own link.
- **Phone**: 44px touch targets, safe-area padding, tables become cards, the
  primary action sticks to the bottom.
- **The More sheet holds the notices.**  The sheet covers the screen, so a
  notice that arrives while it is open would hide what the person is
  choosing from.  The notice waits and is shown once the sheet closes, so
  nothing is lost.  The bell and the account menu are small panels in the
  corner and never cover the notices.
- **The pop-up notices** can be paused from the notification panel: the
  **Pop-ups** switch in its foot holds back the notices the live engine
  raises on its own (the reminder loop, the dependency follow-up, a new
  notification). The result of what a person just did is always shown, and
  the bell, the badge and the notification centre keep working either way.
  The choice is remembered per browser.
- The mobile app bar carries the notification panel and the account menu, so
  it needs a stacking context of its own above the page content: without it
  the panel is painted under the cards and the two show through each other.

---

## 8. Motion

Short transitions only (120 to 200ms) on hover, focus, drawers and dialogs.
Loading uses skeleton-free simple spinners and empty states that explain
themselves. `prefers-reduced-motion` turns every animation and transition off.

---

## 9. Accessibility

Semantic HTML, one `h1` per page, labels bound to inputs, visible focus rings,
status and priority never shown by colour alone, dialogs close on Escape and
return focus, errors are announced through `aria-describedby`, and every
informative image carries alt text (decorative artwork is `alt=""`).

---

## 10. Checks

| Tool | What it proves |
|---|---|
| `python tools/ui_check.py` | every page loads its stylesheets in order (four on authenticated pages, three plus `login.css` on the sign-in page), carries no inline style, keeps the shell and the page head, uses only classes the stylesheets define, and has no page-local `<style>` block |
| `python tools/responsive.py` | no overflow, no clipping, no tap target under 36px across 320 / 375 / 390 / 430 / 768 / 1024 / 1280 / 1440 |
| `node tools/pagetest.js` | every page renders, every control is wired, icons and badges behave |
| `node tools/smoke.js` | the workflow still runs end to end in the browser |
| `python tools/validate.py` | every element id referenced by the scripts exists |
| `python tools/role_pages.py --check` | the 50 role pages are byte-current and uniquely titled |
| `python tools/em_dash_check.py` | no em dash anywhere in the source |
| `python tools/shots.py --theme dark` | captures light and dark frames for review |
