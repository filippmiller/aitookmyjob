// AI Took My Job — Human Signal Edition
// Frontend application matching the "Human Signal" design system

class AITookMyJobApp {
  constructor() {
    this.state = {
      country: 'global',
      lang: 'en',
      meta: { countries: [], languages: ['en'] },
      t: {},
      stats: { counters: {} },
      stories: [],
      authUser: null,
      dashboard: null
    };

    this.theme = localStorage.getItem('theme') || 'dark';
    this.init();
  }

  async init() {
    this.setupTheme();
    this.bindStaticListeners();
    await this.loadInitialData();
    this.render();
    this.startRealTimeUpdates();
  }

  // ── Data fetching ──

  async fetchJSON(url, fallback = {}) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
        signal: ctrl.signal
      });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      console.warn(`Fetch ${url}:`, e.message);
      return fallback;
    }
  }

  async postJSON(url, body) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 10000);
      const res = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: ctrl.signal
      });
      clearTimeout(timer);
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json() : await res.text();
      return { ok: res.ok, status: res.status, data, error: res.ok ? '' : (data?.message || data || `Error ${res.status}`) };
    } catch (e) {
      return { ok: false, status: 0, data: null, error: e.name === 'AbortError' ? 'Request timeout' : 'Network error' };
    }
  }

  // ── Utilities ──

  esc(text) {
    const d = document.createElement('div');
    d.textContent = String(text || '');
    return d.innerHTML;
  }

  fmt(n) {
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(n || 0));
  }

  // ── Theme ──

  setupTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
    this.updateThemeIcon();
  }

  toggleTheme() {
    this.theme = this.theme === 'dark' ? 'light' : 'dark';
    localStorage.setItem('theme', this.theme);
    document.documentElement.setAttribute('data-theme', this.theme);
    this.updateThemeIcon();
  }

  updateThemeIcon() {
    const btn = document.getElementById('themeToggle');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (icon) {
      icon.className = this.theme === 'dark' ? 'ph ph-sun-dim' : 'ph ph-moon';
    }
  }

  // ── Event listeners ──

  bindStaticListeners() {
    // Theme toggle
    const themeBtn = document.getElementById('themeToggle');
    if (themeBtn) themeBtn.addEventListener('click', () => this.toggleTheme());

    // Mobile menu
    const mobileToggle = document.getElementById('mobileMenuToggle');
    const navLinks = document.getElementById('navLinks');
    if (mobileToggle && navLinks) {
      mobileToggle.addEventListener('click', () => {
        navLinks.classList.toggle('is-open');
        const icon = mobileToggle.querySelector('i');
        if (icon) {
          icon.className = navLinks.classList.contains('is-open') ? 'ph ph-x' : 'ph ph-list';
        }
      });
    }

    // Auth modal — index.html
    const authTrigger = document.getElementById('authTriggerBtn');
    const authModal = document.getElementById('authModal');
    const authClose = document.getElementById('authModalClose');

    if (authTrigger && authModal) {
      authTrigger.addEventListener('click', () => this.openModal(authModal));
    }
    if (authClose && authModal) {
      authClose.addEventListener('click', () => this.closeModal(authModal));
    }
    if (authModal) {
      authModal.addEventListener('click', (e) => {
        if (e.target === authModal) this.closeModal(authModal);
      });
    }

    // Share Story button — scrolls to stories or opens modal
    const shareBtn = document.getElementById('shareStoryBtn');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const stories = document.getElementById('stories');
        if (stories) stories.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Tab switching (works on both pages)
    document.addEventListener('click', (e) => {
      const tabBtn = e.target.closest('.tab-btn');
      if (!tabBtn) return;
      const tabName = tabBtn.dataset.tab;
      if (!tabName) return;

      // Find the closest parent that contains tabs
      const tabContainer = tabBtn.closest('.card, .modal-panel');
      if (!tabContainer) return;

      tabContainer.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
      });
      tabContainer.querySelectorAll('.tab-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === `${tabName}Tab`);
      });
    });

    // Login form
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleLogin(loginForm);
      });
    }

    // Register form
    const registerForm = document.getElementById('registerForm');
    if (registerForm) {
      registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleRegister(registerForm);
      });
    }

    // Country / Language selectors
    const countrySelect = document.getElementById('countrySelect');
    if (countrySelect) {
      countrySelect.addEventListener('change', (e) => {
        this.state.country = e.target.value;
        this.loadInitialData().then(() => this.render());
      });
    }
    const langSelect = document.getElementById('langSelect');
    if (langSelect) {
      langSelect.addEventListener('change', (e) => {
        this.state.lang = e.target.value;
      });
    }

    // Smooth scroll for anchor links
    document.addEventListener('click', (e) => {
      const anchor = e.target.closest('a[href^="#"]');
      if (!anchor) return;
      const id = anchor.getAttribute('href').substring(1);
      const target = document.getElementById(id);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // Close mobile menu when clicking a nav link
    if (navLinks) {
      navLinks.addEventListener('click', (e) => {
        if (e.target.closest('.nav-link')) {
          navLinks.classList.remove('is-open');
          const icon = mobileToggle?.querySelector('i');
          if (icon) icon.className = 'ph ph-list';
        }
      });
    }
  }

  // ── Modal helpers ──

  openModal(el) {
    el.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  closeModal(el) {
    el.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  // ── Auth ──

  async handleLogin(form) {
    const email = form.loginEmail.value.trim();
    const password = form.loginPassword.value;
    if (!email || !password) return this.toast('Enter email and password', 'error');

    const btn = form.querySelector('button[type="submit"]');
    this.setLoading(btn, true, 'Signing in...');

    const res = await this.postJSON('/api/auth/login', { email, password });

    if (res.ok) {
      this.toast('Signed in successfully', 'success');
      this.state.authUser = res.data;
      form.reset();
      const modal = document.getElementById('authModal');
      if (modal) this.closeModal(modal);
      this.onAuthChange();
    } else {
      this.toast(res.error || 'Login failed', 'error');
    }

    this.setLoading(btn, false, 'Sign In');
  }

  async handleRegister(form) {
    const email = form.registerEmail.value.trim();
    const password = form.registerPassword.value;
    const confirm = form.confirmPassword.value;

    if (!email || !password || !confirm) return this.toast('Fill in all fields', 'error');
    if (password !== confirm) return this.toast('Passwords do not match', 'error');
    if (password.length < 10) return this.toast('Password must be at least 10 characters', 'error');

    const btn = form.querySelector('button[type="submit"]');
    this.setLoading(btn, true, 'Creating account...');

    const res = await this.postJSON('/api/auth/register', { email, password });

    if (res.ok) {
      this.toast('Account created! Please sign in.', 'success');
      form.reset();
      // Switch to login tab
      const container = form.closest('.card, .modal-panel');
      if (container) {
        container.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'login'));
        container.querySelectorAll('.tab-pane').forEach(p => p.classList.toggle('active', p.id === 'loginTab'));
      }
    } else {
      this.toast(res.error || 'Registration failed', 'error');
    }

    this.setLoading(btn, false, 'Create Account');
  }

  setLoading(btn, loading, text) {
    if (!btn) return;
    btn.disabled = loading;
    btn.textContent = text;
  }

  onAuthChange() {
    // Forum page: show forum, hide cabinet
    const cabinet = document.getElementById('user-cabinet');
    const forum = document.getElementById('forum-preview');
    if (this.state.authUser) {
      if (cabinet) cabinet.classList.add('hidden');
      if (forum) forum.classList.remove('hidden');
    } else {
      if (cabinet) cabinet.classList.remove('hidden');
      if (forum) forum.classList.add('hidden');
    }
  }

  // ── Toast notifications ──

  toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.textContent = message;
    document.body.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateX(20px)';
      el.style.transition = 'all 0.3s ease';
      setTimeout(() => el.remove(), 300);
    }, 3000);
  }

  // ── Data loading ──

  async loadInitialData() {
    const country = this.state.country;

    const [statsData, storiesData, meData] = await Promise.allSettled([
      this.fetchJSON(`/api/stats?country=${country}`, { counters: {} }),
      this.fetchJSON(`/api/stories?country=${country}&limit=12`, { stories: [] }),
      this.fetchJSON('/api/auth/me', null)
    ]);

    this.state.stats = statsData.status === 'fulfilled' ? statsData.value : { counters: {} };
    this.state.stories = storiesData.status === 'fulfilled' ? (storiesData.value.stories || []) : [];

    const me = meData.status === 'fulfilled' ? meData.value : null;
    this.state.authUser = me && me.id ? me : null;
  }

  // ── Rendering ──

  render() {
    this.animateCounters();
    this.renderStories();
    this.initCharts();
    this.onAuthChange();
    this.setupScrollAnimations();
  }

  animateCounters() {
    document.querySelectorAll('[data-target]').forEach(el => {
      const target = parseInt(el.dataset.target, 10);
      if (!target || el._animated) return;
      el._animated = true;

      const duration = 2000;
      const step = target / (duration / 16);
      let current = 0;

      const tick = () => {
        current += step;
        if (current >= target) {
          el.textContent = this.fmt(target);
          return;
        }
        el.textContent = this.fmt(Math.floor(current));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  renderStories() {
    const container = document.getElementById('storiesContainer');
    if (!container || !this.state.stories.length) return;

    container.innerHTML = this.state.stories.map(story => `
      <article class="story-card">
        <div class="story-card-header">
          <div>
            <div class="story-author">${this.esc(story.name)}</div>
            <div class="story-company">${this.esc(story.company)}</div>
          </div>
          <span class="tag tag-amber">${this.esc(story.profession)}</span>
        </div>
        <div class="story-body">${this.esc(story.story)}</div>
        <div class="story-meta">
          <span class="story-meta-item">
            <i class="ph ph-calendar-blank"></i> ${this.esc(story.laidOffAt)}
          </span>
          <span class="story-meta-item">
            <i class="ph ph-eye"></i> ${this.fmt(story.views || 0)}
          </span>
          <span class="story-meta-item">
            <i class="ph ph-map-pin"></i> ${this.esc(story.country || 'Global')}
          </span>
        </div>
      </article>
    `).join('');
  }

  // ── Charts ──

  initCharts() {
    if (typeof Chart === 'undefined') return;

    // Global chart defaults matching the design system
    Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#8A8A90';
    Chart.defaults.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-subtle').trim() || 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";

    const amber = '#D4956B';
    const amberLight = '#E8B98A';
    const teal = '#4A9A8A';
    const signalRed = '#D45454';
    const signalGreen = '#5AA86C';

    this.createChart('trendChart', {
      type: 'line',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [{
          label: 'AI Layoffs',
          data: [1200, 1900, 1500, 2100, 1800, 2400],
          borderColor: amber,
          backgroundColor: 'rgba(212,149,107,0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: amber
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.04)' } },
          x: { grid: { display: false } }
        }
      }
    });

    this.createChart('geoChart', {
      type: 'doughnut',
      data: {
        labels: ['US', 'Europe', 'Asia', 'Other'],
        datasets: [{
          data: [45, 30, 20, 5],
          backgroundColor: [amber, teal, amberLight, signalGreen],
          borderWidth: 0,
          spacing: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } } }
      }
    });

    this.createChart('industryChart', {
      type: 'bar',
      data: {
        labels: ['Tech', 'Finance', 'Media', 'Support', 'Legal', 'Design'],
        datasets: [{
          label: 'Jobs Lost',
          data: [4200, 2800, 2100, 1900, 1200, 1100],
          backgroundColor: [amber, amberLight, teal, signalRed, signalGreen, '#A06840'],
          borderRadius: 4,
          borderSkipped: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' } },
          y: { grid: { display: false } }
        }
      }
    });

    this.createChart('recoveryChart', {
      type: 'line',
      data: {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
        datasets: [
          {
            label: 'Found New Role',
            data: [18, 22, 28, 32, 38, 42],
            borderColor: signalGreen,
            backgroundColor: 'rgba(90,168,108,0.1)',
            tension: 0.4,
            fill: true
          },
          {
            label: 'Still Searching',
            data: [82, 78, 72, 68, 62, 58],
            borderColor: signalRed,
            backgroundColor: 'rgba(212,84,84,0.05)',
            tension: 0.4,
            fill: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { padding: 16, usePointStyle: true, pointStyle: 'circle' } } },
        scales: {
          y: { beginAtZero: true, max: 100, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { callback: v => v + '%' } },
          x: { grid: { display: false } }
        }
      }
    });
  }

  createChart(canvasId, config) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Destroy existing chart on that canvas if any
    const existing = Chart.getChart(canvas);
    if (existing) existing.destroy();
    new Chart(ctx, config);
  }

  // ── Scroll animations ──

  setupScrollAnimations() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.opacity = '1';
          entry.target.style.transform = 'translateY(0)';
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.card, .story-card, .topic-item').forEach(el => {
      if (!el.dataset.observed) {
        el.dataset.observed = '1';
        el.style.opacity = '0';
        el.style.transform = 'translateY(16px)';
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(el);
      }
    });
  }

  // ── Real-time updates ──

  startRealTimeUpdates() {
    try {
      const es = new EventSource('/api/events');
      es.addEventListener('stats-update', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.state.stats = { ...this.state.stats, ...data };
          // Re-animate counters if stat values updated
          document.querySelectorAll('[data-target]').forEach(el => { el._animated = false; });
          this.animateCounters();
        } catch (err) { /* ignore parse errors */ }
      });
      es.addEventListener('story-added', (e) => {
        try {
          const story = JSON.parse(e.data);
          this.state.stories.unshift(story);
          this.renderStories();
        } catch (err) { /* ignore */ }
      });
      es.onerror = () => {
        es.close();
        setTimeout(() => this.startRealTimeUpdates(), 10000);
      };
    } catch (e) {
      // SSE not supported; fall back to polling
      setInterval(async () => {
        const stats = await this.fetchJSON(`/api/stats?country=${this.state.country}`, null);
        if (stats) {
          this.state.stats = stats;
          document.querySelectorAll('[data-target]').forEach(el => { el._animated = false; });
          this.animateCounters();
        }
      }, 30000);
    }
  }
}

// ── Bootstrap ──

document.addEventListener('DOMContentLoaded', () => {
  window.app = new AITookMyJobApp();
});

// ── Service Worker registration ──

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
