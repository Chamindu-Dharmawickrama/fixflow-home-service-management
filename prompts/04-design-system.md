# T04 — Design System, UI Primitives and Application Shells

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T04 |
| Title | Design system, UI primitives and application shells |
| Phase | 1 — Foundation |
| Objective | Establish FixFlow's original, professional visual identity and implement it as a reusable, accessible component system with responsive layout shells. Every later screen is built from these pieces, so no screen looks generic or inconsistent. |

## B. Context

- Read first: `CLAUDE.md` §10; spec §3.3, §10 (all), §13.4, §16 (Responsiveness, Accessibility), §18.4.
- Decisions: D-31 (branding model, **PROPOSED**; confirm), D-32 (code-first design system, **PROPOSED**; confirm), D-40 (frontend data strategy), D-42 (date library), D-18 (money as strings).
- Requirements: UX-01…UX-08, UX-VD, UX-INT-01/02/04/05, FR-004 (foundation), FR-083 (pattern), BR-17/BR-18 (formatting), AC-UQ-01, AC-UQ-03, NFR-02, NFR-03, SC-02, IA-X01 (shell nav config).
- Brand personality (spec §10.2): dependable, modern, calm, precise, service-oriented. Use deep navy/blue-green for navigation and primary actions, restrained teal for positive or active emphasis, off-white page background, white surfaces, dark readable text and subtle borders. Status is always text plus colour. Do not imitate any existing SaaS product's look.

## C. Prerequisites

- T01 `COMPLETED`: Next.js with Tailwind, Vitest and Playwright are set up.
- T02 and T03 are not required; this task can run alongside them.
- Ask the user to confirm D-31 and D-32 (and Q-08 on Figma) before starting.

## D. Scope

**In scope**
1. **`docs/DESIGN_SYSTEM.md`**, which serves as the design reference for all later tasks:
   - brand principles and voice/tone for UI copy (plain, confident, specific; status messages that say what happened and what happens next)
   - colour tokens (brand, accent, neutrals, semantic success/warning/danger/info/neutral, focus ring) with a **measured contrast table** (text/background pairs, WCAG AA ≥ 4.5:1 for body text, ≥ 3:1 for large text and UI boundaries)
   - typography (families, scale with sizes and line heights, weights, tabular numerals for money and tables)
   - spacing scale (4 px base), radii, elevation/shadows, border usage, iconography (Lucide, consistent size and stroke), motion (150–200 ms, respects `prefers-reduced-motion`)
   - layout grids per experience: marketing (max-width container, generous whitespace), admin (sidebar with dense but readable content), portal (comfortable single-column with cards)
   - breakpoints (360, 768, 1024, 1440 test widths)
   - **status mapping** for every status enum (request, quotation, work order, invoice; also payment void and notification read state). Each status gets a label, tone (info / attention / success / danger / neutral), icon and a short customer-facing explanation. Tone follows meaning: new or awaiting → info; needs action → attention; positive outcome → success; problem or overdue → danger; closed, terminal or void → neutral.
   - patterns: forms (labels, help text, required indicator, inline errors, error summary for long forms), tables to cards, filter bars, pagination, empty, loading and error states, confirmation dialogs (consequence text, optional reason field), toasts, timelines, document views (quotation/invoice), detail pages (header, primary action, secondary actions, metadata)
   - **screen blueprints:** text wireframes with content hierarchy and the primary action for homepage, services list, service detail, request-service flow, login/register, admin dashboard, request queue, request detail, quotation editor, jobs list, job detail, calendar, customers, technicians, invoice detail/print, portal overview, portal quotation review, portal invoice, plus their mobile adaptations
2. **Tokens in code:** Tailwind theme (CSS variables; Tailwind v4 `@theme` if that is the installed major) matching the doc. Fonts via `next/font` (self-hosted). Recommended: Inter for UI text and numerals, with an optional distinct display face for marketing headings. Decide, then record the choice.
3. **shadcn/ui** initialised and themed with these tokens. Add only the components needed (below) and customise them; never ship the default theme unchanged.
4. **Components** in `src/components/ui`, `src/components/forms` and `src/components/layout`:
   - Button (primary, secondary, outline, ghost, destructive, link; sm/md/lg; `loading` state that disables and announces)
   - IconButton with a required accessible label
   - Input, Textarea (optional character counter), Select, Checkbox, RadioGroup, Switch, DateInput (date picker with typing support), TimeInput
   - `FormField`, integrated with React Hook Form: label, description, error, required marker, and `aria-invalid`/`aria-describedby` wiring
   - `FormErrorSummary`
   - Card, Badge, `StatusBadge` (driven by the status mapping; accepts an enum value and renders label, tone and icon)
   - `MoneyText` (string amount + currency, tabular)
   - `DateTimeText` (ISO + business timezone)
   - DescriptionList (key/value)
   - Tabs, Dialog, `ConfirmDialog` (title, consequence text, confirm label, destructive variant, optional required reason textarea with min length), Sheet/Drawer, DropdownMenu, Popover, Tooltip
   - Toast (sonner or the shadcn toast)
   - Skeleton presets (table, card, detail)
   - `EmptyState` (icon, title, guidance, optional action)
   - `ErrorState` (message, retry, requestId reference)
   - `PermissionDenied`
   - `PageHeader` (title, description, breadcrumbs, status, actions)
   - Breadcrumbs, `Pagination` (URL-param driven), `FilterBar` scaffold
   - `DataTable` pattern: semantic table at ≥ 768 px (or ≥ 1024 px for wide tables), stacked cards below; sortable header affordance; row link accessibility
   - `Timeline`, `StatCard` (KPI with label, value, context and optional link)
   - Avatar, FixFlow `Logo`: an **original** SVG mark plus wordmark with light and dark variants
5. **Layout shells:**
   - `PublicLayout`: header with business identity slot, nav, mobile menu (accessible disclosure), primary CTA, footer with "Powered by FixFlow" and a demo-notice slot
   - `AuthLayout`
   - `AdminShell`: sidebar nav on ≥ 1024 px, drawer below; top bar with page context, notifications slot, user-menu slot; skip link
   - `PortalShell`: top nav, mobile drawer, notifications and user slots

   Navigation items come from a central config typed by role. **Only implemented routes are listed**, and later tasks add their entries.
6. **`src/lib/formatting`:** `formatMoney(amount: string, currencyCode)` (decimal string in, no float math, `en-US` locale constant), `formatDate`, `formatDateTime`, `formatTime`, `formatTimeRange`, `formatRelative` (all take an explicit IANA `timeZone`), `formatReference`, and status label helpers driven by `@fixflow/shared` enums (add any missing status constants to shared).
7. **Dev-only `/styleguide` route** that renders every component, variant and state (including loading, empty, error, disabled and destructive confirmation), the status badge matrix, form validation examples, the DataTable at both breakpoints, and each shell with example content. It returns `notFound()` in production builds.
8. **Global app files:** root layout with fonts and metadata defaults, `not-found` and `error` boundaries using the design system, favicon/icon from the FixFlow mark, and a skip-to-content link.

**Out of scope**
Real pages (T05+), API client and auth wiring (T05), data fetching, dark mode (D-39), charts (D-03).

## E. Implementation instructions

1. Inspect `apps/web` as T01 left it, including the Tailwind version and config style, and follow the installed conventions.
2. Write `docs/DESIGN_SYSTEM.md` first, then implement the tokens. Starting proposal, which you must refine and verify for contrast before recording:
   - primary `#14505E`, primary-hover `#0F3E4A`, primary-deep (nav) `#0B2E38`
   - accent teal `#0F766E` (text and icons), `#14B8A6` (fills with dark text)
   - page `#F6F7F6`, surface `#FFFFFF`, border `#E3E7EA`
   - text `#0F1B22`, secondary text `#4A5A64`, muted text `#66757F`
   - success `#1E7F4F`/`#E8F5EE`, attention `#9A5B00`/`#FFF4E0`, danger `#B42318`/`#FDECEA`, info `#1D5FA8`/`#E8F0FB`, neutral `#475467`/`#F0F2F4`
3. Build the components in dependency order: tokens → primitives → form components → feedback/state components → patterns → shells. Keep APIs small and typed, avoid prop explosions, and prefer composition.
4. Build the styleguide while building components. Use realistic FixFlow sample content: reference numbers like `FF-2026-00125`, money like `$1,284.50`, names and services from the demo business.
5. Write the tests (H), then capture Playwright screenshots of `/styleguide` and the shell examples at 360, 768, 1024 and 1440 px into `artifacts/screenshots/t04/` (git-ignored). Review them yourself for clipping, overlap, alignment and spacing, then fix what you find.
6. Decide the display font and any token adjustments, and record them in `DESIGN_SYSTEM.md` (and as decisions if they deviate from D-31/D-32).

## F. Quality requirements

- Accessibility:
  - visible focus ring on every interactive element
  - focus is trapped and restored in dialogs and drawers
  - Escape closes overlays
  - icon-only controls have labels
  - colour is never the only signal
  - touch targets ≥ 24 px (aim for 44 px on mobile primary actions)
- No hard-coded colours, font sizes or arbitrary spacing in components; use tokens only.
- Components are server-component friendly where possible; mark `"use client"` only where needed.
- Money and dates are formatted only through `lib/formatting`, never with ad-hoc `toFixed` or `toLocaleString`.
- Sample content in the styleguide is realistic, never lorem ipsum.

## G. Acceptance criteria

1. `docs/DESIGN_SYSTEM.md` contains: the tokens with a measured contrast table where every listed text pair passes AA, the type scale, spacing, the status mapping for **every** value of every status enum, the documented patterns, and screen blueprints for all listed principal screens.
2. `/styleguide` renders every component and state in development and returns 404 in a production build (verified with `next build && next start`, or by a test).
3. `StatusBadge` handles every enum value from `@fixflow/shared`, and a test iterates over all values to assert a label, a tone and an icon exist.
4. `FormField` associates label, description and error correctly: tests assert `aria-invalid`, `aria-describedby` and label `for`/`id`.
5. `formatMoney` and the date formatters are unit-tested for: decimal strings, a negative/zero amount, USD and one other currency, a timezone different from the test runner's, and a DST boundary.
6. The shells are responsive. Playwright confirms no horizontal overflow (`scrollWidth ≤ innerWidth`) at 360, 768, 1024 and 1440 px on `/styleguide` and the shell examples, the mobile nav opens and closes with the keyboard, and focus returns to the trigger.
7. axe (via `@axe-core/playwright`) reports no serious or critical violations on `/styleguide`.
8. The FixFlow logo is original SVG and is used for the favicon and in the shells.
9. Lint, typecheck, unit tests, build and E2E all pass.

## H. Testing and verification

- Vitest + Testing Library: `StatusBadge` coverage, `FormField` a11y wiring, `ConfirmDialog` (reason required before confirm is enabled), `Button` loading state, `Pagination` URL generation, formatting functions.
- Playwright: styleguide overflow checks at 4 widths, keyboard navigation of the mobile menu and a dialog, axe scan, screenshots saved for review.
- Run `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build` and `npm run test:e2e`, and record the results.

## I. Documentation and progress updates

- Progress file: the T04 entry, including the screenshot path and your visual review notes.
- Traceability: UX-01…UX-08, UX-VD, UX-INT-01/02/04/05 (patterns), FR-083 (pattern), AC-UQ-01, AC-UQ-03 (foundation), NFR-02/03 (foundation), SC-02.
- `prompts/README.md` status; decisions D-31 and D-32 → `ACCEPTED` (or updated); record the font decision.
- `docs/ARCHITECTURE.md`: frontend structure section (components, shells, formatting, nav config).

## J. Completion report

Report:
- what was implemented and the key files
- the design decisions made (fonts, final tokens)
- each acceptance criterion with pass/fail
- the commands executed and their actual results
- the screenshot location and visual review findings
- dependencies added, with justifications
- limitations
- a suggested commit message
- the next task: **T05 — Authentication, sessions and access control** (`prompts/05-authentication.md`), once T03 is also complete
