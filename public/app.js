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

function parseRoute() {
  const [_, country, lang] = window.location.pathname.split("/");
  return { country: country || "global", lang: lang || "en" };
}

async function getJSON(url, fallback) {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error("Request failed");
    return await res.json();
  } catch (_error) {
    return fallback;
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
  return COUNTRY_NAMES[code] || code.toUpperCase();
}

async function boot() {
  const route = parseRoute();
  const meta = await getJSON("/api/meta", { countries: [], languages: ["en"] });
  const lang = meta.languages.includes(route.lang) ? route.lang : "en";
  const country = meta.countries.some((c) => c.code === route.country) ? route.country : "global";

  if (route.lang !== lang || route.country !== country) {
    window.location.replace(`/${country}/${lang}/`);
    return;
  }

  const t = await getJSON(`/i18n/${lang}.json`, await getJSON("/i18n/en.json", {}));

  const [statsData, storiesData, companiesData, forumData, adminData] = await Promise.all([
    getJSON(`/api/stats?country=${country}`, { counters: {} }),
    getJSON(`/api/stories?country=${country}&limit=6`, { stories: [] }),
    getJSON(`/api/companies/top?country=${country}`, { companies: [] }),
    getJSON("/api/forum/categories", { categories: [] }),
    getJSON("/api/admin/overview", { message: "Unauthorized" })
  ]);

  const companyTicker = companiesData.companies.length
    ? companiesData.companies.map((c) => `${esc(c.company)} (${fmt(c.layoffs)})`).join(" • ")
    : "No company records yet";

  const recoveredTicker = storiesData.stories
    .filter((s) => s.foundNewJob)
    .map((s) => `${esc(s.name)} / ${countryLabel(s.country)} / ${esc(s.profession)}`)
    .join(" • ") || "No recovered profiles yet";

  const storiesHTML = storiesData.stories.length
    ? storiesData.stories.map((s) => `
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

  const forumHTML = forumData.categories.map((c) => `<li>${esc(c.key)}</li>`).join("");

  app.innerHTML = `
    <main class="container">
      <header class="nav">
        <div class="brand">${esc(t.brand || "AI Took My Job")}</div>
        <div class="controls">
          <select id="countrySelect">${meta.countries
            .map((c) => `<option value="${c.code}" ${c.code === country ? "selected" : ""}>${countryLabel(c.code)}</option>`)
            .join("")}</select>
          <select id="langSelect">${meta.languages
            .map((l) => `<option value="${l}" ${l === lang ? "selected" : ""}>${LANGUAGE_NAMES[l] || l}</option>`)
            .join("")}</select>
        </div>
      </header>

      <section class="hero">
        <h1>${esc(t.heroTitle || "")}</h1>
        <p>${esc(t.heroSubtitle || "")}</p>
        <div class="hero-actions">
          <button class="btn-primary" onclick="document.getElementById('storyForm').scrollIntoView({behavior:'smooth'})">${esc(t.ctaStory || "")}</button>
          <button class="btn-secondary" onclick="document.getElementById('forum').scrollIntoView({behavior:'smooth'})">${esc(t.ctaForum || "")}</button>
        </div>
      </section>

      <section class="grid-4">
        <article class="card"><div class="counter-number">${fmt(statsData.counters.laidOff)}</div><div class="counter-label">${esc(t.counterLaidOff || "")}</div></article>
        <article class="card"><div class="counter-number">${fmt(statsData.counters.sharedStories)}</div><div class="counter-label">${esc(t.counterStories || "")}</div></article>
        <article class="card"><div class="counter-number">${fmt(statsData.counters.foundJob)}</div><div class="counter-label">${esc(t.counterFound || "")}</div></article>
        <article class="card"><div class="counter-number">${fmt(statsData.counters.distinctCompanies)}</div><div class="counter-label">${esc(t.counterCompanies || "")}</div></article>
      </section>

      <section class="ticker"><div class="ticker-track"><strong>${esc(t.tickerLeaders || "")}: </strong>${companyTicker}</div></section>
      <section class="ticker"><div class="ticker-track"><strong>${esc(t.tickerRecovered || "")}: </strong>${recoveredTicker}</div></section>

      <section class="section">
        <h2>${esc(t.latestStories || "")}</h2>
        <div class="stories">${storiesHTML}</div>
      </section>

      <section class="section layout-2">
        <article id="forum" class="card">
          <h2>${esc(t.forumTitle || "")}</h2>
          <ul>${forumHTML}</ul>
          <div class="notice">${esc(t.securityNote || "")}</div>
        </article>
        <article class="card">
          <h2>${esc(t.adminTitle || "")}</h2>
          <p class="notice">${esc(t.adminSecure || "")}</p>
          <pre>${esc(JSON.stringify(adminData, null, 2))}</pre>
        </article>
      </section>

      <section id="storyForm" class="section card">
        <h2>${esc(t.formTitle || "")}</h2>
        <form id="submitStoryForm" class="form-grid">
          <input required name="name" placeholder="${esc(t.name || "")}" />
          <input required name="profession" placeholder="${esc(t.profession || "")}" />
          <input required name="company" placeholder="${esc(t.company || "")}" />
          <input required name="laidOffAt" placeholder="${esc(t.laidOffAt || "")}" />
          <input class="full" required name="reason" placeholder="${esc(t.reason || "")}" />
          <textarea class="full" required name="story" rows="6" placeholder="${esc(t.story || "")}"></textarea>
          <label><input type="checkbox" name="foundNewJob" /> ${esc(t.foundNewJob || "")}</label>
          <button class="btn-primary" type="submit">${esc(t.submit || "")}</button>
          <div class="full" id="submitResult"></div>
        </form>
      </section>

      <footer class="footer">${esc(t.footer || "")}</footer>
    </main>
  `;

  document.getElementById("countrySelect").addEventListener("change", (e) => {
    window.location.assign(`/${e.target.value}/${lang}/`);
  });

  document.getElementById("langSelect").addEventListener("change", (e) => {
    window.location.assign(`/${country}/${e.target.value}/`);
  });

  document.getElementById("submitStoryForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const payload = {
      name: formData.get("name"),
      country,
      language: lang,
      profession: formData.get("profession"),
      company: formData.get("company"),
      laidOffAt: formData.get("laidOffAt"),
      foundNewJob: formData.get("foundNewJob") === "on",
      reason: formData.get("reason"),
      story: formData.get("story")
    };

    const resultNode = document.getElementById("submitResult");

    try {
      const res = await fetch("/api/stories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (!res.ok) throw new Error("submit failed");
      resultNode.className = "success";
      resultNode.textContent = t.submitOk || "Submitted";
      e.target.reset();
    } catch (_error) {
      resultNode.className = "notice";
      resultNode.textContent = t.submitFail || "Submit failed";
    }
  });
}

boot();
