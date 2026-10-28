# Theme Snapshot

Baseline recorded: 2026-10-28, before the Section 25 UI polish pass.

Cascade order on every authenticated page:

1. `css/app.css` (base tokens and legacy blue layer)
2. `css/green.css` (effective palette, typography, shell)
3. `css/kit.css` (spacing scale, composition, dark brand overrides)
4. `css/console.css` (authenticated pages only; Phase 11 shell rules)

The login page loads the first three plus `css/login.css` and does not load
`console.css`.

The tables below list the values that win after that cascade. They are the
frozen theme. The polish pass adds `css/console.css` for new shell rules only;
it must not change any value in these tables.

Token source is noted as `green.css` (light `:root`, dark
`html[data-theme="dark"]`), `app.css` (only where green does not override),
or `kit.css` (dark brand overrides and the spacing scale).

## Colour tokens

| Token | Light | Dark | Source |
|---|---|---|---|
| `--bg` | #F4F7F5 | #0B1220 | green.css |
| `--surface` | #FFFFFF | #111B2E | green.css |
| `--surface-2` | #F7FAF8 | #16233A | green.css |
| `--surface-3` | #EFF5F1 | #1B2A42 | green.css |
| `--ink` | #10201A | #E5EDF8 | green.css |
| `--ink-2` | #40544A | #B4C2D6 | green.css |
| `--text-secondary` | #40544A | #B4C2D6 | green.css |
| `--muted` | #6B7C73 | #8FA1BA | green.css |
| `--text-disabled` | #9AA9A2 | #63748C | green.css |
| `--line` | #E3EAE6 | #24344F | green.css |
| `--line-strong` | #CFDCD5 | #31445F | green.css |
| `--brand` | #0E6B43 | #2E9E6B | green.css |
| `--brand-2` | #0A5233 | #3FB37E | green.css |
| `--brand-3` | #17A268 | #5EEAD4 | green.css |
| `--brand-soft` | #E6F3EC | #122A22 | green.css |
| `--brand-soft-2` | #CFE7DA | #1D4234 | green.css |
| `--brand-ink` | #0A5233 | #7EE2B4 | green.css |
| `--ok` | #15803D | #86EFAC | green.css |
| `--ok-bg` | #E3F3E8 | #14391F | green.css |
| `--warn` | #8A5B09 | #FCD34D | green.css |
| `--warn-bg` | #FBF0D6 | #3D2E0B | green.css |
| `--danger` | #A32A1E | #FCA5A5 | green.css |
| `--danger-bg` | #FBE4E1 | #45191A | green.css |
| `--info` | #0B6A5B | #5EEAD4 | green.css |
| `--info-bg` | #D6EFE7 | #0F3A36 | green.css |
| `--neutral-bg` | #EDF1EF | #1E293B | green.css |
| `--neutral-fg` | #56655D | #CBD5E1 | green.css |
| `--ring` | rgba(14,107,67,.18) | rgba(94,234,212,.22) | green.css |
| `--sidebar-1` | #0B3D28 | #0A1424 | green.css |
| `--sidebar-2` | #093320 | #08111E | green.css |
| `--sidebar-3` | #072617 | #060D18 | green.css |
| `--sidebar-ink` | #DCEBE2 | #D6E3F2 | green.css |
| `--sidebar-muted` | #8FB6A2 | #8FA1BA | green.css |
| `--glass-1` | rgba(255,255,255,.70) | rgba(9,32,22,.72) | app.css |
| `--glass-2` | rgba(255,255,255,.93) | rgba(13,44,30,.93) | app.css |
| `--glass-line` | rgba(1,68,33,.10) | rgba(53,201,142,.18) | app.css |
| `--aurora-1` | rgba(15,143,80,.24) | rgba(53,201,142,.16) | app.css |
| `--aurora-2` | rgba(1,68,33,.16) | rgba(1,68,33,.42) | app.css |
| `--aurora-3` | rgba(232,179,57,.16) | rgba(232,179,57,.10) | app.css |
| `--mint` | #35D18C | #35D18C | app.css |
| `--gold` | #E8B339 | #E8B339 | app.css |

## Shape and elevation

| Token | Value | Source |
|---|---|---|
| `--radius` | 10px | green.css |
| `--radius-sm` | 6px | green.css |
| `--radius-lg` | 10px | green.css |
| `--shadow-sm` | 0 1px 2px rgba(16,32,26,.05) | green.css |
| `--shadow` | 0 1px 2px rgba(16,32,26,.05), 0 10px 24px -16px rgba(16,32,26,.22) | green.css |
| `--shadow-lg` | 0 22px 52px -22px rgba(16,32,26,.32) | green.css |
| `--shell-max` | 1440px | app.css |

Dark shadows:

| Token | Value |
|---|---|
| `--shadow-sm` | 0 1px 2px rgba(0,0,0,.4) |
| `--shadow` | 0 1px 2px rgba(0,0,0,.4), 0 12px 28px -18px rgba(0,0,0,.75) |
| `--shadow-lg` | 0 24px 56px -24px rgba(0,0,0,.85) |

## Typography

| Token | Value | Source |
|---|---|---|
| `--font-sans` | "Inter", system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif | green.css |
| `--font-mono` | ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace | app.css |
| `--sora` | "Sora", "Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif | app.css (display face) |
| `--text-xs` | 12px | green.css |
| `--text-sm` | 13px | green.css |
| `--text-base` | 14px | green.css |
| `--text-md` | 16px | green.css |
| `--text-lg` | 18px | green.css |
| `--text-xl` | 20px | green.css |
| `--text-2xl` | 24px | green.css |
| `--text-3xl` | 30px | green.css |
| `--leading-tight` | 1.35 | green.css |
| `--leading` | 1.55 | green.css |
| `--w-normal` | 400 | green.css |
| `--w-medium` | 500 | green.css |
| `--w-semibold` | 600 | green.css |
| `--w-bold` | 700 | green.css |

There is no serif family in the project. The display face is the existing
Sora. Section 25 asks for the existing serif only where one exists, so the
polish pass does not add one.

## Spacing scale

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |
| `--space-7` | 48px |

## Rules for the polish pass

- No value in this file may change.
- New CSS lives in `css/console.css` and uses the existing tokens, plus
  white and black alpha overlays for the dark rail, matching the existing
  shell. New brand colours are not allowed.
- `css/login.css`, `login.html`, and `js/login.js` are frozen and are not
  edited. `css/app.css`, `css/green.css`, `css/kit.css`, and `js/theme.js`
  are shared with the login page and their token values stay untouched.
- Status and priority chips keep the existing semantic colours.
