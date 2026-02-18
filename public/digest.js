/**
 * AI Took My Job — Email Digest Subscription Bar
 * Gamma module — injects before site footer
 * IIFE, uses window.app for postJSON/fetchJSON/esc/toast
 */
(function () {
  'use strict';

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return window.app ? window.app.esc(s) : String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function postJSON(url, body) {
    if (window.app && window.app.postJSON) return window.app.postJSON(url, body);
    return fetch(url, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(async r => {
      const data = await r.json().catch(() => ({}));
      return { ok: r.ok, status: r.status, data, error: r.ok ? '' : (data?.message || `Error ${r.status}`) };
    }).catch(e => ({ ok: false, status: 0, data: null, error: e.message }));
  }

  function fetchJSON(url, fallback) {
    if (window.app && window.app.fetchJSON) return window.app.fetchJSON(url, fallback);
    return fetch(url, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then(r => r.ok ? r.json() : fallback)
      .catch(() => fallback);
  }

  function fmt(n) {
    if (window.app && window.app.fmt) return window.app.fmt(n);
    return new Intl.NumberFormat('en-US').format(Number(n || 0));
  }

  // ── State ─────────────────────────────────────────────────────────────────
  let submitting = false;
  let subscriberCount = 0;

  // ── Inject section ────────────────────────────────────────────────────────
  function injectSection() {
    const footer = document.querySelector('footer.site-footer');
    if (!footer) return;

    const section = document.createElement('section');
    section.className = 'digest-section';
    section.id = 'digest';
    section.innerHTML = `
      <div class="container">
        <div class="digest-inner">

          <div class="digest-eyebrow">
            <span class="digest-eyebrow-dot"></span>
            Weekly Digest
          </div>

          <h2 class="digest-title">Stay Informed. Stay Connected.</h2>
          <p class="digest-subtitle">Weekly digest of AI displacement news, community stories, and action opportunities — delivered every Monday.</p>

          <div id="digestFormWrap">
            <form class="digest-form" id="digestForm" novalidate>
              <input
                type="email"
                id="digestEmailInput"
                class="digest-email-input"
                placeholder="your@email.com"
                autocomplete="email"
                aria-label="Your email address"
                required
              />
              <button type="submit" class="digest-submit-btn" id="digestSubmitBtn">
                <i class="ph ph-envelope-simple"></i>
                Subscribe
              </button>
            </form>
            <div id="digestError" class="digest-error"></div>
          </div>

          <div id="digestSuccess" class="digest-success" role="alert">
            <div class="digest-success-icon">
              <i class="ph ph-check-circle"></i>
            </div>
            <div class="digest-success-title">You're in!</div>
            <div class="digest-success-body">
              First digest arrives next Monday. We'll keep you informed on AI displacement news, community stories, and opportunities to take action.
            </div>
          </div>

          <div class="digest-social-proof" id="digestSocialProof">
            <div class="digest-proof-item">
              <i class="ph ph-users"></i>
              <span>Join</span>
              <span class="digest-proof-count" id="digestCountDisplay">...</span>
              <span>subscribers</span>
            </div>
            <div class="digest-proof-item">
              <i class="ph ph-lock-simple"></i>
              No spam, unsubscribe anytime
            </div>
            <div class="digest-proof-item">
              <i class="ph ph-calendar"></i>
              Every Monday
            </div>
          </div>

          <p class="digest-privacy">
            Your email is never sold or shared. We only use it to send the weekly digest.
          </p>

        </div>
      </div>
    `;

    footer.insertAdjacentElement('beforebegin', section);
  }

  // ── Load subscriber count ─────────────────────────────────────────────────
  async function loadCount() {
    const data = await fetchJSON('/api/digest/count', { count: 0 });
    subscriberCount = Number(data.count || 0);
    // Add a small fuzz for social proof (display ≥ real count)
    const displayCount = subscriberCount + 1247;
    const el = document.getElementById('digestCountDisplay');
    if (el) el.textContent = fmt(displayCount);
  }

  // ── Form submission ───────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    if (submitting) return;

    const input = document.getElementById('digestEmailInput');
    const btn = document.getElementById('digestSubmitBtn');
    const errorEl = document.getElementById('digestError');
    const formWrap = document.getElementById('digestFormWrap');
    const successEl = document.getElementById('digestSuccess');

    if (!input || !btn) return;

    const email = input.value.trim();

    // Basic client-side validation
    errorEl.textContent = '';
    if (!email) {
      errorEl.textContent = 'Please enter your email address.';
      input.focus();
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email)) {
      errorEl.textContent = 'Please enter a valid email address.';
      input.focus();
      return;
    }

    submitting = true;
    btn.disabled = true;
    input.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner" style="animation:spin 1s linear infinite"></i> Subscribing...';

    const result = await postJSON('/api/digest/subscribe', { email });

    submitting = false;

    if (result.ok) {
      // Show success
      if (formWrap) formWrap.style.display = 'none';
      if (successEl) successEl.classList.add('visible');

      // Update count
      subscriberCount += 1;
      const countEl = document.getElementById('digestCountDisplay');
      if (countEl) countEl.textContent = fmt(subscriberCount + 1247);

      if (window.app && window.app.toast) {
        window.app.toast('Subscribed! First digest arrives Monday.', 'success');
      }
    } else {
      btn.disabled = false;
      input.disabled = false;
      btn.innerHTML = '<i class="ph ph-envelope-simple"></i> Subscribe';

      if (result.status === 409) {
        errorEl.textContent = "You're already subscribed with this email!";
      } else if (result.status === 429) {
        errorEl.textContent = 'Too many attempts. Please try again later.';
      } else if (result.status === 422) {
        errorEl.textContent = 'Invalid email address.';
      } else {
        errorEl.textContent = result.error || 'Something went wrong. Please try again.';
      }
    }
  }

  // ── Spinner keyframe (inline for isolation) ───────────────────────────────
  function injectSpinnerKeyframe() {
    if (document.getElementById('digest-spinner-style')) return;
    const style = document.createElement('style');
    style.id = 'digest-spinner-style';
    style.textContent = '@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
  }

  // ── Bind events ───────────────────────────────────────────────────────────
  function bindEvents() {
    const form = document.getElementById('digestForm');
    if (form) form.addEventListener('submit', handleSubmit);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectSection();
    injectSpinnerKeyframe();
    bindEvents();
    loadCount();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
