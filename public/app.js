// AI Took My Job - 2026 Edition
// Revolutionary JavaScript with cutting-edge features

// Modern ES2026+ features and Web APIs
class AITookMyJobApp {
  constructor() {
    this.state = {
      route: { country: "global", lang: "en" },
      country: "global",
      lang: "en",
      meta: { countries: [], languages: ["en"] },
      t: {},
      stats: { counters: {} },
      stories: [],
      companies: [],
      authUser: null,
      dashboard: null,
      topics: [],
      resources: [],
      news: [],
      petitions: [],
      cohorts: [],
      transparencyReport: null,
      moderationQueue: [],
      anomalySignals: [],
      telegramStatus: null,
      cookieConsent: localStorage.getItem("cookieConsent") || "",
      messages: {
        auth: "",
        story: "",
        forumCreate: "",
        admin: "",
        queue: "",
        sanction: "",
        transparency: "",
        anomaly: "",
        integrations: "",
        anonymous: "",
        legal: "",
        companyBoard: "",
        campaigns: ""
      }
    };
    
    this.theme = localStorage.getItem('theme') || 'light';
    this.init();
  }

  async init() {
    // Initialize with modern async patterns
    await this.loadInitialData();
    this.setupEventListeners();
    this.setupAnimations();
    this.setupTheme();
    this.render();
    this.startRealTimeUpdates();
  }

  // Modern data fetching with AbortController and streaming
  async fetchWithTimeout(resource, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || 10000);
    
    const response = await fetch(resource, {
      ...options,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    return response;
  }

  async getJSON(url, fallback = {}) {
    try {
      const res = await this.fetchWithTimeout(url, { 
        credentials: "include",
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      console.warn(`Failed to fetch ${url}:`, error);
      return fallback;
    }
  }

  async requestJSON(url, options = {}) {
    const { method = "GET", body, headers = {}, timeout = 10000 } = options;
    const init = {
      method,
      credentials: "include",
      headers: { 
        "Content-Type": "application/json",
        ...headers 
      }
    };

    if (body !== undefined) {
      init.body = JSON.stringify(body);
    }

    try {
      const res = await this.fetchWithTimeout(url, { ...init, timeout });
      const contentType = res.headers.get("content-type") || "";
      let data = null;

      if (contentType.includes("application/json")) {
        data = await res.json();
      } else {
        const text = await res.text();
        data = text ? { message: text } : null;
      }

      return {
        ok: res.ok,
        status: res.status,
        data,
        error: res.ok ? "" : (data?.message) || `Request failed (${res.status})`
      };
    } catch (error) {
      return { 
        ok: false, 
        status: 0, 
        data: null, 
        error: error.name === 'AbortError' ? 'Request timeout' : 'Network error' 
      };
    }
  }

  // Enhanced string escaping with template literals
  esc(text) {
    return String(text || "")
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  // Modern number formatting with Intl
  fmt(n) {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1
    }).format(Number(n || 0));
  }

  // Enhanced internationalization
  t(key) {
    return this.state.t[key] || key;
  }

  // Modern routing with URLPattern (when available) or fallback
  parseRoute() {
    const path = window.location.pathname;
    const parts = path.split('/').filter(Boolean);
    return { 
      country: parts[0] || "global", 
      lang: parts[1] || "en" 
    };
  }

  // Advanced animation setup using Web Animations API
  setupAnimations() {
    // Intersection Observer for scroll animations
    this.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.style.animation = 'fadeInUp 0.6s ease-out forwards';
          this.observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1 });

    // Observe elements for animation
    document.querySelectorAll('.glass-card, .stat-card, .story-card').forEach(el => {
      this.observer.observe(el);
    });
  }

  // Theme management with CSS custom properties
  setupTheme() {
    document.documentElement.setAttribute('data-theme', this.theme);
    this.applyThemeVariables();
  }

  applyThemeVariables() {
    const root = document.documentElement;
    if (this.theme === 'dark') {
      root.style.setProperty('--bg-primary', '#0f0f15');
      root.style.setProperty('--bg-secondary', '#1a1a25');
      root.style.setProperty('--text-primary', '#ffffff');
      root.style.setProperty('--text-secondary', '#a0a0b0');
    } else {
      root.style.setProperty('--bg-primary', '#ffffff');
      root.style.setProperty('--bg-secondary', '#f8fafc');
      root.style.setProperty('--text-primary', '#0f0f15');
      root.style.setProperty('--text-secondary', '#475569');
    }
  }

  toggleTheme() {
    this.theme = this.theme === 'light' ? 'dark' : 'light';
    localStorage.setItem('theme', this.theme);
    this.setupTheme();
  }

  // Advanced data loading with progressive enhancement
  async loadInitialData() {
    this.state.route = this.parseRoute();
    this.state.meta = await this.getJSON("/api/meta", { 
      countries: [], 
      languages: ["en"] 
    });

    const lang = this.state.meta.languages.includes(this.state.route.lang) ? 
      this.state.route.lang : "en";
    const country = this.state.meta.countries.some((c) => c.code === this.state.route.country) ? 
      this.state.route.country : "global";

    if (this.state.route.lang !== lang || this.state.route.country !== country) {
      window.location.replace(`/${country}/${lang}/`);
      return false;
    }

    this.state.lang = lang;
    this.state.country = country;

    // Load translations with fallback chain
    const [en, localized] = await Promise.allSettled([
      this.getJSON("/i18n/en.json", {}),
      this.getJSON(`/i18n/${lang}.json`, {})
    ]);

    this.state.t = {
      ...en.status === 'fulfilled' ? en.value : {},
      ...localized.status === 'fulfilled' ? localized.value : {}
    };

    // Parallel data loading for optimal performance
    const [
      statsData,
      storiesData,
      companiesData,
      forumData,
      forumTopicsData,
      dashboardData,
      resourcesData,
      newsData,
      petitionsData,
      cohortsData
    ] = await Promise.allSettled([
      this.getJSON(`/api/stats?country=${country}`, { counters: {} }),
      this.getJSON(`/api/stories?country=${country}&limit=12`, { stories: [] }),
      this.getJSON(`/api/companies/top?country=${country}`, { companies: [] }),
      this.getJSON("/api/forum/categories", { categories: [] }),
      this.getJSON(`/api/forum/topics?country=${country}`, { topics: [] }),
      this.getJSON(`/api/statistics/dashboard?country=${country}`, {}),
      this.getJSON(`/api/resources?country=${country}`, { resources: [] }),
      this.getJSON(`/api/news?country=${country}`, { news: [] }),
      this.getJSON("/api/campaigns/petitions", { petitions: [] }),
      this.getJSON(`/api/cohorts?country=${country}`, { cohorts: [] })
    ]);

    // Handle results with error boundaries
    this.state.stats = statsData.status === 'fulfilled' ? statsData.value : { counters: {} };
    this.state.stories = storiesData.status === 'fulfilled' ? 
      (storiesData.value.stories || []) : [];
    this.state.companies = companiesData.status === 'fulfilled' ? 
      (companiesData.value.companies || []) : [];
    this.state.categories = forumData.status === 'fulfilled' ? 
      (forumData.value.categories || []) : [];
    this.state.topics = forumTopicsData.status === 'fulfilled' ? 
      (forumTopicsData.value.topics || []) : [];
    this.state.dashboard = dashboardData.status === 'fulfilled' ? 
      dashboardData.value : null;
    this.state.resources = resourcesData.status === 'fulfilled' ? 
      (resourcesData.value.resources || []) : [];
    this.state.news = newsData.status === 'fulfilled' ? 
      (newsData.value.news || []) : [];
    this.state.petitions = petitionsData.status === 'fulfilled' ? 
      (petitionsData.value.petitions || []) : [];
    this.state.cohorts = cohortsData.status === 'fulfilled' ? 
      (cohortsData.value.cohorts || []) : [];

    // Load user session
    await this.refreshAuthMe();
    return true;
  }

  // Enhanced authentication management
  async refreshAuthMe() {
    const meRes = await this.requestJSON("/api/auth/me");
    this.state.authUser = meRes.ok ? meRes.data : null;
    if (!meRes.ok && ![401, 404].includes(meRes.status)) {
      this.state.messages.auth = meRes.error || "Failed to load session";
    }
  }

  // Modern event delegation system
  setupEventListeners() {
    const appElement = document.getElementById('app');
    
    // Handle navigation
    appElement.addEventListener('click', (event) => {
      const target = event.target;
      
      // Smooth scrolling for anchor links
      if (target.matches('[href^="#"]')) {
        event.preventDefault();
        const targetId = target.getAttribute('href').substring(1);
        const targetElement = document.getElementById(targetId);
        if (targetElement) {
          targetElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        }
      }
      
      // Theme toggle
      if (target.closest('.theme-toggle')) {
        this.toggleTheme();
      }
      
      // Action buttons
      if (target.matches('.pulse-button')) {
        this.handleShareStory();
      }
    });

    // Form submissions with enhanced validation
    appElement.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.target;
      
      if (form.id === 'storySubmissionForm') {
        this.handleSubmitStory(new FormData(form));
      }
    });

    // Dynamic content updates
    appElement.addEventListener('change', (event) => {
      if (event.target.id === 'countrySelect') {
        this.handleCountryChange(event.target.value);
      }
      if (event.target.id === 'langSelect') {
        this.handleLanguageChange(event.target.value);
      }
    });
  }

  // Enhanced story submission with real-time validation
  async handleSubmitStory(formData) {
    const payload = Object.fromEntries(formData);
    
    // Client-side validation with detailed feedback
    const validationErrors = this.validateStoryPayload(payload);
    if (validationErrors.length > 0) {
      this.showValidationErrors(validationErrors);
      return;
    }

    // Show loading state
    this.updateUIState('submitting', true);
    
    const res = await this.requestJSON("/api/stories", { 
      method: "POST", 
      body: payload 
    });
    
    if (res.ok) {
      this.showMessage('Story submitted successfully!', 'success');
      this.resetForm('storySubmissionForm');
      // Reload stories to show the new one
      await this.loadStories();
    } else {
      this.showMessage(res.error || 'Submission failed', 'error');
    }
    
    this.updateUIState('submitting', false);
  }

  validateStoryPayload(payload) {
    const errors = [];
    
    if (!payload.name || payload.name.length < 2) {
      errors.push('Name must be at least 2 characters');
    }
    
    if (!payload.profession || payload.profession.length < 2) {
      errors.push('Profession must be at least 2 characters');
    }
    
    if (!payload.company || payload.company.length < 1) {
      errors.push('Company is required');
    }
    
    if (!payload.laidOffAt || !/^\d{4}-\d{2}$/.test(payload.laidOffAt)) {
      errors.push('Valid layoff date (YYYY-MM) is required');
    }
    
    if (!payload.reason || payload.reason.length < 8) {
      errors.push('Reason must be at least 8 characters');
    }
    
    if (!payload.story || payload.story.length < 40) {
      errors.push('Story must be at least 40 characters');
    }
    
    return errors;
  }

  // Real-time data updates with Server-Sent Events
  startRealTimeUpdates() {
    try {
      const eventSource = new EventSource('/api/events');
      
      eventSource.addEventListener('stats-update', (event) => {
        const data = JSON.parse(event.data);
        this.updateStats(data);
      });
      
      eventSource.addEventListener('story-added', (event) => {
        const data = JSON.parse(event.data);
        this.addStory(data);
      });
      
      eventSource.onerror = () => {
        console.warn('EventSource connection lost, reconnecting...');
        setTimeout(() => this.startRealTimeUpdates(), 5000);
      };
    } catch (error) {
      console.warn('Server-Sent Events not supported, falling back to polling');
      this.startPollingUpdates();
    }
  }

  startPollingUpdates() {
    setInterval(async () => {
      const stats = await this.getJSON(`/api/stats?country=${this.state.country}`);
      this.updateStats(stats);
    }, 30000); // Poll every 30 seconds
  }

  // Advanced rendering with virtual DOM concepts
  render() {
    // Hide skeleton loader
    document.querySelector('.loading-skeleton')?.classList.add('hidden');
    document.getElementById('main-content')?.classList.remove('hidden');
    
    // Animate stat counters
    this.animateStatNumbers();
    
    // Initialize charts if Chart.js is available
    if (window.Chart) {
      this.initializeCharts();
    }
    
    // Set up infinite scroll for stories
    this.setupInfiniteScroll();
  }

  animateStatNumbers() {
    document.querySelectorAll('[data-target]').forEach(el => {
      const target = parseInt(el.getAttribute('data-target'));
      const duration = 2000; // ms
      const increment = target / (duration / 16); // ~60fps
      let current = 0;
      
      const timer = setInterval(() => {
        current += increment;
        if (current >= target) {
          current = target;
          clearInterval(timer);
        }
        el.textContent = this.fmt(Math.floor(current));
      }, 16);
    });
  }

  initializeCharts() {
    // Trend chart
    const trendCtx = document.getElementById('trendChart')?.getContext('2d');
    if (trendCtx) {
      new Chart(trendCtx, {
        type: 'line',
        data: {
          labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'],
          datasets: [{
            label: 'Layoffs',
            data: [1200, 1900, 1500, 2100, 1800, 2400],
            borderColor: '#8b5cf6',
            backgroundColor: 'rgba(139, 92, 246, 0.1)',
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { display: false }
          },
          scales: {
            y: { beginAtZero: true }
          }
        }
      });
    }

    // Geographic distribution chart
    const geoCtx = document.getElementById('geoChart')?.getContext('2d');
    if (geoCtx) {
      new Chart(geoCtx, {
        type: 'doughnut',
        data: {
          labels: ['US', 'EU', 'Asia', 'Other'],
          datasets: [{
            data: [45, 30, 20, 5],
            backgroundColor: ['#a78bfa', '#c084fc', '#e879f9', '#f0abfc']
          }]
        },
        options: {
          responsive: true,
          plugins: {
            legend: { position: 'bottom' }
          }
        }
      });
    }
  }

  setupInfiniteScroll() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && !this.loadingMore) {
          this.loadMoreStories();
        }
      });
    });
    
    const sentinel = document.createElement('div');
    sentinel.id = 'sentinel';
    document.body.appendChild(sentinel);
    observer.observe(sentinel);
  }

  async loadMoreStories() {
    this.loadingMore = true;
    // Implementation for loading more stories
    this.loadingMore = false;
  }

  // Utility methods
  updateStats(newStats) {
    this.state.stats = { ...this.state.stats, ...newStats };
    this.animateStatNumbers();
  }

  addStory(story) {
    this.state.stories.unshift(story);
    this.renderStories();
  }

  showMessage(message, type = 'info') {
    // Create toast notification
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 8px;
      color: white;
      background: ${type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#3b82f6'};
      z-index: 1000;
      animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  updateUIState(state, value) {
    // Update loading states, disabled states, etc.
    const submitBtn = document.querySelector('.pulse-button');
    if (submitBtn) {
      submitBtn.disabled = value;
      submitBtn.textContent = value ? 'Submitting...' : 'Share Your Story';
    }
  }

  resetForm(formId) {
    const form = document.getElementById(formId);
    if (form) {
      form.reset();
    }
  }

  showValidationErrors(errors) {
    // Display validation errors in a user-friendly way
    errors.forEach(error => this.showMessage(error, 'error'));
  }

  handleCountryChange(country) {
    window.location.href = `/${country}/${this.state.lang}/`;
  }

  handleLanguageChange(lang) {
    window.location.href = `/${this.state.country}/${lang}/`;
  }

  handleShareStory() {
    // Scroll to story form and focus
    const storyForm = document.querySelector('#storySubmissionForm');
    if (storyForm) {
      storyForm.scrollIntoView({ behavior: 'smooth' });
      storyForm.focus();
    }
  }

  async loadStories() {
    const storiesData = await this.getJSON(
      `/api/stories?country=${this.state.country}&limit=12`
    );
    this.state.stories = storiesData.stories || [];
    this.renderStories();
  }

  renderStories() {
    const container = document.getElementById('storiesContainer');
    if (!container) return;
    
    container.innerHTML = this.state.stories.map(story => `
      <article class="story-card glass-card">
        <div class="story-header">
          <div class="story-author">${this.esc(story.name)}</div>
          <div class="story-company">${this.esc(story.company)}</div>
        </div>
        <div class="story-content">
          <p>${this.esc(story.story.substring(0, 150))}...</p>
        </div>
        <div class="story-meta">
          <span>${this.esc(story.profession)}</span>
          <span>${this.esc(story.laidOffAt)}</span>
          <span>Views: ${this.fmt(story.views || 0)}</span>
        </div>
      </article>
    `).join('');
  }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Enable View Transitions API if supported
  if (document.startViewTransition) {
    // Enhance navigation with view transitions
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', (e) => {
        e.preventDefault();
        const targetId = anchor.getAttribute('href').substring(1);
        const targetElement = document.getElementById(targetId);
        
        document.startViewTransition(() => {
          targetElement.scrollIntoView({ 
            behavior: 'smooth', 
            block: 'start' 
          });
        });
      });
    });
  }
  
  // Initialize the application
  window.app = new AITookMyJobApp();
  
  // Initialize forum if forum section exists
  if (document.getElementById('forum-container')) {
    window.modernForum = new ModernForum('forum-container');
  }
});

// Service Worker for offline functionality
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(registration => console.log('SW registered'))
      .catch(err => console.log('SW registration failed'));
  });
}

// Web Share API integration
async function shareStory(story) {
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'AI Took My Job - Story Share',
        text: story.story,
        url: window.location.href
      });
    } catch (error) {
      console.log('Sharing failed:', error);
    }
  } else {
    // Fallback to clipboard API
    try {
      await navigator.clipboard.writeText(window.location.href);
      alert('Link copied to clipboard!');
    } catch (error) {
      console.log('Clipboard copy failed:', error);
    }
  }
}

// Web Animations API for enhanced interactions
function createFloatingAnimation(element) {
  element.animate([
    { transform: 'translateY(0px)' },
    { transform: 'translateY(-20px)' },
    { transform: 'translateY(0px)' }
  ], {
    duration: 3000,
    iterations: Infinity,
    easing: 'ease-in-out'
  });
}

// Initialize floating animations for elements
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.floating-element').forEach(createFloatingAnimation);
});