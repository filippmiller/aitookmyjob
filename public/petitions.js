// AI Took My Job — Petition System UI
// Alpha agent module — Human Signal design system
// IIFE, self-initialising on DOMContentLoaded

(function () {
  'use strict';

  // ── Open Letter static data ──

  const OPEN_LETTER = {
    id: 'open-letter-ai-reporting',
    title: 'Open Letter: Demand Transparent AI Displacement Reporting',
    preText: 'This letter includes stories from affected workers across multiple countries.',
    body: `
      <p>To: Corporate Leaders, Technology Executives, and Policy Makers</p>

      <p>We, the workers displaced by AI automation, write to demand immediate action on transparent AI displacement reporting. The rapid adoption of artificial intelligence has fundamentally altered the global labour market — yet this transformation is occurring without accountability, transparency, or adequate support for those most affected.</p>

      <p>Every day, thousands of professionals — developers, writers, designers, translators, customer support agents, data analysts, and countless others — lose their livelihoods to AI tools deployed without warning, without consultation, and without severance commensurate with the disruption caused.</p>

      <p>We demand the following:</p>

      <p><strong>1. Mandatory disclosure.</strong> Companies with more than 50 employees must publicly disclose when AI tools replace human roles — including the number of roles affected, the timeline, and what support was provided to affected workers.</p>

      <p><strong>2. Impact assessment.</strong> Before deploying AI that eliminates roles, organisations must conduct and publish human impact assessments, evaluated by independent third parties.</p>

      <p><strong>3. Fair transition support.</strong> Affected workers are entitled to retraining programmes, extended severance, and job placement support — not just standard redundancy packages designed for a pre-AI era.</p>

      <p><strong>4. National AI displacement registries.</strong> Governments should maintain public registries of AI-driven workforce reductions, enabling researchers, policymakers, and workers to understand the true scale of displacement.</p>

      <p>The stories on this platform are not statistics. They are human beings whose lives have been upended by decisions made in boardrooms and server rooms alike. We deserve visibility. We deserve accountability. We deserve a fair transition into whatever comes next.</p>

      <p>Sign this letter. Add your voice. Demand transparency.</p>

      <p><em>— The community of AI Took My Job</em></p>
    `,
    signatureKey: 'open_letter_ai_reporting'
  };

  let petitionRows = [];

  // ── Helpers ──

  function getApp() {
    return window.app;
  }

  function markSigned(id, patch = {}) {
    petitionRows = petitionRows.map((petition) => (
      petition.id === id ? { ...petition, ...patch, viewerSigned: true } : petition
    ));
    window._petitionRows = petitionRows;
    if (window._petitionOpenLetter?.id === id) {
      window._petitionOpenLetter = { ...window._petitionOpenLetter, ...patch, viewerSigned: true };
    }
  }

  function hasSigned(id) {
    return Boolean(petitionRows.find((petition) => petition.id === id)?.viewerSigned || (window._petitionOpenLetter?.id === id && window._petitionOpenLetter.viewerSigned));
  }

  // ── Inject petition section into DOM ──

  function injectSection() {
    const communitySection = document.getElementById('community');
    if (!communitySection) {
      console.warn('[petitions] Could not find #community section to inject after.');
      return;
    }

    const section = document.createElement('section');
    section.id = 'take-action';
    section.className = 'petition-section';
    section.setAttribute('aria-label', 'Take Action');

    section.innerHTML = `
      <div class="container">
        <div class="petition-section-header">
          <div class="petition-eyebrow">
            <div class="petition-eyebrow-line"></div>
            <span class="petition-eyebrow-text">Take Action</span>
          </div>
          <h2 class="petition-section-title">Campaigns &amp; Petitions</h2>
          <p class="petition-section-subtitle">Join campaigns that demand accountability. Every signature counts.</p>
        </div>

        <!-- Featured Open Letter -->
        <div class="petition-featured" id="petitionOpenLetter">
          <div class="petition-featured-badge">
            <i class="ph ph-envelope-open"></i>
            Featured Open Letter
          </div>
          <h3 class="petition-featured-title">${getApp()?.esc(OPEN_LETTER.title) || OPEN_LETTER.title}</h3>
          <p class="petition-featured-meta" id="petitionLetterMeta">Loading context...</p>

          <button class="petition-letter-toggle" id="petitionLetterToggle" aria-expanded="false">
            <i class="ph ph-caret-down"></i>
            Read the full letter
          </button>

          <div class="petition-letter-body" id="petitionLetterBody" role="region" aria-label="Letter text">
            ${OPEN_LETTER.body}
          </div>

          <div class="petition-sig-block">
            <div class="petition-sig-count">
              <span class="petition-sig-number" id="openLetterSigCount">—</span>
              <span class="petition-sig-label">Signatures</span>
            </div>
            <p class="petition-sig-subtext" id="openLetterSigSubtext">
              Join thousands of workers demanding transparency.
            </p>
          </div>

          <div class="petition-featured-actions">
            <button class="petition-btn-sign" id="openLetterSignBtn">
              <i class="ph ph-pen-nib"></i>
              Sign &amp; Add Your Voice
            </button>
            <button class="petition-btn-share" id="openLetterShareBtn">
              <i class="ph ph-share-network"></i>
              Share this letter
            </button>
          </div>

          <div class="petition-share-panel" id="openLetterSharePanel">
            <p><i class="ph ph-check-circle"></i> You signed! Help spread the word:</p>
            <div class="petition-share-links">
              <a class="petition-share-link petition-share-link--twitter" id="shareTwitter" href="#" target="_blank" rel="noopener">
                <i class="ph ph-twitter-logo"></i>
                Twitter / X
              </a>
              <a class="petition-share-link petition-share-link--linkedin" id="shareLinkedIn" href="#" target="_blank" rel="noopener">
                <i class="ph ph-linkedin-logo"></i>
                LinkedIn
              </a>
              <button class="petition-share-link petition-share-link--copy" id="shareCopy">
                <i class="ph ph-copy"></i>
                Copy link
              </button>
            </div>
          </div>
        </div>

        <!-- Active Petitions List -->
        <div class="petition-list-header">
          <h3 class="petition-list-title">Active Campaigns</h3>
          <span class="petition-count-badge" id="petitionCountBadge">Loading...</span>
        </div>
        <div class="petition-grid" id="petitionGrid">
          <div class="petition-loading" style="grid-column:1/-1;">
            <i class="ph ph-spinner"></i>
            Loading campaigns...
          </div>
        </div>
      </div>
    `;

    communitySection.insertAdjacentElement('afterend', section);
  }

  // ── Render petition cards ──

  function renderPetitions(petitions) {
    const app = getApp();
    const grid = document.getElementById('petitionGrid');
    const badge = document.getElementById('petitionCountBadge');

    if (!grid) return;

    if (badge) {
      badge.textContent = `${petitions.length} active`;
    }

    if (!petitions.length) {
      grid.innerHTML = '<p class="petition-empty">No active campaigns at this time. Check back soon.</p>';
      return;
    }

    grid.innerHTML = petitions.map(petition => {
      const signatures = petition.signatures || petition.signatureCount || 0;
      const goal = petition.goal || 10000;
      const pct = Math.min(100, Math.round((signatures / goal) * 100));
      const signed = Boolean(petition.viewerSigned);

      return `
        <div class="petition-card" data-petition-id="${app?.esc(petition.id) || petition.id}">
          <div class="petition-celebrate" aria-hidden="true"></div>
          <h4 class="petition-card-title">${app?.esc(petition.title) || petition.title}</h4>
          <p class="petition-card-desc">${app?.esc(petition.description || petition.body || '') || ''}</p>

          <div class="petition-progress-wrap">
            <div class="petition-progress-labels">
              <span class="petition-progress-sigs">${app?.fmt(signatures) || signatures}</span>
              <span class="petition-progress-goal">Goal: ${app?.fmt(goal) || goal}</span>
            </div>
            <div class="petition-progress-bar-track">
              <div class="petition-progress-bar-fill" style="width: 0%" data-target-width="${pct}%"></div>
            </div>
            <div class="petition-progress-milestones" aria-hidden="true">
              <div class="petition-milestone" data-pct="25"></div>
              <div class="petition-milestone" data-pct="50"></div>
              <div class="petition-milestone" data-pct="75"></div>
            </div>
          </div>

          <div class="petition-card-footer">
            <button
              class="petition-card-btn${signed ? ' is-signed' : ''}"
              data-petition-id="${app?.esc(petition.id) || petition.id}"
              ${signed ? 'disabled' : ''}
              aria-label="Sign petition: ${app?.esc(petition.title) || petition.title}"
            >
              <i class="ph ${signed ? 'ph-check' : 'ph-signature'}"></i>
              ${signed ? 'Signed' : 'Sign This Petition'}
            </button>
            <button
              class="petition-card-share-btn"
              data-petition-id="${app?.esc(petition.id) || petition.id}"
              aria-label="Share petition"
            >
              <i class="ph ph-share-network"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Animate progress bars after paint
    requestAnimationFrame(() => {
      grid.querySelectorAll('.petition-progress-bar-fill').forEach(bar => {
        const target = bar.dataset.targetWidth;
        setTimeout(() => { bar.style.width = target; }, 100);
      });
    });

    // Bind sign buttons
    grid.querySelectorAll('.petition-card-btn').forEach(btn => {
      if (!btn.disabled) {
        btn.addEventListener('click', handleCardSign);
      }
    });

    // Bind share buttons
    grid.querySelectorAll('.petition-card-share-btn').forEach(btn => {
      btn.addEventListener('click', handleCardShare);
    });
  }

  // ── Sign a petition card ──

  async function handleCardSign(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.petitionId;
    const app = getApp();
    if (!id || btn.disabled) return;

    btn.disabled = true;
    btn.innerHTML = '<i class="ph ph-spinner" style="animation:spin 1s linear infinite"></i> Signing...';

    const res = await app.postJSON(`/api/campaigns/petitions/${id}/sign`, {});

    if (res.ok || res.status === 200) {
      markSigned(id, res.data?.petition || { signatures: res.data?.signatures });
      btn.classList.add('is-signed');
      btn.innerHTML = '<i class="ph ph-check"></i> Signed';

      // Update signature count display
      const card = btn.closest('.petition-card');
      if (card) {
        const sigsEl = card.querySelector('.petition-progress-sigs');
        const newCount = res.data?.signatures || res.data?.signatureCount;
        if (sigsEl && newCount !== undefined) {
          sigsEl.textContent = app.fmt(newCount);
        }

        // Trigger celebration
        celebrate(card);
      }

      app.toast('Thank you for signing! Your voice matters.', 'success');
    } else {
      app.toast(res.error || 'Could not sign petition. Try again.', 'error');
      btn.disabled = false;
      btn.innerHTML = '<i class="ph ph-signature"></i> Sign This Petition';
    }
  }

  // ── Share a petition card ──

  function handleCardShare(e) {
    const btn = e.currentTarget;
    const id = btn.dataset.petitionId;
    const url = `${window.location.origin}/#take-action`;
    const text = 'I signed a petition demanding AI displacement transparency. Add your voice:';
    const app = getApp();

    if (navigator.share) {
      navigator.share({ title: 'AI Took My Job — Take Action', text, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url).then(() => {
        app.toast('Link copied to clipboard', 'success');
      }).catch(() => {
        app.toast('Could not copy link', 'error');
      });
    }
  }

  // ── Celebration burst animation ──

  function celebrate(card) {
    const burst = card.querySelector('.petition-celebrate');
    if (!burst) return;

    const colors = ['var(--amber)', 'var(--amber-light)', 'var(--signal-green)', '#fff'];
    for (let i = 0; i < 16; i++) {
      const dot = document.createElement('div');
      dot.className = 'petition-confetti';
      dot.style.cssText = `
        background: ${colors[i % colors.length]};
        left: ${40 + Math.random() * 20}%;
        top: ${40 + Math.random() * 20}%;
        --tx: ${(Math.random() - 0.5) * 120}px;
        --ty: ${(Math.random() - 0.5) * 120}px;
        animation-delay: ${Math.random() * 0.2}s;
      `;
      burst.appendChild(dot);
      setTimeout(() => dot.remove(), 1000);
    }
  }

  // ── Open Letter sign / share flow ──

  function setupOpenLetter(stats) {
    const app = getApp();
    const signBtn = document.getElementById('openLetterSignBtn');
    const shareBtn = document.getElementById('openLetterShareBtn');
    const sigCount = document.getElementById('openLetterSigCount');
    const sigSubtext = document.getElementById('openLetterSigSubtext');
    const sharePanel = document.getElementById('openLetterSharePanel');
    const metaEl = document.getElementById('petitionLetterMeta');

    const letterPetition = window._petitionOpenLetter;
    const baseSigs = Number(letterPetition?.signatures || 12847);
    const storyCount = stats?.counters?.sharedStories || 0;
    const countryCount = stats?.counters?.distinctCompanies || 0;
    let letterSigs = letterPetition ? baseSigs : baseSigs + Math.floor(storyCount * 3.4);

    // Display meta text
    if (metaEl) {
      metaEl.textContent = `This letter includes stories from ${storyCount || 'many'} affected workers across ${countryCount || 'multiple'} organisations.`;
    }

    // Animate counter
    if (sigCount) {
      animateNumber(sigCount, 0, letterSigs, 2000);
    }

    if (sigSubtext && letterSigs > 0) {
      sigSubtext.textContent = `${app?.fmt(letterSigs) || letterSigs} people have already added their voices.`;
    }

    const isSigned = Boolean(letterPetition?.viewerSigned);
    if (isSigned && signBtn) {
      signBtn.classList.add('is-signed');
      signBtn.innerHTML = '<i class="ph ph-check"></i> You signed';
      signBtn.disabled = true;
      if (sharePanel) sharePanel.classList.add('is-visible');
    }

    // Sign handler
    if (signBtn) {
      signBtn.addEventListener('click', async () => {
        if (hasSigned(OPEN_LETTER.signatureKey)) return;

        signBtn.disabled = true;
        signBtn.innerHTML = '<i class="ph ph-spinner" style="animation:spin 1s linear infinite"></i> Signing...';

        const petitionId = window._petitionOpenLetterId || OPEN_LETTER.signatureKey;
        let ok = false;

        if (petitionId && app) {
          const res = await app.postJSON(`/api/campaigns/petitions/${petitionId}/sign`, {});
          ok = res.ok;
          if (ok && res.data?.signatures) {
            letterSigs = res.data.signatures;
          }
        }

        if (ok) {
          markSigned(petitionId, { signatures: letterSigs });
          signBtn.classList.add('is-signed');
          signBtn.innerHTML = '<i class="ph ph-check"></i> Signed — Thank you!';

          // Update count with bump animation
          if (sigCount) {
            sigCount.textContent = app?.fmt(letterSigs) || letterSigs;
            sigCount.classList.add('bump');
            setTimeout(() => sigCount.classList.remove('bump'), 400);
          }

          if (sharePanel) sharePanel.classList.add('is-visible');
          app?.toast('Your signature has been added to the database.', 'success');
        } else {
          signBtn.disabled = false;
          signBtn.innerHTML = '<i class="ph ph-pen-nib"></i> Sign &amp; Add Your Voice';
          app?.toast('Could not sign. Please try again.', 'error');
        }
      });
    }

    // Share buttons
    const twitterBtn = document.getElementById('shareTwitter');
    const linkedinBtn = document.getElementById('shareLinkedIn');
    const copyBtn = document.getElementById('shareCopy');
    const pageUrl = encodeURIComponent(window.location.origin + '/#take-action');
    const twitterText = encodeURIComponent('I signed an open letter demanding transparent AI displacement reporting. Add your voice: ' + window.location.origin + '/#take-action');
    const linkedinText = encodeURIComponent('I just signed: "Demand Transparent AI Displacement Reporting" — join the movement.');

    if (twitterBtn) {
      twitterBtn.href = `https://twitter.com/intent/tweet?text=${twitterText}`;
    }
    if (linkedinBtn) {
      linkedinBtn.href = `https://www.linkedin.com/sharing/share-offsite/?url=${pageUrl}&summary=${linkedinText}`;
    }
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(window.location.origin + '/#take-action').then(() => {
          copyBtn.innerHTML = '<i class="ph ph-check"></i> Copied!';
          setTimeout(() => { copyBtn.innerHTML = '<i class="ph ph-copy"></i> Copy link'; }, 2000);
        }).catch(() => app?.toast('Could not copy link', 'error'));
      });
    }

    // Share letter button (pre-sign)
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        if (navigator.share) {
          navigator.share({
            title: OPEN_LETTER.title,
            text: 'Add your voice to the open letter demanding transparent AI displacement reporting.',
            url: window.location.origin + '/#take-action'
          }).catch(() => {});
        } else {
          navigator.clipboard.writeText(window.location.origin + '/#take-action').then(() => {
            app?.toast('Link copied to clipboard', 'success');
          }).catch(() => app?.toast('Could not copy link', 'error'));
        }
      });
    }

    // Letter expand toggle
    const toggle = document.getElementById('petitionLetterToggle');
    const body = document.getElementById('petitionLetterBody');
    if (toggle && body) {
      toggle.addEventListener('click', () => {
        const isOpen = body.classList.contains('is-open');
        body.classList.toggle('is-open', !isOpen);
        toggle.classList.toggle('is-open', !isOpen);
        toggle.setAttribute('aria-expanded', String(!isOpen));
        toggle.querySelector('span') && (toggle.querySelector('span').textContent = isOpen ? 'Read the full letter' : 'Hide the letter');
        if (!toggle.querySelector('span')) {
          toggle.lastChild.textContent = isOpen ? ' Read the full letter' : ' Hide the letter';
        }
      });
    }
  }

  // ── Number animation helper ──

  function animateNumber(el, from, to, duration) {
    const app = getApp();
    const start = performance.now();
    function tick(now) {
      const elapsed = now - start;
      const progress = Math.min(1, elapsed / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.floor(from + (to - from) * eased);
      el.textContent = app?.fmt(value) || value.toLocaleString();
      if (progress < 1) requestAnimationFrame(tick);
      else el.textContent = app?.fmt(to) || to.toLocaleString();
    }
    requestAnimationFrame(tick);
  }

  // ── Load and render petitions from API ──

  async function loadPetitions() {
    const app = getApp();
    if (!app) return;

    const data = await app.fetchJSON('/api/campaigns/petitions', { petitions: [] });
    const petitions = data.petitions || [];
    petitionRows = petitions;
    window._petitionRows = petitionRows;

    // Stash first petition ID for the open letter to use (if any matches)
    const letterPetition = petitions.find(p =>
      p.id === OPEN_LETTER.signatureKey || (p.title && p.title.toLowerCase().includes('transparent'))
    );
    if (letterPetition) {
      window._petitionOpenLetterId = letterPetition.id;
      window._petitionOpenLetter = letterPetition;
    }

    renderPetitions(petitions.filter((petition) => petition.id !== window._petitionOpenLetterId && !petition.featured));
  }

  // ── Main initialisation ──

  async function init() {
    // Wait for window.app to be available
    if (!window.app) {
      setTimeout(init, 100);
      return;
    }

    const app = getApp();

    injectSection();

    // Load petitions
    await loadPetitions();

    // Load stats for open letter context
    const statsData = await app.fetchJSON(`/api/stats?country=global`, { counters: {} });
    setupOpenLetter(statsData);

    // Add "Take Action" nav link
    const navLinks = document.getElementById('navLinks');
    if (navLinks && !navLinks.querySelector('[href="#take-action"]')) {
      const communityLink = navLinks.querySelector('[href="#community"]');
      if (communityLink) {
        const link = document.createElement('a');
        link.href = '#take-action';
        link.className = 'nav-link';
        link.textContent = 'Take Action';
        communityLink.insertAdjacentElement('afterend', link);
      }
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();
