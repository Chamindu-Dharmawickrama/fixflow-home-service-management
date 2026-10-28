# T08 — Public Website and Service Pages

## A. Task identification

| Field | Value |
|---|---|
| Task ID | T08 |
| Title | Public website and service pages |
| Phase | 2 — Identity, configuration and public experience |
| Objective | Build the polished, responsive, accessible and SEO-friendly public website for the configured business: homepage, service catalogue, service detail and privacy/demo notice. A reviewer should understand the product within 30 seconds, and a visitor should be able to start a service request. |

## B. Context

- Read first: `CLAUDE.md` §10; spec §2.2, §3.3 (success criteria), §7.1 steps 1–3, §8.1, §9.1, §10 (principles, visual direction, "authentic imagery only on marketing pages"), §15.2 (demo privacy notice), §16 (SEO), §19, §22 (honest positioning).
- Decisions: D-31 (branding: business identity on public content, "Powered by FixFlow", demo banner), D-09 (demo notice), D-47, D-50, D-40; Q-05 (imagery).
- Requirements: FR-001, FR-002 (UI), FR-003, FR-004, FR-005, NFR-11, SEC-DATA-05, PF-03, SC-01, SC-09, IA-P01…P03, IA-X02.

## C. Prerequisites

- T07 `COMPLETED`: public settings and services endpoints exist. T04 public layout and components exist.
- Ask the user whether licensed photos are available (Q-05). If they are not, use designed visual compositions built from tokens, Lucide icons and shapes. Never use broken images, hot-linked images or unlicensed images. Record the credits of any supplied photos in `apps/web/public/images/CREDITS.md`.

## D. Scope

**In scope**
- `/` homepage, with content from public settings and services:
  - **Hero**: a clear headline about the business value (e.g. "Home repairs and maintenance, handled from first request to final invoice"), a supporting line, a primary CTA "Request a service" (→ `/request-service`), a secondary CTA "Browse services", and a visual.
  - **Service highlights**: active services as cards (icon or image, name, category, short description, "From $X" or "Request a quote", link to detail).
  - **How it works**: 4 steps mirroring the real workflow (Request → Quote → Scheduled visit → Invoice and payment), described truthfully.
  - **Trust elements** that the product actually delivers ("Written quotations before work starts", "Track every request online", "Clear invoices and payment records"). **No testimonials, ratings, client logos or invented statistics.**
  - **Service area** and **FAQ** (FR-005, 5–7 realistic questions answered from the actual workflow and policies).
  - **Contact block** from settings, and a footer.
- `/services`: page heading and intro, a category filter (URL param, accessible), a responsive card grid, and an empty state.
- `/services/[slug]`: overview, full description, "What's included" list, estimated duration, a pricing note (FIXED: "Starting from $X — final price confirmed in your written quotation"; QUOTE_REQUIRED: "Priced after we review your request"), CTA "Request this service" (→ `/request-service?service=<slug>`), related services, and breadcrumbs. Inactive or unknown slugs return `notFound()`.
- `/privacy`: a plain-language privacy and demo notice (what the app collects, why, demo resets, fictional data; "do not submit real personal information" when in demo mode).
- **Demo banner** (when `NEXT_PUBLIC_DEMO_MODE`): slim and dismissible per session. The text reads "FixFlow portfolio demo — CoolBreeze Home Services is a fictional business. Data resets regularly." with a link to `/privacy`.
- Header: business identity, nav (Home, Services, How it works anchor, Contact anchor), session-aware account link (from T05), and the primary CTA. The mobile menu is accessible.
- **SEO**:
  - `generateMetadata` per page with titles following D-31 ("AC Routine Maintenance · CoolBreeze Home Services")
  - meta descriptions, canonical URLs and Open Graph tags
  - `sitemap.xml` (home, services, active service slugs, privacy) and `robots.txt`; when demo mode is on, decide and record whether to `noindex`
  - semantic headings: one `h1` per page and an ordered hierarchy
- **Resilience**: fetch with time-based revalidation (e.g. 60–300 s) so pages are fast. If the API is unavailable (Render cold start, outage), show a graceful message with retry for dynamic sections rather than an error page. The build must not fail because the API is unreachable at build time; choose dynamic rendering or a fallback and document the choice.
- Update the T05 `/register` page to link to `/privacy`.

**Out of scope**
The request-service form itself (T11; the CTA links to the route that T11 builds). **Until T11 lands, `/request-service` must not be a dead link.** Either implement T11 next, or temporarily point the CTA at `/login?returnTo=/portal` with honest copy. Record which. Also out of scope: blog, testimonials, live chat, analytics.

## E. Implementation instructions

1. Inspect the T04 `PublicLayout`, the design system screen blueprints for the homepage, services and service detail, the T07 endpoints, and `src/lib/settings`.
2. Write the content first in a typed content module (FAQ, how-it-works copy, trust points) so it is reviewable and consistent with the actual workflow. The content must stay true to what FixFlow implements.
3. Build the pages with Server Components and keep client JS minimal (mobile menu, filter, banner dismissal).
4. Capture screenshots at 360, 768, 1024 and 1440 px into `artifacts/screenshots/t08/`, review them critically against the design system (hierarchy, spacing, alignment, image cropping, line lengths) and iterate until they look professional.
5. Check performance basics: optimised images through `next/image` with explicit sizes, font loading without layout shift, and no large client bundles on public pages.

## F. Quality requirements

- The visual quality is portfolio-grade: a coherent grid, clear hierarchy, consistent card heights and spacing, a restrained palette, and no generic template look. Follow the visual direction in spec §10.2.
- All copy is realistic, specific and honest. Run `grep -ri "lorem"` before finishing.
- Accessibility: landmarks, skip link, alt text (decorative images use `alt=""`), focus states, a keyboard-operable menu and filter, and contrast that passes.
- No dead links or buttons.

## G. Acceptance criteria

1. The homepage renders the hero, live service highlights from the API, How it works, trust points, service area, FAQ and contact from settings, plus a footer with "Powered by FixFlow". A business name change in settings appears after revalidation.
2. `/services` lists only active services, with a working category filter (URL param) and an empty state. `/services/[slug]` shows the full detail and the CTA, and an inactive or unknown slug returns 404.
3. `/privacy` exists. The demo banner appears only in demo mode and links to it.
4. Metadata: each page has a unique, meaningful title and description in the D-31 format. The sitemap lists active service URLs and robots.txt is served.
5. There is no horizontal overflow at 360, 768, 1024 and 1440 px. The mobile menu works by keyboard. axe reports no serious or critical violations on `/`, `/services`, `/services/[slug]` and `/privacy`.
6. With the API stopped, the public pages render a graceful fallback (no unhandled error page), and `npm run build` does not depend on a running API.
7. Lint, typecheck, unit, build and E2E pass.

## H. Testing and verification

- E2E: homepage sections and service cards (against a seeded test DB); service detail navigation; 404 for an archived service (archive it via the admin API in test setup); category filter; mobile menu keyboard test; overflow at 4 widths; axe on 4 pages; an API-down fallback test (route interception or a stopped API).
- Unit: the metadata builder, the sitemap generator and the content module types.
- Run all standard commands and record the results.

## I. Documentation and progress updates

- Progress (include the screenshot paths and review notes), traceability (FR-001…FR-005, NFR-11, SEC-DATA-05, PF-03, SC-01, SC-09, IA-P01…P03, IA-X02), `prompts/README.md`, decisions (rendering/revalidation choice, noindex choice, imagery source), README (public site overview).

## J. Completion report

Report:
- what was implemented and the key files
- each acceptance criterion with pass/fail
- the commands executed and their actual results
- screenshots and your visual review notes
- the imagery approach used
- how the `/request-service` CTA is handled until T11
- limitations
- a suggested commit message
- the next task: **T09 — Hosted preview deployment** (`prompts/09-preview-deployment.md`). If credentials are not ready, mark T09 `BLOCKED` and continue with **T10**.
