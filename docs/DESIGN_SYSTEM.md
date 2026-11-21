# FixFlow Design System

The visual and interaction reference for every screen in FixFlow: public website, business dashboard and customer portal. It is a code-first design system (there are no separate mock-ups): this document, the tokens in `globals.css`, the components and the development-only `/styleguide` are the reference.

**What is authoritative.** The tokens in [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css) are the implementation; this document explains them. The contrast table in §3 is produced from that file by code, and `apps/web/src/lib/design/tokens.test.ts` fails the build if a promised pair drops below its WCAG threshold. The status vocabulary in §8 is produced from `apps/web/src/lib/formatting/status.ts`. To see everything rendered, run `npm run dev` and open `http://localhost:3000/styleguide` (development only; a production build returns 404).

**How to use it.** Read §1–§2 once; before building a screen read its blueprint in §13, the patterns in §11 and the checklist in §15. Reuse a component from §9 before creating one. Do not add colours, font sizes, radii or shadows: the Tailwind theme contains only the tokens below, so an off-palette class does not compile.

## Contents

1. Brand principles
2. Voice and tone
3. Colour
4. Typography
5. Spacing, radii, elevation, borders, icons, motion
6. Breakpoints and layouts
7. Navigation and shells
8. Status mapping
9. Components
10. Formatting
11. Patterns
12. Accessibility rules
13. Screen blueprints
14. Design decisions
15. Checklist for new screens

---

## 1. Brand principles

FixFlow is for one small home-service business, so it should feel like a well-run local company: **dependable, modern, calm, precise, service-oriented**.

| Principle | In practice |
|---|---|
| Professional before decorative | A coherent grid, type scale and spacing carry the design. No gradients except one brand panel on the sign-in page, no glows, no motion for its own sake. |
| One identity | The public site, dashboard and portal share the logo, colours, type, radii and icon style. They differ in density and layout, never in language. |
| Action first | Each screen leads with what the person should do next: one primary action per view, and a "needs attention" list ahead of vanity numbers. |
| Status in words | Every state is text plus an icon plus colour. Colour is never the only signal. |
| Realistic content | Believable services, addresses, dates and money; fictional but never lorem ipsum, and never claims of clients, testimonials or outcomes that do not exist. |
| Every state designed | Loading, empty, validation error, server error, disabled, destructive confirmation and permission denied exist for each screen. |
| Responsive by design | Phones first. Tables become cards; a sidebar becomes a drawer; nothing scrolls sideways unless a table says so deliberately. |
| Accessible controls | Labels, headings, keyboard operation, visible focus, enough contrast, meaningful names (WCAG 2.2 AA practices). |

**Branding model.** Product chrome (dashboard, portal, sign-in, favicon, app logo, page titles such as "Requests · FixFlow") is FixFlow-branded. The public website's *content* uses the configured business identity (CoolBreeze Home Services), with titles such as "AC Repair · CoolBreeze Home Services" and a footer line "Powered by FixFlow". In demo mode a slim banner reads "FixFlow portfolio demo — fictional business and data."

**The mark.** An original drawing: a roof (the home) over a line of flowing water (the flow), on a rounded tile. Two strokes, so it stays legible at 16 px. `Logo` has a `light` variant (deep teal tile, for light backgrounds) and a `dark` variant (bright teal tile with navy strokes, for the sidebar and footer), a `markOnly` form, and a text wordmark ("Fix" + "Flow" in the display face). `src/app/icon.svg` is the same drawing with literal colours, used as the favicon.

## 2. Voice and tone

Plain, confident, specific. Write for a homeowner who is busy and a little worried that something is broken.

- **Say what happened and what happens next.** "Quotation QT-2026-00042 sent. Morgan Reyes can review it in their portal." Not "Success!".
- **Be specific about consequences before irreversible actions.** "The invoice stays in the history marked Void and the customer is told it was withdrawn. It can't be reopened."
- **Name the thing.** "Void invoice", "Send quotation", not "Confirm" or "OK".
- **Errors say what is wrong and how to fix it, next to the field.** "Enter a valid email address, like name@example.com." Never "Invalid input". Never blame the person.
- **Never fake it.** A success message appears only after the server confirmed. An email that was only written to the log is "Logged only", never "Sent". A payment is "Recorded", never "Processed": FixFlow takes no payments.
- **Short sentences, sentence case, no exclamation marks, no jargon.** "Quotation", "job", "invoice"; not "work order" in customer-facing text (the API calls it a work order).
- **Empty states give guidance**, not apology: "No quotations yet. When you review a request you can prepare one for it."
- **Dates and money read the way people say them:** "Oct 28, 2026, 3:30 PM", "$1,284.50", "Tomorrow at 9:00 AM".

## 3. Colour

A deep navy-teal carries navigation and primary actions; a restrained teal marks active and positive things; neutrals are slightly green-grey so the page feels warm rather than clinical. The default Tailwind palette is switched off (`--color-*: initial`), so only the tokens below exist.

| Token | Value | Use |
|---|---|---|
| `page` | `#f6f7f6` | Page background |
| `surface` | `#ffffff` | Cards, tables, dialogs, inputs |
| `surface-muted` | `#eef1f0` | Table headers, skeletons, read-only fields, hover |
| `border` | `#e3e7ea` | Subtle edges and dividers (decorative) |
| `border-strong` | `#7a8993` | Form control boundaries and other UI edges (≥ 3:1) |
| `ink` | `#0f1b22` | Body text |
| `ink-secondary` | `#4a5a64` | Supporting text |
| `ink-muted` | `#5e6d77` | Metadata, placeholders |
| `brand` | `#14505e` | Primary buttons, links, selected tabs |
| `brand-hover` | `#0f3e4a` | Primary hover |
| `brand-deep` | `#0b2e38` | Sidebar, footer, tooltips, overlays (at 60%) |
| `brand-soft` | `#e4eff1` | Selected items, secondary buttons, avatars |
| `accent` | `#0f766e` | Teal **text and icons** |
| `accent-fill` | `#14b8a6` | Teal **fills**, always with dark text (`ink` or `brand-deep`); never as text or as the only boundary on white (2.5:1) |
| `accent-soft` | `#e2f3f0` | Teal tint |
| `nav-text` / `nav-muted` / `nav-hover` / `nav-active` / `nav-border` | `#c7dadf` / `#93afb7` / `#123b47` / `#14505e` / `#1d4652` | Sidebar items, group headings, hover, current page, dividers |
| `focus` / `focus-on-dark` | `#0f766e` / `#5eead4` | Focus ring on light / on dark surfaces |
| `info`, `attention`, `success`, `danger`, `neutral` | `#1d5fa8`, `#9a5b00`, `#1b7646`, `#b42318`, `#475467` | Status text and icons |
| `*-soft` | `#e8f0fb`, `#fff4e0`, `#e8f5ee`, `#fdecea`, `#f0f2f4` | Status backgrounds |
| `*-edge` | `#afc9eb`, `#ebcb8b`, `#a7d8be`, `#f4b4ae`, `#d0d5dd` | Decorative badge edges (text, not the edge, carries meaning) |
| `danger-hover` | `#912018` | Destructive button hover |
| `cal-blue`, `cal-green`, `cal-amber`, `cal-purple`, `cal-rose`, `cal-teal`, `cal-orange`, `cal-slate` | `#1d4f91`, `#1b6b3f`, `#8a5300`, `#6b3fa0`, `#b0214f`, `#0f6b6b`, `#a8400a`, `#3f4f5e` | Technician calendar colours: the dot, the left edge and the text of a block |
| `cal-*-soft` | `#e6eefa`, `#e6f4ec`, `#fdf1d8`, `#f1e9fa`, `#fde8ee`, `#dff3f2`, `#fde9dc`, `#e9edf1` | The fill behind a calendar block |

**Technician calendar colours.** A technician has a colour so their jobs can be told apart on the calendar. The palette is `TECHNICIAN_COLORS` in `@fixflow/shared` (blue, green, amber, purple, rose, teal, orange, slate), stored as a key, never a colour value. Each key has two tokens, `cal-<key>` and `cal-<key>-soft`, used together as a **soft fill with the strong colour for the text and the left edge** (the same idea as a status badge), and `features/admin/lib/technician-colors.ts` writes out the classes in full so Tailwind finds them. The colour is never the only way to tell people apart: a name always sits beside it, and the colour picker shows each colour's name. Three promises are tested for every key: the colour on its fill, ink on the fill, and the colour on white (all 4.5:1, see below). A palette key without tokens fails `tokens.test.ts`, and one without classes does not compile.

The shadcn/ui names (`background`, `foreground`, `card`, `popover`, `primary`, `secondary`, `muted`, `destructive`, `input`, `ring`…) are aliases of these tokens.

**Adjusted from the starting proposal.** Success text was `#1e7f4f` (4.45:1 on its tint, a fail) and is now `#1b7646` (5.03:1). Muted text was `#66757f` (4.43:1 on the page background, a fail) and is now `#5e6d77` (4.98:1). `border-strong` and `danger-hover` are additions.

**Rules.** Text is `ink`, `ink-secondary` or `ink-muted`, never lighter. Links are `brand`. Status text uses the tone colour on its `-soft` tint or on `surface`. Dark surfaces set `data-surface="dark"`, which switches the focus ring to `focus-on-dark`. There is no dark mode.

### Measured contrast (WCAG 2.2 AA)

Computed by `contrastRatio()` from the hex values in `globals.css`. Body text needs 4.5:1; large text, icons, focus rings and control boundaries need 3:1. Every row below passes, and the test suite asserts it.

| Use | Foreground | Background | Ratio | Needs | Result |
|---|---|---|---|---|---|
| Body text on the page | `ink` #0f1b22 | `page` #f6f7f6 | 16.29:1 | 4.5:1 | Pass |
| Body text on cards and tables | `ink` #0f1b22 | `surface` #ffffff | 17.50:1 | 4.5:1 | Pass |
| Body text on table headers and zebra rows | `ink` #0f1b22 | `surface-muted` #eef1f0 | 15.39:1 | 4.5:1 | Pass |
| Secondary text on the page | `ink-secondary` #4a5a64 | `page` #f6f7f6 | 6.66:1 | 4.5:1 | Pass |
| Secondary text on cards | `ink-secondary` #4a5a64 | `surface` #ffffff | 7.15:1 | 4.5:1 | Pass |
| Secondary text on muted surfaces | `ink-secondary` #4a5a64 | `surface-muted` #eef1f0 | 6.29:1 | 4.5:1 | Pass |
| Metadata and placeholders on the page | `ink-muted` #5e6d77 | `page` #f6f7f6 | 4.98:1 | 4.5:1 | Pass |
| Metadata and placeholders on cards | `ink-muted` #5e6d77 | `surface` #ffffff | 5.34:1 | 4.5:1 | Pass |
| Metadata on muted surfaces | `ink-muted` #5e6d77 | `surface-muted` #eef1f0 | 4.70:1 | 4.5:1 | Pass |
| Primary button label | `surface` #ffffff | `brand` #14505e | 8.98:1 | 4.5:1 | Pass |
| Primary button label on hover | `surface` #ffffff | `brand-hover` #0f3e4a | 11.61:1 | 4.5:1 | Pass |
| Links and secondary-button labels on cards | `brand` #14505e | `surface` #ffffff | 8.98:1 | 4.5:1 | Pass |
| Links on the page | `brand` #14505e | `page` #f6f7f6 | 8.36:1 | 4.5:1 | Pass |
| Selected or secondary-button label | `brand` #14505e | `brand-soft` #e4eff1 | 7.66:1 | 4.5:1 | Pass |
| Secondary-button label on hover | `brand` #14505e | `surface-muted` #eef1f0 | 7.90:1 | 4.5:1 | Pass |
| Teal text and icons on cards | `accent` #0f766e | `surface` #ffffff | 5.47:1 | 4.5:1 | Pass |
| Teal text and icons on the page | `accent` #0f766e | `page` #f6f7f6 | 5.10:1 | 4.5:1 | Pass |
| Teal emphasis on its soft tint | `accent` #0f766e | `accent-soft` #e2f3f0 | 4.77:1 | 4.5:1 | Pass |
| Label on a bright teal fill | `ink` #0f1b22 | `accent-fill` #14b8a6 | 7.03:1 | 4.5:1 | Pass |
| Deep navy label on a bright teal fill | `brand-deep` #0b2e38 | `accent-fill` #14b8a6 | 5.77:1 | 4.5:1 | Pass |
| Navigation label on the sidebar | `nav-text` #c7dadf | `brand-deep` #0b2e38 | 9.93:1 | 4.5:1 | Pass |
| Brand name and headings on the sidebar | `surface` #ffffff | `brand-deep` #0b2e38 | 14.36:1 | 4.5:1 | Pass |
| Navigation group heading | `nav-muted` #93afb7 | `brand-deep` #0b2e38 | 6.19:1 | 4.5:1 | Pass |
| Navigation label while hovered | `nav-text` #c7dadf | `nav-hover` #123b47 | 8.34:1 | 4.5:1 | Pass |
| Active navigation label | `surface` #ffffff | `nav-active` #14505e | 8.98:1 | 4.5:1 | Pass |
| Success badge | `success` #1b7646 | `success-soft` #e8f5ee | 5.03:1 | 4.5:1 | Pass |
| Attention badge | `attention` #9a5b00 | `attention-soft` #fff4e0 | 4.98:1 | 4.5:1 | Pass |
| Danger badge and error message tint | `danger` #b42318 | `danger-soft` #fdecea | 5.75:1 | 4.5:1 | Pass |
| Info badge | `info` #1d5fa8 | `info-soft` #e8f0fb | 5.62:1 | 4.5:1 | Pass |
| Neutral badge | `neutral` #475467 | `neutral-soft` #f0f2f4 | 6.85:1 | 4.5:1 | Pass |
| Success text and icons on cards | `success` #1b7646 | `surface` #ffffff | 5.64:1 | 4.5:1 | Pass |
| Attention text and icons on cards | `attention` #9a5b00 | `surface` #ffffff | 5.43:1 | 4.5:1 | Pass |
| Error text and icons on cards | `danger` #b42318 | `surface` #ffffff | 6.57:1 | 4.5:1 | Pass |
| Info text and icons on cards | `info` #1d5fa8 | `surface` #ffffff | 6.45:1 | 4.5:1 | Pass |
| Neutral text and icons on cards | `neutral` #475467 | `surface` #ffffff | 7.69:1 | 4.5:1 | Pass |
| Destructive button label | `surface` #ffffff | `danger` #b42318 | 6.57:1 | 4.5:1 | Pass |
| Destructive button label on hover | `surface` #ffffff | `danger-hover` #912018 | 8.66:1 | 4.5:1 | Pass |
| Calendar block text, blue | `cal-blue` #1d4f91 | `cal-blue-soft` #e6eefa | 6.97:1 | 4.5:1 | Pass |
| Body text on a blue calendar block | `ink` #0f1b22 | `cal-blue-soft` #e6eefa | 14.98:1 | 4.5:1 | Pass |
| Technician blue name or dot on cards | `cal-blue` #1d4f91 | `surface` #ffffff | 8.14:1 | 4.5:1 | Pass |
| Calendar block text, green | `cal-green` #1b6b3f | `cal-green-soft` #e6f4ec | 5.75:1 | 4.5:1 | Pass |
| Body text on a green calendar block | `ink` #0f1b22 | `cal-green-soft` #e6f4ec | 15.43:1 | 4.5:1 | Pass |
| Technician green name or dot on cards | `cal-green` #1b6b3f | `surface` #ffffff | 6.52:1 | 4.5:1 | Pass |
| Calendar block text, amber | `cal-amber` #8a5300 | `cal-amber-soft` #fdf1d8 | 5.65:1 | 4.5:1 | Pass |
| Body text on a amber calendar block | `ink` #0f1b22 | `cal-amber-soft` #fdf1d8 | 15.62:1 | 4.5:1 | Pass |
| Technician amber name or dot on cards | `cal-amber` #8a5300 | `surface` #ffffff | 6.33:1 | 4.5:1 | Pass |
| Calendar block text, purple | `cal-purple` #6b3fa0 | `cal-purple-soft` #f1e9fa | 6.25:1 | 4.5:1 | Pass |
| Body text on a purple calendar block | `ink` #0f1b22 | `cal-purple-soft` #f1e9fa | 14.81:1 | 4.5:1 | Pass |
| Technician purple name or dot on cards | `cal-purple` #6b3fa0 | `surface` #ffffff | 7.38:1 | 4.5:1 | Pass |
| Calendar block text, rose | `cal-rose` #b0214f | `cal-rose-soft` #fde8ee | 5.65:1 | 4.5:1 | Pass |
| Body text on a rose calendar block | `ink` #0f1b22 | `cal-rose-soft` #fde8ee | 14.96:1 | 4.5:1 | Pass |
| Technician rose name or dot on cards | `cal-rose` #b0214f | `surface` #ffffff | 6.61:1 | 4.5:1 | Pass |
| Calendar block text, teal | `cal-teal` #0f6b6b | `cal-teal-soft` #dff3f2 | 5.47:1 | 4.5:1 | Pass |
| Body text on a teal calendar block | `ink` #0f1b22 | `cal-teal-soft` #dff3f2 | 15.20:1 | 4.5:1 | Pass |
| Technician teal name or dot on cards | `cal-teal` #0f6b6b | `surface` #ffffff | 6.30:1 | 4.5:1 | Pass |
| Calendar block text, orange | `cal-orange` #a8400a | `cal-orange-soft` #fde9dc | 5.25:1 | 4.5:1 | Pass |
| Body text on a orange calendar block | `ink` #0f1b22 | `cal-orange-soft` #fde9dc | 14.89:1 | 4.5:1 | Pass |
| Technician orange name or dot on cards | `cal-orange` #a8400a | `surface` #ffffff | 6.17:1 | 4.5:1 | Pass |
| Calendar block text, slate | `cal-slate` #3f4f5e | `cal-slate-soft` #e9edf1 | 7.16:1 | 4.5:1 | Pass |
| Body text on a slate calendar block | `ink` #0f1b22 | `cal-slate-soft` #e9edf1 | 14.87:1 | 4.5:1 | Pass |
| Technician slate name or dot on cards | `cal-slate` #3f4f5e | `surface` #ffffff | 8.43:1 | 4.5:1 | Pass |
| Form control boundary on cards | `border-strong` #7a8993 | `surface` #ffffff | 3.60:1 | 3:1 | Pass |
| Form control boundary on the page | `border-strong` #7a8993 | `page` #f6f7f6 | 3.36:1 | 3:1 | Pass |
| Focus ring on cards | `focus` #0f766e | `surface` #ffffff | 5.47:1 | 3:1 | Pass |
| Focus ring on the page | `focus` #0f766e | `page` #f6f7f6 | 5.10:1 | 3:1 | Pass |
| Focus ring on selected rows | `focus` #0f766e | `brand-soft` #e4eff1 | 4.67:1 | 3:1 | Pass |
| Focus ring on the sidebar | `focus-on-dark` #5eead4 | `brand-deep` #0b2e38 | 9.71:1 | 3:1 | Pass |
| Focus ring on a hovered sidebar item | `focus-on-dark` #5eead4 | `nav-hover` #123b47 | 8.15:1 | 3:1 | Pass |
| Active-item marker on the sidebar | `accent-fill` #14b8a6 | `brand-deep` #0b2e38 | 5.77:1 | 3:1 | Pass |

Decorative colours (`border`, `*-edge`) carry no meaning on their own and are exempt.

## 4. Typography

| Role | Family | Notes |
|---|---|---|
| Interface and all numbers | **Inter** (variable, 100–900) | Tabular numerals (`tabular-nums`) for money, references, dates in tables and counters |
| Page titles, dialog titles, the wordmark, marketing headlines | **Bricolage Grotesque** (variable, 200–800) | Gives the product a voice that Inter alone would not; used at 20 px and above only |

Both are self-hosted woff2 files in `apps/web/src/app/fonts/` (SIL Open Font License; licences alongside), loaded with `next/font/local`, so there is no font request at build time or in the browser. Latin subset only.

| Class | Size / line height | Use |
|---|---|---|
| `text-5xl` | 52 / 60 px, −0.025em | Marketing hero (`font-display font-semibold`) |
| `text-4xl` | 40 / 48 px, −0.02em | Section headline, sign-in panel |
| `text-3xl` | 30 / 38 px, −0.01em | Page title from `sm` up; statistic values |
| `text-2xl` | 24 / 32 px | Page title on phones; section heading |
| `text-xl` | 20 / 28 px | Dialog title |
| `text-lg` | 18 / 28 px | Card title; lead paragraph |
| `text-base` | 16 / 24 px | Body text; form controls on phones (avoids iOS zoom) |
| `text-sm` | 14 / 20 px | Tables, form controls from `sm`, helper text, buttons |
| `text-xs` | 12 / 16 px | Badges, metadata, counters |

Weights: 400 body, 500 labels and buttons, 600 headings and table headers, 700 the wordmark. One `h1` per page (`PageHeader` renders it). Line length for reading text is capped near 65 characters (`max-w-2xl`/`max-w-3xl`).

## 5. Spacing, radii, elevation, borders, icons, motion

**Spacing** is a 4 px scale (Tailwind's default step). Common steps: 4 (`1`), 8 (`2`), 12 (`3`), 16 (`4`), 24 (`6`), 32 (`8`), 48 (`12`), 64 (`16`). Cards pad 20 px on phones and 24 px from `sm`; page gutters are 16 / 24 / 32 px at base / `sm` / `lg`; stacked sections use `gap-6`.

**Radii:** `sm` 4 (inline links), `md` 6 (tooltips), `lg` 8 (buttons, inputs), `xl` 12 (cards, menus), `2xl` 16 (dialogs), `full` (badges, avatars).

**Elevation.** Cards, tables and filter bars are flat with a 1 px `border` (cards add `shadow-sm`). Only floating things lift: menus, popovers and tooltips `shadow-md`; dialogs, drawers and toasts `shadow-lg`. Shadows are tinted with the navy so they never look grey and dirty.

**Borders.** `border` for decoration and dividers; `border-strong` (3.6:1 on white) for anything a person must find to use: inputs, selects, checkboxes, outline buttons. An invalid control swaps its border for `danger` and adds an icon and text.

**Icons.** Lucide, 16 px (inline with text and in buttons), 20 px (navigation), 24 px (empty and error states), default 2 px stroke, `aria-hidden` and always next to a text label or inside a control that has an accessible name. Never an icon alone.

**Motion.** 150 ms for hover and focus colour changes, 200 ms for overlays (dialog, drawer), `cubic-bezier(0.2, 0, 0, 1)`. Overlays fade and scale slightly or slide in. Spinners and skeleton pulses stop under `prefers-reduced-motion`, and a global rule shortens every animation and transition to near zero in that mode.

## 6. Breakpoints and layouts

Tailwind's breakpoints are used unchanged. Screens are verified at **360, 768, 1024 and 1440 px**.

| Width | Means |
|---|---|
| 360 (base) | Phone. Single column, cards instead of tables, drawer navigation, 44 px primary controls |
| 640 `sm` | Buttons and inputs drop to 40 px; two-column forms; description lists put terms beside values |
| 768 `md` | Tablet. Data tables appear. The public site still uses its menu (its links come inline at 1024) |
| 1024 `lg` | Admin sidebar appears (drawer below); portal top navigation goes inline; two- and three-column detail layouts |
| 1280 / 1440 | Content stops growing: marketing `max-w-7xl` (1280), admin content `max-w-7xl`, portal `max-w-5xl` (1024) |

| Experience | Layout |
|---|---|
| **Marketing** (`PublicLayout`) | White header (64 px) with business identity, inline links from `lg` (a menu below it), primary call to action. Full-bleed bands alternating white and `page`, content in `max-w-7xl`, generous vertical rhythm (`py-12`/`lg:py-16`). Deep-navy footer with contact, service area, "Powered by FixFlow" and the demo notice. |
| **Auth** (`AuthLayout`) | Centred 448 px form card on `page`; from `lg` a left brand panel (`brand-deep` to `brand` gradient) with the logo, one headline and three product facts. |
| **Admin** (`AdminShell`) | 256 px deep-navy sidebar from `lg` with grouped navigation and the signed-in user; 64 px top bar with context, notifications and user menu; dense but readable content in `max-w-7xl` with `gap-6`; below `lg` the sidebar is a drawer opened from the top bar. |
| **Portal** (`PortalShell`) | 64 px light top bar, navigation inline from `lg` and a drawer below; one comfortable column of cards (`max-w-5xl`). Deliberately calmer than the admin: customers come to check on one job. |

Z-order: sticky headers `z-30`, overlays and drawers `z-50`. Toasts are managed by `sonner`.

## 7. Navigation and shells

Navigation lives in one typed config, [`apps/web/src/config/navigation.ts`](../apps/web/src/config/navigation.ts): `NAVIGATION.public`, `NAVIGATION.admin` (groups) and `NAVIGATION.portal`, plus `navigationForRole(role)`. **It lists only routes that exist**, so no link is ever dead; a route is added to it in the same change that builds the screen. `navigation.test.ts` fails if an admin path appears in the portal list (customers never see admin links; the server still enforces access), if a path repeats, is not an absolute app path, or uses an unknown icon.

Add an entry as `{ label, href, icon, match? }` where `icon` is a key of `NAV_ICON_NAMES` (add new keys to `lib/navigation.ts` and `components/layout/nav-icons.ts` together; the registry type makes a missing icon a compile error) and `match` is `"prefix"` (default: stays highlighted on child pages) or `"exact"` (index pages).

Shells take their navigation from the config by default; `/styleguide/shells/*` passes example items. Reading the current URL (to highlight the page) happens in `NavList`, behind a `<Suspense>` boundary whose fallback is the same list without a highlight: with Cache Components the shell around it can be prerendered and the links are never missing. Every shell's main landmark is `<main id="main-content" tabIndex={-1}>`, the target of the skip link in the root layout.

| Shell | Slots (all optional) |
|---|---|
| `PublicLayout` | `identity` (business name and logo), `homeHref`, `navItems`, `navInlineFrom` (`md` or `lg`), `account` (the session link, always in the header), `cta`, `banner`, `footer`, `demoNotice` |
| `AuthLayout` | `title`, `description`, `homeHref`, `banner`, `footer` (children are the form, wrapped in a card) |
| `AdminShell` | `navigation`, `homeHref`, `context`, `notifications`, `userMenu`, `sidebarFooter`, `banner` |
| `PortalShell` | `navigation`, `homeHref`, `notifications`, `userMenu`, `banner` |

## 8. Status mapping

One mapping gives every status a **label**, a **tone**, an **icon** and a one-sentence **description** that says what it means and what happens next. `StatusBadge` renders it; pages read `getStatusMeta(kind, status).description` for the customer explanation. The same word can mean different things on different records (Accepted on a request or a quotation), so a badge is always given the record `kind`.

**Tone rules.** `info`: new, queued or waiting on someone. `attention`: someone needs to act, or a decision is pending. `success`: a positive outcome. `danger`: a problem or an overdue balance. `neutral`: closed, terminal, draft or void.

The tables below cover every value of every status enum in `@fixflow/shared` (39 values), including the four derived display states the shared package defines (`PaymentRecordState`, `NotificationReadState`, `ServiceCatalogueState`, `TechnicianState`). They are generated from the code; `status.test.ts` and `status-badge.test.tsx` iterate every value and assert a label, a tone and an icon.


#### Service request (`kind="request"`, `ServiceRequestStatus`)

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `SUBMITTED` | Submitted | info | `inbox` | We've received your request. A team member will review it soon. |
| `UNDER_REVIEW` | Under review | info | `clipboard-list` | We're reviewing the details and preparing your quotation. |
| `QUOTED` | Quoted | attention | `file-text` | A quotation is ready for you to review and answer. |
| `ACCEPTED` | Accepted | success | `circle-check` | You accepted the quotation. We'll schedule the job next. |
| `DECLINED` | Declined | neutral | `circle-x` | You declined the quotation, so no work will be scheduled. |
| `CONVERTED_TO_JOB` | Converted to job | success | `briefcase` | Your job has been created. Follow its progress under Jobs. |
| `CANCELLED` | Cancelled | neutral | `ban` | This request was cancelled, so no work will be carried out. |

#### Quotation (`kind="quotation"`, `QuotationStatus`)

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `DRAFT` | Draft | neutral | `file-pen` | Still being prepared. Customers can't see it yet. |
| `SENT` | Sent | attention | `send` | Waiting for your decision. Accept or decline it before it expires. |
| `ACCEPTED` | Accepted | success | `circle-check` | Accepted. The job will be scheduled next. |
| `DECLINED` | Declined | neutral | `circle-x` | Declined, so no work will be scheduled from this quotation. |
| `EXPIRED` | Expired | neutral | `timer-off` | No longer available because its validity date has passed. |
| `VOID` | Void | neutral | `ban` | Withdrawn by the business. A replacement quotation may follow. |

#### Work order / job (`kind="workOrder"`, `WorkOrderStatus`)

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `PENDING_SCHEDULING` | Pending scheduling | attention | `calendar-clock` | The quotation was accepted. We'll confirm a date and time soon. |
| `SCHEDULED` | Scheduled | info | `calendar-check` | Your appointment is confirmed for the date and time shown. |
| `IN_PROGRESS` | In progress | info | `wrench` | The work has started. |
| `COMPLETED` | Completed | success | `circle-check` | The work is finished. An invoice will follow. |
| `CANCELLED` | Cancelled | neutral | `ban` | This job was cancelled, so no work will be carried out. |
| `NEEDS_RESCHEDULING` | Needs rescheduling | attention | `calendar-x` | We need to agree a new time for your appointment and will be in touch. |

#### Invoice (`kind="invoice"`, `InvoiceStatus`)

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `DRAFT` | Draft | neutral | `file-pen` | Still being prepared. Customers can't see it yet. |
| `ISSUED` | Issued | info | `receipt` | Payment is due by the due date shown. |
| `PARTIALLY_PAID` | Partially paid | attention | `circle-dashed` | Part of the payment has been recorded. The remaining balance is still due. |
| `PAID` | Paid | success | `circle-check` | Paid in full. Thank you. |
| `OVERDUE` | Overdue | danger | `triangle-alert` | The due date has passed and a balance remains. Please arrange payment. |
| `VOID` | Void | neutral | `ban` | Cancelled by the business, so there is nothing to pay. |

#### Payment record (`kind="payment"`, `PaymentRecordState`, derived from `voidedAt`)

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `RECORDED` | Recorded | success | `banknote` | The business recorded this payment against the invoice. |
| `VOID` | Voided | neutral | `ban` | Corrected: this payment record was voided and no longer counts towards the balance. |

#### Notification (`kind="notification"`, `NotificationReadState`, derived from `readAt`)

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `UNREAD` | New | info | `bell-dot` | You haven't opened this notification yet. |
| `READ` | Read | neutral | `check` | You've already opened this notification. |

#### Email delivery, staff only (`kind="emailDelivery"`, `EmailDeliveryStatus`)

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `PENDING` | Queued | info | `clock` | Waiting to be sent. |
| `SENT` | Sent | success | `mail-check` | Handed to the mail server. Arrival in the inbox isn't confirmed. |
| `LOGGED` | Logged only | neutral | `scroll-text` | Written to the server log; no email was sent. |
| `FAILED` | Failed | danger | `mail-x` | Sending failed. The action it belongs to was not affected. |
| `SKIPPED` | Skipped | neutral | `circle-minus` | Not sent, for example because the address is reserved for demo use. |

#### Service in the catalogue, staff only (`kind="service"`, `ServiceCatalogueState`)

A service has no status column: it is derived from `isPublished` and `archivedAt`, like the payment and notification states. An archived service is never published, so the three are exclusive.

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `PUBLISHED` | Published | success | `circle-check` | Shown on the website and open to new requests. |
| `UNPUBLISHED` | Unpublished | neutral | `file-pen` | Not on the website yet, so customers can't see or request it. |
| `ARCHIVED` | Archived | neutral | `archive` | Hidden from the website and closed to new requests. It can be restored. |

#### Technician, staff only (`kind="technician"`, `TechnicianState`)

A technician has one flag, `isActive`; the state is its name in words. Deactivating never touches the jobs already assigned, which the description says.

| Value | Label | Tone | Icon (Lucide) | What it means |
|---|---|---|---|---|
| `ACTIVE` | Active | success | `circle-check` | Can be given new jobs. |
| `INACTIVE` | Inactive | neutral | `circle-minus` | Not offered for new jobs. Jobs already assigned stay with them. |


A status the web app does not know yet (the API gained one first) still renders as a neutral badge with a readable label, rather than crashing or showing nothing.

## 9. Components

Import from the file, not a barrel. "Client" components carry `"use client"`; the rest work in Server Components. Props are small and typed; compose rather than add options.

**Primitives** (`src/components/ui`)

| Component | Notes |
|---|---|
| `Button`, `buttonVariants` | Client. Variants `primary` `secondary` `outline` `ghost` `destructive` `link`; sizes `sm` 36, `md` 44→40, `lg` 48 px; `asChild` for links. `loading` shows a spinner, sets `aria-busy` and `aria-disabled` (the button stays focusable), ignores clicks and Enter so a submit cannot run twice, and announces `loadingText` through a live region. Class helper `buttonVariants` lives in `button-variants.ts` for server code. |
| `IconButton` | A button with an icon and a **required** `label` (accessible name, also a tooltip). |
| `Input`, `Textarea`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `DateInput`, `TimeInput`, `Label` | `Textarea` has an optional character counter (`showCount` with `maxLength`). `Select` is a styled **native** select; `DateInput`/`TimeInput` are the browser's date and time controls with `YYYY-MM-DD` / `HH:mm` values. `Checkbox`, `RadioGroup`, `Switch` are Radix. |
| `Card` (+ `CardHeader` `CardTitle` `CardDescription` `CardContent` `CardFooter`) | `CardTitle` takes `as` to set the heading level. |
| `Badge`, `StatusBadge` | `Badge` is a generic labelled chip (`tone`); `StatusBadge` takes `kind` and `status` (§8). |
| `MoneyText`, `DateTimeText`, `ReferenceText` | Format only through `lib/formatting` (§10). `DateTimeText` renders `<time>` with the zone in its tooltip. |
| `DescriptionList`, `DescriptionItem` | Key/value details; terms beside values from `sm`. |
| `Avatar`, `Logo`, `LogoMark` | `Avatar` shows initials, `decorative` when a name is written beside it. |
| `Tabs`, `Dialog`, `Sheet`, `DropdownMenu`, `Popover`, `Tooltip` | Radix. Dialog and Sheet need a title. Focus moves in, is trapped and returns to the trigger; Escape closes. |
| `ConfirmDialog` | Alert dialog: `title`, `consequence` (required), `confirmLabel`, `destructive`, optional `reason` `{ label, minLength }`. Confirm stays disabled until the trimmed reason is long enough; while the async `onConfirm` is pending both buttons and Escape are blocked; a failure keeps the dialog open and shows the error; focus returns to the opener. |
| `Toaster`, `toast` | `sonner`, mounted once in the root layout. |
| `Skeleton`, `TableSkeleton`, `CardSkeleton`, `DetailSkeleton` | Announce what is loading; blocks are `aria-hidden`. |
| `EmptyState`, `ErrorState`, `PermissionDenied` | Icon, title, guidance, optional action. `ErrorState` retries with `onRetry` (client contexts, for example `error.tsx`) or `retryHref` (server pages) and shows the API `requestId`. |
| `PageHeader`, `Breadcrumbs` | One `h1`; breadcrumbs, status, meta line, description and actions. |
| `Pagination`, `FilterBar`, `FilterBarField` | Server components driven by `searchParams` (§11). |
| `DataTable`, `ScrollRegion` | Table above the breakpoint, cards below (§11). |
| `Timeline`, `StatCard` | History list; KPI with label, value, context and optional link. |
| `DocumentLines`, `DocumentTotals` | Quotation and invoice lines (a table from `sm`, stacked lines on phones) and totals. All amounts are the server's strings. |
| `Spinner` | Decorative; pair it with text. |

**Forms** (`src/components/forms`)

| Component | Notes |
|---|---|
| `Field` / `FieldGroup` | Label (or fieldset and legend), help text, control, inline error. Wires `label[for]`↔`id`, `aria-describedby` (help and error), `aria-invalid`, `aria-required`; the error slot is a polite live region. `layout="inline"` puts a checkbox or switch before its label. |
| `FormField` / `FormFieldGroup` | The same, connected to React Hook Form: `{(field) => <Input {...field} />}` receives `name`, `value`, `onChange`, `onBlur`, `ref` and the ARIA props. |
| `FormErrorSummary` | Lists every problem with links to the fields; takes focus after a failed submit. Create the form with `shouldFocusError: false`. |
| `applyApiFieldErrors`, `collectFormErrors`, `getFieldId` | Put the API's `fieldErrors` onto the form (`_` becomes `root.server`); flatten the error tree; stable control ids from field names. |

**Layout** (`src/components/layout`): `PublicLayout`, `AuthLayout`, `AdminShell`, `PortalShell`, `MobileNav` (drawer), `PublicNav` (disclosure), `NavList`/`NavItems`, `SkipLink`.

## 10. Formatting

All in `src/lib/formatting`, all pure, none reading the clock or the browser's locale or time zone.

| Function | Example |
|---|---|
| `formatMoney("1284.50", "USD")` | `$1,284.50`; `"-12.5"` → `-$12.50`; `"-0.00"` → `$0.00`; the string is read as an exact decimal by `Intl.NumberFormat`, so `"9007199254740993.10"` and `"1.005"` (→ `$1.01`) are exact. Throws on a malformed amount rather than show a wrong one. |
| `formatDate(iso, tz)` | `Oct 28, 2026`; an instant is shown on its calendar day in the **business** zone; a date-only `2026-11-11` is shown as written |
| `formatDateTime(iso, tz)` / `formatTime(iso, tz)` | `Oct 28, 2026, 3:30 PM` / `3:30 PM` |
| `formatTimeRange(start, end, tz)` | `9:00 – 11:00 AM`, `11:00 AM – 1:00 PM`, `Oct 28, 11:00 PM – Oct 29, 1:00 AM` |
| `formatRelative(iso, now, tz)` | `12 minutes ago`, `in 3 hours`, `Yesterday at 9:00 AM`, `in 4 days`, then the date. Calendar days are counted in the business zone; `now` is a parameter. |
| `formatTimeZoneName(iso, tz)` | `EDT` / `EST` for that date (daylight saving aware) |
| `formatReference(ref)` / `referenceType(ref)` | Normalises `ff-2026-00125` → `FF-2026-00125`; maps the prefix to a `ReferenceType` |
| `getStatusMeta(kind, status)` / `statusLabel(...)` | §8 |

Never call `toFixed`, `toLocaleString` or `new Date().toLocaleDateString` for business values. The business time zone and currency come from the settings and are passed in. Dates are implemented on `Intl.DateTimeFormat#formatToParts` with the text assembled by hand.

## 11. Patterns

**Forms.** One column on phones, two from `sm` where fields are short and related. Every control sits in a `Field`: visible label above (never placeholder-only), optional help text under the label, error under the control with an icon and text, required marked with an asterisk (and a "* Required field" note at the end). Errors appear on blur (`mode: "onTouched"`) and on submit; what the person typed is kept. Forms with more than a handful of fields or repeating rows add `FormErrorSummary` at the top. The submit button is `loading` while the request is pending. Server `fieldErrors` go through `applyApiFieldErrors`. Inline success is a polite status message; the toast confirms too, but only after the server did.

**Lists: filter bar, table, pagination.** Filters, search, sort and page live in the URL (`searchParams`), so a state can be bookmarked and reloaded and the list is a Server Component. `FilterBar` is a plain `GET` form (it works before JavaScript loads and drops `page`); `buildHref(basePath, searchParams, patch)` builds every sort, page and filter link so other parameters are kept; page 1 has no `page` parameter. Reading `searchParams` is request-time data, so list pages wrap the list in `<Suspense fallback={<TableSkeleton />}>`. An empty result shows `EmptyState` with "Clear filters".

**Tables to cards.** `DataTable` renders a real `<table>` (caption, `scope="col"` headers, `aria-sort`, right-aligned tabular numbers, header sort links) from `md` (768 px), or `lg` for wide tables, and the same rows as stacked cards below. The primary column holds the one real link to the record; its `::after` stretches over the row or card, so a screen reader hears one link per row and a mouse can click anywhere on it. Interactive elements inside a row (a menu, a button) need `relative z-10`. The table wrapper is a focusable, named `ScrollRegion` so a table that does overflow can be scrolled with the keyboard.

**Empty, loading, error, permission.** Loading uses skeletons shaped like the content, with a live region that says what is loading. Empty states say why and offer the next step. Errors say what happened, offer retry and show the request id for support. A 403 shows `PermissionDenied` with a way back; a record that exists but belongs to someone else is a 404 (the API never says that a record exists but is not yours).

**Confirmation dialogs.** Anything destructive or irreversible (void, cancel, decline, accept, send) uses `ConfirmDialog`: the title names the action, the consequence says what changes and what cannot be undone, the confirm button repeats the action's name, destructive actions are red, and cancel/void/correct actions ask for a reason that becomes part of the history. Cancel is the safe default focus when there is no reason field.

**Toasts.** Short, specific, after server confirmation; bottom right, at most three visible. A message the person must act on belongs inline, not only in a toast.

**Timelines.** `Timeline` lists events newest first on activity feeds, oldest first on a record's life cycle, with the actor and business-time stamp. Customer timelines are built from customer-safe events only.

**Document views (quotation, invoice).** A card with the business identity and address on the left and the customer on the right, `DocumentLines`, `DocumentTotals` right-aligned (subtotal, tax with rate, total; on invoices also payments recorded and balance due), terms or payment instructions in a muted panel. Phones stack the lines. Print styling is described under Invoices below.

**Detail pages.** `PageHeader` (breadcrumbs, title, status badge, reference and dates on the meta line, then actions with the single most likely next step first), then a two-thirds / one-third grid from `lg`: details, notes and history on the left; customer and side facts on the right. The server decides which actions exist (`availableActions`); render only those.

**Dashboards.** Four or five `StatCard`s (each linking to the list behind it), then "Needs attention" with direct actions, then upcoming work and recent activity.

## 12. Accessibility rules

- Semantic landmarks: one `header`, `nav` (named when there are several), `main#main-content`, `footer`; one `h1`; headings in order.
- A skip link is the first tab stop on every page.
- Every interactive element has a visible focus ring (2 px `focus`, 2 px offset; `focus-on-dark` inside `data-surface="dark"`).
- Every control has a programmatic label; icon-only controls use `IconButton` with a `label`; decorative icons are `aria-hidden`.
- Colour is never the only signal: status = text + icon + colour; errors = icon + text + red border; required = asterisk and `aria-required`.
- Touch targets are at least 24 px (checkboxes and radios have a 24 px hit area); primary phone actions are 44 px.
- Dialogs and drawers trap focus, close on Escape and return focus to the control that opened them (`ConfirmDialog` remembers its opener itself, because Radix only restores focus to a `Trigger`).
- A pending action keeps focus (`aria-disabled`, not `disabled`) and announces itself; an error summary takes focus after a failed submit.
- A scrollable region is focusable and named.
- Motion respects `prefers-reduced-motion`.
- axe (`@axe-core/playwright`, WCAG 2.0/2.1/2.2 A and AA tags) must report no serious or critical violation on every new key screen; `e2e/tests/styleguide.spec.ts` runs it on the styleguide and every shell example.

## 13. Screen blueprints

Text wireframes: content hierarchy and the primary action. `[Primary]` is the one primary button; `(status)` is a `StatusBadge`. The phone adaptation follows each. Widths: 360 phone, 768 tablet, 1024+ desktop.

### Public website

**Homepage** (`/`)
```
Header: [business logo + name]   Services  How it works        [Request service]
Hero:  chip: categories
       H1  Home repairs and servicing, done properly the first time.
       lead paragraph (what you get)
       [Browse services →]  [See how it works]      "Quotation first. Nothing starts until you say yes."
       right: card "Follow every step": request (Submitted) · quotation (Sent) · appointment (Scheduled) · invoice (Paid)
Band (page): H2 What we can help with        All services →
       3 service cards: category chip, name, one line, "From $129.00" or "Request a quote"
Band (white): H2 How it works   4 numbered steps with icons
Band (page):  H2 What you can expect   3 promises with a teal rule
Band (brand): H2 Ready when you are                                   [Browse services]
Footer (navy): business · contact · service area  |  Powered by FixFlow · demo notice
```
**As built:** Hero (the example card is labelled "Example"/"Sample data") → "What we can help with" (3 cards and "All services") → How it works (4 numbered steps) → "What you can expect" (3 promises, teal rule) → FAQ (native `<details>`, 6 questions, 7 in the demo) → "Where we work and how to reach us" (two cards, `#contact`) → brand "Ready when you are" band → navy footer. The header is Home · Services · How it works · Contact, then "Sign in"/"My account"/"Dashboard" and "Request a service"; the demo banner sits above it in demo mode. Services list: breadcrumbs, H1, category chips (links with `aria-current`), a grid of equal-height cards. Service page: breadcrumbs, category badge, H1, a wide picture tile, "About this service", "What's included" (check list), a pricing card (not sticky below `lg`) and "Other services you may need".

Phone: header shows the identity (the name wraps onto two lines), a menu button (disclosure panel with the links and the call to action) and the account link; hero stacks, the status card moves under the buttons; service cards and steps stack one per row; the CTA band stacks with a full-width button.

**Services list** (`/services`)
```
H1 Our services + one-sentence description
(optional later: category filter chips)
grid 3 → 2 → 1 : card [category chip / name (whole card links) / short description / ⏱ duration / "From $X" | "Request a quote"]
```

**Service detail** (`/services/[slug]`)
```
Breadcrumbs: Services › AC Routine Maintenance
H1 name · short description · category chip
Left (2/3): H2 What this covers (paragraph) · H2 What's included (checked list)
Right (1/3, sticky): card: "From $129.00" or "Request a quote" · note · ⏱ duration · [Request this service]
```
Phone: the price card comes after the content and the button is full width.

**Request a service** (`/request-service`)
```
AuthLayout-free page inside PublicLayout. H1 Request a service
1 Service (select, preselected from the service page)
2 Describe the problem (textarea, counter)
3 Address (customer's saved addresses or new)   4 Preferred day and window (date + radio)
Account: signed in → continue; otherwise sign-in or register first (the request is kept)
[Send request]   FormErrorSummary on failure; confirmation page shows the reference and "what happens next"
```
Phone: one column, 44 px controls, the button is full width and sticks to the bottom of the form card.

Five numbered cards on one page (service, problem, address, date and window, review), each an `h2` with a "Step n of 5" for screen readers. Services and windows are radio cards (name, line of text, price or hours); the address step uses the `AddressSelector`, or typed fields with a "Save this address to my profile" switch (and a label field when it is on); the date is the browser's date control limited to tomorrow through 90 days ahead; the review is a `DescriptionList` that fills in as the customer chooses; the only action is a full-width (phone) "Send request". "Sticks to the bottom of the form card" is read as "is the last thing in the card": a button fixed to the viewport would cover fields being tabbed to (WCAG 2.2 *focus not obscured*).

**Request confirmation and tracking** (`/portal/requests/[id]?submitted=1`, `/portal/requests`)
```
PageHeader: H1 reference · (status badge)   meta: service · Sent <date>        [Request another service]
Success panel (only while Submitted and ?submitted=1; takes focus): ✓ "Your request has been sent" · reference · Status · What happens next (3 steps) · [View all my requests] [Request another service]
Left (2/3): card What happens next · card Request details (service, problem, address + access notes, preferred time, sent) · card Messages from us (customer-visible notes)
Right (1/3): card History (customer timeline)
List: H1 Your requests · [Request a service] · FilterBar (Status) · DataTable: Reference | Service | Status | Submitted | What happens next · Pagination
```
Phone: single column, the table becomes cards, the filter bar stacks. Empty states: "You haven't sent a request yet" (with the button) and "No requests match" (with "Show all requests"). A request that is not found or not yours is one "We couldn't find that request" state inside the shell.

**Sign in / Register** (`/login`, `/register`)
```
AuthLayout: [brand panel on lg] | H1 Sign in · one-line welcome
card: Email · Password · [Sign in] · "Continue with Google" (when configured)
below: New here? Create an account          demo mode: published demo credentials note
Register adds: Full name · Confirm password · terms and privacy checkbox
```
Phone: logo above the title; the card fills the width.

### Business dashboard (`AdminShell`)

**Dashboard** (`/app/dashboard`) — built in `/styleguide/shells/admin`
```
H1 Dashboard · "Today, Oct 28, 2026. Start with what needs you."
KPI row (4): New requests 7 · Quotations awaiting reply 4 · Jobs this week 12 · Outstanding balance $3,416.30 (each links to its list)
Left (2/3): card Needs attention (oldest first): ref · customer · reason | (status) [Review]
            card Upcoming jobs: date · time range · service · customer · technician | (Scheduled)
Right (1/3): card Recent activity (Timeline)
```
Tablet and phone: KPIs 2×2 then 1 column; the right column drops under the left; the sidebar is a drawer.

**Request queue** (`/app/requests`) — built in `/styleguide/shells/admin/requests`
```
H1 Service requests · description
FilterBar: Search · Status · [Apply filters] [Clear filters]
DataTable: Reference | Customer | Service | Status | Submitted | Quoted   (sortable headers; row opens the request)
Pagination: Showing 1–20 of 132 requests            ‹ Previous 1 2 … 7 Next ›
```
Phone: the filter bar stacks; each row is a card (reference as the title, the rest as label/value pairs); pagination shows "Page 1 of 7".

*As built.* Above the filters sit **status chips** (`RequestStatusChips`): "All" and one per status in workflow order, each a link with its count in the name ("Submitted 3"); several can be chosen at once, the selected ones are marked with colour, `aria-current` and a filled count, and the strip scrolls sideways on a phone, like `LinkTabs`. The filters are `RequestQueueFilters` (not `FilterBar`): Search (reference, customer name or email), Service, Submitted from and to, then Search and "Clear filters". Columns are Reference (+ a **New** badge for a `SUBMITTED` request) | Customer (+ city) | Service | Status | Preferred time | Submitted | Updated; Reference, Status, Submitted and Updated sort. The table becomes cards below **1024 px** (`DataTable breakpoint="lg"`, seven columns do not fit a tablet). States: no requests yet (guidance, no button: requests come from customers), no match (with "Show all requests"), a load error with a retry, and the page skeleton. Typing in the search reloads the list after a pause and every change lands in the address.

**Request detail** (`/app/requests/[id]`) — built in `/styleguide/shells/admin/requests/detail`
```
Breadcrumbs: Requests › FF-2026-00125
H1 service · (status)   meta: reference · submitted     [Start review] [Cancel request]
Left (2/3): card Request details (service, problem, address, preferred time)
            Tabs: History (Timeline, customer-safe + staff) | 🔒 Internal notes (badge "Only the business sees these")
            card Quotations (empty state with "Create quotation" once under review)
Right (1/3): card Customer: avatar, name, contact, link to the customer
```
Cancel uses `ConfirmDialog` with a required reason. Phone: single column; actions wrap under the title.

*As built.* The header carries the status badge, the reference/service/customer/date as quiet facts and `RequestActions`: the first non-destructive action the server allows as the main button (**Start review**, or **Reopen request** for a declined request) and the destructive one in a **More actions** menu (nothing is on the page when the server allows nothing). **Cancel** opens a `ConfirmDialog` with *Reason (internal)* (required) and *Message to the customer* (optional), says that the request cannot be reopened and who reads what, and offers "Keep request"; **Reopen** asks for an internal reason. Left column: *Request details* (with "a preference, not a booking"), *Cancellation* (only when cancelled: when and by whom, the reason marked internal, what the customer was told or that they saw the standard wording), and **Notes**: an add form (note, then "Who can see this note" as two bordered radio choices, *Internal* chosen first, "Add note") above the list, where each note has a badge with an icon and its words (**Internal** with a lock, **Shared with the customer** with an eye) and a left border that differs. Right column: *Customer* (name, email and phone as links, how many other requests, jobs and invoices, and earlier requests as links with their status) and *History* (the staff timeline, each event with the customer's wording and an "Internal" badge where the customer sees nothing). The blueprint's tabs were not used: the notes panel and the history are both always visible, so an internal note is never one click away from being missed. The **Quotations** card is described below. Phone: one column in the order details, cancellation, notes, customer, history. The notes' long unbroken text wraps (the page's grid has an explicit `grid-cols-1`: a one-column implicit grid grows to its widest word).

**Quotation editor** (`/app/quotations/[id]`)
```
Breadcrumbs · H1 Quotation QT-2026-00042 · (Draft)            [Preview] [Send quotation…]
Left (2/3): card Lines: editable rows (description, quantity, unit price, line total read-only) · [Add line]
                       errors beside the fields (lines.2.quantity), FormErrorSummary above
            card Terms and validity (expiry date, notes)
Right (1/3, sticky): card Totals preview (subtotal, discount, tax, total) "Recalculated by the server when saved"
```
"Send" opens `ConfirmDialog` ("A sent quotation can't be edited; you can replace it"). Saving a draft and sending are visibly different buttons. Phone: lines become stacked cards with labelled fields; totals sit above the action bar.

*As built.* **Header:** breadcrumbs *Requests › request › quotation*, the title "Quotation QT-…", the status badge, quiet facts (service, customer link, started) and the actions: **Preview**, **Send to customer…** (the primary button; the ellipsis says a confirmation follows) and **More actions** (Void). The *Save draft* button is the primary button of the `FormSaveBar` at the foot of the form, with "You have unsaved changes." / "All changes are saved. Last saved …" beside it, so **saving and sending are different in place, label, weight and consequence**; Preview and Send are off while there is anything unsaved ("Save your changes to preview or send."), and Send is off while the previewed total is not above zero ("Add a price: …"). **Cards:** *Lines* (`LineItemsEditor`), *Discount and tax* (the tax rate says it came from the settings and changes only this quotation), *Validity, terms and note*; the **Totals** card shows the subtotal, the discount, the tax with its rate and the total under "Preview — final totals are calculated when you save", and says why there is no figure while an amount cannot be added up. An error list (`FormErrorSummary`) links to each field ("Line 2 quantity"), and each message is beside its row and field. **Rows** (`components/forms/line-items-editor.tsx`, reused by the invoice editor) change with the **width of the editor, not the screen** (container queries; named size `linetable` = 46 rem in `globals.css`): under 32 rem a card with a labelled field per line; from 32 rem a card of two rows (the description across the top, then quantity, price, taxable box, line total and the move and remove buttons); from 46 rem a table under column headings with the labels hidden. The editor is that wide only from about 1440 px (the page's two columns start at `xl`, with an 18 rem totals column: at `lg` the sidebar and a 22 rem column left the lines about 280 px). Buttons name their line ("Move line 2 up", "Remove line 2"), the only line cannot be removed, and a hidden live region says what moved. **Dialogs:** *Preview for the customer* (the document as the customer reads it, loading, error with "Try again", focus back on Preview), *Send QT-… to …?* ("After sending, this quotation can't be edited. The customer will be able to accept or decline it until …", "Not yet" / "Send to customer"), *Void QT-…?* (an internal reason, and for a sent quotation an optional message for the customer), and *Leave without saving?*.

**Quotation document** (`QuotationDocument`, one component for the preview, the read-only view and the customer's page): the business's mark, name and address, "Quotation" with the reference, the sent and valid-until dates, *Prepared for* (name and service address) and *Service*, the lines (a table from `sm`, stacked below; a **Tax** column says which lines carry tax when the document says so), the totals, the note and the terms in a muted panel. Long unbroken words wrap (`overflow-wrap: anywhere` in the table cells). It carries nothing internal. **Printing:** the shell's sidebar and top bar, the page header, the banner and the side cards are `print:hidden`; `globals.css` sets the margins and a plain background, and a **Print** button calls the browser's print.

**Read-only view** (any status but draft): a **status banner** in words ("Sent Nov 3, 2026 · valid until Nov 17, 2026", "Expired", "Voided Nov 4, 2026: <internal reason>" marked as only for the team, "Accepted", "Declined" with the customer's reason), the document, and beside it the *Replacement chain* (Replaces / Replaced by, with links and status badges), *Details* (who started, sent and voided it, and the request) and *History*. Actions: **Replace with a new draft** (only for a sent quotation, and not while the request already has a draft), **More actions › Void quotation**, **Print**.

**Request page, Quotations card:** every version newest first as a `DataTable` (cards below 1024 px): reference (with "Replaces QT-…"), status badge, total, sent date and valid-until date, each row opening the quotation; with none, a sentence that says what to do ("Use “Create quotation” above to prepare one."), and no second Create button. **Create quotation** is the request's main action while it is under review and has no draft.

**Jobs list** (`/app/jobs`) — same pattern as the request queue: filters (status, technician, date range), columns Reference | Customer | Service | Scheduled (date + time range) | Technician | Status; phone cards.

**Job detail** (`/app/jobs/[id]`)
```
Breadcrumbs · H1 service · (status)  meta: JOB ref · quotation ref   [Start job] [Reschedule] [Create invoice]
Left: card Schedule (date, time range, technician) · card Notes · Timeline of status changes
Right: card Customer and address · card Quotation summary (total)
```
Status actions come from `availableActions`. Phone: single column.

**Calendar** (`/app/calendar`)
```
H1 Calendar   [‹ Today ›]  Week of Oct 26 – Nov 1, 2026   (Week | List)   Technician filter
Week grid: 7 day columns, time rows (business hours), appointment blocks coloured by technician with name, time, (status icon)
Click a block → right Sheet: job summary, [Open job] [Reschedule]
Conflict: dialog or inline error "Jordan Lee already has JOB-2026-00028 from 9:00 to 11:00 AM"
```
Phone and tablet default to the **list view** (days as headings, appointments as rows); the week grid needs 1024 px.

**Customers** (`/app/customers`): search + list (Name, email, phone, open requests, balance due); phone cards. Detail: header with avatar; Tabs Requests | Quotations | Jobs | Invoices; left details and addresses.

*As built.* **Directory** (`/app/customers`): a search form (`CustomerSearch`: Search, *Sort by* and *Order* selects, Search and "Clear search"), then a `DataTable` (cards below **1024 px**) with Customer (the link) | Contact (email over phone, each named for a screen reader) | City | Requests | Open jobs | Outstanding (`MoneyText` with the business currency; a balance of nothing is quiet, a balance owed is bold) | Last activity. Customer and Last activity sort from their headers. *When the customer signed up* is a sort in the select, not a column: with it the table had eight columns and the email broke mid-word. The select is what a phone sorts with, since cards have no column headers. States: no customers yet, no match (with "Show all customers"), a load error with a retry, the page skeleton. **Customer** (`/app/customers/[id]`): one full-width column, in this order: a header (name, breadcrumb, "Customer since", the email and phone as `mailto:`/`tel:` links); three `StatCard`s (Requests, Open jobs, Outstanding balance, each a link to its tab; the balance is amber when something is owed); *Service addresses* (a grid of bordered cards, the default marked with a badge and a star, access notes with their line breaks); **History** (`LinkTabs` with a count on each tab, the open tab in the address, then a `DataTable` or cards, `Pagination`, and a guided empty state per tab); and *Internal notes* (below). The side-by-side layout of the request page is not repeated here: a 24 rem side column left the history tables about 300 px at 1024 px. A history row links to its request (the only page that exists yet); the quotation, job and invoice pages add their own links later (`RECORD_PATHS`). **Internal notes** carry a banner with a lock icon and the words "Internal — never shown to the customer" (the amber panel and the icon say it as well as the colour), a single-field form (there is no visibility to choose), and the notes newest first with author and time. A very long unbroken word (a name, a city, a note) wraps instead of widening the page: the shared `PageHeader` title is `min-w-0 break-words` for that reason.

**Technicians** (`/app/technicians`): list/cards with avatar, name, contact, colour key, active switch, upcoming assignments count; create/edit in a `Dialog` or page; deactivate with `ConfirmDialog`.

*As built.* **List** (`/app/technicians`): "Add technician" in the page header; `LinkTabs` *Active* (the default, with a clean address), *Inactive* and *All* with their counts; a `FilterBar` search (name, specialty, email or phone); then a `DataTable` (cards below **1024 px**) with Technician (the colour dot and the name, the link) | Specialties (tags) | Contact | Status (`StatusBadge kind="technician"`) | Upcoming jobs | Next job (date and time in the business zone, with the job reference). The name header sorts A to Z or Z to A. Empty states: no technicians yet (with the add button), no match for a search, nobody inactive, everybody inactive, and a page past the end. **Add and edit** are one right-hand `Sheet` (full width on a phone, 28 rem at most, scrolling) with name, phone, email, specialties as removable tags, the calendar colour as eight named swatches, and notes ("Only you and your team can see this"); a tag typed and not yet added is added on Save. Adding goes on to the new technician's page. **A technician's page** (`/app/technicians/[id]`): the name with the state badge, "Added …", **Edit**, **Deactivate** or **Reactivate**; an info line when inactive; "Next 7 days", a tile for each day (the weekday and date, and the booked time as "2 h 30 min" or **Free**; it says working hours are not tracked); "Upcoming jobs" (reference, customer, service, day and time range, status; not links yet); and a Details card (phone and email as links, specialties, colour with its name, notes). **Deactivate** is a `ConfirmDialog`: "*Jordan Lee has 3 upcoming jobs. They stay assigned; you can reassign them from each job. Jordan won't be available for new assignments.*"; **Reactivate** needs no confirmation. Long names, tags, emails and notes wrap (`[overflow-wrap:anywhere]`, because `break-words` alone cannot shrink a flex item); the shared `Breadcrumbs` got the same fix.

*As built.* **Jobs list** (`/app/jobs`): `LinkTabs` *Needs scheduling* (the default, a clean address), *Upcoming*, *In progress*, *Completed* and *All*, each with its count under the other filters; a `role="search"` GET form (search, a technician `Select` that also lists inactive technicians, *Scheduled from* and *to*) whose changes go to the address; a `DataTable` (cards below **1024 px**) with Job (the link) | Status | Customer and city | Service | Scheduled (day, then the time range with the zone's short name, or "Not scheduled yet") | Technician (colour dot and name, or "Unassigned") | Created. `JobsEmpty` has a message for a page past the end, a search with no match and each tab. **Job** (`/app/jobs/[id]`): header with the reference, `StatusBadge kind="workOrder"` and the one **Schedule** / **Reschedule** button the server names; left column *Appointment* (the day, the time range, the length and the technician with their phone and email, or "Not scheduled yet" with what to do), *Scope of work* (the scope and the accepted quotation's `DocumentLines` and totals), *History*; right column *Customer*, *Service address* (with the access notes), *Where it came from* (links to the request and quotation). **Create job** is the main button of an accepted request and of its accepted quotation. **Scheduling dialog** (`Dialog`, max 32 rem, inside the screen at 360 px): a line saying "Times in {zone} ({EST})", Date and Start time side by side from `sm`, *How long* (half-hours to 12 hours; it says when the visit ends, and the day if that is another one), *Technician* (active only), a *region* "{Name}'s other jobs that day", a polite live line "Conflicts with JOB-…, 10:00 AM – 12:00 PM." (red, with a warning icon) or "{Name} is free at that time." (green, with a check), and for a move *Reason for moving it* (a `Textarea` with a counter, "Only your team sees this"). A refusal from the server is a `FormAlert` in the dialog with the server's sentence and "Your entries are kept…". Every state has text and an icon, never colour alone; the page behind an open dialog is hidden from assistive technology, so tests look at it by CSS.

*As built.* **Job** (`/app/jobs/[id]`) gains, under the header, **`JobProgress`**: a `nav` named "Job progress" holding an ordered list of the four steps, each a numbered circle (a tick when done; success colour done, brand colour current, outlined when not reached) with its label and its state **in words** ("done", "current step", "not reached"), a row from `sm` and a column on phones (the circle's wrapper is `w-full` only from `sm`: found in a screenshot at 360 px, where it squeezed the labels); a job that left the path shows "This job left the usual path:" and the `StatusBadge`. The buttons: the main one is the action that moves the job on (**Start job**, **Complete job**, **Schedule**); a scheduled job also has an outline **Reschedule**; **More actions** holds **Needs rescheduling** and **Cancel job** (destructive). Each lifecycle action is a `ConfirmDialog` (max 28 rem): the consequence in words (including what the customer will not be told), a required internal field and an optional second one, both with counters; **Complete job** labels them "Completion summary for the customer" (guidance "What was done, parts replaced, any advice. The customer reads this on their job page.") and "Internal note (optional)" ("Only your team sees this"); **Start job** shows a `role="note"` strip (attention colours) when the booked time has not come. A completed or cancelled job gets a card ("Completion details", "Cancellation") whose sections say, with an icon and words, **Shown to the customer** or **Team only**. A job that needs a new time shows "Needs a new time" with the old appointment as "Previously scheduled" and "Technician then". **Jobs list**: the *Ready to invoice* tab (after *In progress*) with a sortable *Completed* column (also on *Completed*); a former appointment is labelled "Previously scheduled" in the table and the cards.

*Customer.* **Jobs** (`/portal/jobs`): an `h2` **Upcoming** and an `h2` **Past jobs**, each a named list of cards (a two-column grid from `md`): the reference as the link (the whole card is its target), `StatusBadge`, the service, the day and the time range with the zone's short name, "With {first name}" and, for a finished job, "Completed {date}"; a job with no time says why ("Waiting for a time", "We are finding a new time", "No visit will take place"). Past jobs are paged. Empty: "You don't have a job yet" with a link to the requests. **Job** (`/portal/jobs/[id]`): header with the reference and `StatusBadge`; left column *Where things stand* (the explanation in plain words, when work started or finished, and "Previously booked … That time no longer applies." for a job that needs a new time), *Your visit* (a description list What | When | Where | Who, with "Times are shown on {zone} clocks."), *What we did* (the summary, only when complete); right column *History* and *Where it came from*. The overview's **Upcoming visits** card lists the first three and links to every job; a request's page has a **Your job** card.

**Invoice detail / print** (`/app/invoices/[id]`)
```
Breadcrumbs · H1 Invoice INV-2026-00007 · (Partially paid)     [Record payment] [Download PDF] [Void…]
card Document: business + customer · dates (issued, due) · DocumentLines · DocumentTotals (… payments recorded, balance due)
card Payments: rows with amount, method, date, (Recorded|Voided) and [Void payment…]
Print view: the document only, A4/Letter, no navigation, totals and footer never cropped
```
Issuing and receiving payment are clearly different steps. Phone: the document card stacks; payments become cards.

*As built.* **Payments received** (`InvoicePaymentsPanel`) is a full-width card under the status banner, above the document and the side cards (a seven-column table does not fit the 22 rem side column). The header says it is money the team recorded outside FixFlow and that FixFlow does not collect or check payments, and holds **Record payment** (only while the server lists `RECORD_PAYMENT`). Under it a summary `dl` of three tiles: **Total**, **Paid** and **Balance due** (larger; "Paid in full" in the success colour when nothing is owed). Then a `DataTable` (a table from 1024 px, stacked cards below it): Date received | Method | Reference (with the note under it as "Note: …") | Amount (right-aligned, struck through when voided) | Recorded by | Status | Actions. Status is a `StatusBadge` (`kind="payment"`: **Recorded** or **Voided**) and a voided payment's line "Voided {date} by {name}. Reason: …" is **visible text**, not a tooltip; the **Void…** button is named for its row ("Void the $100.00 payment received on Mar 5, 2026"). The empty state is a dashed panel with a banknote icon: "No payments recorded yet. When {customer} pays you outside FixFlow, record it here so the balance stays right." (or "No payments were recorded against this invoice." when none can be). **Record payment** is a `Dialog` (the `schedule-dialog` pattern: unmounted when closed, a save in flight cannot be dismissed, focus goes back to the button): the helper text "Record only payments you've actually received outside FixFlow." under the title, Amount received (starts as the balance) and Date received (today in the business zone, `max` today) side by side from `sm`, **How it was received** (no default), Reference and Notes (each saying "Don't enter card numbers or bank login details."), an inline error beside each field, a `FormAlert` for anything else, and a submit button that shows its busy state and cannot be pressed twice. A `422 PAYMENT_EXCEEDS_BALANCE` is shown beside the amount with the balance that is left and everything typed kept. **Void payment** is a destructive `ConfirmDialog` with a required internal reason and the consequence in amounts ("The invoice balance will increase by $100.00, to $205.64. … The payment stays in the list, marked Voided"). Toasts: "Payment recorded", "Payment voided". The panel is `print:hidden`.

### Customer portal (`PortalShell`)

**Overview** (`/portal`) — built in `/styleguide/shells/portal`
```
H1 Hello, Morgan · "Here is where your requests, appointments and invoices stand."
card (attention edge) A quotation is waiting for your answer · (Sent) · total · valid until      [Review quotation]
2 cards: Upcoming appointment (date, window, address, (Scheduled)) · Invoice balance ($260.18, due date)
card Your recent requests: ref · service · plain-language description of the status | (status)
```
Phone: cards stack; the quotation card's button is full width.

**Quotation review** (`/portal/quotations/[id]`) — built in `/styleguide/shells/portal/quotation`
```
Breadcrumbs · H1 Quotation for AC Diagnostic Visit · (Sent)   meta: ref · valid until · description of the status
card Document (business, prepared for, DocumentLines, DocumentTotals, Terms)
card Your decision: "Nothing is scheduled until you accept."   [Accept quotation]  [Decline]
```
Both open `ConfirmDialog` with the consequence. After a decision the card shows the outcome and date instead of the buttons; an expired or voided quotation shows its status and no buttons. Phone: the two buttons stack, full width.

*As built.* **Header:** breadcrumbs *Requests › request › quotation*, the title "Quotation QT-…", the status badge, quiet facts (service, valid until) and **Print quotation**; the header, the banner and the decision are `print:hidden`. **Banner** (`QuotationBanner`, `role="status"`, tone by `data-tone`): *awaiting an answer* "Valid until Nov 17, 2026 — 5 days left" (the info tone; the attention tone from two days or fewer, and "last day to answer" on the day itself) over "Read the quotation below, then accept or decline it. Nothing is scheduled until you accept."; *accepted* "You accepted this quotation on …" (success); *declined* "You declined this quotation on …" with the business's phone and email as `tel:` and `mailto:` links; *expired* "This quotation has expired — contact us for an updated quote" with the same links; *withdrawn* "This quotation was withdrawn" with a link to the quotation that replaced it, or to the request. **Document:** the shared `QuotationDocument` (the business header and contact, the sent and valid-until dates, *Prepared for*, the lines as a table or stacked cards, subtotal, discount, tax with its rate and the emphasised total, the note and the terms), so what the admin previewed is what the customer reads. **Decision** (`QuotationDecision`): *Your decision*, "Total $255.64. Nothing is scheduled until you accept.", and **Accept quotation** (primary) and **Decline** (outline) side by side. On a phone it is a bar that **sticks to the foot of the screen** (a top border and shadow, full width through negative margins, above the content, below dialogs); from `lg` it is an ordinary card after the document. The accept dialog says the total, "what happens next: we'll contact you to schedule the work" and "This records your acceptance; it is not a contract signature. You can't change your answer afterwards."; the decline dialog says no work will be scheduled and offers the optional, 500-character "Help us improve — why are you declining?" (`ConfirmDialog`'s `secondary` field, which never blocks the button). Both start on "Go back", block a second click while pending, show the server's sentence on a refusal and keep what was typed after a failure that may pass. After the server says yes the bar is replaced by a **confirmation** (`role="status"`, takes focus: "Thank you — your acceptance is recorded", "We've let … know. …", *Back to your request*) and the page is refreshed to the new status. **Request page, quotation card** (`RequestQuotationsCard`): the current quotation (reference, status badge, total, valid until, one sentence on where it stands, **Review quotation**, primary while it awaits an answer), and *Earlier versions* below it with "Replaced by QT-…" links; nothing at all when the customer has not been sent one. **Overview, "Awaiting your decision"** (`AwaitingDecision`): a card in the brand's soft colour above *Your requests*, one row per quotation awaiting an answer (reference, service, total, "Valid until … — 5 days left", **Review quotation**), the soonest to run out first; not drawn when none is waiting. On a phone the rows stack and the button follows the text.

**Invoice** (`/portal/invoices/[id]`) — built in `/styleguide/shells/portal/invoice`
```
Breadcrumbs · H1 Invoice for … · (Partially paid)  meta: ref · issued · due · description of the status
card Document with totals ending in "Balance due"
2 cards: Payments recorded (amount, method, date, (Recorded|Voided)) · How to pay (instructions; "FixFlow does not take payments online")
[Download PDF]
```

### The scheduling calendar

`/app/calendar`: a toolbar (Today, previous, next, the range as the region's heading, the view as a segmented set of links, a date, a technician, "Needs scheduling" with its count), a legend (technician colours, and the status icons that are on screen), then the view. The hour grid has crisp hour lines and fainter half-hour lines drawn from the border tokens, a gutter of hour labels, today's column in `brand-soft` with a filled day number and a line at the current time. A block uses the technician's `cal-*` colour pair (text and fill, AA contrast pinned by `tokens.test.ts`), a 4 px left edge, the status icon of the badge, and only the lines that fit its height. The agenda is cards under a heading per day, empty days collapsed. The drawer and the needs-scheduling panel are right-hand sheets (full width on a phone); the scheduling dialog is the one on the job page. Reviewed at 1440 (week), 1024 (week), 768 (day) and 360 px (agenda).

### Invoices

**List** (`/app/invoices`): a heading and one sentence; a chip row (`All`, then `Draft`, `Issued`, `Partially paid`, `Overdue`, `Paid`, `Void`), each a link with its count and `aria-current` on the chosen one (the style of the request queue's chips, single choice); a search and due-date range form; then a `DataTable` (cards below 1024 px) with *Invoice* (the number, or the word "Draft"), *Customer*, *Job*, *Issued*, *Due*, *Total*, *Balance* (a dash for a draft or a void invoice), and *Status* (the badge, and "Overdue by N days" in `danger` text under it). Sortable: issued, due, total, status. Empty states: past the last page, no match (with "Clear search and filters"), an empty status chip (each says what belongs there), and none yet (with a link to Ready to invoice).

**Draft** (`/app/invoices/[id]`): the quotation editor's layout with the invoice's own header (Invoices › *Draft invoice*): the lines (the shared `LineItemsEditor`, with a sentence saying they come from the accepted quotation and that extra parts or labour are added as lines), discount and tax rate, *Dates and note* (issue date, which may be empty to mean "the day it is issued"; due date; a note), the live totals card (labelled a preview), the save bar. **Preview** opens the saved draft as a document; **Issue invoice…** opens an alert dialog ("This assigns invoice number INV-… and locks its contents. Corrections after issuing require voiding."); **Void invoice** is behind *More actions*. Preview and Issue wait for a saved draft, and Issue also for a total above zero, each saying why.

**Issued and later**: a status banner (`role="status"`: "Issued Mar 2, 2026 · due Mar 16, 2026", "Overdue by 4 days", "Paid in full", or "Voided … : reason" with the reason marked internal), the print-ready document, and a column of cards: **Payments received** (a separate card from the invoice itself: empty with "Payments are recorded in the next step", no button, a voided payment struck through), **Details** and **History**. The document: the business's logo, address and contact (the snapshot), "Invoice" and the number, the issue and due dates, *Billed to* and *Service*, the lines, the totals with **Amount paid** and **Balance due**, the customer's note, **How to pay** (the instructions, and "Please quote INV-… with your payment"), and the footer. A draft prints the mark "Draft: not issued yet" and a void invoice the mark "Void".

**Print.** The frame (sidebar, top bar, page header with its buttons, banner, side cards) carries `print:hidden`; the document drops its border, radius and padding, and its lines, totals, note, instructions and footer carry `print:break-inside-avoid`. Nothing in it has a fixed width, so it fits A4 and Letter; the E2E spec prints it on both and checks that nothing is clipped. Checked at 1440, 1024, 768 and 360 px by the E2E spec (axe, no sideways scroll, dialogs inside the screen).

## 14. Design decisions

| Topic | Decision |
|---|---|
| Branding | The branding model of §1. |
| Code-first | This document, the tokens, the components and `/styleguide` are the design system. There are no Figma mock-ups. |
| Fonts | Inter for the interface and numerals, Bricolage Grotesque for titles and marketing headlines. Self-hosted woff2 in `apps/web/src/app/fonts/` loaded with `next/font/local`; no Google Fonts request at build or run time. |
| Tokens and components | The Tailwind theme is reset so only the FixFlow colours, type sizes, radii and shadows exist. Components are hand-composed from `radix-ui`, `class-variance-authority`, `clsx` + `tailwind-merge` and Lucide, following shadcn/ui conventions. The shadcn CLI was run once and its output not kept: it added the whole CLI as a runtime dependency (`shadcn`, about 7,600 lockfile lines), a `cn` package and a build-time Google Fonts fetch. `components.json` is kept. |
| Native controls | `Select`, `DateInput` and `TimeInput` wrap the browser's `<select>`, `<input type="date">` and `<input type="time">`: full keyboard and screen-reader support, the platform picker on phones, the API's `YYYY-MM-DD` and `HH:mm` values, no calendar dependency. A custom calendar popover can replace `DateInput` later without changing its props. |
| Dates in the web app | They use `Intl.DateTimeFormat#formatToParts` for the zone conversion and assemble the text by hand, not `date-fns`/`@date-fns/tz`: `TZDate`'s constructor calls `new Date()` with no argument, which Next.js Cache Components rejects while prerendering a server component, and ICU puts a narrow no-break space before "PM" that would differ between server and browser. The API keeps `date-fns` + `@date-fns/tz` for business-day boundaries. |
| Status mapping | It lives in `apps/web/src/lib/formatting/status.ts`, keyed by the full enums so a missing value is a compile error. Payment void state and notification read state are derived display states added to `@fixflow/shared` (`derived-status.ts`), kept apart from the enums that must match Prisma. |
| Dev-only styleguide | `/styleguide` and `/styleguide/shells/*` call `notFound()` in production builds (layout and every page), are `noindex`, and carry the shell examples with fictional data. The central navigation config lists only existing routes and is empty until tasks add theirs. |

Cache Components is confirmed. The design system follows it: runtime reads (`usePathname`, `searchParams`, `params`) sit behind `<Suspense>` with a meaningful fallback; no component reads the clock during render.

## 15. Checklist for new screens

1. Find its blueprint in §13; reuse the shell, `PageHeader` and the patterns in §11.
2. Only tokens: no hex colours, no arbitrary font sizes, spacing or radii.
3. Money, dates and references through `lib/formatting` and `MoneyText`/`DateTimeText`/`ReferenceText`; status through `StatusBadge`.
4. Every state: loading skeleton, empty (with guidance), validation error beside the field, server error with retry and request id, success only after the server, disabled, permission denied.
5. Destructive or irreversible actions use `ConfirmDialog` with the consequence (and a reason where the history needs one).
6. A pending submit uses `Button loading`; keep the form values after a recoverable error.
7. Responsive at 360, 768, 1024 and 1440 with no horizontal overflow; tables via `DataTable`.
8. Keyboard: tab order follows reading order, overlays return focus, nothing needs a mouse.
9. Add the route's entry to `config/navigation.ts` in the same change that builds the screen, and not before.
10. Add Playwright coverage and an axe scan for the screen; save screenshots at the four widths.
