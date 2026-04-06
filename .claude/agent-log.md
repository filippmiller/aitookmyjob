# Agent Log

## 2026-04-06 — AI News Articles Carousel

**Category:** features (90%), tests (10%)
**Status:** Completed

### What was done

1. **Curated 18 real articles** about AI job displacement from major outlets
   - Sources: HBR, CNBC, Fortune, TechCrunch, CBS News, Goldman Sachs, IMF, WEF, Brookings, HR Dive, etc.
   - Each article: title, source, date, 2-sentence excerpt, real URL
   - Stored as `public/data/articles.json`

2. **Built horizontal carousel component**
   - Auto-scrolls every 5 seconds, pauses on hover
   - Left/right arrow navigation + dot indicators
   - CSS scroll-snap for smooth manual scrolling
   - Responsive: 3 cards desktop, 2 tablet, 1 mobile
   - Cards: source name (small caps), title, excerpt, "Read article" link

3. **Added carousel section between stories and community**
   - Section title "AI Displacement in the News" (translated in all 5 langs)
   - 3 new E2E tests for carousel (all pass)

### Files Created/Changed
- `public/data/articles.json` — 18 curated articles
- `public/carousel.css` — Carousel styles + responsive
- `public/index.html` — Added carousel section + CSS link
- `public/app.js` — renderNewsCarousel() + initCarouselControls()
- `public/i18n/*.json` — Added newsCarouselTitle key (all 5 langs)
- `tests/e2e-comprehensive.spec.js` — 3 carousel tests + rate-limit fixes

---

## 2026-04-06 — Complete UX Overhaul: Stories-First Homepage

**Category:** features (80%), tests (20%)
**Status:** Completed

### What was done

1. **Replaced dashboard-first layout with stories-first design**
   - Removed hero section with cold stats
   - Added featured story with large quote, avatar, author info above the fold
   - Added warm onboarding CTA: "Your story matters"
   - Added "How it works" 3-step section (Share, Connect, Find opportunities)

2. **Left sidebar with collapsible charts (desktop)**
   - 60px collapsed, 360px on hover with smooth CSS transitions
   - Contains: Live Stats grid, Layoff Trend, Industries, Geographic, Recovery charts
   - Icon + label visible when collapsed, full chart on hover

3. **Mobile top ribbon (< 1024px)**
   - Horizontal scrollable stat ribbon replacing sidebar
   - Charts button to expand/collapse chart panel

4. **Enhanced story cards (v2)**
   - Avatar circles with initials, profession/company metadata
   - Left border accent on hover, 4-line body clamp
   - Me Too + Share actions in footer

5. **All 27 E2E tests passing** after layout changes

### Files Changed
- `public/index.html` — Complete layout restructure
- `public/sidebar.css` — New file: sidebar, ribbon, featured story, how-it-works, v2 cards
- `public/app.js` — Added renderFeaturedStory(), v2 card rendering, ribbon toggle
- `tests/e2e-comprehensive.spec.js` — Updated for new layout selectors

---

## 2026-04-06 — Fix Language Switcher + E2E Test Suite

**Category:** features (60%), bugs (20%), tests (20%)
**Status:** Completed

### What was done

1. **Fixed language switcher** — ALL text now changes when switching between EN/RU/DE/FR/ES
   - Added `data-i18n` attributes to 50+ translatable elements in `index.html`
   - Added `data-i18n-html` for hero title (contains `<em>` markup)
   - Added `data-i18n-placeholder` for search input
   - Rewrote `applyTranslations()` to generically apply all `[data-i18n]` elements
   - Completed all 5 translation files with full key coverage (~70 keys each)

2. **Fixed URL-based locale initialization** — App now reads `/:country/:lang/` from the URL on init
   - Previously `lang` was always `'en'` regardless of URL
   - Added URL path parsing in constructor + dropdown sync

3. **Wrote comprehensive Playwright E2E test suite** (27 tests)
   - Homepage, nav links, registration, login, forum, story submission
   - Research charts, all 5 language locales, language switcher
   - Responsive at 375/768/1280px, 404 handling
   - API endpoints, static assets, translation file validation

### Files Changed
- `public/index.html` — Added data-i18n attributes throughout
- `public/app.js` — URL parsing, applyTranslations rewrite, selector sync
- `public/i18n/en.json` — Expanded from 89 to ~140 keys
- `public/i18n/ru.json` — Completed all keys (was 37, now ~140)
- `public/i18n/de.json` — Completed all keys
- `public/i18n/fr.json` — Completed all keys
- `public/i18n/es.json` — Completed all keys
- `tests/e2e-comprehensive.spec.js` — New test file (27 tests)

### Test Results
- 27/27 passed in 3.7 minutes
