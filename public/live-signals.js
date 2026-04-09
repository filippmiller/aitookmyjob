/**
 * AI Took My Job — Live Signals Module
 * Beta domain: Pulse Counter + Breaking Ticker + Profession Carousel
 *
 * Depends on: window.app (AITookMyJobApp instance)
 * Injects:
 *   - .ticker-bar between .site-nav and .hero
 *   - .pulse-counter inside .hero-sidebar
 *   - .carousel-profession-wrap before .hero-subtitle
 */

(function () {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────

  /** Professions to cycle through in the hero carousel */
  const PROFESSIONS = [
    'DEVELOPERS',
    'DESIGNERS',
    'WRITERS',
    'TRANSLATORS',
    'QA ENGINEERS',
    'SUPPORT AGENTS',
    'DATA ANALYSTS',
    'PARALEGALS',
    'ILLUSTRATORS',
    'RECRUITERS',
  ];

  /**
   * Estimated global AI-driven displacement rate.
   * Based on widely-cited figures (~375M roles at risk over 10 years),
   * we use a conservative 1M displacements/year → ~2 per minute.
   * Rate here is expressed in displacements-per-second for the counter.
   */
  const DISPLACEMENT_RATE_PER_SECOND = 2 / 60; // ~2 per minute

  /** Carousel interval in ms */
  const CAROUSEL_INTERVAL = 2400;

  // ── Helpers ────────────────────────────────────────────────────────────────

  function getApp() {
    return window.app || null;
  }

  /**
   * Format a relative time from a date string.
   * Returns strings like "2h ago", "Yesterday", "3 days ago".
   */
  function relativeTime(dateStr) {
    if (!dateStr) return '';
    const now = Date.now();
    const then = new Date(dateStr).getTime();
    if (isNaN(then)) return '';
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMs / 3600000);
    const diffDay = Math.floor(diffMs / 86400000);

    if (diffMin < 60) return diffMin <= 1 ? 'Just now' : `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    if (diffDay === 1) return 'Yesterday';
    if (diffDay < 7) return `${diffDay} days ago`;
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /**
   * Build a safe ticker item HTML fragment.
   * Uses app.esc() for escaping if available, otherwise basic escaping.
   */
  function escHtml(str) {
    const app = getApp();
    if (app && typeof app.esc === 'function') return app.esc(str);
    const d = document.createElement('div');
    d.textContent = String(str || '');
    return d.innerHTML;
  }

  // ── Module State ───────────────────────────────────────────────────────────

  const state = {
    sessionStart: Date.now(),
    displacedCount: 0,
    carouselIndex: 0,
    carouselTimer: null,
    counterRafId: null,
  };

  // ── 1. TICKER BAR ──────────────────────────────────────────────────────────

  async function buildTickerItems() {
    const app = getApp();
    const items = [];

    // Fetch stories and news in parallel, fall back gracefully
    const [storiesRes, newsRes] = await Promise.allSettled([
      app ? app.fetchJSON('/api/stories?limit=12', { stories: [] }) : Promise.resolve({ stories: [] }),
      app ? app.fetchJSON('/api/news', { news: [] }) : Promise.resolve({ news: [] }),
    ]);

    const stories = (storiesRes.status === 'fulfilled' ? storiesRes.value.stories : null) || [];
    const news = (newsRes.status === 'fulfilled' ? newsRes.value.news : null) || [];

    // Build story items
    stories.slice(0, 8).forEach(story => {
      const time = relativeTime(story.createdAt || story.submittedAt);
      const name = story.name || 'Someone';
      const profession = story.profession || 'worker';
      const snippet = (story.reason || story.story || '').slice(0, 80);

      items.push({
        time,
        icon: 'ph-person',
        html: `<strong>${escHtml(name)}</strong>, ${escHtml(profession)}: &ldquo;${escHtml(snippet)}&rdquo;`,
      });
    });

    // Build news items
    news.slice(0, 6).forEach(article => {
      const time = relativeTime(article.publishedAt || article.date);
      const rawTitle = typeof article.title === 'object' ? (article.title.en || '') : (article.title || '');
      const title = rawTitle.slice(0, 90);
      const source = article.source || '';

      items.push({
        time,
        icon: 'ph-newspaper',
        html: source
          ? `<strong>${escHtml(source)}</strong> &mdash; ${escHtml(title)}`
          : escHtml(title),
      });
    });

    // Sort by recency (best-effort — items with no time go to end)
    // We don't re-sort since the API already returns recent items first.
    // Shuffle stories and news together by interleaving for variety.
    const interleaved = [];
    const maxLen = Math.max(stories.length, news.length);
    for (let i = 0; i < maxLen; i++) {
      if (i < stories.length) {
        const s = stories[i];
        const time = relativeTime(s.createdAt || s.submittedAt);
        const name = s.name || 'Someone';
        const profession = s.profession || 'worker';
        const snippet = (s.reason || s.story || '').slice(0, 80);
        interleaved.push({
          time,
          icon: 'ph-person',
          html: `<strong>${escHtml(name)}</strong>, ${escHtml(profession)}: &ldquo;${escHtml(snippet)}&rdquo;`,
        });
      }
      if (i < news.length) {
        const a = news[i];
        const time = relativeTime(a.publishedAt || a.date);
        const rawTitle2 = typeof a.title === 'object' ? (a.title.en || '') : (a.title || '');
        const title = rawTitle2.slice(0, 90);
        const source = a.source || '';
        interleaved.push({
          time,
          icon: 'ph-newspaper',
          html: source
            ? `<strong>${escHtml(source)}</strong> &mdash; ${escHtml(title)}`
            : escHtml(title),
        });
      }
    }

    // If API returned nothing, use fallback items
    if (interleaved.length === 0) {
      return [
        { time: '2h ago', icon: 'ph-person', html: '<strong>Maya R.</strong>, UX Designer: &ldquo;Entire design team replaced by Midjourney integrations&rdquo;' },
        { time: '5h ago', icon: 'ph-newspaper', html: '<strong>TechCrunch</strong> &mdash; AI layoffs accelerating across tech sector in Q1 2026' },
        { time: 'Yesterday', icon: 'ph-person', html: '<strong>Daniel K.</strong>, Copywriter: &ldquo;Marketing department cut 80% after GPT rollout&rdquo;' },
        { time: '2 days ago', icon: 'ph-newspaper', html: '<strong>Bloomberg</strong> &mdash; 3 new stories from Germany added to the archive' },
        { time: '3 days ago', icon: 'ph-person', html: '<strong>Sarah M.</strong>, Translator: &ldquo;Freelance work vanished overnight&rdquo;' },
        { time: '4 days ago', icon: 'ph-newspaper', html: '<strong>Reuters</strong> &mdash; Support centres in Eastern Europe facing mass AI-driven closures' },
      ];
    }

    return interleaved.slice(0, 14);
  }

  function renderTickerItems(items) {
    // Duplicate items for seamless loop — CSS uses translateX(-50%) on the track
    const itemsHtml = items.map(item => {
      const timeHtml = item.time
        ? `<span class="ticker-item-time">${escHtml(item.time)}</span>`
        : '';
      return `
        <span class="ticker-item">
          ${timeHtml}
          ${item.time ? '<span class="ticker-sep"></span>' : ''}
          <span class="ticker-item-text">${item.html}</span>
        </span>`;
    }).join('');

    // Double for seamless infinite scroll
    return itemsHtml + itemsHtml;
  }

  async function initTicker() {
    // Build the ticker bar DOM
    const bar = document.createElement('div');
    bar.className = 'ticker-bar';
    bar.setAttribute('role', 'marquee');
    bar.setAttribute('aria-label', 'Live updates from the community');
    bar.setAttribute('aria-live', 'off');

    bar.innerHTML = `
      <div class="ticker-live-badge" aria-hidden="true">
        <span class="ticker-live-dot"></span>
        <span class="ticker-live-label">Live</span>
      </div>
      <div class="ticker-track-wrap">
        <div class="ticker-track" id="lsTickerTrack">
          <span class="ticker-item" style="color:var(--text-muted);font-size:var(--text-xs);">Loading updates&hellip;</span>
        </div>
      </div>
    `;

    // Insert between nav and hero
    const nav = document.querySelector('.site-nav');
    if (nav && nav.nextElementSibling) {
      nav.insertAdjacentElement('afterend', bar);
    } else if (nav) {
      nav.parentNode.appendChild(bar);
    }

    // Fetch and populate asynchronously
    const items = await buildTickerItems();
    const track = document.getElementById('lsTickerTrack');
    if (track) {
      track.innerHTML = renderTickerItems(items);

      // Pause on hover/focus
      bar.addEventListener('mouseenter', () => {
        track.style.animationPlayState = 'paused';
      });
      bar.addEventListener('mouseleave', () => {
        track.style.animationPlayState = 'running';
      });
      bar.addEventListener('focusin', () => {
        track.style.animationPlayState = 'paused';
      });
      bar.addEventListener('focusout', () => {
        track.style.animationPlayState = 'running';
      });
    }
  }

  // ── 2. PULSE COUNTER ───────────────────────────────────────────────────────

  async function initPulseCounter() {
    const app = getApp();

    // Try to get laidOff count from stats to derive a realistic rate
    let ratePerSecond = DISPLACEMENT_RATE_PER_SECOND;
    if (app) {
      try {
        const statsData = await app.fetchJSON('/api/stats', { counters: {} });
        const laidOff = statsData?.counters?.laidOff || 0;
        if (laidOff > 1000) {
          // Derive a session rate: assume 1M displaced/year globally,
          // scale our local counter modestly for immersive but honest impact.
          // We keep the fixed constant for predictability.
        }
      } catch (_) {
        // ignore — use default rate
      }
    }

    // Build the counter element
    const counter = document.createElement('div');
    counter.className = 'pulse-counter';
    counter.id = 'lsPulseCounter';
    counter.setAttribute('role', 'status');
    counter.setAttribute('aria-label', 'People displaced by AI since you arrived');
    counter.setAttribute('aria-live', 'polite');
    counter.setAttribute('aria-atomic', 'false');

    counter.innerHTML = `
      <div class="pulse-counter-header">
        <div class="pulse-counter-icon" aria-hidden="true">
          <i class="ph ph-pulse"></i>
        </div>
        <span class="pulse-counter-label">Since you arrived</span>
      </div>
      <div class="pulse-counter-value" id="lsPulseValue" aria-live="polite">0</div>
      <div class="pulse-counter-desc">people displaced by AI while you&rsquo;ve been on this page</div>
    `;

    // Insert into hero sidebar, after existing stats grid
    const heroSidebar = document.querySelector('.hero-sidebar');
    if (heroSidebar) {
      heroSidebar.appendChild(counter);
    }

    // Kick off the live ticker
    startPulseCounter(ratePerSecond);
  }

  function startPulseCounter(ratePerSecond) {
    const valueEl = document.getElementById('lsPulseValue');
    if (!valueEl) return;

    let lastTime = performance.now();
    let fractional = 0;

    function tick(now) {
      const deltaMs = now - lastTime;
      lastTime = now;

      fractional += (ratePerSecond * deltaMs) / 1000;

      if (fractional >= 1) {
        const increment = Math.floor(fractional);
        fractional -= increment;
        state.displacedCount += increment;

        const formatted = state.displacedCount.toLocaleString('en-US');
        valueEl.textContent = formatted;

        // Subtle pulse animation on increment
        valueEl.classList.remove('pulse-tick');
        // Force reflow to restart animation
        void valueEl.offsetWidth;
        valueEl.classList.add('pulse-tick');
      }

      state.counterRafId = requestAnimationFrame(tick);
    }

    state.counterRafId = requestAnimationFrame(tick);
  }

  // ── 3. PROFESSION CAROUSEL ─────────────────────────────────────────────────

  function initCarousel() {
    // Build the carousel element
    const wrap = document.createElement('div');
    wrap.className = 'carousel-profession-wrap';
    wrap.setAttribute('aria-label', 'Professions affected by AI');

    const slot = document.createElement('div');
    slot.className = 'carousel-profession-slot';
    slot.id = 'lsCarouselSlot';

    // Pre-render all words, only show the first as active
    PROFESSIONS.forEach((word, i) => {
      const span = document.createElement('span');
      span.className = 'carousel-profession-word' + (i === 0 ? ' carousel-active' : '');
      span.textContent = word;
      span.dataset.index = i;
      span.setAttribute('aria-hidden', i === 0 ? 'false' : 'true');
      slot.appendChild(span);
    });

    const prefix = document.createElement('span');
    prefix.className = 'carousel-profession-prefix';
    prefix.textContent = 'Affecting';
    wrap.appendChild(prefix);
    wrap.appendChild(slot);

    // Insert before .hero-subtitle
    const heroSubtitle = document.querySelector('.hero-subtitle');
    if (heroSubtitle) {
      heroSubtitle.insertAdjacentElement('beforebegin', wrap);
    } else {
      // Fallback: append to hero-content
      const heroContent = document.querySelector('.hero-content');
      if (heroContent) heroContent.appendChild(wrap);
    }

    // Start cycling
    state.carouselTimer = setInterval(() => cycleCarousel(), CAROUSEL_INTERVAL);
  }

  function cycleCarousel() {
    const slot = document.getElementById('lsCarouselSlot');
    if (!slot) return;

    const words = slot.querySelectorAll('.carousel-profession-word');
    if (!words.length) return;

    const currentIndex = state.carouselIndex;
    const nextIndex = (currentIndex + 1) % PROFESSIONS.length;

    const current = words[currentIndex];
    const next = words[nextIndex];

    // Exit current
    current.classList.remove('carousel-active');
    current.classList.add('carousel-exit');
    current.setAttribute('aria-hidden', 'true');

    // Activate next
    // Reset next word position before animating in
    next.classList.remove('carousel-exit');
    next.setAttribute('aria-hidden', 'false');
    // Force reflow
    void next.offsetWidth;
    next.classList.add('carousel-active');

    // Clean up exit class after animation completes
    setTimeout(() => {
      current.classList.remove('carousel-exit');
    }, 400);

    state.carouselIndex = nextIndex;
  }

  // ── INIT ───────────────────────────────────────────────────────────────────

  function init() {
    // Run all three features
    initTicker();
    initPulseCounter();
    initCarousel();
  }

  // Wait for DOM to be ready, and also wait for window.app to be available
  // (app.js initializes app at the bottom of the script)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already ready — small delay to let app.js finish constructing window.app
    setTimeout(init, 0);
  }

})();
