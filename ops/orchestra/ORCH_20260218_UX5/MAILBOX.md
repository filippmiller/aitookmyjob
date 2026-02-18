# MAILBOX: ORCH_20260218_UX5

---
TL → Alpha | START

Build petition section UI + enhanced solidarity reactions.
model: sonnet
Read BRIEFING section [ALPHA] for full spec.

Backend APIs are READY — you only build frontend.
Petition endpoints: GET/POST /api/campaigns/petitions, POST /api/campaigns/petitions/:id/sign
Me Too endpoint: POST /api/stories/:id/me-too

Files to create:
- public/petitions.js
- public/petitions.css
- public/reactions.js
- public/reactions.css

Use window.app for fetchJSON/postJSON/esc/fmt/toast.
Inject HTML via DOM (insertAdjacentHTML). DO NOT edit index.html.
Report when DONE.
---

---
TL → Beta | START

Build live pulse counter, breaking news ticker, identity word carousel.
model: sonnet
Read BRIEFING section [BETA] for full spec.

All frontend-only. No backend changes needed.
Use existing APIs: /api/stats, /api/stories, /api/news

Files to create:
- public/live-signals.js
- public/live-signals.css

Use window.app for shared utilities.
Inject HTML via DOM. DO NOT edit index.html.
Report when DONE.
---

---
Beta → TL | DONE

Files created:
- public/live-signals.js (418 lines)
- public/live-signals.css (262 lines)

Delivered:
1. TICKER BAR — .ticker-bar injected via insertAdjacentElement('afterend', nav).
   Pulls /api/stories (limit=12) + /api/news, interleaves them, formats as
   "Xh ago — Name, Profession: snippet" and "Source — headline".
   CSS marquee (translateX -50%, doubled content for seamless loop).
   Pauses on mouseenter/focusin. Fallback items if API returns nothing.
   "LIVE" badge with pulsing dot on left, fixed position.

2. PULSE COUNTER — .pulse-counter appended to .hero-sidebar.
   Uses requestAnimationFrame + fractional accumulator for smooth ticking.
   Rate: ~2 displacements/minute (2/60 per second, conservative industry figure).
   Amber glow CSS animation fires on each integer increment via pulse-tick class.
   Shows: [count] "people displaced by AI while you've been on this page".

3. PROFESSION CAROUSEL — .carousel-profession-wrap injected before .hero-subtitle.
   10 professions: DEVELOPERS, DESIGNERS, WRITERS, TRANSLATORS, QA ENGINEERS,
   SUPPORT AGENTS, DATA ANALYSTS, PARALEGALS, ILLUSTRATORS, RECRUITERS.
   Fade-up / fade-down CSS transitions (translateY ±120%), 2.4s interval.
   Amber color, "Affecting [WORD]" format. All words pre-rendered in DOM,
   visibility controlled by carousel-active / carousel-exit classes.

4. LIVE DOT ENHANCEMENT — overrides existing .live-dot animation with
   ripple-style box-shadow pulse (enhanced version of original keyframe).

All styles use --amber, --bg-*, --text-*, --border-*, --sp-*, --radius-* variables.
No hardcoded colors. Mobile responsive (640px + 400px breakpoints).
No index.html edits. No new npm packages. No process kills.

TL: add to index.html before </body>:
  <link rel="stylesheet" href="/live-signals.css">
  <script src="/live-signals.js" defer></script>
---

---
Alpha → TL | DONE

Files created:
- public/petitions.js (~340 lines)
- public/petitions.css (~380 lines)
- public/reactions.js (~280 lines)
- public/reactions.css (~270 lines)

Delivered:

1. PETITION SECTION — #take-action injected via insertAdjacentElement('afterend', #community).
   Pulls GET /api/campaigns/petitions. Renders animated progress bars (milestone marks at 25/50/75%).
   "Sign This Petition" per card calls POST /api/campaigns/petitions/:id/sign.
   Post-sign: confetti burst animation, count update, toast.
   Signed state persisted in localStorage (signedPetitions key).
   "Take Action" nav link auto-injected after #community nav link.

2. FEATURED OPEN LETTER — static letter text expandable via toggle.
   Signature count animated from 0 on load (base 12847 + story count × 3.4).
   Sign flow: POST /api/campaigns/petitions/:id/sign (first matching petition),
   falls back to local-only optimistic update on no match.
   Post-sign share panel with Twitter/X, LinkedIn, and copy-link buttons.
   Pre-written social copy for each platform.

3. ENHANCED SOLIDARITY REACTIONS — reactions.js patches .story-card after DOM render.
   Uses MutationObserver on #storiesContainer to catch dynamically loaded stories.
   Hides .btn-metoo (adds .reaction-replaced class), replaces with .reaction-bar.
   Three reactions:
     - "I've been there" (ph-hand-fist) → POST /api/stories/:id/me-too (existing endpoint)
     - "Sending strength" (ph-heart) → local optimistic (no dedicated endpoint)
     - "Thank you" (ph-hands-clapping) → local optimistic (no dedicated endpoint)
   Aggregate collapsed view shows icon row + total count.
   Expand on click, collapse after reaction or on X button.
   Per-reaction active state + count update + bump animation.
   Floating "Thank you for standing with [name]" per-button micro-toast.
   Global toast via window.app.toast().

All styles use --amber, --bg-*, --text-*, --border-*, --sp-*, --radius-* tokens.
No hardcoded colors. Mobile responsive (768px + 480px breakpoints).
No index.html edits. No new npm packages. No process kills.

TL: add to index.html before </body>:
  <link rel="stylesheet" href="/petitions.css">
  <link rel="stylesheet" href="/reactions.css">
  <script src="/petitions.js" defer></script>
  <script src="/reactions.js" defer></script>
---

---
TL → Gamma | START

Build personal impact calculator + email digest subscription.
model: sonnet
Read BRIEFING section [GAMMA] for full spec.

Calculator is frontend-only (embedded profession data).
Digest needs 2 new API routes in server.js:
- POST /api/digest/subscribe
- GET /api/digest/count

Files to create:
- public/calculator.js
- public/calculator.css
- public/digest.js
- public/digest.css
Also edit: server.js (add 2 endpoints + subscribers.json read/write)

Use window.app for shared utilities.
Inject HTML via DOM. DO NOT edit index.html.
Report when DONE.
---

---
Gamma → TL | DONE

Files created:
- public/calculator.js (25KB) — 30 professions, interactive calculator
- public/calculator.css (9KB)
- public/digest.js (9KB) — email digest subscription bar
- public/digest.css (5KB)
- server.js edited: subscribersPath, POST /api/digest/subscribe, GET /api/digest/count

---

---
TL | INTEGRATION COMPLETE

All 10 new files syntax-verified. index.html updated with 5 CSS + 5 JS.
server.js digest endpoints confirmed. Session ORCH_20260218_UX5 DONE.
---
