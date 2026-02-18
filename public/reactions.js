// AI Took My Job — Enhanced Solidarity Reactions
// Alpha agent module — Human Signal design system
// IIFE, self-initialising. Enhances story cards with expandable reaction bar.

(function () {
  'use strict';

  // ── Reaction type definitions ──

  const REACTIONS = [
    {
      type: 'solidarity',
      icon: 'ph-hand-fist',
      label: "I've been there",
      title: 'Solidarity — I know this feeling',
      activeClass: 'is-active',
      endpoint: 'me-too', // reuse the existing me-too endpoint
    },
    {
      type: 'strength',
      icon: 'ph-heart',
      label: 'Sending strength',
      title: 'Sending strength and support',
      endpoint: 'react',
    },
    {
      type: 'gratitude',
      icon: 'ph-hands-clapping',
      label: 'Thank you',
      title: 'Thank you for sharing this',
      endpoint: 'react',
    }
  ];

  // ── Local storage helpers (track which reactions user made) ──

  function getMyReactions() {
    try {
      return JSON.parse(localStorage.getItem('myReactions') || '{}');
    } catch (e) {
      return {};
    }
  }

  function saveReaction(storyId, type) {
    const reactions = getMyReactions();
    if (!reactions[storyId]) reactions[storyId] = {};
    reactions[storyId][type] = true;
    localStorage.setItem('myReactions', JSON.stringify(reactions));
  }

  function hasReacted(storyId, type) {
    const reactions = getMyReactions();
    return !!(reactions[storyId] && reactions[storyId][type]);
  }

  // ── Build the reaction bar HTML for a given story ──

  function buildReactionBar(storyId, storyName, meTooCount) {
    const app = window.app;
    const myReactions = getMyReactions();
    const storyReactions = myReactions[storyId] || {};

    // Default counts: solidarity inherits the existing meToo count
    // strength and gratitude start at 0 locally (no dedicated backend endpoints)
    const counts = {
      solidarity: meTooCount || 0,
      strength: 0,
      gratitude: 0
    };

    const total = counts.solidarity + counts.strength + counts.gratitude;
    const escapedName = app ? app.esc(storyId) : storyId;
    const escapedStoryName = app ? app.esc(storyName || 'this person') : (storyName || 'this person');

    // Emoji icons for aggregate display
    const aggregateIcons = REACTIONS.map(r =>
      `<i class="ph ${r.icon}" title="${r.title}"></i>`
    ).join('');

    const reactionBtns = REACTIONS.map(r => {
      const isActive = !!storyReactions[r.type];
      const count = counts[r.type];
      return `
        <button
          class="reaction-btn${isActive ? ' is-active' : ''}"
          data-type="${r.type}"
          data-story-id="${escapedName}"
          data-story-name="${escapedStoryName}"
          title="${r.title}"
          ${isActive ? 'disabled' : ''}
          aria-label="${r.label}: ${count} reactions"
          aria-pressed="${isActive}"
        >
          <i class="ph ${r.icon}"></i>
          <span>${r.label}</span>
          <span class="reaction-count" data-type="${r.type}">${count > 0 ? count : ''}</span>
        </button>
      `;
    }).join('');

    return `
      <div
        class="reaction-bar"
        data-story-id="${escapedName}"
        data-story-name="${escapedStoryName}"
        aria-label="Solidarity reactions"
      >
        <!-- Collapsed aggregate view -->
        <button
          class="reaction-aggregate"
          aria-expanded="false"
          title="Show reaction options"
        >
          <span class="reaction-aggregate-icons">${aggregateIcons}</span>
          <span class="reaction-aggregate-count">${total > 0 ? formatCount(total) + ' solidarity' : 'Show solidarity'}</span>
        </button>

        <!-- Expanded reaction buttons -->
        <div class="reaction-buttons" role="group" aria-label="Reaction options">
          ${reactionBtns}
          <button class="reaction-collapse-btn" title="Collapse" aria-label="Collapse reaction bar">
            <i class="ph ph-x"></i>
          </button>
        </div>
      </div>
    `;
  }

  // ── Compact number format ──

  function formatCount(n) {
    if (!n) return '';
    if (window.app) return window.app.fmt(n);
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  // ── Enhance a single story card ──

  function enhanceCard(card) {
    const metooBtn = card.querySelector('.btn-metoo');
    if (!card || card.dataset.reactionEnhanced) return;
    card.dataset.reactionEnhanced = '1';

    const storyId = metooBtn?.dataset.storyId;
    if (!storyId) return;

    // Get current meToo count
    const countEl = metooBtn?.querySelector('.metoo-count');
    const meTooCount = parseInt(countEl?.textContent || '0', 10) || 0;

    // Get story name from card
    const nameEl = card.querySelector('.story-author');
    const storyName = nameEl?.textContent?.trim() || 'this person';

    // Hide original Me Too button
    if (metooBtn) metooBtn.classList.add('reaction-replaced');

    // Build and inject reaction bar
    const barHTML = buildReactionBar(storyId, storyName, meTooCount);
    const actionsEl = card.querySelector('.story-actions');
    if (actionsEl) {
      actionsEl.insertAdjacentHTML('afterbegin', barHTML);
    } else {
      card.insertAdjacentHTML('beforeend', `<div class="story-actions">${barHTML}</div>`);
    }

    // Bind events on the new bar
    const bar = card.querySelector('.reaction-bar');
    if (!bar) return;

    // Expand on aggregate click
    const aggregate = bar.querySelector('.reaction-aggregate');
    if (aggregate) {
      aggregate.addEventListener('click', () => expandBar(bar));
    }

    // Collapse button
    const collapseBtn = bar.querySelector('.reaction-collapse-btn');
    if (collapseBtn) {
      collapseBtn.addEventListener('click', () => collapseBar(bar));
    }

    // Reaction buttons
    bar.querySelectorAll('.reaction-btn').forEach(btn => {
      btn.addEventListener('click', (e) => handleReaction(e, bar));
    });
  }

  // ── Expand / collapse bar ──

  function expandBar(bar) {
    bar.classList.add('is-expanded');
    const agg = bar.querySelector('.reaction-aggregate');
    if (agg) agg.setAttribute('aria-expanded', 'true');
    // Focus first button
    const first = bar.querySelector('.reaction-btn:not(:disabled)');
    if (first) first.focus();
  }

  function collapseBar(bar) {
    bar.classList.remove('is-expanded');
    const agg = bar.querySelector('.reaction-aggregate');
    if (agg) {
      agg.setAttribute('aria-expanded', 'false');
      agg.focus();
    }
  }

  // ── Handle a reaction click ──

  async function handleReaction(e, bar) {
    const btn = e.currentTarget;
    const type = btn.dataset.type;
    const storyId = btn.dataset.storyId;
    const storyName = btn.dataset.storyName || bar.dataset.storyName || 'this person';
    const app = window.app;

    if (!storyId || btn.disabled) return;

    // Prevent double-fire
    btn.disabled = true;
    btn.setAttribute('aria-pressed', 'true');

    // Add ripple effect
    btn.classList.add('ripple');
    setTimeout(() => btn.classList.remove('ripple'), 400);

    let serverOk = false;

    // solidarity → reuse /api/stories/:id/me-too
    if (type === 'solidarity') {
      if (app) {
        const res = await app.postJSON(`/api/stories/${storyId}/me-too`, {});
        serverOk = res.ok;

        if (serverOk) {
          const newCount = res.data?.meToo;
          const countEl = btn.querySelector('.reaction-count');
          if (countEl && newCount !== undefined) {
            countEl.textContent = formatCount(newCount);
            bumpCount(countEl);
          }
        }
      } else {
        serverOk = true;
      }
    } else {
      // strength / gratitude: no dedicated endpoint yet, just local optimistic update
      serverOk = true;
    }

    if (serverOk) {
      // Save to localStorage
      saveReaction(storyId, type);

      // Activate button
      btn.classList.add('is-active');

      // Optimistically increment count if no server value
      const countEl = btn.querySelector('.reaction-count');
      if (countEl) {
        const current = parseInt(countEl.textContent, 10) || 0;
        const newVal = current + 1;
        countEl.textContent = formatCount(newVal);
        bumpCount(countEl);
      }

      // Update aggregate view
      updateAggregate(bar);

      // Show floating thank-you
      showThankYou(btn, storyName);

      // Toast
      const messages = {
        solidarity: `Thank you for standing with ${storyName}`,
        strength: `Strength sent to ${storyName}`,
        gratitude: `Your gratitude has been noted — thank you`
      };
      app?.toast(messages[type] || 'Reaction recorded', 'success');

      // Collapse bar after a moment
      setTimeout(() => collapseBar(bar), 1500);
    } else {
      // Revert on failure
      btn.disabled = false;
      btn.setAttribute('aria-pressed', 'false');
      app?.toast('Could not save reaction. Try again.', 'error');
    }
  }

  // ── Bump count animation ──

  function bumpCount(el) {
    el.classList.add('bump');
    setTimeout(() => el.classList.remove('bump'), 400);
  }

  // ── Update aggregate total in collapsed view ──

  function updateAggregate(bar) {
    const counts = bar.querySelectorAll('.reaction-count');
    let total = 0;
    counts.forEach(c => {
      total += parseInt(c.textContent, 10) || 0;
    });
    const aggCount = bar.querySelector('.reaction-aggregate-count');
    if (aggCount) {
      aggCount.textContent = total > 0 ? `${formatCount(total)} solidarity` : 'Show solidarity';
    }
  }

  // ── Floating thank-you message ──

  function showThankYou(btn, name) {
    // Remove existing
    const existing = btn.querySelector('.reaction-thankyou');
    if (existing) existing.remove();

    const el = document.createElement('div');
    el.className = 'reaction-thankyou';
    el.textContent = `Thank you for standing with ${name}`;
    btn.appendChild(el);

    // Remove after animation
    setTimeout(() => el.remove(), 2600);
  }

  // ── Observe DOM for new story cards ──
  // (handles dynamic content loaded after init)

  function enhanceAllCards() {
    document.querySelectorAll('.story-card').forEach(card => {
      if (!card.dataset.reactionEnhanced) {
        enhanceCard(card);
      }
    });
  }

  // ── Mutation observer for dynamically rendered stories ──

  function watchForStories() {
    const container = document.getElementById('storiesContainer');
    if (!container) return;

    const observer = new MutationObserver(() => {
      enhanceAllCards();
    });

    observer.observe(container, { childList: true, subtree: true });
  }

  // ── Main init ──

  function init() {
    if (!window.app) {
      setTimeout(init, 100);
      return;
    }

    // Enhance any already-rendered cards
    enhanceAllCards();

    // Watch for new cards
    watchForStories();
  }

  document.addEventListener('DOMContentLoaded', init);

})();
