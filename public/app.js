const app = document.getElementById("app");

const COUNTRY_NAMES = {
  global: "Global",
  us: "United States",
  de: "Germany",
  fr: "France",
  es: "Spain",
  ru: "Russia",
  gb: "United Kingdom",
  ca: "Canada",
  mx: "Mexico",
  br: "Brazil",
  ar: "Argentina",
  in: "India",
  jp: "Japan",
  kr: "South Korea",
  au: "Australia",
  za: "South Africa",
  ae: "United Arab Emirates",
  it: "Italy",
  nl: "Netherlands",
  se: "Sweden"
};

const LANGUAGE_NAMES = {
  en: "English",
  ru: "Русский",
  de: "Deutsch",
  fr: "Français",
  es: "Español"
};

const FALLBACK_TEXT = {
  brand: "AI Took My Job",
  navStories: "Stories",
  navForum: "Forum",
  navAdmin: "Admin",
  navAuth: "Auth",
  heroTitle: "A public ledger for AI-era layoffs, recovery, and worker voice",
  heroSubtitle: "Track displacement by country, publish verified experiences, and coordinate practical help through stories, forum threads, and moderation-led trust controls.",
  ctaStory: "Share your story",
  ctaForum: "Open forum",
  ctaAuth: "Open auth",
  counterLaidOff: "People laid off",
  counterStories: "Stories shared",
  counterFound: "Found a new job",
  counterCompanies: "Companies in tracker",
  tickerLeaders: "Top companies by layoffs",
  tickerRecovered: "People who found a new job",
  latestStories: "Latest stories",
  forumTitle: "Forum",
  forumCategories: "Categories",
  forumCreateTitle: "Create a topic",
  forumTopicTitle: "Topic title",
  forumTopicBody: "Topic details",
  forumCategory: "Category",
  forumCreate: "Publish topic",
  forumCreateOk: "Topic created.",
  forumCreateFail: "Could not create topic.",
  forumRepliesLabel: "Replies",
  forumReplyBody: "Write a reply",
  forumReply: "Reply",
  forumReplyOk: "Reply posted.",
  forumReplyFail: "Could not post reply.",
  noTopics: "No forum topics yet.",
  authTitle: "Account access",
  registerTitle: "Register",
  loginTitle: "Login",
  email: "Email",
  password: "Password",
  register: "Create account",
  login: "Sign in",
  me: "Check session",
  logout: "Logout",
  authGuest: "Signed out",
  authSignedInAs: "Signed in as",
  authRegisterOk: "Registration successful.",
  authLoginOk: "Login successful.",
  authLogoutOk: "Logged out.",
  authMeFail: "Could not load session.",
  authRequired: "Sign in required.",
  adminTitle: "Admin",
  adminSecure: "Token required for privileged endpoints.",
  adminToken: "Admin token",
  loadAdmin: "Load overview",
  loadQueue: "Load moderation queue",
  moderationQueueTitle: "Moderation queue",
  queueEmpty: "Queue is empty.",
  moderationAction: "Action",
  moderationReason: "Reason",
  approve: "Approve",
  reject: "Reject",
  adminActionRun: "Run action",
  adminActionOk: "Moderation action applied.",
  adminActionFail: "Moderation action failed.",
  sanctionsTitle: "Sanctions",
  sanctionTargetUser: "Target user id",
  sanctionType: "Sanction type",
  sanctionReason: "Sanction reason",
  sanctionDurationDays: "Duration (days)",
  sanctionSubmit: "Apply sanction",
  sanctionOk: "Sanction applied.",
  sanctionFail: "Could not apply sanction.",
  formTitle: "Submit your story",
  name: "Name or alias",
  profession: "Profession",
  company: "Company",
  laidOffAt: "Layoff date (YYYY-MM)",
  reason: "Reason from employer",
  story: "Your story",
  foundNewJob: "I already found a new job",
  submit: "Submit for moderation",
  submitOk: "Story submitted. Thank you.",
  submitFail: "Could not submit story. Check fields and try again.",
  securityNote: "Security baseline: validation, rate limiting, CSP, strict payload limits.",
  footer: "Global launch: EN / RU / DE / FR / ES. Country-aware routes are live."
};

const state = {
  route: { country: "global", lang: "en" },
  country: "global",
  lang: "en",
  meta: { countries: [], languages: ["en"] },
  t: { ...FALLBACK_TEXT },
  stats: { counters: {} },
  stories: [],
  companies: [],
  categories: [],
  topics: [],
  authUser: null,
  adminToken: localStorage.getItem("adminToken") || "",
  adminOverview: null,
  moderationQueue: [],
  messages: {
    auth: "",
    story: "",
    forumCreate: "",
    admin: "",
    queue: "",
    sanction: ""
  }
};

function parseRoute() {
  const [_, country, lang] = window.location.pathname.split("/");
  return { country: country || "global", lang: lang || "en" };
}

async function getJSON(url, fallback) {
  try {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("Request failed");
    return await res.json();
  } catch (_error) {
    return fallback;
  }
}

async function requestJSON(url, options = {}) {
  const { method = "GET", body, headers = {} } = options;
  const init = {
    method,
    credentials: "include",
    headers: { ...headers }
  };

  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, init);
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
      error: res.ok ? "" : (data && data.message) || `Request failed (${res.status})`
    };
  } catch (_error) {
    return { ok: false, status: 0, data: null, error: "Network error" };
  }
}

function esc(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmt(n) {
  return new Intl.NumberFormat().format(Number(n || 0));
}

function countryLabel(code) {
  return COUNTRY_NAMES[code] || String(code || "").toUpperCase();
}

function t(key) {
  return state.t[key] || FALLBACK_TEXT[key] || key;
}

function getAdminHeaders() {
  const token = state.adminToken.trim();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function withAdminToken(url) {
  const token = encodeURIComponent(state.adminToken.trim());
  if (!token) return url;
  const join = url.includes("?") ? "&" : "?";
  return `${url}${join}token=${token}`;
}

function normalizeQueue(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.queue)) return data.queue;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function render() {
  const companyTicker = state.companies.length
    ? state.companies.map((c) => `${esc(c.company)} (${fmt(c.layoffs)})`).join(" • ")
    : "No company records yet";

  const recoveredTicker = state.stories
    .filter((s) => s.foundNewJob)
    .map((s) => `${esc(s.name)} / ${countryLabel(s.country)} / ${esc(s.profession)}`)
    .join(" • ") || "No recovered profiles yet";

  const storiesHTML = state.stories.length
    ? state.stories.map((s) => `
      <article class="card story">
        <h3>${esc(s.profession)} • ${esc(s.name)}</h3>
        <div class="meta">
          <span>${esc(s.company)}</span>
          <span>${esc(s.laidOffAt)}</span>
          <span>${countryLabel(s.country)}</span>
        </div>
        <p>${esc(s.story)}</p>
      </article>
    `).join("")
    : `<article class="card">No stories yet.</article>`;

  const categoriesHTML = state.categories.length
    ? state.categories.map((c) => `<li>${esc(c.key || c.id)}</li>`).join("")
    : "<li>No categories available.</li>";

  const topicOptions = state.topics
    .map((topic) => `<option value="${esc(topic.id)}">${esc(topic.title)}</option>`)
    .join("");

  const topicItems = state.topics.length
    ? state.topics.map((topic) => `
      <article class="card topic">
        <div class="topic-head">
          <h3>${esc(topic.title)}</h3>
          <div class="meta">
            <span>${esc(topic.categoryId || "general")}</span>
            <span>${t("forumRepliesLabel")}: ${fmt(topic.replies)}</span>
            <span>${esc(topic.lastUpdate || "-")}</span>
          </div>
        </div>
        <form class="reply-form" data-topic-id="${esc(topic.id)}">
          <textarea required name="body" rows="3" placeholder="${esc(t("forumReplyBody"))}"></textarea>
          <div class="form-row">
            <button class="btn-secondary" type="submit">${esc(t("forumReply"))}</button>
          </div>
        </form>
      </article>
    `).join("")
    : `<article class="card">${esc(t("noTopics"))}</article>`;

  const queueItems = state.moderationQueue.length
    ? state.moderationQueue.map((item) => `
      <article class="card queue-item">
        <div class="topic-head">
          <h3>${esc(item.title || item.id || "queue-item")}</h3>
          <div class="meta">
            <span>${esc(item.type || "story")}</span>
            <span>${esc(item.id || "-")}</span>
            <span>${esc(item.createdAt || "-")}</span>
          </div>
        </div>
        <p>${esc(item.story || item.preview || item.reason || "No preview available")}</p>
        <form class="moderation-action" data-entry-id="${esc(item.id || "")}">
          <select name="action">
            <option value="approve">${esc(t("approve"))}</option>
            <option value="reject">${esc(t("reject"))}</option>
          </select>
          <input name="reason" placeholder="${esc(t("moderationReason"))}" />
          <button class="btn-secondary" type="submit">${esc(t("adminActionRun"))}</button>
        </form>
      </article>
    `).join("")
    : `<article class="card">${esc(state.messages.queue || t("queueEmpty"))}</article>`;

  app.innerHTML = `
    <main class="container">
      <header class="nav reveal">
        <div class="brand">${esc(t("brand"))}</div>
        <div class="controls">
          <select id="countrySelect">${state.meta.countries
            .map((c) => `<option value="${c.code}" ${c.code === state.country ? "selected" : ""}>${countryLabel(c.code)}</option>`)
            .join("")}</select>
          <select id="langSelect">${state.meta.languages
            .map((l) => `<option value="${l}" ${l === state.lang ? "selected" : ""}>${LANGUAGE_NAMES[l] || l}</option>`)
            .join("")}</select>
        </div>
      </header>

      <section class="hero reveal">
        <h1>${esc(t("heroTitle"))}</h1>
        <p>${esc(t("heroSubtitle"))}</p>
        <div class="hero-actions">
          <button class="btn-primary" data-jump="storyForm">${esc(t("ctaStory"))}</button>
          <button class="btn-secondary" data-jump="forum">${esc(t("ctaForum"))}</button>
          <button class="btn-secondary" data-jump="auth">${esc(t("ctaAuth"))}</button>
        </div>
      </section>

      <nav class="section-tabs reveal" aria-label="Main sections">
        <a href="#stories">${esc(t("navStories"))}</a>
        <a href="#forum">${esc(t("navForum"))}</a>
        <a href="#admin">${esc(t("navAdmin"))}</a>
        <a href="#auth">${esc(t("navAuth"))}</a>
      </nav>

      <section class="grid-4 reveal">
        <article class="card"><div class="counter-number">${fmt(state.stats.counters.laidOff)}</div><div class="counter-label">${esc(t("counterLaidOff"))}</div></article>
        <article class="card"><div class="counter-number">${fmt(state.stats.counters.sharedStories)}</div><div class="counter-label">${esc(t("counterStories"))}</div></article>
        <article class="card"><div class="counter-number">${fmt(state.stats.counters.foundJob)}</div><div class="counter-label">${esc(t("counterFound"))}</div></article>
        <article class="card"><div class="counter-number">${fmt(state.stats.counters.distinctCompanies)}</div><div class="counter-label">${esc(t("counterCompanies"))}</div></article>
      </section>

      <section class="ticker"><div class="ticker-track"><strong>${esc(t("tickerLeaders"))}: </strong>${companyTicker}</div></section>
      <section class="ticker"><div class="ticker-track"><strong>${esc(t("tickerRecovered"))}: </strong>${recoveredTicker}</div></section>

      <section id="stories" class="section reveal">
        <h2>${esc(t("latestStories"))}</h2>
        <div class="stories">${storiesHTML}</div>
      </section>

      <section class="section card reveal" id="auth">
        <h2>${esc(t("authTitle"))}</h2>
        <div class="auth-layout">
          <form id="registerForm" class="auth-form">
            <h3>${esc(t("registerTitle"))}</h3>
            <input required type="email" name="email" placeholder="${esc(t("email"))}" />
            <input required type="password" name="password" placeholder="${esc(t("password"))}" />
            <button class="btn-primary" type="submit">${esc(t("register"))}</button>
          </form>
          <form id="loginForm" class="auth-form">
            <h3>${esc(t("loginTitle"))}</h3>
            <input required type="email" name="email" placeholder="${esc(t("email"))}" />
            <input required type="password" name="password" placeholder="${esc(t("password"))}" />
            <button class="btn-primary" type="submit">${esc(t("login"))}</button>
          </form>
          <div class="auth-session">
            <p><strong>${state.authUser ? esc(t("authSignedInAs")) : esc(t("authGuest"))}</strong>${state.authUser ? `: ${esc(state.authUser.email || state.authUser.id || "user")}` : ""}</p>
            <div class="hero-actions">
              <button class="btn-secondary" type="button" id="meBtn">${esc(t("me"))}</button>
              <button class="btn-secondary" type="button" id="logoutBtn">${esc(t("logout"))}</button>
            </div>
            <p class="notice" id="authMessage">${esc(state.messages.auth)}</p>
          </div>
        </div>
      </section>

      <section id="forum" class="section layout-2 reveal">
        <article class="card forum-sidebar">
          <h2>${esc(t("forumTitle"))}</h2>
          <h3>${esc(t("forumCategories"))}</h3>
          <ul>${categoriesHTML}</ul>
          <div class="notice">${esc(t("securityNote"))}</div>
          <form id="createTopicForm" class="form-grid">
            <h3 class="full">${esc(t("forumCreateTitle"))}</h3>
            <select required name="categoryId">
              ${state.categories.map((c) => `<option value="${esc(c.id)}">${esc(c.key)}</option>`).join("")}
            </select>
            <input required name="title" placeholder="${esc(t("forumTopicTitle"))}" />
            <textarea class="full" required name="body" rows="4" placeholder="${esc(t("forumTopicBody"))}"></textarea>
            <button class="btn-primary" type="submit">${esc(t("forumCreate"))}</button>
            <div class="full notice" id="forumCreateMessage">${esc(state.messages.forumCreate)}</div>
          </form>
          <form id="quickReplyForm" class="form-grid compact">
            <h3 class="full">${esc(t("forumReply"))}</h3>
            <select required name="topicId" class="full">
              <option value="">Select topic</option>
              ${topicOptions}
            </select>
            <textarea class="full" required name="body" rows="3" placeholder="${esc(t("forumReplyBody"))}"></textarea>
            <button class="btn-secondary" type="submit">${esc(t("forumReply"))}</button>
          </form>
        </article>
        <article class="topic-list">
          ${topicItems}
        </article>
      </section>

      <section id="admin" class="section card reveal">
        <h2>${esc(t("adminTitle"))}</h2>
        <p class="notice">${esc(t("adminSecure"))}</p>
        <form id="adminTokenForm" class="admin-bar">
          <input name="token" value="${esc(state.adminToken)}" placeholder="${esc(t("adminToken"))}" />
          <button class="btn-secondary" type="submit">${esc(t("loadAdmin"))}</button>
          <button class="btn-secondary" type="button" id="loadQueueBtn">${esc(t("loadQueue"))}</button>
        </form>
        <p class="notice" id="adminMessage">${esc(state.messages.admin)}</p>
        <pre class="admin-pre">${esc(state.adminOverview ? JSON.stringify(state.adminOverview, null, 2) : "No admin overview loaded.")}</pre>

        <h3>${esc(t("moderationQueueTitle"))}</h3>
        <div class="queue-grid">${queueItems}</div>

        <h3>${esc(t("sanctionsTitle"))}</h3>
        <form id="sanctionForm" class="form-grid">
          <input required name="targetUserId" placeholder="${esc(t("sanctionTargetUser"))}" />
          <input required name="type" placeholder="${esc(t("sanctionType"))}" />
          <input class="full" required name="reason" placeholder="${esc(t("sanctionReason"))}" />
          <input name="durationDays" type="number" min="1" placeholder="${esc(t("sanctionDurationDays"))}" />
          <button class="btn-primary" type="submit">${esc(t("sanctionSubmit"))}</button>
          <div class="full notice" id="sanctionMessage">${esc(state.messages.sanction)}</div>
        </form>
      </section>

      <section id="storyForm" class="section card reveal">
        <h2>${esc(t("formTitle"))}</h2>
        <form id="submitStoryForm" class="form-grid">
          <input required name="name" placeholder="${esc(t("name"))}" />
          <input required name="profession" placeholder="${esc(t("profession"))}" />
          <input required name="company" placeholder="${esc(t("company"))}" />
          <input required name="laidOffAt" placeholder="${esc(t("laidOffAt"))}" />
          <input class="full" required name="reason" placeholder="${esc(t("reason"))}" />
          <textarea class="full" required name="story" rows="6" placeholder="${esc(t("story"))}"></textarea>
          <label><input type="checkbox" name="foundNewJob" /> ${esc(t("foundNewJob"))}</label>
          <button class="btn-primary" type="submit">${esc(t("submit"))}</button>
          <div class="full" id="submitResult">${esc(state.messages.story)}</div>
        </form>
      </section>

      <footer class="footer">${esc(t("footer"))}</footer>
    </main>
  `;
}

async function refreshAuthMe() {
  const meRes = await requestJSON("/api/auth/me");
  state.authUser = meRes.ok ? meRes.data : null;
  if (!meRes.ok && meRes.status !== 401 && meRes.status !== 404) {
    state.messages.auth = meRes.error || t("authMeFail");
  }
}

async function loadAdminOverview() {
  if (!state.adminToken.trim()) {
    state.messages.admin = t("adminSecure");
    render();
    return;
  }

  const res = await requestJSON(withAdminToken("/api/admin/overview"), {
    headers: getAdminHeaders()
  });

  if (res.ok) {
    state.adminOverview = res.data;
    state.messages.admin = "";
  } else {
    state.adminOverview = null;
    state.messages.admin = res.error;
  }

  render();
}

async function loadModerationQueue() {
  if (!state.adminToken.trim()) {
    state.messages.queue = t("adminSecure");
    render();
    return;
  }

  const res = await requestJSON(withAdminToken("/api/admin/moderation/queue"), {
    headers: getAdminHeaders()
  });

  if (res.ok) {
    state.moderationQueue = normalizeQueue(res.data);
    state.messages.queue = state.moderationQueue.length ? "" : t("queueEmpty");
  } else {
    state.moderationQueue = [];
    state.messages.queue = res.error;
  }

  render();
}

async function loadInitialData() {
  state.route = parseRoute();
  state.meta = await getJSON("/api/meta", { countries: [], languages: ["en"] });

  const lang = state.meta.languages.includes(state.route.lang) ? state.route.lang : "en";
  const country = state.meta.countries.some((c) => c.code === state.route.country) ? state.route.country : "global";

  if (state.route.lang !== lang || state.route.country !== country) {
    window.location.replace(`/${country}/${lang}/`);
    return false;
  }

  state.lang = lang;
  state.country = country;

  const en = await getJSON("/i18n/en.json", FALLBACK_TEXT);
  const localized = await getJSON(`/i18n/${lang}.json`, {});
  state.t = { ...FALLBACK_TEXT, ...en, ...localized };

  const [statsData, storiesData, companiesData, forumData, forumTopicsData] = await Promise.all([
    getJSON(`/api/stats?country=${country}`, { counters: {} }),
    getJSON(`/api/stories?country=${country}&limit=6`, { stories: [] }),
    getJSON(`/api/companies/top?country=${country}`, { companies: [] }),
    getJSON("/api/forum/categories", { categories: [] }),
    getJSON(`/api/forum/topics?country=${country}`, { topics: [] })
  ]);

  state.stats = statsData;
  state.stories = storiesData.stories || [];
  state.companies = companiesData.companies || [];
  state.categories = forumData.categories || [];
  state.topics = forumTopicsData.topics || [];

  await refreshAuthMe();
  return true;
}

function installListeners() {
  app.addEventListener("change", (event) => {
    const target = event.target;

    if (target.id === "countrySelect") {
      window.location.assign(`/${target.value}/${state.lang}/`);
      return;
    }

    if (target.id === "langSelect") {
      window.location.assign(`/${state.country}/${target.value}/`);
    }
  });

  app.addEventListener("click", async (event) => {
    const jump = event.target.closest("[data-jump]");
    if (jump) {
      const node = document.getElementById(jump.getAttribute("data-jump"));
      if (node) node.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    if (event.target.id === "meBtn") {
      await refreshAuthMe();
      state.messages.auth = state.authUser ? "" : t("authGuest");
      render();
      return;
    }

    if (event.target.id === "logoutBtn") {
      const res = await requestJSON("/api/auth/logout", { method: "POST", body: {} });
      state.authUser = null;
      state.messages.auth = res.ok ? t("authLogoutOk") : res.error;
      render();
      return;
    }

    if (event.target.id === "loadQueueBtn") {
      await loadModerationQueue();
    }
  });

  app.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    if (form.id === "submitStoryForm") {
      const payload = {
        name: formData.get("name"),
        country: state.country,
        language: state.lang,
        profession: formData.get("profession"),
        company: formData.get("company"),
        laidOffAt: formData.get("laidOffAt"),
        foundNewJob: formData.get("foundNewJob") === "on",
        reason: formData.get("reason"),
        story: formData.get("story")
      };

      const res = await requestJSON("/api/stories", { method: "POST", body: payload });
      state.messages.story = res.ok ? t("submitOk") : res.error || t("submitFail");
      if (res.ok) form.reset();
      render();
      return;
    }

    if (form.id === "registerForm") {
      const payload = {
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || "")
      };
      const res = await requestJSON("/api/auth/register", { method: "POST", body: payload });
      if (res.ok) {
        state.messages.auth = t("authRegisterOk");
        await refreshAuthMe();
        form.reset();
      } else {
        state.messages.auth = res.error;
      }
      render();
      return;
    }

    if (form.id === "loginForm") {
      const payload = {
        email: String(formData.get("email") || "").trim(),
        password: String(formData.get("password") || "")
      };
      const res = await requestJSON("/api/auth/login", { method: "POST", body: payload });
      if (res.ok) {
        state.messages.auth = t("authLoginOk");
        await refreshAuthMe();
        form.reset();
      } else {
        state.messages.auth = res.error;
      }
      render();
      return;
    }

    if (form.id === "createTopicForm") {
      if (!state.authUser) {
        state.messages.forumCreate = t("authRequired");
        render();
        return;
      }

      const payload = {
        country: state.country,
        language: state.lang,
        categoryId: formData.get("categoryId"),
        title: formData.get("title"),
        body: formData.get("body")
      };

      const res = await requestJSON("/api/forum/topics", { method: "POST", body: payload });
      if (res.ok) {
        state.messages.forumCreate = t("forumCreateOk");
        form.reset();
        const topics = await getJSON(`/api/forum/topics?country=${state.country}`, { topics: [] });
        state.topics = topics.topics || [];
      } else {
        state.messages.forumCreate = res.error || t("forumCreateFail");
      }
      render();
      return;
    }

    if (form.id === "quickReplyForm") {
      if (!state.authUser) {
        state.messages.forumCreate = t("authRequired");
        render();
        return;
      }

      const topicId = String(formData.get("topicId") || "").trim();
      const body = String(formData.get("body") || "").trim();
      if (!topicId) {
        state.messages.forumCreate = t("forumReplyFail");
        render();
        return;
      }

      const res = await requestJSON(`/api/forum/topics/${encodeURIComponent(topicId)}/replies`, {
        method: "POST",
        body: { body, country: state.country, language: state.lang }
      });

      state.messages.forumCreate = res.ok ? t("forumReplyOk") : res.error || t("forumReplyFail");
      if (res.ok) {
        form.reset();
        const topics = await getJSON(`/api/forum/topics?country=${state.country}`, { topics: [] });
        state.topics = topics.topics || [];
      }
      render();
      return;
    }

    if (form.classList.contains("reply-form")) {
      if (!state.authUser) {
        state.messages.forumCreate = t("authRequired");
        render();
        return;
      }

      const topicId = form.getAttribute("data-topic-id");
      const body = String(formData.get("body") || "").trim();
      const res = await requestJSON(`/api/forum/topics/${encodeURIComponent(topicId)}/replies`, {
        method: "POST",
        body: { body, country: state.country, language: state.lang }
      });

      state.messages.forumCreate = res.ok ? t("forumReplyOk") : res.error || t("forumReplyFail");
      if (res.ok) {
        form.reset();
        const topics = await getJSON(`/api/forum/topics?country=${state.country}`, { topics: [] });
        state.topics = topics.topics || [];
      }
      render();
      return;
    }

    if (form.id === "adminTokenForm") {
      state.adminToken = String(formData.get("token") || "").trim();
      localStorage.setItem("adminToken", state.adminToken);
      await loadAdminOverview();
      return;
    }

    if (form.classList.contains("moderation-action")) {
      if (!state.adminToken.trim()) {
        state.messages.queue = t("adminSecure");
        render();
        return;
      }

      const entryId = form.getAttribute("data-entry-id");
      if (!entryId) {
        state.messages.queue = t("adminActionFail");
        render();
        return;
      }

      const payload = {
        action: formData.get("action"),
        reason: formData.get("reason")
      };

      const res = await requestJSON(withAdminToken(`/api/admin/moderation/${encodeURIComponent(entryId)}/action`), {
        method: "POST",
        headers: getAdminHeaders(),
        body: payload
      });

      state.messages.queue = res.ok ? t("adminActionOk") : res.error || t("adminActionFail");
      if (res.ok) await loadModerationQueue();
      else render();
      return;
    }

    if (form.id === "sanctionForm") {
      if (!state.adminToken.trim()) {
        state.messages.sanction = t("adminSecure");
        render();
        return;
      }

      const payload = {
        targetUserId: formData.get("targetUserId"),
        type: formData.get("type"),
        reason: formData.get("reason"),
        durationDays: Number(formData.get("durationDays") || 0) || undefined
      };

      const res = await requestJSON(withAdminToken("/api/admin/sanctions"), {
        method: "POST",
        headers: getAdminHeaders(),
        body: payload
      });

      state.messages.sanction = res.ok ? t("sanctionOk") : res.error || t("sanctionFail");
      if (res.ok) form.reset();
      render();
    }
  });
}

async function boot() {
  installListeners();
  const ready = await loadInitialData();
  if (!ready) return;
  render();
}

boot();
