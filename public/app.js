// AI Took My Job — Human Signal Edition
// Frontend application matching the "Human Signal" design system

class AITookMyJobApp {
  constructor() {
    // Parse country and lang from URL path /:country/:lang/
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const urlCountry = pathParts[0] || 'global';
    const urlLang = pathParts[1] || 'en';
    const validLangs = ['en', 'ru', 'de', 'fr', 'es'];

    this.state = {
      country: urlCountry,
      lang: validLangs.includes(urlLang) ? urlLang : 'en',
      meta: { countries: [], languages: ['en'] },
      t: {},
      stats: { counters: {} },
      stories: [],
      news: [],
      resources: [],
      authUser: null,
      dashboard: null,
      storiesPage: 0,
      storiesPerPage: 6,
      allStoriesLoaded: false
    };

    this.theme = localStorage.getItem('theme') || 'dark';
    this.init();
  }

  async init() {
    this.setupTheme();
    this.syncSelectorsFromState();
    this.bindStaticListeners();
    await this.loadInitialData();
    this.render();
    this.startRealTimeUpdates();
  }

  syncSelectorsFromState() {
    const langSelect = document.getElementById('langSelect');
    if (langSelect) langSelect.value = this.state.lang;
    const countrySelect = document.getElementById('countrySelect');
    if (countrySelect) countrySelect.value = this.state.country;
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
      authTrigger.addEventListener('click', () => {
        // Show appropriate sections based on auth state
        const authTabs = document.getElementById('authTabs');
        const phoneSection = document.getElementById('phoneSection');
        const sessionSection = document.getElementById('sessionSection');
        if (this.state.authUser) {
          if (authTabs) authTabs.style.display = 'none';
          if (phoneSection) phoneSection.style.display = 'block';
          if (sessionSection) sessionSection.style.display = 'block';
        } else {
          if (authTabs) authTabs.style.display = '';
          if (phoneSection) phoneSection.style.display = 'none';
          if (sessionSection) sessionSection.style.display = 'none';
        }
        this.openModal(authModal);
      });
    }
    if (authClose && authModal) {
      authClose.addEventListener('click', () => this.closeModal(authModal));
    }
    if (authModal) {
      authModal.addEventListener('click', (e) => {
        if (e.target === authModal) this.closeModal(authModal);
      });
    }

    // Share Story button — opens submission modal
    const shareBtn = document.getElementById('shareStoryBtn');
    const storyModal = document.getElementById('storyModal');
    const storyClose = document.getElementById('storyModalClose');

    if (shareBtn && storyModal) {
      shareBtn.addEventListener('click', () => this.openModal(storyModal));
    }
    if (storyClose && storyModal) {
      storyClose.addEventListener('click', () => this.closeModal(storyModal));
    }
    if (storyModal) {
      storyModal.addEventListener('click', (e) => {
        if (e.target === storyModal) this.closeModal(storyModal);
      });
    }

    // Story submission form
    const storyForm = document.getElementById('storyForm');
    if (storyForm) {
      storyForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleStorySubmit(storyForm);
      });
    }

    // Character counter for story textarea
    const storyTextarea = document.getElementById('storyText');
    const charCountEl = document.getElementById('storyCharCount');
    if (storyTextarea && charCountEl) {
      const updateCount = () => {
        const len = storyTextarea.value.length;
        charCountEl.textContent = `${len.toLocaleString()} / 3,000`;
        charCountEl.style.color = len < 40 ? 'var(--signal-red)' : len > 2800 ? 'var(--signal-amber)' : 'var(--text-muted)';
      };
      storyTextarea.addEventListener('input', updateCount);
      updateCount();
    }

    // Preview toggle
    const previewToggle = document.getElementById('storyPreviewToggle');
    const previewPanel = document.getElementById('storyPreviewPanel');
    const previewContent = document.getElementById('storyPreviewContent');
    if (previewToggle && previewPanel && previewContent && storyTextarea) {
      previewToggle.addEventListener('click', () => {
        const showing = previewPanel.style.display !== 'none';
        previewPanel.style.display = showing ? 'none' : 'block';
        previewToggle.innerHTML = showing ? '<i class="ph ph-eye"></i> Preview' : '<i class="ph ph-eye-slash"></i> Hide Preview';
        if (!showing) {
          previewContent.textContent = storyTextarea.value || '(empty)';
        }
      });
      storyTextarea.addEventListener('input', () => {
        if (previewPanel.style.display !== 'none') {
          previewContent.textContent = storyTextarea.value || '(empty)';
        }
      });
    }

    // Success panel close
    const successClose = document.getElementById('storySuccessClose');
    if (successClose) {
      successClose.addEventListener('click', () => {
        const modal = document.getElementById('storyModal');
        if (modal) this.closeModal(modal);
        // Reset visibility
        const form = document.getElementById('storyForm');
        const successPanel = document.getElementById('storySuccessPanel');
        if (form) form.style.display = '';
        if (successPanel) successPanel.style.display = 'none';
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

    // Phone verification forms
    const phoneStartForm = document.getElementById('phoneStartForm');
    if (phoneStartForm) {
      phoneStartForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handlePhoneStart(phoneStartForm);
      });
    }
    const phoneConfirmForm = document.getElementById('phoneConfirmForm');
    if (phoneConfirmForm) {
      phoneConfirmForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handlePhoneConfirm(phoneConfirmForm);
      });
    }

    // Session controls
    const sessionCheckBtn = document.getElementById('sessionCheckBtn');
    if (sessionCheckBtn) {
      sessionCheckBtn.addEventListener('click', () => this.handleSessionCheck());
    }
    const sessionLogoutBtn = document.getElementById('sessionLogoutBtn');
    if (sessionLogoutBtn) {
      sessionLogoutBtn.addEventListener('click', () => this.handleLogout());
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
      langSelect.addEventListener('change', async (e) => {
        this.state.lang = e.target.value;
        await this.loadTranslations(this.state.lang);
        this.renderNews();
        this.renderResources();
        this.applyTranslations();
      });
    }

    // Load More Stories
    const loadMoreBtn = document.getElementById('loadMoreStories');
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener('click', () => this.loadMoreStories());
    }

    // Story search and filter
    const storySearch = document.getElementById('storySearch');
    const storyRegionFilter = document.getElementById('storyRegionFilter');
    if (storySearch) {
      let debounce;
      storySearch.addEventListener('input', () => {
        clearTimeout(debounce);
        debounce = setTimeout(() => this.renderStories(), 250);
      });
    }
    if (storyRegionFilter) {
      storyRegionFilter.addEventListener('change', () => this.renderStories());
    }

    // Keyboard accessibility: Escape closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const openModal = document.querySelector('.modal-overlay.is-open');
        if (openModal) {
          this.closeModal(openModal);
          e.preventDefault();
        }
      }
    });

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
    this._lastFocused = document.activeElement;
    el.classList.add('is-open');
    el.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    const first = el.querySelector('input, button, [tabindex]');
    if (first) first.focus();
  }

  closeModal(el) {
    el.classList.remove('is-open');
    el.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (this._lastFocused) this._lastFocused.focus();
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
      this.state.authUser = res.data;
      form.reset();
      this.onAuthChange();
      this.showAuthMessage(`Signed in as ${res.data?.email || 'user'}`, 'success');
      // Show phone/session sections
      const authTabs = document.getElementById('authTabs');
      const phoneSection = document.getElementById('phoneSection');
      const sessionSection = document.getElementById('sessionSection');
      if (authTabs) authTabs.style.display = 'none';
      if (phoneSection) phoneSection.style.display = 'block';
      if (sessionSection) sessionSection.style.display = 'block';
    } else {
      this.showAuthMessage(res.error || 'Login failed', 'error');
    }

    this.setLoading(btn, false, 'Sign In');
  }

  async handleRegister(form) {
    const email = form.email.value.trim();
    const password = form.password.value;
    const confirm = form.confirmPassword.value;

    if (!email || !password || !confirm) return this.toast('Fill in all fields', 'error');
    if (password !== confirm) return this.toast('Passwords do not match', 'error');
    if (password.length < 10) return this.toast('Password must be at least 10 characters', 'error');

    const btn = form.querySelector('button[type="submit"]');
    this.setLoading(btn, true, 'Creating account...');

    const res = await this.postJSON('/api/auth/register', { email, password });

    if (res.ok) {
      // Auto-login after registration
      const loginRes = await this.postJSON('/api/auth/login', { email, password });
      if (loginRes.ok) {
        this.state.authUser = loginRes.data;
        this.onAuthChange();
        this.showAuthMessage(`Registration successful. Signed in as ${email}`, 'success');
        // Show phone verification section
        const authTabs = document.getElementById('authTabs');
        const phoneSection = document.getElementById('phoneSection');
        const sessionSection = document.getElementById('sessionSection');
        if (authTabs) authTabs.style.display = 'none';
        if (phoneSection) phoneSection.style.display = 'block';
        if (sessionSection) sessionSection.style.display = 'block';
      } else {
        this.showAuthMessage('Account created! Please sign in.', 'success');
      }
      form.reset();
    } else {
      this.showAuthMessage(res.error || 'Registration failed', 'error');
    }

    this.setLoading(btn, false, 'Create Account');
  }

  showAuthMessage(text, type) {
    const el = document.getElementById('authMessage');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    el.style.background = type === 'success' ? 'rgba(90,168,108,0.15)' : 'rgba(212,84,84,0.15)';
    el.style.color = type === 'success' ? 'var(--signal-green)' : 'var(--signal-red)';
  }

  showPhoneMessage(text, type) {
    const el = document.getElementById('phoneMessage');
    if (!el) return;
    el.textContent = text;
    el.style.display = 'block';
    el.style.background = type === 'success' ? 'rgba(90,168,108,0.15)' : 'rgba(212,84,84,0.15)';
    el.style.color = type === 'success' ? 'var(--signal-green)' : 'var(--signal-red)';
  }

  async handlePhoneStart(form) {
    const phone = form.phone.value.trim();
    if (!phone) return this.showPhoneMessage('Enter a phone number', 'error');

    const btn = form.querySelector('button[type="submit"]');
    this.setLoading(btn, true, 'Sending...');

    const res = await this.postJSON('/api/auth/phone/request-otp', { phone });
    if (res.ok) {
      this.showPhoneMessage('Verification code sent!', 'success');
      // Pre-fill confirm form phone field
      const confirmPhone = document.getElementById('phoneConfirmNumber');
      if (confirmPhone) confirmPhone.value = phone;
    } else {
      this.showPhoneMessage(res.error || 'Failed to send code', 'error');
    }

    this.setLoading(btn, false, 'Send Verification Code');
  }

  async handlePhoneConfirm(form) {
    const phone = form.phone.value.trim();
    const code = form.code.value.trim();
    if (!phone || !code) return this.showPhoneMessage('Enter phone and code', 'error');

    const btn = form.querySelector('button[type="submit"]');
    this.setLoading(btn, true, 'Verifying...');

    const res = await this.postJSON('/api/auth/phone/verify', { phone, code });
    if (res.ok) {
      this.showPhoneMessage('Phone verified!', 'success');
      // Close auth modal after a brief delay so the success message is visible
      setTimeout(() => {
        const modal = document.getElementById('authModal');
        if (modal) this.closeModal(modal);
      }, 1500);
    } else {
      this.showPhoneMessage(res.error || 'Verification failed', 'error');
    }

    this.setLoading(btn, false, 'Verify Phone');
  }

  async handleSessionCheck() {
    const res = await this.fetchJSON('/api/auth/me', null);
    if (res && res.id) {
      this.showAuthMessage(`Signed in as ${res.email || res.id}`, 'success');
    } else {
      this.showAuthMessage('Not signed in', 'error');
    }
  }

  async handleLogout() {
    await this.postJSON('/api/auth/logout', {});
    this.state.authUser = null;
    this.onAuthChange();
    this.showAuthMessage('Logged out', 'success');
    // Reset modal to login view
    const authTabs = document.getElementById('authTabs');
    const phoneSection = document.getElementById('phoneSection');
    const sessionSection = document.getElementById('sessionSection');
    if (authTabs) authTabs.style.display = '';
    if (phoneSection) phoneSection.style.display = 'none';
    if (sessionSection) sessionSection.style.display = 'none';
  }

  async handleStorySubmit(form) {
    const errorEl = document.getElementById('storyFormError');
    if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }

    const body = {
      name: form.name.value.trim(),
      profession: form.profession.value.trim(),
      company: form.company.value.trim() || 'Undisclosed',
      laidOffAt: form.laidOffAt.value.trim(),
      reason: form.reason.value.trim(),
      story: form.story.value.trim(),
      country: form.country.value,
      language: this.state.lang,
      aiTool: form.aiTool.value.trim() || undefined,
      foundNewJob: form.foundNewJob.checked,
      ndaConfirmed: form.ndaConfirmed.checked
    };

    if (body.story.length < 40) {
      if (errorEl) { errorEl.textContent = 'Story must be at least 40 characters.'; errorEl.style.display = 'block'; }
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    this.setLoading(btn, true, 'Submitting...');

    const endpoint = this.state.authUser ? '/api/stories' : '/api/stories/anonymous';
    const res = await this.postJSON(endpoint, body);

    if (res.ok) {
      form.reset();
      // Update char counter
      const charCountEl = document.getElementById('storyCharCount');
      if (charCountEl) charCountEl.textContent = '0 / 3,000';
      // Hide preview
      const previewPanel = document.getElementById('storyPreviewPanel');
      if (previewPanel) previewPanel.style.display = 'none';
      // Show success animation
      const successPanel = document.getElementById('storySuccessPanel');
      if (successPanel) {
        form.style.display = 'none';
        successPanel.style.display = 'block';
        const checkmark = document.getElementById('storySuccessCheckmark');
        if (checkmark) setTimeout(() => { checkmark.style.transform = 'scale(1)'; }, 50);
      } else {
        this.toast('Story submitted for review. Thank you for sharing.', 'success');
        const modal = document.getElementById('storyModal');
        if (modal) this.closeModal(modal);
      }
    } else {
      const msg = res.data?.message || res.error || 'Submission failed';
      if (errorEl) { errorEl.textContent = msg; errorEl.style.display = 'block'; }
      this.toast(msg, 'error');
    }

    this.setLoading(btn, false, 'Submit Story');
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

    const [statsData, storiesData, newsData, meData, resourcesData] = await Promise.allSettled([
      this.fetchJSON(`/api/stats?country=${country}`, { counters: {} }),
      this.fetchJSON(`/api/stories?country=${country}&limit=${this.state.storiesPerPage}`, { stories: [] }),
      this.fetchJSON(`/api/news?country=${country}`, { news: [] }),
      this.fetchJSON('/api/auth/me', null),
      this.fetchJSON(`/api/resources?country=${country}`, { resources: [] })
    ]);

    this.state.stats = statsData.status === 'fulfilled' ? statsData.value : { counters: {} };
    this.state.stories = storiesData.status === 'fulfilled' ? (storiesData.value.stories || []) : [];
    this.state.news = newsData.status === 'fulfilled' ? (newsData.value.news || []) : [];
    this.state.resources = resourcesData.status === 'fulfilled' ? (resourcesData.value.resources || []) : [];

    const me = meData.status === 'fulfilled' ? meData.value : null;
    this.state.authUser = me && me.id ? me : null;

    await this.loadTranslations(this.state.lang);
  }

  // ── Rendering ──

  render() {
    this.animateCounters();
    this.renderFeaturedStory();
    this.renderStories();
    this.renderNewsCarousel();
    this.renderNews();
    this.renderResources();
    this.renderCommunity();
    this.applyTranslations();
    this.initCharts();
    this.onAuthChange();
    this.setupScrollAnimations();
    this.setupRibbonToggle();
  }

  animateCounters() {
    const counters = this.state.stats?.counters || {};
    const mapping = {
      affected: counters.laidOff || 0,
      stories: counters.sharedStories || 0,
      foundJobs: counters.foundJob || 0,
      countries: counters.distinctCompanies || 0
    };

    document.querySelectorAll('[data-stat]').forEach(el => {
      const key = el.dataset.stat;
      const target = mapping[key];
      if (target === undefined || el._animated) return;
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

      if (target === 0) {
        el.textContent = '0';
      } else {
        requestAnimationFrame(tick);
      }
    });
  }

  getInitials(name) {
    return (name || '?').split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
  }

  renderFeaturedStory() {
    const stories = this.state.stories;
    if (!stories.length) return;

    // Pick the story with most engagement or most recent
    const featured = stories.reduce((best, s) => {
      const score = (s.metrics?.meToo || s.meToo || 0) + (s.views || 0);
      const bestScore = (best.metrics?.meToo || best.meToo || 0) + (best.views || 0);
      return score > bestScore ? s : best;
    }, stories[0]);

    const quoteEl = document.getElementById('featuredQuoteText');
    const nameEl = document.getElementById('featuredName');
    const metaEl = document.getElementById('featuredMeta');
    const avatarEl = document.getElementById('featuredAvatar');

    if (quoteEl) {
      const excerpt = featured.story.length > 280 ? featured.story.slice(0, 280) + '...' : featured.story;
      quoteEl.textContent = excerpt;
    }
    if (nameEl) nameEl.textContent = featured.name;
    if (metaEl) {
      metaEl.innerHTML = `${this.esc(featured.profession)} at ${this.esc(featured.company)} <span class="tag tag-amber" style="margin-left:var(--sp-2);">${this.esc(featured.laidOffAt)}</span>`;
    }
    if (avatarEl) avatarEl.textContent = this.getInitials(featured.name);
  }

  renderStories() {
    const container = document.getElementById('storiesContainer');
    if (!container || !this.state.stories.length) return;

    const searchEl = document.getElementById('storySearch');
    const regionEl = document.getElementById('storyRegionFilter');
    const query = (searchEl?.value || '').toLowerCase().trim();
    const regionCodes = (regionEl?.value || '').split(',').filter(Boolean);

    const filtered = this.state.stories.filter(story => {
      if (query) {
        const haystack = `${story.name} ${story.company} ${story.profession} ${story.story} ${story.reason || ''}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (regionCodes.length) {
        if (!regionCodes.includes(story.country)) return false;
      }
      return true;
    });

    if (!filtered.length) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:var(--sp-8);">No stories match your filters.</p>';
      return;
    }

    container.innerHTML = filtered.map(story => `
      <article class="story-card-v2">
        <a href="/story/${this.esc(story.id)}" style="text-decoration:none;color:inherit;display:block;">
          <div class="story-card-v2-header">
            <div class="story-avatar">${this.esc(this.getInitials(story.name))}</div>
            <div class="story-card-v2-author">
              <div class="story-card-v2-name">${this.esc(story.name)}</div>
              <div class="story-card-v2-meta">${this.esc(story.profession)} at ${this.esc(story.company)} &middot; ${this.esc(story.laidOffAt)}</div>
            </div>
            <span class="tag tag-amber">${this.esc(story.country || 'Global')}</span>
          </div>
          <div class="story-card-v2-body">${this.esc(story.story)}</div>
        </a>
        <div class="story-card-v2-footer">
          <div class="story-card-v2-tags">
            <span style="font-size:var(--text-xs);color:var(--text-muted);"><i class="ph ph-eye"></i> ${this.fmt(story.views || 0)}</span>
          </div>
          <div style="display:flex;gap:var(--sp-2);">
            <button class="btn-metoo" data-story-id="${this.esc(story.id)}" title="I experienced this too">
              <i class="ph ph-hand-fist"></i>
              <span>Me Too</span>
              <span class="metoo-count">${story.metrics?.meToo || story.meToo || 0}</span>
            </button>
            <button class="btn-share" data-story-id="${this.esc(story.id)}" title="Share this story">
              <i class="ph ph-share-network"></i>
            </button>
          </div>
        </div>
      </article>
    `).join('');

    container.querySelectorAll('.btn-metoo').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleMeToo(e));
    });
    container.querySelectorAll('.btn-share').forEach(btn => {
      btn.addEventListener('click', (e) => this.handleShare(e));
    });

    this.updatePagination();
  }

  // ── Story pagination ──

  async loadMoreStories() {
    const btn = document.getElementById('loadMoreStories');
    if (btn) this.setLoading(btn, true, 'Loading...');

    this.state.storiesPage++;
    const offset = this.state.storiesPage * this.state.storiesPerPage;
    const data = await this.fetchJSON(
      `/api/stories?country=${this.state.country}&limit=${this.state.storiesPerPage}&offset=${offset}`,
      { stories: [] }
    );

    const newStories = data.stories || [];
    if (newStories.length < this.state.storiesPerPage) {
      this.state.allStoriesLoaded = true;
    }

    this.state.stories = [...this.state.stories, ...newStories];
    this.renderStories();
    if (btn) this.setLoading(btn, false, 'Load More Stories');
  }

  updatePagination() {
    const pagination = document.getElementById('storiesPagination');
    if (!pagination) return;
    pagination.style.display = this.state.allStoriesLoaded ? 'none' : 'block';
  }

  // ── Story interactions ──

  async handleMeToo(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.storyId;
    if (btn.disabled) return;
    btn.disabled = true;

    const res = await this.postJSON(`/api/stories/${id}/me-too`, {});
    if (res.ok) {
      const countEl = btn.querySelector('.metoo-count');
      if (countEl) countEl.textContent = res.data.meToo;
      btn.classList.add('metoo-active');
      this.toast('Solidarity noted', 'success');
    } else {
      btn.disabled = false;
    }
  }

  handleShare(e) {
    const id = e.currentTarget.dataset.storyId;
    const url = `${window.location.origin}/#story-${id}`;

    if (navigator.share) {
      navigator.share({ title: 'AI Took My Job — A Story', url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        this.toast('Link copied to clipboard', 'success');
      }).catch(() => {
        this.toast('Could not copy link', 'error');
      });
    }
  }

  // ── News ──

  renderNews() {
    const container = document.getElementById('newsContainer');
    if (!container || !this.state.news.length) return;

    const lang = this.state.lang;
    const readMore = this.state.t.newsReadMore || 'Read article';

    container.innerHTML = this.state.news.map(item => {
      const title = typeof item.title === 'object'
        ? (item.title[lang] || item.title.en || '')
        : (item.title || '');
      const date = item.publishedAt
        ? new Date(item.publishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : '';

      return `
        <article class="news-card">
          <div class="news-card-accent"></div>
          <div class="news-card-body">
            <div class="news-meta">
              <span class="news-source">${this.esc(item.source)}</span>
              <span class="news-date">${this.esc(date)}</span>
            </div>
            <h3 class="news-title">${this.esc(title)}</h3>
            <a href="${this.esc(item.url)}" target="_blank" rel="noopener noreferrer" class="news-link">
              ${this.esc(readMore)}
              <i class="ph ph-arrow-up-right"></i>
            </a>
          </div>
        </article>
      `;
    }).join('');
  }

  // ── Resources ──

  renderResources() {
    const container = document.getElementById('resourcesContainer');
    if (!container) return;

    const resources = this.state.resources || [];
    if (!resources.length) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;padding:var(--sp-8);">No resources available yet.</p>';
      return;
    }

    const typeIcons = {
      reskilling: 'ph-graduation-cap',
      legal: 'ph-scales',
      jobs: 'ph-briefcase',
      counseling: 'ph-heart',
      community: 'ph-users-three'
    };

    const typeLabels = {
      reskilling: 'Reskilling',
      legal: 'Legal Aid',
      jobs: 'Job Board',
      counseling: 'Counseling',
      community: 'Community'
    };

    container.innerHTML = resources.map(r => `
      <a href="${this.esc(r.url)}" target="_blank" rel="noopener noreferrer" class="resource-card">
        <div class="resource-icon"><i class="ph ${typeIcons[r.type] || 'ph-link'}"></i></div>
        <div class="resource-body">
          <span class="tag tag-amber" style="font-size:var(--text-xs);margin-bottom:var(--sp-1);">${this.esc(typeLabels[r.type] || r.type)}</span>
          <h4 class="resource-title">${this.esc(r.title)}</h4>
          <p class="resource-summary">${this.esc(r.summary)}</p>
          <span class="resource-provider">${this.esc(r.provider)}</span>
        </div>
      </a>
    `).join('');
  }

  // ── Community section (dynamic, no fake data) ──

  async renderCommunity() {
    const discussionsEl = document.getElementById('communityDiscussions');
    const tagEl = document.getElementById('communityDiscussionTag');

    // Load forum topics from API
    try {
      const data = await this.fetchJSON(`/api/forum/topics?country=${this.state.country}`, { topics: [] });
      const topics = data.topics || [];
      if (discussionsEl) {
        if (topics.length === 0) {
          discussionsEl.innerHTML = '<p style="color:var(--text-muted); font-size:var(--text-sm);">No discussions yet. Be the first to start one!</p>';
        } else {
          if (tagEl) tagEl.style.display = '';
          discussionsEl.innerHTML = topics.slice(0, 3).map(t => `
            <div class="discussion-item">
              <h4>${this.esc(t.title)}</h4>
              <div class="discussion-meta"><span>${t.replies || 0} replies</span></div>
            </div>
          `).join('');
        }
      }
    } catch (_e) {
      if (discussionsEl) discussionsEl.innerHTML = '<p style="color:var(--text-muted); font-size:var(--text-sm);">Could not load discussions.</p>';
    }

    // Load stats for support group counts
    try {
      const stats = await this.fetchJSON(`/api/stats?country=${this.state.country}`, { counters: {} });
      const total = stats.counters?.sharedStories || 0;
      const onlineBadge = document.getElementById('communityOnlineBadge');
      if (onlineBadge && total > 0) {
        onlineBadge.textContent = `${total} stories shared`;
        onlineBadge.style.display = '';
      }
      // Show real story counts per group (not fabricated member counts)
      const el = (id, text) => { const e = document.getElementById(id); if (e) e.textContent = text; };
      el('groupDevCount', total > 0 ? 'Join the conversation' : 'Coming soon');
      el('groupDesignCount', total > 0 ? 'Join the conversation' : 'Coming soon');
      el('groupContentCount', total > 0 ? 'Join the conversation' : 'Coming soon');
      el('groupSupportCount', total > 0 ? 'Join the conversation' : 'Coming soon');
    } catch (_e) { /* leave defaults */ }
  }

  // ── Translations ──

  async loadTranslations(lang) {
    const data = await this.fetchJSON(`/i18n/${lang}.json`, {});
    this.state.t = data || {};
  }

  applyTranslations() {
    const t = this.state.t;
    if (!t || !Object.keys(t).length) return;

    // Apply textContent to all [data-i18n] elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (t[key]) el.textContent = t[key];
    });

    // Apply innerHTML to [data-i18n-html] elements (for hero title with <em>)
    document.querySelectorAll('[data-i18n-html]').forEach(el => {
      const key = el.getAttribute('data-i18n-html');
      if (t[key]) el.innerHTML = t[key];
    });

    // Apply placeholder to [data-i18n-placeholder] elements
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (t[key]) el.placeholder = t[key];
    });

    // Update URL path to reflect current language
    const { country, lang } = this.state;
    const newPath = `/${country}/${lang}/`;
    if (window.location.pathname !== newPath) {
      window.history.replaceState(null, '', newPath);
    }
  }

  // ── Charts ──

  async initCharts() {
    if (typeof Chart === 'undefined') return;

    Chart.defaults.color = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#8A8A90';
    Chart.defaults.borderColor = getComputedStyle(document.documentElement).getPropertyValue('--border-subtle').trim() || 'rgba(255,255,255,0.06)';
    Chart.defaults.font.family = "'DM Sans', system-ui, sans-serif";

    const amber = '#D4956B';
    const amberLight = '#E8B98A';
    const teal = '#4A9A8A';
    const signalRed = '#D45454';
    const signalGreen = '#5AA86C';
    const chartColors = [amber, teal, amberLight, signalGreen, signalRed, '#A06840'];

    const agg = await this.fetchJSON(`/api/research/aggregate?country=${this.state.country}`, {});
    const trend = agg.monthlyTrend || [];
    const professions = (agg.topProfessions || []).slice(0, 6);

    // Trend chart from real monthly data
    this.createChart('trendChart', {
      type: 'line',
      data: {
        labels: trend.length ? trend.map(t => t.month) : ['No data'],
        datasets: [{
          label: 'Stories',
          data: trend.length ? trend.map(t => t.storiesCount) : [0],
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

    // Geographic distribution from stories data
    const geoMap = {};
    const regionMap = { us: 'US', ca: 'US', mx: 'US', de: 'Europe', fr: 'Europe', gb: 'Europe', es: 'Europe', it: 'Europe', nl: 'Europe', se: 'Europe', ru: 'Europe', in: 'Asia', jp: 'Asia', kr: 'Asia', au: 'Oceania' };
    (this.state.stories || []).forEach(s => {
      const region = regionMap[s.country] || 'Other';
      geoMap[region] = (geoMap[region] || 0) + 1;
    });
    const geoLabels = Object.keys(geoMap);
    const geoData = Object.values(geoMap);

    this.createChart('geoChart', {
      type: 'doughnut',
      data: {
        labels: geoLabels.length ? geoLabels : ['No data'],
        datasets: [{
          data: geoData.length ? geoData : [1],
          backgroundColor: geoLabels.length ? chartColors.slice(0, geoLabels.length) : ['#333'],
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

    // Industry/profession chart from real data
    this.createChart('industryChart', {
      type: 'bar',
      data: {
        labels: professions.length ? professions.map(p => p.profession) : ['No data'],
        datasets: [{
          label: 'Stories',
          data: professions.length ? professions.map(p => p.storiesCount) : [0],
          backgroundColor: chartColors.slice(0, Math.max(professions.length, 1)),
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

    // Recovery rate from stories data
    const stories = this.state.stories || [];
    const found = stories.filter(s => s.foundNewJob).length;
    const searching = stories.length - found;
    const foundPct = stories.length ? Math.round((found / stories.length) * 100) : 0;

    this.createChart('recoveryChart', {
      type: 'doughnut',
      data: {
        labels: ['Found New Role', 'Still Searching'],
        datasets: [{
          data: stories.length ? [foundPct, 100 - foundPct] : [0, 100],
          backgroundColor: [signalGreen, signalRed],
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

    document.querySelectorAll('.card, .story-card, .story-card-v2, .news-card, .topic-item').forEach(el => {
      if (!el.dataset.observed) {
        el.dataset.observed = '1';
        el.style.opacity = '0';
        el.style.transform = 'translateY(16px)';
        el.style.transition = 'opacity 0.5s ease, transform 0.5s ease';
        observer.observe(el);
      }
    });
  }

  setupRibbonToggle() {
    const btn = document.getElementById('ribbonChartToggle');
    const panel = document.getElementById('ribbonChartPanel');
    if (!btn || !panel) return;
    if (btn._bound) return;
    btn._bound = true;

    btn.addEventListener('click', () => {
      panel.classList.toggle('is-open');
      if (panel.classList.contains('is-open')) {
        // Render a simple trend chart in the mobile panel
        const canvas = document.getElementById('mobileChart');
        if (canvas && !canvas._chart) {
          const style = getComputedStyle(document.documentElement);
          const amber = style.getPropertyValue('--amber').trim() || '#D4956B';
          const data = this.state.stats?.monthlyTrend || [];
          canvas._chart = new Chart(canvas, {
            type: 'line',
            data: {
              labels: data.map(d => d.month || ''),
              datasets: [{
                data: data.map(d => d.count || 0),
                borderColor: amber,
                backgroundColor: 'rgba(212,149,107,0.1)',
                fill: true,
                tension: 0.4,
                pointRadius: 2
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: { legend: { display: false } },
              scales: { x: { display: false }, y: { display: false } }
            }
          });
        }
      }
    });
  }

  // ── News Carousel ──

  async renderNewsCarousel() {
    const track = document.getElementById('carouselTrack');
    if (!track || track._rendered) return;
    track._rendered = true;

    const articles = await this.fetchJSON('/data/articles.json', []);
    if (!articles.length) return;

    const readMore = this.state.t.newsReadMore || 'Read article';

    track.innerHTML = articles.map(a => `
      <div class="carousel-card">
        <div class="carousel-card-top">
          <span class="carousel-card-source">${this.esc(a.source)}</span>
          <span class="carousel-card-date">${this.esc(a.date)}</span>
        </div>
        <h4 class="carousel-card-title">${this.esc(a.title)}</h4>
        <p class="carousel-card-excerpt">${this.esc(a.excerpt)}</p>
        <a href="${this.esc(a.url)}" target="_blank" rel="noopener noreferrer" class="carousel-card-link">
          ${this.esc(readMore)} <i class="ph ph-arrow-up-right"></i>
        </a>
      </div>
    `).join('');

    this.initCarouselControls(track, articles.length);
  }

  initCarouselControls(track, total) {
    const prevBtn = document.getElementById('carouselPrev');
    const nextBtn = document.getElementById('carouselNext');
    const dotsContainer = document.getElementById('carouselDots');

    // Calculate cards per view based on viewport
    const getCardsPerView = () => {
      if (window.innerWidth < 768) return 1;
      if (window.innerWidth < 1024) return 2;
      return 3;
    };

    let currentIndex = 0;
    let autoScrollTimer = null;

    const scrollToIndex = (idx) => {
      const card = track.children[idx];
      if (card) {
        track.scrollTo({ left: card.offsetLeft - track.offsetLeft, behavior: 'smooth' });
        currentIndex = idx;
        updateDots();
      }
    };

    // Dots
    const buildDots = () => {
      if (!dotsContainer) return;
      const perView = getCardsPerView();
      const pages = Math.ceil(total / perView);
      dotsContainer.innerHTML = '';
      for (let i = 0; i < Math.min(pages, 8); i++) {
        const dot = document.createElement('button');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dot.setAttribute('aria-label', `Page ${i + 1}`);
        dot.addEventListener('click', () => scrollToIndex(i * perView));
        dotsContainer.appendChild(dot);
      }
    };

    const updateDots = () => {
      if (!dotsContainer) return;
      const perView = getCardsPerView();
      const activePage = Math.floor(currentIndex / perView);
      dotsContainer.querySelectorAll('.carousel-dot').forEach((d, i) => {
        d.classList.toggle('active', i === activePage);
      });
    };

    // Arrow navigation
    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        const perView = getCardsPerView();
        currentIndex = Math.max(0, currentIndex - perView);
        scrollToIndex(currentIndex);
        resetAutoScroll();
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const perView = getCardsPerView();
        currentIndex = Math.min(total - 1, currentIndex + perView);
        if (currentIndex >= total - perView) currentIndex = 0;
        scrollToIndex(currentIndex);
        resetAutoScroll();
      });
    }

    // Auto-scroll every 5 seconds
    const startAutoScroll = () => {
      autoScrollTimer = setInterval(() => {
        const perView = getCardsPerView();
        currentIndex += perView;
        if (currentIndex >= total) currentIndex = 0;
        scrollToIndex(currentIndex);
      }, 5000);
    };

    const resetAutoScroll = () => {
      clearInterval(autoScrollTimer);
      startAutoScroll();
    };

    // Pause on hover
    track.addEventListener('mouseenter', () => clearInterval(autoScrollTimer));
    track.addEventListener('mouseleave', () => startAutoScroll());

    // Sync currentIndex on manual scroll
    track.addEventListener('scroll', () => {
      if (!track.children.length) return;
      const cardWidth = track.children[0].offsetWidth + 16;
      currentIndex = Math.round(track.scrollLeft / cardWidth);
      updateDots();
    });

    buildDots();
    startAutoScroll();

    // Rebuild dots on resize
    window.addEventListener('resize', () => { buildDots(); });
  }

  // ── Real-time updates ──

  startRealTimeUpdates() {
    try {
      const es = new EventSource('/api/events');
      es.addEventListener('stats-update', (e) => {
        try {
          const data = JSON.parse(e.data);
          this.state.stats = { ...this.state.stats, ...data };
          document.querySelectorAll('[data-stat]').forEach(el => { el._animated = false; });
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
          document.querySelectorAll('[data-stat]').forEach(el => { el._animated = false; });
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
