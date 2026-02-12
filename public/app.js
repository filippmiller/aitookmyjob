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
  navStats: "Statistics",
  navCompanies: "Companies",
  navResources: "Resources",
  navNews: "News",
  navForum: "Forum",
  navAdmin: "Admin",
  navAuth: "Auth",
  navLegal: "Legal",
  heroTitle: "A public ledger for AI-era layoffs, recovery, and worker voice",
  heroSubtitle: "Track displacement by country, publish verified experiences, and coordinate practical help through stories, forum threads, and moderation-led trust controls.",
  ctaStory: "Share your story",
  ctaForum: "Open forum",
  ctaAuth: "Open auth",
  ctaResources: "Open resources",
  counterLaidOff: "People laid off",
  counterStories: "Stories shared",
  counterFound: "Found a new job",
  counterCompanies: "Companies in tracker",
  tickerLeaders: "Top companies by layoffs",
  tickerRecovered: "People who found a new job",
  latestStories: "Latest stories",
  storyOpen: "Open",
  storyMeToo: "Me too",
  storyComment: "Comment",
  storyCommentPlaceholder: "Add supportive comment",
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
  authPhoneTitle: "Phone verification",
  authPhoneHint: "Required for higher-trust posting and integrations.",
  authPhone: "Phone number",
  authPhoneCode: "Verification code",
  authPhoneStart: "Send code",
  authPhoneConfirm: "Confirm code",
  authPhoneStartOk: "Verification code sent.",
  authPhoneConfirmOk: "Phone verified.",
  deleteAccount: "Delete account",
  statsTitle: "Statistics dashboard",
  companiesTitle: "Company profiles",
  companySelect: "Select company",
  companyNoProfile: "Select a company to view profile.",
  resourcesTitle: "Resources",
  newsTitle: "News",
  legalTitle: "Legal and privacy",
  methodologyTitle: "Methodology",
  takedownTitle: "Takedown request",
  takedownSubmit: "Submit takedown",
  cookieTitle: "Cookie consent",
  cookieAccept: "Accept essential cookies",
  cookieReject: "Reject non-essential",
  anonymousTitle: "Anonymous story submission",
  anonymousSubmit: "Submit anonymously",
  adminTitle: "Admin",
  adminSecure: "Token required for privileged endpoints.",
  adminToken: "Admin token",
  adminTransparencyTitle: "Transparency report",
  adminTransparencyPeriod: "Reporting period (e.g. 2026-Q1)",
  adminTransparencyLoad: "Load report",
  adminTransparencyEmpty: "No transparency report loaded.",
  adminAnomalyTitle: "Anomaly signals",
  adminAnomalyLoad: "Load anomaly signals",
  adminAnomalyEmpty: "No anomaly signals loaded.",
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
  storyPrivacyTitle: "Privacy controls",
  storyVisibilityName: "Name visibility",
  storyVisibilityCompany: "Company visibility",
  storyVisibilityGeo: "Location visibility",
  storyVisibilityDate: "Date visibility",
  visibilityPublic: "Public",
  visibilityCoarse: "Coarse only",
  visibilityHidden: "Hidden",
  deanonymWarningTitle: "Deanonymization risk warnings",
  deanonymWarningNone: "No deanonymization warnings reported.",
  foundNewJob: "I already found a new job",
  ndaLabel: "I confirm my story does not intentionally disclose protected NDA information",
  submit: "Submit for moderation",
  submitOk: "Story submitted. Thank you.",
  submitFail: "Could not submit story. Check fields and try again.",
  navIntegrations: "Integrations",
  integrationsTitle: "Integrations",
  integrationsTelegramTitle: "Telegram link",
  integrationsTelegramStatus: "Current Telegram status",
  integrationsTelegramLoadStatus: "Refresh status",
  integrationsTelegramGenerateCode: "Generate link code",
  integrationsTelegramCode: "Link code",
  integrationsTelegramNoStatus: "No Telegram status available yet.",
  integrationsTelegramAuthHint: "Sign in to generate and view Telegram link status.",
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
  dashboard: null,
  stories: [],
  companies: [],
  companyProfile: null,
  resources: [],
  news: [],
  countersSplit: null,
  petitions: [],
  cohorts: [],
  transparencyCenter: null,
  companyBoardTopics: [],
  onionInfo: null,
  redactionAssistant: null,
  methodology: null,
  categories: [],
  topics: [],
  authUser: null,
  adminToken: localStorage.getItem("adminToken") || "",
  adminOverview: null,
  moderationQueue: [],
  storyRiskWarnings: [],
  transparencyReport: null,
  anomalySignals: [],
  telegramStatus: null,
  telegramLinkCode: "",
  cookieConsent: localStorage.getItem("cookieConsent") || "",
  messages: {
    auth: "",
    phone: "",
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

function normalizeAnomalySignals(data) {
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray(data.signals)) return data.signals;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function extractRiskWarnings(data) {
  if (!data || typeof data !== "object") return [];

  const directWarnings = data.deanonymizationWarnings || data.riskWarnings || data.warnings;
  if (Array.isArray(directWarnings)) {
    return directWarnings.map((v) => String(v || "").trim()).filter(Boolean);
  }

  const risk = data.deanonymizationRisk || data.risk || data.deanonymization;
  if (risk && typeof risk === "object") {
    if (Array.isArray(risk.warnings)) {
      return risk.warnings.map((v) => String(v || "").trim()).filter(Boolean);
    }
    const level = String(risk.level || "").trim();
    const score = Number(risk.score);
    if (level || Number.isFinite(score)) {
      const scorePart = Number.isFinite(score) ? ` (${score.toFixed(2)})` : "";
      return [`${level || "risk"}${scorePart}`];
    }
  }

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
          <span>Views: ${fmt(s.views)}</span>
          <span>Me too: ${fmt(s.meToo)}</span>
          <span>Comments: ${fmt(s.commentsCount)}</span>
        </div>
        <p>${esc(s.story)}</p>
        <div class="hero-actions">
          <button class="btn-secondary" data-view-story="${esc(s.id)}">${esc(t("storyOpen"))}</button>
          <button class="btn-secondary" data-me-too="${esc(s.id)}">${esc(t("storyMeToo"))}</button>
        </div>
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

  const storyRiskWarnings = state.storyRiskWarnings.length
    ? `
      <div class="risk-warnings">
        <h3>${esc(t("deanonymWarningTitle"))}</h3>
        <ul>${state.storyRiskWarnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>
      </div>
    `
    : `<p class="notice">${esc(t("deanonymWarningNone"))}</p>`;

  const anomalyItems = state.anomalySignals.length
    ? state.anomalySignals.map((signal) => `
      <article class="card signal-item">
        <div class="meta">
          <span>${esc(signal.severity || signal.level || "unknown")}</span>
          <span>${esc(signal.type || signal.category || "signal")}</span>
          <span>${esc(signal.createdAt || signal.timestamp || "-")}</span>
        </div>
        <p>${esc(signal.summary || signal.reason || signal.message || "No summary")}</p>
      </article>
    `).join("")
    : `<article class="card">${esc(state.messages.anomaly || t("adminAnomalyEmpty"))}</article>`;

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
          <button class="btn-secondary" data-jump="resources">${esc(t("ctaResources"))}</button>
        </div>
      </section>

      <nav class="section-tabs reveal" aria-label="Main sections">
        <a href="#stories">${esc(t("navStories"))}</a>
        <a href="#stats">${esc(t("navStats"))}</a>
        <a href="#companies">${esc(t("navCompanies"))}</a>
        <a href="#resources">${esc(t("navResources"))}</a>
        <a href="#news">${esc(t("navNews"))}</a>
        <a href="#forum">${esc(t("navForum"))}</a>
        <a href="#admin">${esc(t("navAdmin"))}</a>
        <a href="#auth">${esc(t("navAuth"))}</a>
        <a href="#integrations">${esc(t("navIntegrations"))}</a>
        <a href="#legal">${esc(t("navLegal"))}</a>
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

      <section id="stats" class="section card reveal">
        <h2>${esc(t("statsTitle"))}</h2>
        ${state.countersSplit ? `<div class="notice">All stories: ${fmt(state.countersSplit.all?.stories || 0)} | Verified stories: ${fmt(state.countersSplit.verified?.stories || 0)} | Verified layoffs: ${fmt(state.countersSplit.verified?.laidOff || 0)}</div>` : ""}
        <div class="layout-2">
          <article class="card">
            <h3>Top companies</h3>
            <ul>${(state.dashboard?.topCompaniesByLayoffs || []).slice(0, 8).map((x) => `<li>${esc(x.company)} (${fmt(x.layoffs)})</li>`).join("") || "<li>No data</li>"}</ul>
          </article>
          <article class="card">
            <h3>Affected professions</h3>
            <ul>${(state.dashboard?.affectedProfessions || []).slice(0, 8).map((x) => `<li>${esc(x.profession)} (${fmt(x.count)})</li>`).join("") || "<li>No data</li>"}</ul>
          </article>
          <article class="card">
            <h3>AI tools replacing roles</h3>
            <ul>${(state.dashboard?.aiToolsReplacingPeople || []).slice(0, 8).map((x) => `<li>${esc(x.tool)} (${fmt(x.count)})</li>`).join("") || "<li>No data</li>"}</ul>
          </article>
          <article class="card">
            <h3>Compensation and salary trend</h3>
            <p>Average compensation (months): ${esc(state.dashboard?.averageCompensationMonths ?? "-")}</p>
            <p>Salary avg before: ${fmt(state.dashboard?.salaryTrend?.beforeAverage || 0)}</p>
            <p>Salary avg after: ${fmt(state.dashboard?.salaryTrend?.afterAverage || 0)}</p>
          </article>
        </div>
      </section>

      <section id="companies" class="section card reveal">
        <h2>${esc(t("companiesTitle"))}</h2>
        <form id="companyProfileForm" class="admin-bar">
          <select name="companyName">
            <option value="">${esc(t("companySelect"))}</option>
            ${state.companies.map((c) => `<option value="${esc(c.company)}">${esc(c.company)}</option>`).join("")}
          </select>
          <button class="btn-secondary" type="submit">Load profile</button>
        </form>
        ${state.companyProfile
          ? `<article class="card"><h3>${esc(state.companyProfile.company)}</h3><div class="meta"><span>Stories: ${fmt(state.companyProfile.storiesCount)}</span><span>Humanity: ${fmt(state.companyProfile.humanityRating)}</span></div></article>`
          : `<article class="card">${esc(t("companyNoProfile"))}</article>`}
        <h3>Company board</h3>
        <form id="companyBoardForm" class="form-grid">
          <input class="full" required name="title" placeholder="Board topic title" />
          <textarea class="full" required name="body" rows="3" placeholder="Board topic details"></textarea>
          <button class="btn-secondary" type="submit">Post to board</button>
          <div class="full notice">${esc(state.messages.companyBoard)}</div>
        </form>
        <div class="stories">${state.companyBoardTopics.length ? state.companyBoardTopics.slice(0, 6).map((x) => `<article class="card"><h3>${esc(x.title)}</h3><p>${esc(x.body)}</p></article>`).join("") : "<article class=\"card\">No board topics loaded.</article>"}</div>
      </section>

      <section id="resources" class="section reveal">
        <h2>${esc(t("resourcesTitle"))}</h2>
        <div class="stories">${state.resources.length ? state.resources.map((r) => `<article class="card"><h3>${esc(r.title)}</h3><div class="meta"><span>${esc(r.type)}</span><span>${esc(r.provider || "")}</span></div><p>${esc(r.summary || "")}</p></article>`).join("") : "<article class=\"card\">No resources yet.</article>"}</div>
        <h3>Cohorts</h3>
        <div class="stories">${state.cohorts.length ? state.cohorts.map((c) => `<article class="card"><h3>${esc(c.title)}</h3><div class="meta"><span>${esc(c.profession)}</span><span>${fmt(c.enrolled || 0)}/${fmt(c.capacity || 0)}</span></div></article>`).join("") : "<article class=\"card\">No cohorts yet.</article>"}</div>
        <h3>Campaigns</h3>
        <div class="stories">${state.petitions.length ? state.petitions.map((p) => `<article class="card"><h3>${esc(p.title)}</h3><div class="meta"><span>${fmt(p.signatures || 0)} / ${fmt(p.goal || 0)} signatures</span></div><button class="btn-secondary" data-sign-petition="${esc(p.id)}">Sign</button></article>`).join("") : "<article class=\"card\">No petitions yet.</article>"}</div>
      </section>

      <section id="news" class="section reveal">
        <h2>${esc(t("newsTitle"))}</h2>
        <div class="stories">${state.news.length ? state.news.map((n) => `<article class="card"><h3>${esc(n.title)}</h3><div class="meta"><span>${esc(n.source || "")}</span><span>${esc(n.publishedAt || "")}</span></div></article>`).join("") : "<article class=\"card\">No news yet.</article>"}</div>
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
          <form id="phoneStartForm" class="auth-form">
            <h3>${esc(t("authPhoneTitle"))}</h3>
            <p class="notice">${esc(t("authPhoneHint"))}</p>
            <input required name="phone" placeholder="${esc(t("authPhone"))}" />
            <button class="btn-secondary" type="submit">${esc(t("authPhoneStart"))}</button>
          </form>
          <form id="phoneConfirmForm" class="auth-form">
            <h3>${esc(t("authPhoneConfirm"))}</h3>
            <input required name="phone" placeholder="${esc(t("authPhone"))}" />
            <input required name="code" placeholder="${esc(t("authPhoneCode"))}" />
            <button class="btn-secondary" type="submit">${esc(t("authPhoneConfirm"))}</button>
          </form>
          <div class="auth-session">
            <p><strong>${state.authUser ? esc(t("authSignedInAs")) : esc(t("authGuest"))}</strong>${state.authUser ? `: ${esc(state.authUser.email || state.authUser.id || "user")}` : ""}</p>
            <div class="hero-actions">
              <button class="btn-secondary" type="button" id="meBtn">${esc(t("me"))}</button>
              <button class="btn-secondary" type="button" id="logoutBtn">${esc(t("logout"))}</button>
              <button class="btn-secondary" type="button" id="deleteAccountBtn">${esc(t("deleteAccount"))}</button>
            </div>
            <p class="notice" id="authMessage">${esc(state.messages.auth)}</p>
            <p class="notice" id="phoneMessage">${esc(state.messages.phone)}</p>
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

        <h3>${esc(t("adminTransparencyTitle"))}</h3>
        <form id="transparencyForm" class="admin-bar">
          <input name="period" placeholder="${esc(t("adminTransparencyPeriod"))}" value="${esc(state.transparencyReport?.period || "")}" />
          <button class="btn-secondary" type="submit">${esc(t("adminTransparencyLoad"))}</button>
        </form>
        <p class="notice">${esc(state.messages.transparency)}</p>
        <pre class="admin-pre">${esc(state.transparencyReport ? JSON.stringify(state.transparencyReport, null, 2) : t("adminTransparencyEmpty"))}</pre>

        <h3>${esc(t("adminAnomalyTitle"))}</h3>
        <div class="hero-actions">
          <button class="btn-secondary" type="button" id="loadAnomalyBtn">${esc(t("adminAnomalyLoad"))}</button>
        </div>
        <div class="queue-grid">${anomalyItems}</div>

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
          <input name="city" placeholder="City" />
          <input required name="laidOffAt" placeholder="${esc(t("laidOffAt"))}" />
          <input name="tenureYears" type="number" min="0" step="0.1" placeholder="Tenure years" />
          <input name="salaryBefore" type="number" min="0" placeholder="Salary before" />
          <input name="salaryAfter" type="number" min="0" placeholder="Salary after" />
          <input name="aiTool" placeholder="AI tool replaced role" />
          <input name="searchingMonths" type="number" min="0" step="0.1" placeholder="Search months" />
          <select name="evidenceTier">
            <option value="self_report">Evidence: self report</option>
            <option value="doc_verified">Evidence: document verified</option>
            <option value="multi_source">Evidence: multi-source</option>
          </select>
          <input class="full" required name="reason" placeholder="${esc(t("reason"))}" />
          <textarea class="full" required name="story" rows="6" placeholder="${esc(t("story"))}"></textarea>
          <div class="full privacy-block">
            <h3>${esc(t("storyPrivacyTitle"))}</h3>
            <div class="privacy-grid">
              <label>
                ${esc(t("storyVisibilityName"))}
                <select name="visibilityName">
                  <option value="public">${esc(t("visibilityPublic"))}</option>
                  <option value="coarse">${esc(t("visibilityCoarse"))}</option>
                  <option value="hidden">${esc(t("visibilityHidden"))}</option>
                </select>
              </label>
              <label>
                ${esc(t("storyVisibilityCompany"))}
                <select name="visibilityCompany">
                  <option value="public">${esc(t("visibilityPublic"))}</option>
                  <option value="coarse">${esc(t("visibilityCoarse"))}</option>
                  <option value="hidden">${esc(t("visibilityHidden"))}</option>
                </select>
              </label>
              <label>
                ${esc(t("storyVisibilityGeo"))}
                <select name="visibilityGeo">
                  <option value="public">${esc(t("visibilityPublic"))}</option>
                  <option value="coarse">${esc(t("visibilityCoarse"))}</option>
                  <option value="hidden">${esc(t("visibilityHidden"))}</option>
                </select>
              </label>
              <label>
                ${esc(t("storyVisibilityDate"))}
                <select name="visibilityDate">
                  <option value="public">${esc(t("visibilityPublic"))}</option>
                  <option value="coarse">${esc(t("visibilityCoarse"))}</option>
                  <option value="hidden">${esc(t("visibilityHidden"))}</option>
                </select>
              </label>
            </div>
          </div>
          <label class="full"><input type="checkbox" name="ndaConfirmed" required /> ${esc(t("ndaLabel"))}</label>
          <label><input type="checkbox" name="foundNewJob" /> ${esc(t("foundNewJob"))}</label>
          <button class="btn-primary" type="submit">${esc(t("submit"))}</button>
          <div class="full" id="submitResult">${esc(state.messages.story)}</div>
          <div class="full">${storyRiskWarnings}</div>
        </form>
      </section>

      <section id="integrations" class="section card reveal">
        <h2>${esc(t("integrationsTitle"))}</h2>
        <h3>${esc(t("integrationsTelegramTitle"))}</h3>
        ${state.authUser ? `
          <div class="hero-actions">
            <button class="btn-secondary" type="button" id="loadTelegramStatusBtn">${esc(t("integrationsTelegramLoadStatus"))}</button>
          </div>
          <p class="notice">${esc(state.messages.integrations)}</p>
          <p><strong>${esc(t("integrationsTelegramStatus"))}</strong></p>
          <pre class="admin-pre">${esc(state.telegramStatus ? JSON.stringify(state.telegramStatus, null, 2) : t("integrationsTelegramNoStatus"))}</pre>
          <form id="telegramLinkCodeForm" class="admin-bar">
            <button class="btn-primary" type="submit">${esc(t("integrationsTelegramGenerateCode"))}</button>
            <span><strong>${esc(t("integrationsTelegramCode"))}:</strong> <code>${esc(state.telegramLinkCode || "-")}</code></span>
          </form>
        ` : `
          <p class="notice">${esc(t("integrationsTelegramAuthHint"))}</p>
        `}
      </section>

      <section class="section card reveal">
        <h2>${esc(t("anonymousTitle"))}</h2>
        <form id="anonymousStoryForm" class="form-grid">
          <input name="name" placeholder="${esc(t("name"))}" />
          <input required name="profession" placeholder="${esc(t("profession"))}" />
          <input name="company" placeholder="${esc(t("company"))}" />
          <input required name="laidOffAt" placeholder="${esc(t("laidOffAt"))}" />
          <input class="full" required name="reason" placeholder="${esc(t("reason"))}" />
          <textarea class="full" required name="story" rows="5" placeholder="${esc(t("story"))}"></textarea>
          <label class="full"><input type="checkbox" name="ndaConfirmed" required /> ${esc(t("ndaLabel"))}</label>
          <button class="btn-secondary" type="submit">${esc(t("anonymousSubmit"))}</button>
          <div class="full notice">${esc(state.messages.anonymous)}</div>
        </form>
      </section>

      <section id="legal" class="section card reveal">
        <h2>${esc(t("legalTitle"))}</h2>
        <h3>${esc(t("cookieTitle"))}</h3>
        <div class="hero-actions">
          <button class="btn-secondary" type="button" id="cookieAcceptBtn">${esc(t("cookieAccept"))}</button>
          <button class="btn-secondary" type="button" id="cookieRejectBtn">${esc(t("cookieReject"))}</button>
          <span class="notice">Current: ${esc(state.cookieConsent || "not set")}</span>
        </div>
        <h3>${esc(t("methodologyTitle"))}</h3>
        <pre class="admin-pre">${esc(state.methodology ? JSON.stringify(state.methodology, null, 2) : "No methodology loaded")}</pre>
        <h3>Transparency center</h3>
        <pre class="admin-pre">${esc(state.transparencyCenter ? JSON.stringify(state.transparencyCenter, null, 2) : "No transparency center data")}</pre>
        <h3>Secure submission info</h3>
        <pre class="admin-pre">${esc(state.onionInfo ? JSON.stringify(state.onionInfo, null, 2) : "No secure submission info")}</pre>
        <h3>Redaction assistant</h3>
        <form id="redactionForm" class="form-grid">
          <textarea class="full" required name="text" rows="4" placeholder="Paste draft story text"></textarea>
          <button class="btn-secondary" type="submit">Analyze redaction risk</button>
        </form>
        <pre class="admin-pre">${esc(state.redactionAssistant ? JSON.stringify(state.redactionAssistant, null, 2) : "No redaction analysis yet")}</pre>
        <h3>${esc(t("takedownTitle"))}</h3>
        <form id="takedownForm" class="form-grid">
          <input required name="email" type="email" placeholder="${esc(t("email"))}" />
          <input required name="targetUrl" placeholder="Target URL" />
          <input required class="full" name="legalBasis" placeholder="Legal basis (DMCA, privacy, etc.)" />
          <textarea class="full" required name="reason" rows="4" placeholder="Reason"></textarea>
          <button class="btn-secondary" type="submit">${esc(t("takedownSubmit"))}</button>
          <div class="full notice">${esc(state.messages.legal)}</div>
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

async function loadTransparencyReport(periodInput) {
  const period = String(periodInput || "").trim();
  const query = period ? `?period=${encodeURIComponent(period)}` : "";
  const res = await requestJSON(withAdminToken(`/api/transparency/report${query}`), {
    headers: getAdminHeaders()
  });

  if (res.ok) {
    state.transparencyReport = res.data || {};
    if (period && !state.transparencyReport.period) {
      state.transparencyReport.period = period;
    }
    state.messages.transparency = "";
  } else {
    state.transparencyReport = null;
    state.messages.transparency = res.error;
  }

  render();
}

async function loadAnomalySignals() {
  const endpoints = [
    "/api/admin/anomaly/signals",
    "/api/admin/anomalies/signals",
    "/api/antiabuse/anomaly/signals"
  ];

  let lastRes = null;
  for (const endpoint of endpoints) {
    const res = await requestJSON(withAdminToken(endpoint), {
      headers: getAdminHeaders()
    });
    lastRes = res;
    if (res.ok) {
      state.anomalySignals = normalizeAnomalySignals(res.data);
      state.messages.anomaly = state.anomalySignals.length ? "" : t("adminAnomalyEmpty");
      render();
      return;
    }
    if (res.status !== 404) break;
  }

  state.anomalySignals = [];
  state.messages.anomaly = lastRes && lastRes.status === 404
    ? t("adminAnomalyEmpty")
    : (lastRes && lastRes.error) || t("adminAnomalyEmpty");
  render();
}

async function loadTelegramStatus() {
  if (!state.authUser) {
    state.messages.integrations = t("authRequired");
    render();
    return;
  }

  const endpoints = [
    "/api/integrations/telegram/status",
    "/api/auth/integrations/telegram/status"
  ];

  let lastRes = null;
  for (const endpoint of endpoints) {
    const res = await requestJSON(endpoint);
    lastRes = res;
    if (res.ok) {
      state.telegramStatus = res.data || null;
      state.messages.integrations = "";
      render();
      return;
    }
    if (res.status !== 404) break;
  }

  state.telegramStatus = null;
  state.messages.integrations = lastRes && lastRes.status === 404
    ? ""
    : (lastRes && lastRes.error) || t("integrationsTelegramNoStatus");
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

  const [statsData, storiesData, companiesData, forumData, forumTopicsData, dashboardData, resourcesData, newsData, methodologyData, countersData, petitionsData, cohortsData, centerData, onionData] = await Promise.all([
    getJSON(`/api/stats?country=${country}`, { counters: {} }),
    getJSON(`/api/stories?country=${country}&limit=12`, { stories: [] }),
    getJSON(`/api/companies/top?country=${country}`, { companies: [] }),
    getJSON("/api/forum/categories", { categories: [] }),
    getJSON(`/api/forum/topics?country=${country}`, { topics: [] }),
    getJSON(`/api/statistics/dashboard?country=${country}`, {}),
    getJSON(`/api/resources?country=${country}`, { resources: [] }),
    getJSON(`/api/news?country=${country}`, { news: [] }),
    getJSON("/api/legal/methodology", null),
    getJSON(`/api/counters?country=${country}`, null),
    getJSON("/api/campaigns/petitions", { petitions: [] }),
    getJSON(`/api/cohorts?country=${country}`, { cohorts: [] }),
    getJSON("/api/transparency/center", null),
    getJSON("/api/submission/onion-info", null)
  ]);

  state.stats = statsData;
  state.stories = storiesData.stories || [];
  state.companies = companiesData.companies || [];
  state.categories = forumData.categories || [];
  state.topics = forumTopicsData.topics || [];
  state.dashboard = dashboardData || null;
  state.resources = resourcesData.resources || [];
  state.news = newsData.news || [];
  state.methodology = methodologyData || null;
  state.countersSplit = countersData?.counters || null;
  state.petitions = petitionsData.petitions || [];
  state.cohorts = cohortsData.cohorts || [];
  state.transparencyCenter = centerData || null;
  state.onionInfo = onionData || null;

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
      state.telegramStatus = null;
      state.telegramLinkCode = "";
      state.messages.auth = res.ok ? t("authLogoutOk") : res.error;
      render();
      return;
    }

    if (event.target.id === "deleteAccountBtn") {
      if (!state.authUser) {
        state.messages.auth = t("authRequired");
        render();
        return;
      }
      const confirmation = window.prompt("Type DELETE to confirm account deletion:");
      if (!confirmation) return;
      const res = await requestJSON("/api/auth/delete-account", { method: "POST", body: { confirmation } });
      state.messages.auth = res.ok ? "Account deleted." : res.error;
      if (res.ok) state.authUser = null;
      render();
      return;
    }

    if (event.target.id === "loadQueueBtn") {
      await loadModerationQueue();
      return;
    }

    if (event.target.id === "loadAnomalyBtn") {
      await loadAnomalySignals();
      return;
    }

    if (event.target.id === "loadTelegramStatusBtn") {
      await loadTelegramStatus();
      return;
    }

    if (event.target.id === "cookieAcceptBtn") {
      state.cookieConsent = "essential";
      localStorage.setItem("cookieConsent", state.cookieConsent);
      render();
      return;
    }

    if (event.target.id === "cookieRejectBtn") {
      state.cookieConsent = "minimal";
      localStorage.setItem("cookieConsent", state.cookieConsent);
      render();
      return;
    }

    const meTooBtn = event.target.closest("[data-me-too]");
    if (meTooBtn) {
      const storyId = meTooBtn.getAttribute("data-me-too");
      await requestJSON(`/api/stories/${encodeURIComponent(storyId)}/me-too`, { method: "POST", body: {} });
      const stories = await getJSON(`/api/stories?country=${state.country}&limit=12`, { stories: [] });
      state.stories = stories.stories || state.stories;
      render();
      return;
    }

    const openStoryBtn = event.target.closest("[data-view-story]");
    if (openStoryBtn) {
      const storyId = openStoryBtn.getAttribute("data-view-story");
      await requestJSON(`/api/stories/${encodeURIComponent(storyId)}/view`, { method: "POST", body: {} });
      const stories = await getJSON(`/api/stories?country=${state.country}&limit=12`, { stories: [] });
      state.stories = stories.stories || state.stories;
      render();
      return;
    }

    const signBtn = event.target.closest("[data-sign-petition]");
    if (signBtn) {
      const petitionId = signBtn.getAttribute("data-sign-petition");
      await requestJSON(`/api/campaigns/petitions/${encodeURIComponent(petitionId)}/sign`, { method: "POST", body: {} });
      const petitions = await getJSON("/api/campaigns/petitions", { petitions: [] });
      state.petitions = petitions.petitions || [];
      render();
    }
  });

  app.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const formData = new FormData(form);

    if (form.id === "submitStoryForm") {
      const privacy = {
        name: String(formData.get("visibilityName") || "public"),
        company: String(formData.get("visibilityCompany") || "public"),
        geo: String(formData.get("visibilityGeo") || "public"),
        date: String(formData.get("visibilityDate") || "public")
      };

      const payload = {
        name: formData.get("name"),
        country: state.country,
        language: state.lang,
        profession: formData.get("profession"),
        company: formData.get("company"),
        city: formData.get("city"),
        laidOffAt: formData.get("laidOffAt"),
        tenureYears: formData.get("tenureYears"),
        salaryBefore: formData.get("salaryBefore"),
        salaryAfter: formData.get("salaryAfter"),
        aiTool: formData.get("aiTool"),
        searchingMonths: formData.get("searchingMonths"),
        evidenceTier: formData.get("evidenceTier"),
        foundNewJob: formData.get("foundNewJob") === "on",
        reason: formData.get("reason"),
        story: formData.get("story"),
        privacy,
        visibility: privacy,
        ndaConfirmed: formData.get("ndaConfirmed") === "on"
      };

      const res = await requestJSON("/api/stories", { method: "POST", body: payload });
      state.storyRiskWarnings = extractRiskWarnings(res.data);
      state.messages.story = res.ok ? t("submitOk") : res.error || t("submitFail");
      if (res.ok) {
        form.reset();
        const stories = await getJSON(`/api/stories?country=${state.country}&limit=12`, { stories: [] });
        state.stories = stories.stories || state.stories;
      }
      render();
      return;
    }

    if (form.id === "anonymousStoryForm") {
      const payload = {
        name: formData.get("name"),
        country: state.country,
        language: state.lang,
        profession: formData.get("profession"),
        company: formData.get("company"),
        laidOffAt: formData.get("laidOffAt"),
        foundNewJob: false,
        reason: formData.get("reason"),
        story: formData.get("story"),
        evidenceTier: "self_report",
        ndaConfirmed: formData.get("ndaConfirmed") === "on"
      };
      const res = await requestJSON("/api/stories/anonymous", { method: "POST", body: payload });
      state.messages.anonymous = res.ok ? "Anonymous story submitted." : res.error;
      if (res.ok) form.reset();
      render();
      return;
    }

    if (form.id === "companyProfileForm") {
      const companyName = String(formData.get("companyName") || "");
      const selected = state.companies.find((c) => c.company === companyName);
      if (!selected) {
        state.companyProfile = null;
        state.companyBoardTopics = [];
        render();
        return;
      }
      const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      const res = await requestJSON(`/api/companies/${encodeURIComponent(slug)}`);
      state.companyProfile = res.ok ? res.data : null;
      const boardRes = await requestJSON(`/api/companies/${encodeURIComponent(slug)}/board/topics`);
      state.companyBoardTopics = boardRes.ok ? (boardRes.data?.topics || []) : [];
      render();
      return;
    }

    if (form.id === "companyBoardForm") {
      if (!state.authUser) {
        state.messages.companyBoard = t("authRequired");
        render();
        return;
      }
      if (!state.companyProfile) {
        state.messages.companyBoard = "Load a company profile first.";
        render();
        return;
      }
      const slug = String(state.companyProfile.slug || "").trim();
      const payload = {
        title: String(formData.get("title") || "").trim(),
        body: String(formData.get("body") || "").trim()
      };
      const postRes = await requestJSON(`/api/companies/${encodeURIComponent(slug)}/board/topics`, { method: "POST", body: payload });
      state.messages.companyBoard = postRes.ok ? "Board topic created." : postRes.error;
      if (postRes.ok) {
        const boardRes = await requestJSON(`/api/companies/${encodeURIComponent(slug)}/board/topics`);
        state.companyBoardTopics = boardRes.ok ? (boardRes.data?.topics || []) : state.companyBoardTopics;
        form.reset();
      }
      render();
      return;
    }

    if (form.id === "redactionForm") {
      const payload = { text: String(formData.get("text") || "").trim() };
      const redactionRes = await requestJSON("/api/privacy/redaction-assistant", { method: "POST", body: payload });
      state.redactionAssistant = redactionRes.ok ? redactionRes.data : { error: redactionRes.error };
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

    if (form.id === "phoneStartForm") {
      const payload = {
        phone: String(formData.get("phone") || "").trim()
      };
      const res = await requestJSON("/api/auth/phone/request-otp", { method: "POST", body: payload });
      state.messages.phone = res.ok ? t("authPhoneStartOk") : res.error;
      render();
      return;
    }

    if (form.id === "phoneConfirmForm") {
      const payload = {
        phone: String(formData.get("phone") || "").trim(),
        code: String(formData.get("code") || "").trim()
      };
      const endpoints = ["/api/auth/phone/verify", "/api/auth/phone/confirm"];
      let lastRes = null;

      for (const endpoint of endpoints) {
        const res = await requestJSON(endpoint, { method: "POST", body: payload });
        lastRes = res;
        if (res.ok) {
          state.messages.phone = t("authPhoneConfirmOk");
          await refreshAuthMe();
          form.reset();
          render();
          return;
        }
        if (res.status !== 404) break;
      }

      state.messages.phone = (lastRes && lastRes.error) || t("authMeFail");
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

    if (form.id === "transparencyForm") {
      if (!state.adminToken.trim()) {
        state.messages.transparency = t("adminSecure");
        render();
        return;
      }
      await loadTransparencyReport(formData.get("period"));
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
      return;
    }

    if (form.id === "telegramLinkCodeForm") {
      if (!state.authUser) {
        state.messages.integrations = t("authRequired");
        render();
        return;
      }

      const endpoints = ["/api/integrations/telegram/link-code", "/api/integrations/telegram/link"];
      let lastRes = null;
      for (const endpoint of endpoints) {
        const res = await requestJSON(endpoint, { method: "POST", body: {} });
        lastRes = res;
        if (res.ok) {
          state.telegramLinkCode = String(res.data?.code || res.data?.linkCode || res.data?.token || "").trim();
          state.messages.integrations = "";
          await loadTelegramStatus();
          return;
        }
        if (res.status !== 404) break;
      }
      state.messages.integrations = (lastRes && lastRes.error) || t("integrationsTelegramNoStatus");
      render();
      return;
    }

    if (form.id === "takedownForm") {
      const payload = {
        email: String(formData.get("email") || "").trim(),
        targetUrl: String(formData.get("targetUrl") || "").trim(),
        legalBasis: String(formData.get("legalBasis") || "").trim(),
        reason: String(formData.get("reason") || "").trim()
      };
      const res = await requestJSON("/api/legal/takedown", { method: "POST", body: payload });
      state.messages.legal = res.ok ? "Takedown request submitted." : res.error;
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
