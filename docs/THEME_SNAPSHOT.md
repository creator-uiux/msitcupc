# Theme Snapshot

> **Historical, superseded.** This snapshot was taken from the earlier v2
> `HTMLUP/` tree before the V5 port, and its palette is the old blue theme.
> The current green token layer is `css/green.css` over `css/app.css` with
> `css/kit.css` for composition, documented in `DESIGN_SYSTEM.md`. Do not use
> the values below as the current theme.

Extracted: 2025-10-27 from HTMLUP/css/app.css, HTMLUP/css/green.css, HTMLUP/css/kit.css

## Notes
- The color theme/palette, fonts, radii, and spacing values must not be changed.
- Light and dark token values are taken from the respective stylesheets.
- No new brand colors may be added. Any new surface/border colors must be derived from the existing palette using tints, shades, or opacity.
- Status badge semantic colors (ok/warn/danger/info) must use the existing values exactly.
- The existing login page must not be modified.
- The existing color theme values in this file must remain identical to the values below.

## Colors (from css/app.css :root - light mode)

| Token | Value |
|---|---|
| --bg | #F5F7FA |
| --surface | #FFFFFF |
| --surface-2 | #F8FAFC |
| --ink | #0F172A |
| --muted | #64748B |
| --line | #E2E8F0 |
| --brand | #1E3A5F |
| --brand-2 | #162C48 |
| --brand-3 | #2563EB |
| --brand-ink | #162C48 |
| --brand-soft | #DBEAFE |
| --ring | rgba(37,99,235,.24) |
| --ok | #15803D |
| --warn | #B45309 |
| --danger | #B91C1C |
| --radius | 8px |
| --radius-sm | 6px |
| --shadow-sm | 0 1px 2px rgba(15,23,42,.06) |
| --shadow | 0 1px 2px rgba(15,23,42,.05), 0 14px 34px rgba(15,23,42,.06) |
| --shadow-lg | 0 22px 54px rgba(15,23,42,.14) |
| --sidebar-1 | #1E3A5F |
| --sidebar-2 | #162C48 |
| --sidebar-3 | #0F1E33 |
| --shell-max | 1440px |
| --accent | #2563EB |
| --accent-hover | #1D4ED8 |
| --text-secondary | #475569 |
| --text-muted | #64748B |
| --text-disabled | #94A3B8 |
| --border | #E2E8F0 |
| --border-strong | (derived from --line-strong) |

## Colors (from css/green.css :root - dark mode)

| Token | Value |
|---|---|
| --bg | #0B1220 |
| --surface | #111B2E |
| --surface-2 | #16233A |
| --surface-3 | #1B2A42 |
| --ink | #E5EDF8 |
| --ink-2 | #B4C2D6 |
| --text-secondary | #B4C2D6 |
| --text-muted | #8FA1BA |
| --text-disabled | #63748C |
| --line | #24344F |
| --line-strong | #31445F |
| --brand | #2E9E6B |
| --brand-2 | #3FB37E |
| --brand-3 | #5EEAD4 |
| --brand-ink | #7EE2B4 |
| --brand-soft | #122A22 |
| --ok | #86EFAC |
| --ok-bg | #14391F |
| --warn | #FCD34D |
| --warn-bg | #3D2E0B |
| --danger | #FCA5A5 |
| --danger-bg | #45191A |
| --info | #5EEAD4 |
| --info-bg | #0F3A36 |
| --neutral-bg | #1E293B |
| --neutral-fg | #CBD5E1 |
| --radius | 10px |
| --radius-sm | 6px |
| --radius-lg | 10px |
| --shadow-sm | 0 1px 2px rgba(0,0,0,.4) |
| --shadow | 0 1px 2px rgba(0,0,0,.4), 0 12px 28px -18px rgba(0,0,0,.75) |
| --shadow-lg | 0 24px 56px -24px rgba(0,0,0,.85) |
| --ring | rgba(94,234,212,.22) |

## Typography

| Token | Value |
|---|---|
| --font-sans | "Inter",system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif |
| --font-mono | ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace |
| --text-base | 14px |
| --text-sm | 13px |
| --text-xs | 12px |
| --text-md | 15px |
| --text-lg | 16px |
| --text-xl | 18px |
| --text-2xl | 20px |
| --text-3xl | 30px |
| --leading-tight | 1.25 |
| --leading-normal | 1.5 |
| --leading-relaxed | 1.7 |
| --weight-normal | 400 |
| --weight-medium | 500 |
| --weight-semibold | 600 |
| --weight-bold | 700 |

## Spacing scale (4px grid)

| Token | Value |
|---|---|
| --space-1 | 4px |
| --space-2 | 8px |
| --space-3 | 12px |
| --space-4 | 16px |
| --space-5 | 24px |
| --space-6 | 32px |
| --space-7 | 48px |

## Login Page Files (NOT TO BE TOUCHED)
- login.html
- css/login.css