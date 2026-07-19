/**
 * Ops console client (aitj-z8q.16)
 * Auth: Authorization Bearer ADMIN_TOKEN (stored in sessionStorage).
 */
(() => {
  const TOKEN_KEY = "aitj_admin_token";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY) || $("#adminToken")?.value || "";
  }

  function setToken(t) {
    sessionStorage.setItem(TOKEN_KEY, t || "");
    if ($("#adminToken")) $("#adminToken").value = t || "";
  }

  function showError(msg) {
    const el = $("#adminError");
    const ok = $("#adminOk");
    if (ok) ok.classList.add("hidden");
    if (!el) return;
    el.textContent = msg || "Error";
    el.classList.toggle("hidden", !msg);
  }

  function showOk(msg) {
    const el = $("#adminOk");
    const err = $("#adminError");
    if (err) err.classList.add("hidden");
    if (!el) return;
    el.textContent = msg || "";
    el.classList.toggle("hidden", !msg);
    if (msg) setTimeout(() => el.classList.add("hidden"), 3500);
  }

  async function api(path, options = {}) {
    const token = getToken();
    const headers = {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    };
    const res = await fetch(path, { ...options, headers, credentials: "same-origin" });
    let data = null;
    const text = await res.text();
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { message: text };
    }
    if (!res.ok) {
      const msg = data?.message || data?.code || `HTTP ${res.status}`;
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtTime(iso) {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return String(iso);
    }
  }

  function slaPill(state) {
    if (!state) return "";
    return `<span class="pill sla-${esc(state)}">${esc(state)}</span>`;
  }

  function confirmDestructive(title, body) {
    return new Promise((resolve) => {
      const dlg = $("#confirmDialog");
      if (!dlg || typeof dlg.showModal !== "function") {
        resolve(window.confirm(`${title}\n\n${body || ""}`));
        return;
      }
      $("#confirmTitle").textContent = title;
      $("#confirmBody").textContent = body || "This action is audited and requires explicit confirmation.";
      dlg.returnValue = "cancel";
      dlg.showModal();
      dlg.addEventListener(
        "close",
        () => resolve(dlg.returnValue === "ok"),
        { once: true }
      );
    });
  }

  // ── Tabs ─────────────────────────────────────────────────────────────────

  function activateTab(name) {
    $$(".admin-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".admin-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === name));
    location.hash = name;
    loadTab(name);
  }

  async function loadTab(name) {
    showError("");
    try {
      const loaders = {
        overview: loadOverview,
        moderation: loadModeration,
        evidence: loadSignals,
        crisis: loadCrisis,
        reports: loadReports,
        sanctions: loadSanctions,
        appeals: loadAppeals,
        takedowns: loadTakedowns,
        users: loadUsers,
        companies: loadCompanies,
        resources: loadResources,
        news: loadNews,
        jobs: loadJobs,
        health: loadHealth
      };
      if (loaders[name]) await loaders[name]();
    } catch (err) {
      showError(err.message);
      setAuthStatus(false, err.message);
    }
  }

  function setAuthStatus(ok, detail) {
    const el = $("#authStatus");
    if (!el) return;
    el.textContent = ok ? `Connected${detail ? ` · ${detail}` : ""}` : detail || "Not connected";
    el.classList.toggle("ok", !!ok);
    el.classList.toggle("err", !ok && !!detail);
  }

  // ── Loaders ──────────────────────────────────────────────────────────────

  async function loadOverview() {
    const [ov, queue] = await Promise.all([
      api("/api/admin/overview"),
      api("/api/admin/queue/unified?limit=40")
    ]);
    setAuthStatus(true, ov.actorRole || "staff");
    const stats = [
      ["Queue", ov.moderation?.queueItems],
      ["Pending stories", ov.moderation?.pendingStories],
      ["Published", ov.moderation?.publishedStories],
      ["Users", ov.users?.registeredEstimate],
      ["Appeals open", ov.ops?.appealsOpen],
      ["Crisis open", ov.ops?.crisisOpen],
      ["Takedowns", ov.ops?.takedownsPending],
      ["Unified items", queue.total]
    ];
    $("#overviewStats").innerHTML = stats
      .map(
        ([label, value]) =>
          `<div class="stat-card"><div class="label">${esc(label)}</div><div class="value">${esc(value ?? "—")}</div></div>`
      )
      .join("");
    const tb = $("#unifiedTable tbody");
    tb.innerHTML = (queue.items || [])
      .map(
        (it) => `<tr>
        <td><span class="pill">${esc(it.kind)}</span></td>
        <td><strong>${esc(it.title)}</strong><div class="muted">${esc((it.summary || "").slice(0, 120))}</div></td>
        <td>${esc(it.status)} ${slaPill(it.slaState)}</td>
        <td>${esc(fmtTime(it.createdAt))}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="4" class="muted">Queue empty</td></tr>`;
  }

  async function loadModeration() {
    const data = await api("/api/admin/moderation/queue");
    const list = $("#moderationList");
    list.innerHTML = (data.queue || [])
      .map(
        (q) => `<article class="admin-card" data-id="${esc(q.id)}">
        <div class="title">${esc(q.title)} <span class="pill">${esc(q.type)}</span></div>
        <div class="body">${esc((q.story || "").slice(0, 400))}</div>
        <div class="actions">
          <button type="button" class="btn btn-primary btn-sm" data-mod-action="approve" data-id="${esc(q.id)}">Approve</button>
          <button type="button" class="btn btn-danger btn-sm" data-mod-action="reject" data-id="${esc(q.id)}">Reject</button>
        </div>
      </article>`
      )
      .join("") || `<p class="muted">No pending items</p>`;
  }

  async function loadSignals() {
    const data = await api("/api/admin/signals?limit=50");
    const tb = $("#signalsTable tbody");
    tb.innerHTML = (data.signals || [])
      .map(
        (s) => `<tr>
        <td><code>${esc(s.id)}</code></td>
        <td>${esc(s.status)}</td>
        <td>${esc(s.companySlug || "—")}</td>
        <td>${esc(s.verificationLevel || "—")}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" data-sig-status="under_review" data-id="${esc(s.id)}">Review</button>
          <button type="button" class="btn btn-danger btn-sm" data-sig-delete="${esc(s.id)}">Delete</button>
        </td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5" class="muted">No signals</td></tr>`;
  }

  async function loadCrisis() {
    const data = await api("/api/admin/crisis?limit=100");
    const tb = $("#crisisTable tbody");
    tb.innerHTML = (data.cases || [])
      .map(
        (c) => `<tr>
        <td><code>${esc(c.id)}</code></td>
        <td>${esc(c.sourceType)}:${esc(c.sourceId)}</td>
        <td>${esc(c.status)}</td>
        <td>${slaPill(c.slaState)}</td>
        <td>${esc(fmtTime(c.slaDueAt))}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" data-crisis="acknowledged" data-id="${esc(c.id)}">Ack</button>
          <button type="button" class="btn btn-secondary btn-sm" data-crisis="escalated" data-id="${esc(c.id)}">Escalate</button>
          <button type="button" class="btn btn-primary btn-sm" data-crisis="resolved" data-id="${esc(c.id)}" data-confirm="1">Resolve</button>
        </td>
      </tr>`
      )
      .join("") || `<tr><td colspan="6" class="muted">No crisis cases</td></tr>`;
  }

  async function loadReports() {
    const data = await api("/api/admin/reports?status=open");
    function cards(items, kind) {
      return (items || [])
        .map(
          (r) => `<article class="admin-card">
          <div class="title">${esc(r.id)} · ${esc(r.targetType || r.resourceId || "")}</div>
          <div class="body">${esc(r.reason || "")}</div>
          <div class="actions">
            <button type="button" class="btn btn-primary btn-sm" data-report-kind="${kind}" data-report-id="${esc(r.id)}" data-report-status="resolved">Resolve</button>
            <button type="button" class="btn btn-secondary btn-sm" data-report-kind="${kind}" data-report-id="${esc(r.id)}" data-report-status="dismissed">Dismiss</button>
          </div>
        </article>`
        )
        .join("") || `<p class="muted">None</p>`;
    }
    $("#exprReports").innerHTML = cards(data.expression, "expression");
    $("#socialReports").innerHTML = cards(data.social, "social");
    $("#resourceReports").innerHTML = cards(data.resources, "resource");
  }

  async function loadSanctions() {
    const data = await api("/api/admin/sanctions?limit=100");
    $("#sanctionsTable tbody").innerHTML = (data.sanctions || [])
      .map(
        (s) => `<tr>
        <td><code>${esc(s.id)}</code></td>
        <td>${esc(s.targetUserId)}</td>
        <td>${esc(s.type)}</td>
        <td>${esc(s.reason)}</td>
        <td>${esc(fmtTime(s.createdAt))}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5" class="muted">None</td></tr>`;
  }

  async function loadAppeals() {
    const data = await api("/api/admin/appeals?limit=100");
    $("#appealsTable tbody").innerHTML = (data.appeals || [])
      .map(
        (a) => `<tr>
        <td><code>${esc(a.id)}</code></td>
        <td>${esc(a.targetType)}:${esc(a.targetId)}</td>
        <td>${esc(a.status)}</td>
        <td>${slaPill(a.slaState)}</td>
        <td>${esc(fmtTime(a.slaDueAt))}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" data-appeal="under_review" data-id="${esc(a.id)}">Review</button>
          <button type="button" class="btn btn-primary btn-sm" data-appeal="upheld" data-id="${esc(a.id)}" data-confirm="1">Uphold</button>
          <button type="button" class="btn btn-danger btn-sm" data-appeal="overturned" data-id="${esc(a.id)}" data-confirm="1">Overturn</button>
        </td>
      </tr>`
      )
      .join("") || `<tr><td colspan="6" class="muted">No appeals</td></tr>`;
  }

  async function loadTakedowns() {
    const data = await api("/api/admin/takedowns?limit=100");
    $("#takedownsTable tbody").innerHTML = (data.takedowns || [])
      .map(
        (t) => `<tr>
        <td><code>${esc(t.id)}</code></td>
        <td>${esc(t.targetUrl)}</td>
        <td>${esc(t.status)}</td>
        <td>${esc(t.legalBasis)}</td>
        <td>
          <button type="button" class="btn btn-secondary btn-sm" data-td="in_review" data-id="${esc(t.id)}">Review</button>
          <button type="button" class="btn btn-primary btn-sm" data-td="accepted" data-id="${esc(t.id)}" data-confirm="1">Accept</button>
          <button type="button" class="btn btn-danger btn-sm" data-td="rejected" data-id="${esc(t.id)}">Reject</button>
        </td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5" class="muted">None</td></tr>`;
  }

  async function loadUsers() {
    const q = $("#userSearch")?.value || "";
    const data = await api(`/api/admin/users?limit=100&q=${encodeURIComponent(q)}`);
    const roles = data.roles || ["user", "moderator", "admin", "superadmin"];
    $("#usersTable tbody").innerHTML = (data.users || [])
      .map((u) => {
        const opts = roles
          .map((r) => `<option value="${esc(r)}" ${r === u.role ? "selected" : ""}>${esc(r)}</option>`)
          .join("");
        return `<tr>
        <td><code>${esc(u.id)}</code></td>
        <td>${esc(u.email)}</td>
        <td>
          <select data-role-user="${esc(u.id)}">${opts}</select>
          <button type="button" class="btn btn-secondary btn-sm" data-set-role="${esc(u.id)}">Set</button>
        </td>
        <td class="muted">${esc(u.mutedUntil || "—")} / ${esc(u.bannedUntil || "—")}</td>
        <td><button type="button" class="btn btn-danger btn-sm" data-del-user="${esc(u.id)}">Delete</button></td>
      </tr>`;
      })
      .join("") || `<tr><td colspan="5" class="muted">No users</td></tr>`;
  }

  async function loadCompanies() {
    const data = await api("/api/admin/companies");
    $("#companiesTable tbody").innerHTML = (data.topCompanies || [])
      .map(
        (c) => `<tr>
        <td>${esc(c.company)}</td>
        <td>${esc(c.stories)}</td>
        <td>${esc(c.layoffs)}</td>
        <td>${esc(c.rehired)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="4" class="muted">None</td></tr>`;
    $("#boardsList").innerHTML = (data.boards || [])
      .map(
        (b) => `<article class="admin-card">
        <div class="title">${esc(b.companySlug)} · ${esc(b.title)}</div>
        <div class="body">${esc(b.body || "")}</div>
      </article>`
      )
      .join("") || `<p class="muted">No boards</p>`;
  }

  async function loadResources() {
    const data = await api("/api/admin/resources");
    $("#resourcesTable tbody").innerHTML = (data.resources || [])
      .slice(0, 100)
      .map(
        (r) => `<tr>
        <td>${esc(r.title)}</td>
        <td>${esc(r.status)}</td>
        <td>${esc(r.verificationState)}</td>
        <td><a href="${esc(r.url)}" target="_blank" rel="noopener">${esc((r.url || "").slice(0, 48))}</a></td>
      </tr>`
      )
      .join("") || `<tr><td colspan="4" class="muted">None</td></tr>`;
  }

  async function loadNews() {
    const [subs, health] = await Promise.all([
      api("/api/admin/news/submissions"),
      api("/api/admin/news/source-health")
    ]);
    $("#newsSubmissions").innerHTML = (subs.submissions || subs.items || [])
      .map(
        (s) => `<article class="admin-card">
        <div class="title">${esc(s.id)} · ${esc(s.status)}</div>
        <div class="body">${esc(s.title || s.url || "")}</div>
        <div class="actions">
          <button type="button" class="btn btn-primary btn-sm" data-news-sub="approve" data-id="${esc(s.id)}">Approve</button>
          <button type="button" class="btn btn-danger btn-sm" data-news-sub="reject" data-id="${esc(s.id)}">Reject</button>
        </div>
      </article>`
      )
      .join("") || `<p class="muted">No submissions</p>`;
    $("#sourceHealth").textContent = JSON.stringify(health, null, 2);
  }

  async function loadJobs() {
    const status = $("#jobStatusFilter")?.value || "";
    const qs = status ? `?status=${encodeURIComponent(status)}&limit=50` : "?limit=50";
    const data = await api(`/api/admin/jobs${qs}`);
    $("#jobsTable tbody").innerHTML = (data.jobs || [])
      .map(
        (j) => `<tr>
        <td><code>${esc(j.id)}</code></td>
        <td>${esc(j.type)}</td>
        <td>${esc(j.status)}</td>
        <td>${esc(j.attempts ?? j.attempt ?? "—")}</td>
        <td><button type="button" class="btn btn-secondary btn-sm" data-job-retry="${esc(j.id)}">Retry</button></td>
      </tr>`
      )
      .join("") || `<tr><td colspan="5" class="muted">No jobs</td></tr>`;
  }

  async function loadHealth() {
    const [health, audit] = await Promise.all([
      api("/api/admin/health"),
      api("/api/admin/audit?hours=48&limit=80").catch(() => ({ events: [] }))
    ]);
    $("#healthOut").textContent = JSON.stringify(health, null, 2);
    $("#auditTable tbody").innerHTML = (audit.events || [])
      .map(
        (e) => `<tr>
        <td>${esc(fmtTime(e.createdAt))}</td>
        <td>${esc(e.action)}</td>
        <td>${esc(e.actorId)}</td>
        <td>${esc(e.targetType)}:${esc(e.targetId)}</td>
      </tr>`
      )
      .join("") || `<tr><td colspan="4" class="muted">No events</td></tr>`;
  }

  // ── Events ───────────────────────────────────────────────────────────────

  function wire() {
    const saved = sessionStorage.getItem(TOKEN_KEY);
    if (saved && $("#adminToken")) $("#adminToken").value = saved;

    $("#saveToken")?.addEventListener("click", async () => {
      setToken($("#adminToken").value.trim());
      try {
        await loadOverview();
        showOk("Connected");
      } catch (err) {
        showError(err.message);
        setAuthStatus(false, err.message);
      }
    });

    $$(".admin-tab").forEach((btn) => {
      btn.addEventListener("click", () => activateTab(btn.dataset.tab));
    });

    document.body.addEventListener("click", async (ev) => {
      const t = ev.target.closest("[data-action], [data-mod-action], [data-crisis], [data-appeal], [data-td], [data-report-kind], [data-set-role], [data-del-user], [data-sig-delete], [data-sig-status], [data-job-retry], [data-news-sub]");
      if (!t) return;
      try {
        if (t.dataset.action) {
          const map = {
            "reload-unified": loadOverview,
            "reload-moderation": loadModeration,
            "reload-signals": loadSignals,
            "reload-crisis": loadCrisis,
            "scan-crisis": async () => {
              const out = await api("/api/admin/crisis/scan", { method: "POST", body: "{}" });
              showOk(`Opened ${out.opened} crisis case(s)`);
              await loadCrisis();
            },
            "reload-reports": loadReports,
            "reload-sanctions": loadSanctions,
            "reload-appeals": loadAppeals,
            "reload-takedowns": loadTakedowns,
            "reload-users": loadUsers,
            "reload-companies": loadCompanies,
            "reload-resources": loadResources,
            "link-check": async () => {
              await api("/api/admin/resources/link-check", { method: "POST", body: "{}" });
              showOk("Link check enqueued");
            },
            "reload-news": loadNews,
            "ingest-news": async () => {
              await api("/api/admin/news/ingest", { method: "POST", body: "{}" });
              showOk("Ingest triggered");
            },
            "source-check": async () => {
              await api("/api/admin/news/source-check", { method: "POST", body: "{}" });
              showOk("Source check triggered");
              await loadNews();
            },
            "reload-jobs": loadJobs,
            "reload-health": loadHealth
          };
          if (map[t.dataset.action]) await map[t.dataset.action]();
          return;
        }

        if (t.dataset.modAction) {
          const action = t.dataset.modAction;
          const id = t.dataset.id;
          await api(`/api/admin/moderation/${encodeURIComponent(id)}/action`, {
            method: "POST",
            body: JSON.stringify({ action, reason: action === "reject" ? "moderator reject" : "moderator approve" })
          });
          showOk(`${action} ${id}`);
          await loadModeration();
          return;
        }

        if (t.dataset.crisis) {
          const status = t.dataset.crisis;
          const id = t.dataset.id;
          const body = { status };
          if (t.dataset.confirm === "1") {
            const ok = await confirmDestructive("Resolve crisis case?", `Case ${id} → ${status}`);
            if (!ok) return;
            body.confirm = true;
          }
          await api(`/api/admin/crisis/${encodeURIComponent(id)}/status`, {
            method: "POST",
            body: JSON.stringify(body)
          });
          showOk(`Crisis ${status}`);
          await loadCrisis();
          return;
        }

        if (t.dataset.appeal) {
          const status = t.dataset.appeal;
          const id = t.dataset.id;
          const body = { status };
          if (t.dataset.confirm === "1") {
            const ok = await confirmDestructive("Resolve appeal?", `Appeal ${id} → ${status}`);
            if (!ok) return;
            body.confirm = true;
          }
          await api(`/api/admin/appeals/${encodeURIComponent(id)}/status`, {
            method: "POST",
            body: JSON.stringify(body)
          });
          showOk(`Appeal ${status}`);
          await loadAppeals();
          return;
        }

        if (t.dataset.td) {
          const status = t.dataset.td;
          const id = t.dataset.id;
          const body = { status };
          if (t.dataset.confirm === "1") {
            const ok = await confirmDestructive("Accept takedown?", `Takedown ${id}`);
            if (!ok) return;
            body.confirm = true;
          }
          await api(`/api/admin/takedowns/${encodeURIComponent(id)}/resolve`, {
            method: "POST",
            body: JSON.stringify(body)
          });
          showOk(`Takedown ${status}`);
          await loadTakedowns();
          return;
        }

        if (t.dataset.reportKind) {
          const kind = t.dataset.reportKind;
          const id = t.dataset.reportId;
          const status = t.dataset.reportStatus;
          if (kind === "expression") {
            await api(`/api/admin/reports/expression/${encodeURIComponent(id)}/resolve`, {
              method: "POST",
              body: JSON.stringify({ status })
            });
          } else if (kind === "social") {
            await api(`/api/admin/reports/social/${encodeURIComponent(id)}/resolve`, {
              method: "POST",
              body: JSON.stringify({ status })
            });
          } else if (kind === "resource") {
            await api(`/api/admin/resources/reports/${encodeURIComponent(id)}/resolve`, {
              method: "POST",
              body: JSON.stringify({ status })
            });
          }
          showOk("Report updated");
          await loadReports();
          return;
        }

        if (t.dataset.setRole) {
          const id = t.dataset.setRole;
          const sel = document.querySelector(`select[data-role-user="${id}"]`);
          const role = sel?.value;
          const ok = await confirmDestructive("Change user role?", `Set ${id} → ${role}`);
          if (!ok) return;
          await api(`/api/admin/users/${encodeURIComponent(id)}/role`, {
            method: "POST",
            body: JSON.stringify({ role, confirm: true })
          });
          showOk("Role updated");
          await loadUsers();
          return;
        }

        if (t.dataset.delUser) {
          const id = t.dataset.delUser;
          const ok = await confirmDestructive("Delete user permanently?", id);
          if (!ok) return;
          await api(`/api/admin/users/${encodeURIComponent(id)}/delete`, {
            method: "POST",
            body: JSON.stringify({ confirm: true })
          });
          showOk("User deleted");
          await loadUsers();
          return;
        }

        if (t.dataset.sigDelete) {
          const id = t.dataset.sigDelete;
          const ok = await confirmDestructive("Soft-delete signal?", id);
          if (!ok) return;
          await api(`/api/admin/signals/${encodeURIComponent(id)}/delete`, {
            method: "POST",
            body: JSON.stringify({ confirm: true })
          });
          showOk("Signal deleted");
          await loadSignals();
          return;
        }

        if (t.dataset.sigStatus) {
          await api(`/api/admin/signals/${encodeURIComponent(t.dataset.id)}/status`, {
            method: "POST",
            body: JSON.stringify({ status: t.dataset.sigStatus })
          });
          showOk("Signal status updated");
          await loadSignals();
          return;
        }

        if (t.dataset.jobRetry) {
          await api(`/api/admin/jobs/${encodeURIComponent(t.dataset.jobRetry)}/retry`, {
            method: "POST",
            body: "{}"
          });
          showOk("Job retried");
          await loadJobs();
          return;
        }

        if (t.dataset.newsSub) {
          const action = t.dataset.newsSub;
          const id = t.dataset.id;
          await api(`/api/admin/news/submissions/${encodeURIComponent(id)}/${action}`, {
            method: "POST",
            body: "{}"
          });
          showOk(`Submission ${action}`);
          await loadNews();
        }
      } catch (err) {
        showError(err.message);
      }
    });

    $("#sanctionForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const type = fd.get("type");
      const body = {
        targetUserId: fd.get("targetUserId"),
        type,
        reason: fd.get("reason"),
        durationDays: fd.get("durationDays") ? Number(fd.get("durationDays")) : undefined
      };
      if (type === "ban" || type === "suspend") {
        if (!fd.get("confirm")) {
          showError("Check confirm for ban/suspend");
          return;
        }
        body.confirm = true;
      }
      try {
        await api("/api/admin/sanctions", { method: "POST", body: JSON.stringify(body) });
        showOk("Sanction created");
        ev.target.reset();
        await loadSanctions();
      } catch (err) {
        showError(err.message);
      }
    });

    $("#evidenceForm")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      try {
        const data = await api(
          `/api/admin/evidence/${encodeURIComponent(fd.get("id"))}?reason=${encodeURIComponent(fd.get("reason") || "admin_review")}`
        );
        $("#evidenceOut").textContent = JSON.stringify(data, null, 2);
      } catch (err) {
        showError(err.message);
      }
    });

    const hash = (location.hash || "#overview").replace("#", "") || "overview";
    activateTab(hash);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
