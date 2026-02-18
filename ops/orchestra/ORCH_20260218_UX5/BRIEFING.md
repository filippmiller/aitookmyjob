# BRIEFING: ORCH_20260218_UX5

## [GLOBAL]

### Project: AI Took My Job
- **Stack**: Express 5, vanilla JS (no React/Vue), Chart.js, static HTML, CSS with @layer
- **Design system**: "Human Signal" — dark editorial theme, amber accent #D4956B, Fraunces/DM Sans/JetBrains Mono
- **Fonts loaded via**: Google Fonts (already in <head>)
- **Icons**: Phosphor Icons via unpkg CDN (`<i class="ph ph-icon-name">`)
- **Files**:
  - `server.js` — single Express backend (~3100 lines), JSON file storage
  - `public/index.html` — main page (hero, dashboard, stories, community, news, resources)
  - `public/forum.html` — forum/account page
  - `public/app.js` — single frontend JS class `AITookMyJobApp`
  - `public/styles.css` — all CSS with @layer (base, components, utilities, etc.)
  - `data/*.json` — JSON file storage for stories, users, forum, petitions, etc.

### Key Architecture Decisions
- **NO new npm packages** — use what exists (Express, Chart.js, Phosphor Icons)
- **Modular files**: Each agent writes to SEPARATE new JS and CSS files to avoid conflicts
  - New JS files get loaded via `<script>` tags added to index.html
  - New CSS files get loaded via `<link>` tags added to index.html
  - Each new JS file should be an IIFE or class that initializes itself
- **API routes**: Only Gamma adds new server.js routes (calculator + digest). Alpha/Beta are frontend-only
- **HTML sections**: Each agent writes their HTML sections into their own JS file using DOM injection (createElement/insertAdjacentHTML). Do NOT edit index.html directly

### Existing APIs That Are Ready
```
GET  /api/campaigns/petitions        → { petitions: [...] }
POST /api/campaigns/petitions        → create petition (auth required)
POST /api/campaigns/petitions/:id/sign → increment signature count
POST /api/stories/:id/me-too         → increment meToo counter
GET  /api/stats?country=X            → { counters: { laidOff, sharedStories, foundJob, distinctCompanies } }
GET  /api/stories?country=X&limit=N  → { stories: [...] }
GET  /api/news?country=X             → { news: [...] }
```

### Existing Frontend That's Ready
- `AITookMyJobApp` class in app.js with: fetchJSON(), postJSON(), esc(), fmt(), toast()
- Story cards already have `btn-metoo` and `btn-share` with working handlers
- Hero stats already animate with `animateCounters()`

### CSS Variable System (use these, don't invent new colors)
```css
--surface-primary, --surface-secondary, --surface-tertiary
--text-primary, --text-secondary, --text-muted
--signal-amber: #D4956B (brand accent)
--signal-red, --signal-green, --signal-blue
--sp-1 through --sp-16 (spacing: 0.25rem to 4rem)
--text-xs through --text-3xl (font sizes)
--font-display: 'Fraunces', --font-body: 'DM Sans', --font-mono: 'JetBrains Mono'
--radius-sm, --radius-md, --radius-lg, --radius-xl
```

### Process Safety
- NEVER kill any running process
- Port conflicts: add 13 and retry
- NEVER use taskkill, Stop-Process, kill-port

---

## [ALPHA]

### Domain: Petition System Frontend + Enhanced Solidarity Reactions
### Files to create:
- `public/petitions.js` — Petition section UI, rendering, signing flow
- `public/petitions.css` — Petition-specific styles
- `public/reactions.js` — Enhanced reaction system (beyond existing Me Too)
- `public/reactions.css` — Reaction button styles

### Task 1: Petition Section UI
The backend already has full petition APIs. Build the frontend:

1. **Petition section** — inject after the Community section in index.html using DOM
   - Section title: "Take Action" with subtitle "Join campaigns that demand accountability"
   - List of active petitions from GET /api/campaigns/petitions
   - Each petition card shows: title, description, signature count, goal, animated progress bar
   - "Sign This Petition" button per card (calls POST /api/campaigns/petitions/:id/sign)
   - After signing: show celebration animation, updated count, social sharing prompt
   - Progress bar fills based on signatures/goal ratio with milestone markers (25%, 50%, 75%, 100%)

2. **Featured Open Letter** — a prominent, pre-built open letter at the top:
   - Title: "Open Letter: Demand Transparent AI Displacement Reporting"
   - Pre-written letter text visible on expand
   - Large signature counter with animated number
   - "Sign & Add Your Voice" CTA button
   - After signing: "Share this letter" with pre-written social copy for Twitter/LinkedIn
   - Display: "This letter includes stories from X affected workers across Y countries"

### Task 2: Enhanced Solidarity Reactions
Existing: "Me Too" button on story cards (working). Enhance to a full reaction system:

1. Replace single "Me Too" with expandable reaction bar:
   - "I've been there" (fist icon, ph-hand-fist) — solidarity, replaces Me Too
   - "Sending strength" (heart icon, ph-heart) — support
   - "Thank you" (hands icon, ph-hands-clapping) — gratitude
   - Each shows count, animates on click
2. Aggregate display: "423 people expressed solidarity with this story"
3. Reaction bar appears on hover/tap, collapses otherwise
4. Post reaction: brief "Thank you for standing with [name]" toast

### Technical Notes
- petitions.js should be an IIFE that waits for DOMContentLoaded
- Use the global `app` instance (window.app) for fetchJSON/postJSON/toast/esc/fmt helpers
- Inject HTML sections using insertAdjacentHTML on the appropriate parent
- All styles scoped with `.petition-*` and `.reaction-*` class prefixes

---

## [BETA]

### Domain: Live Pulse Counter + Breaking Ticker + Identity Carousel
### Files to create:
- `public/live-signals.js` — All real-time engagement signals
- `public/live-signals.css` — Ticker, pulse counter, carousel styles

### Task 1: Live Pulse Counter
1. **"Since you arrived" counter** — small floating badge or hero insert:
   - Calculate displacement rate from stats (laidOff count / time period)
   - Show: "~X people displaced by AI since you opened this page"
   - Number ticks up every few seconds using the calculated rate
   - Subtle pulse animation on each tick
   - Position: inside hero sidebar, below existing stats

2. **Hero stat enhancement** — make existing counter stats more alive:
   - Add subtle "live" pulse dot next to the "Live data" badge (already exists, just animate it)
   - Numbers should have a gentle glow on the initial count-up animation

### Task 2: Breaking Ticker
1. **Horizontal scrolling ticker bar** between nav and hero:
   - Pulls recent stories + news items from existing APIs
   - Format: "2h ago — Maya R. shared: 'Company replaced team with AI' | 5h ago — New article: AI layoffs accelerating | Yesterday — 3 new stories from Germany"
   - Smooth CSS marquee animation (infinite scroll left)
   - Pause on hover
   - Subtle separator between items (dot or pipe)
   - Background: slightly darker than nav, text in muted color
   - "LIVE" badge on the left side, fixed position

### Task 3: Identity-Driven Word Carousel
1. **Animated profession cycling** in hero title:
   - Current hero: "The *human* cost of artificial intelligence"
   - Add below it or integrate: cycling through professions affected
   - Words cycle: DEVELOPERS, DESIGNERS, WRITERS, TRANSLATORS, QA ENGINEERS, SUPPORT AGENTS, DATA ANALYSTS
   - Fade-up/fade-down animation, 2-second interval
   - Uses --signal-amber color for the cycling word
   - Subtle, not distracting — complement the hero, don't overwhelm

### Technical Notes
- live-signals.js should be an IIFE that waits for DOMContentLoaded
- Ticker data: combine /api/stories (recent) + /api/news (recent), sort by date, format as ticker items
- Use requestAnimationFrame for smooth counter animations
- CSS animations for ticker (transform: translateX, @keyframes)
- All styles scoped with `.ticker-*`, `.pulse-*`, `.carousel-*` class prefixes

---

## [GAMMA]

### Domain: Personal Impact Calculator + Email Digest Subscription
### Files to create:
- `public/calculator.js` — Interactive profession risk calculator
- `public/calculator.css` — Calculator section styles
- `public/digest.js` — Newsletter subscription form + logic
- `public/digest.css` — Digest section styles

### Task 1: Personal Impact Calculator
1. **New section** — inject after Dashboard section using DOM:
   - Section title: "How Does AI Affect Your Career?"
   - Subtitle: "Enter your profession to see personalized insights"

2. **Interactive calculator UI**:
   - Large search/input: "Enter your profession..."
   - Autocomplete dropdown with common professions
   - On submit, show results card:
     - **Risk level**: Low / Medium / High / Critical (with color indicator)
     - **Estimated % of roles affected** by AI in this field
     - **Average recovery time**: "X months to find new work"
     - **Top transition paths**: "People in your field moved to: [roles]"
     - **Skills to learn**: 3-4 recommended skills
     - **Success stories**: "X people in your field found new work" (link to filtered stories)
   - "Share your result" button with pre-written social copy

3. **Profession data**: Build a static dataset in the JS file with ~30 common professions:
   - Copywriter, UX Designer, Graphic Designer, Developer, QA Engineer, Translator, Support Agent, Data Entry, Accountant, Recruiter, Paralegal, Marketing Analyst, etc.
   - Each with: riskLevel, affectedPercent, avgRecoveryMonths, transitionPaths[], recommendedSkills[]
   - Data should feel research-backed (use realistic estimates based on industry reports)

### Task 2: Email Digest Subscription
1. **Subscription bar** — inject before footer using DOM:
   - Headline: "Stay Informed. Stay Connected."
   - Subtitle: "Weekly digest of AI displacement news, community stories, and action opportunities"
   - Email input + "Subscribe" button
   - After submit: success message "You're in! First digest arrives next Monday."
   - Below: "Join X,XXX subscribers" (social proof counter)

2. **Backend API**: Add to server.js:
   - `POST /api/digest/subscribe` — accepts { email }, validates, stores in `data/subscribers.json`
   - `GET /api/digest/count` — returns subscriber count for social proof
   - Basic email validation (Zod), duplicate checking, rate limiting

3. **Minimal subscription storage**:
   - Store: { id, email, subscribedAt, country, language }
   - No actual email sending (future feature) — just collect subscribers for now

### Technical Notes
- calculator.js should be an IIFE that waits for DOMContentLoaded
- Calculator uses NO external APIs — all data is embedded in the JS file
- For the profession autocomplete, use a simple datalist or custom dropdown
- digest.js adds its own API call to postJSON for subscription
- Gamma MUST also edit server.js to add the 2 new API endpoints (subscribe + count)
- All styles scoped with `.calc-*` and `.digest-*` class prefixes

---

## [RULES]

### Communication
- Post updates to MAILBOX.md in the format specified
- Keep messages SHORT — code speaks, not prose
- Report: files created, lines of code, what works, what's left

### File Boundaries (CRITICAL)
- Alpha: ONLY creates/edits `public/petitions.js`, `public/petitions.css`, `public/reactions.js`, `public/reactions.css`
- Beta: ONLY creates/edits `public/live-signals.js`, `public/live-signals.css`
- Gamma: ONLY creates/edits `public/calculator.js`, `public/calculator.css`, `public/digest.js`, `public/digest.css`, AND adds 2 API routes to `server.js`
- **TL integrates**: adds `<script>` and `<link>` tags to index.html

### Quality Bar
- All JS must use the `window.app` instance for shared utilities (fetchJSON, postJSON, esc, fmt, toast)
- All CSS must use existing CSS variables (--surface-*, --text-*, --signal-*, --sp-*, --radius-*)
- All HTML injection must use proper XSS escaping via app.esc()
- Mobile responsive (no horizontal overflow)
- Dark theme by default, light theme support (use CSS variables, not hardcoded colors)
- Phosphor Icons for all icons (already loaded)

### Never
- Never edit index.html directly (TL does integration)
- Never edit app.js directly (use window.app for shared utilities)
- Never edit styles.css directly (write to your own CSS files)
- Never install new npm packages
- Never kill processes
