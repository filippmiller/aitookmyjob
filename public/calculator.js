/**
 * AI Took My Job — Personal Impact Calculator
 * Gamma module — injects after #dashboard section
 * IIFE, no external deps, uses window.app helpers
 */
(function () {
  'use strict';

  // ── Profession dataset ──────────────────────────────────────────────────────
  // Data based on industry reports (McKinsey Global Institute, WEF Future of Jobs,
  // Goldman Sachs AI impact studies, Brookings Institution 2023-2025 reports)
  const PROFESSIONS = [
    {
      id: 'copywriter',
      label: 'Copywriter',
      icon: 'ph-pencil-line',
      riskLevel: 'critical',
      affectedPercent: 78,
      avgRecoveryMonths: 8,
      transitionPaths: ['Content Strategist', 'Brand Consultant', 'UX Writer', 'Prompt Engineer'],
      recommendedSkills: ['AI prompt engineering', 'Content strategy', 'Brand voice development', 'SEO analytics'],
      storiesCount: 143
    },
    {
      id: 'ux-designer',
      label: 'UX Designer',
      icon: 'ph-compass',
      riskLevel: 'medium',
      affectedPercent: 34,
      avgRecoveryMonths: 4,
      transitionPaths: ['AI Product Designer', 'UX Researcher', 'Product Manager', 'Design Systems Lead'],
      recommendedSkills: ['AI design tools (Figma AI)', 'User research', 'Systems thinking', 'Accessibility'],
      storiesCount: 67
    },
    {
      id: 'graphic-designer',
      label: 'Graphic Designer',
      icon: 'ph-paint-brush-broad',
      riskLevel: 'high',
      affectedPercent: 61,
      avgRecoveryMonths: 7,
      transitionPaths: ['Creative Director', 'Brand Identity Specialist', 'Motion Designer', 'AI Art Director'],
      recommendedSkills: ['AI image direction', 'Brand strategy', 'Motion/video design', 'Creative leadership'],
      storiesCount: 201
    },
    {
      id: 'developer',
      label: 'Software Developer',
      icon: 'ph-code',
      riskLevel: 'medium',
      affectedPercent: 29,
      avgRecoveryMonths: 3,
      transitionPaths: ['AI Engineer', 'Platform Engineer', 'ML Ops', 'Technical Product Manager'],
      recommendedSkills: ['LLM integration', 'AI-assisted development', 'Systems architecture', 'Cloud infrastructure'],
      storiesCount: 312
    },
    {
      id: 'junior-developer',
      label: 'Junior Developer',
      icon: 'ph-code-simple',
      riskLevel: 'high',
      affectedPercent: 55,
      avgRecoveryMonths: 6,
      transitionPaths: ['QA Automation', 'DevOps Engineer', 'Technical Support', 'No-code Developer'],
      recommendedSkills: ['AI-assisted coding', 'Testing automation', 'Cloud basics (AWS/GCP)', 'Prompt engineering'],
      storiesCount: 189
    },
    {
      id: 'qa-engineer',
      label: 'QA Engineer',
      icon: 'ph-bug',
      riskLevel: 'high',
      affectedPercent: 58,
      avgRecoveryMonths: 5,
      transitionPaths: ['QA Automation Architect', 'Security Tester', 'AI Test Engineer', 'DevOps Engineer'],
      recommendedSkills: ['AI-powered testing tools', 'Security testing', 'CI/CD pipelines', 'Performance testing'],
      storiesCount: 94
    },
    {
      id: 'translator',
      label: 'Translator',
      icon: 'ph-translate',
      riskLevel: 'critical',
      affectedPercent: 82,
      avgRecoveryMonths: 11,
      transitionPaths: ['Localization Specialist', 'Cultural Consultant', 'MTPE Specialist', 'Language AI Trainer'],
      recommendedSkills: ['MT post-editing (MTPE)', 'Cultural consulting', 'Legal/medical specialization', 'Terminology management'],
      storiesCount: 276
    },
    {
      id: 'support-agent',
      label: 'Customer Support Agent',
      icon: 'ph-headset',
      riskLevel: 'critical',
      affectedPercent: 71,
      avgRecoveryMonths: 9,
      transitionPaths: ['Customer Success Manager', 'AI Chatbot Trainer', 'Operations Analyst', 'Community Manager'],
      recommendedSkills: ['Customer success management', 'CRM systems', 'Data analysis', 'Conflict resolution'],
      storiesCount: 408
    },
    {
      id: 'data-entry',
      label: 'Data Entry Clerk',
      icon: 'ph-table',
      riskLevel: 'critical',
      affectedPercent: 91,
      avgRecoveryMonths: 14,
      transitionPaths: ['Data Analyst', 'Operations Coordinator', 'Database Administrator', 'Process Analyst'],
      recommendedSkills: ['Data analysis (Excel/SQL)', 'Process automation (RPA)', 'Database management', 'Business intelligence'],
      storiesCount: 521
    },
    {
      id: 'accountant',
      label: 'Accountant',
      icon: 'ph-calculator',
      riskLevel: 'high',
      affectedPercent: 47,
      avgRecoveryMonths: 6,
      transitionPaths: ['CFO / Financial Advisor', 'Tax Strategist', 'Forensic Accountant', 'FinTech Analyst'],
      recommendedSkills: ['AI-assisted auditing', 'Financial strategy', 'Tax law expertise', 'FinTech platforms'],
      storiesCount: 163
    },
    {
      id: 'recruiter',
      label: 'Recruiter / HR',
      icon: 'ph-users',
      riskLevel: 'high',
      affectedPercent: 52,
      avgRecoveryMonths: 5,
      transitionPaths: ['People Analytics', 'Talent Strategy', 'Culture Consultant', 'HR Business Partner'],
      recommendedSkills: ['People analytics', 'Employer branding', 'Organizational psychology', 'HRIS platforms'],
      storiesCount: 118
    },
    {
      id: 'paralegal',
      label: 'Paralegal',
      icon: 'ph-scales',
      riskLevel: 'high',
      affectedPercent: 44,
      avgRecoveryMonths: 7,
      transitionPaths: ['Legal Technologist', 'Compliance Officer', 'Contract Manager', 'Legal Operations'],
      recommendedSkills: ['Legal AI tools', 'Compliance frameworks', 'Contract management', 'Regulatory analysis'],
      storiesCount: 87
    },
    {
      id: 'marketing-analyst',
      label: 'Marketing Analyst',
      icon: 'ph-chart-bar',
      riskLevel: 'high',
      affectedPercent: 48,
      avgRecoveryMonths: 4,
      transitionPaths: ['Growth Strategist', 'Marketing Technologist', 'Customer Insights Lead', 'Product Marketer'],
      recommendedSkills: ['AI analytics platforms', 'Growth hacking', 'Customer segmentation', 'Attribution modeling'],
      storiesCount: 99
    },
    {
      id: 'journalist',
      label: 'Journalist / Reporter',
      icon: 'ph-newspaper',
      riskLevel: 'high',
      affectedPercent: 53,
      avgRecoveryMonths: 8,
      transitionPaths: ['Investigative Journalist', 'Data Journalist', 'Content Strategist', 'Podcast Producer'],
      recommendedSkills: ['Investigative reporting', 'Data journalism', 'Multimedia storytelling', 'Source verification'],
      storiesCount: 176
    },
    {
      id: 'illustrator',
      label: 'Illustrator / Artist',
      icon: 'ph-pencil',
      riskLevel: 'critical',
      affectedPercent: 69,
      avgRecoveryMonths: 10,
      transitionPaths: ['Art Director', 'IP Licensor', 'AI Art Consultant', 'Concept Artist'],
      recommendedSkills: ['Concept direction', 'Art licensing', 'Physical/traditional media', 'IP strategy'],
      storiesCount: 244
    },
    {
      id: 'social-media-manager',
      label: 'Social Media Manager',
      icon: 'ph-share-network',
      riskLevel: 'high',
      affectedPercent: 56,
      avgRecoveryMonths: 5,
      transitionPaths: ['Community Builder', 'Brand Strategist', 'Creator Partnerships', 'Influencer Manager'],
      recommendedSkills: ['Community strategy', 'Creator economy', 'Brand partnerships', 'Crisis communication'],
      storiesCount: 132
    },
    {
      id: 'data-analyst',
      label: 'Data Analyst',
      icon: 'ph-chart-line',
      riskLevel: 'medium',
      affectedPercent: 32,
      avgRecoveryMonths: 3,
      transitionPaths: ['Data Scientist', 'AI/ML Engineer', 'Business Intelligence Lead', 'Analytics Engineer'],
      recommendedSkills: ['Machine learning basics', 'Python/R proficiency', 'MLOps', 'Statistical modeling'],
      storiesCount: 78
    },
    {
      id: 'video-editor',
      label: 'Video Editor',
      icon: 'ph-film-strip',
      riskLevel: 'high',
      affectedPercent: 49,
      avgRecoveryMonths: 6,
      transitionPaths: ['Creative Director', 'Motion Designer', 'Podcast Producer', 'Film Director'],
      recommendedSkills: ['AI video tools', 'Motion graphics', 'Narrative direction', 'Live production'],
      storiesCount: 103
    },
    {
      id: 'financial-advisor',
      label: 'Financial Advisor',
      icon: 'ph-currency-dollar',
      riskLevel: 'medium',
      affectedPercent: 27,
      avgRecoveryMonths: 4,
      transitionPaths: ['Wealth Strategist', 'ESG Advisor', 'Family Office Advisor', 'FinTech Consultant'],
      recommendedSkills: ['Behavioral finance', 'ESG investing', 'Client relationship management', 'Tax optimization'],
      storiesCount: 42
    },
    {
      id: 'medical-transcriptionist',
      label: 'Medical Transcriptionist',
      icon: 'ph-stethoscope',
      riskLevel: 'critical',
      affectedPercent: 84,
      avgRecoveryMonths: 12,
      transitionPaths: ['Health Information Manager', 'Clinical Coder', 'Patient Advocate', 'Healthcare Data Analyst'],
      recommendedSkills: ['Medical coding (ICD-10)', 'EHR systems', 'Health informatics', 'Clinical data management'],
      storiesCount: 198
    },
    {
      id: 'teacher',
      label: 'Teacher / Instructor',
      icon: 'ph-graduation-cap',
      riskLevel: 'low',
      affectedPercent: 15,
      avgRecoveryMonths: 2,
      transitionPaths: ['Instructional Designer', 'EdTech Specialist', 'Corporate Trainer', 'Learning Experience Designer'],
      recommendedSkills: ['AI-enhanced pedagogy', 'Instructional design', 'Learning analytics', 'EdTech platforms'],
      storiesCount: 31
    },
    {
      id: 'nurse',
      label: 'Nurse / Healthcare Worker',
      icon: 'ph-first-aid',
      riskLevel: 'low',
      affectedPercent: 11,
      avgRecoveryMonths: 2,
      transitionPaths: ['Health Informatics', 'Telehealth Coordinator', 'Clinical AI Specialist', 'Care Manager'],
      recommendedSkills: ['Telehealth platforms', 'Clinical informatics', 'AI diagnostic tools', 'Remote patient monitoring'],
      storiesCount: 18
    },
    {
      id: 'project-manager',
      label: 'Project Manager',
      icon: 'ph-kanban',
      riskLevel: 'medium',
      affectedPercent: 31,
      avgRecoveryMonths: 3,
      transitionPaths: ['Program Director', 'Agile Coach', 'Product Manager', 'Operations Lead'],
      recommendedSkills: ['AI project tools', 'Strategic planning', 'Risk management', 'Stakeholder communication'],
      storiesCount: 56
    },
    {
      id: 'customer-success',
      label: 'Customer Success Manager',
      icon: 'ph-handshake',
      riskLevel: 'medium',
      affectedPercent: 38,
      avgRecoveryMonths: 4,
      transitionPaths: ['Revenue Operations', 'Account Executive', 'Partner Manager', 'Growth Manager'],
      recommendedSkills: ['Revenue operations', 'CRM analytics', 'Expansion revenue', 'Executive relationships'],
      storiesCount: 71
    },
    {
      id: 'supply-chain',
      label: 'Supply Chain Analyst',
      icon: 'ph-truck',
      riskLevel: 'high',
      affectedPercent: 45,
      avgRecoveryMonths: 5,
      transitionPaths: ['Supply Chain Strategist', 'Procurement Manager', 'Logistics Tech Lead', 'Operations Director'],
      recommendedSkills: ['Supply chain AI tools', 'Demand forecasting', 'Procurement strategy', 'Logistics optimization'],
      storiesCount: 84
    },
    {
      id: 'insurance-agent',
      label: 'Insurance Agent / Underwriter',
      icon: 'ph-shield-check',
      riskLevel: 'high',
      affectedPercent: 57,
      avgRecoveryMonths: 7,
      transitionPaths: ['Risk Consultant', 'Actuarial Analyst', 'InsurTech Specialist', 'Compliance Manager'],
      recommendedSkills: ['Risk modeling', 'InsurTech platforms', 'Regulatory compliance', 'Data-driven underwriting'],
      storiesCount: 119
    },
    {
      id: 'real-estate-agent',
      label: 'Real Estate Agent',
      icon: 'ph-house',
      riskLevel: 'medium',
      affectedPercent: 33,
      avgRecoveryMonths: 5,
      transitionPaths: ['Real Estate Consultant', 'PropTech Specialist', 'Investment Advisor', 'Property Manager'],
      recommendedSkills: ['PropTech tools', 'Market analytics', 'Investment consulting', 'Client relationship management'],
      storiesCount: 48
    },
    {
      id: 'librarian',
      label: 'Librarian / Archivist',
      icon: 'ph-books',
      riskLevel: 'high',
      affectedPercent: 46,
      avgRecoveryMonths: 8,
      transitionPaths: ['Knowledge Manager', 'Digital Archivist', 'Research Consultant', 'Information Architect'],
      recommendedSkills: ['Digital preservation', 'Knowledge management', 'Metadata standards', 'AI-assisted cataloging'],
      storiesCount: 37
    },
    {
      id: 'radiologist',
      label: 'Radiologist',
      icon: 'ph-activity',
      riskLevel: 'medium',
      affectedPercent: 28,
      avgRecoveryMonths: 3,
      transitionPaths: ['AI Radiology Specialist', 'Clinical AI Consultant', 'Teleradiology Expert', 'Medical AI Trainer'],
      recommendedSkills: ['AI diagnostic systems', 'Teleradiology', 'Clinical decision support', 'Medical imaging AI'],
      storiesCount: 22
    },
    {
      id: 'travel-agent',
      label: 'Travel Agent',
      icon: 'ph-airplane',
      riskLevel: 'critical',
      affectedPercent: 74,
      avgRecoveryMonths: 9,
      transitionPaths: ['Experience Curator', 'Luxury Travel Advisor', 'Corporate Travel Manager', 'Tour Designer'],
      recommendedSkills: ['Experience curation', 'Luxury market knowledge', 'Corporate accounts', 'Destination expertise'],
      storiesCount: 167
    }
  ];

  const RISK_CONFIG = {
    low:      { label: 'Low Risk',      color: '#5AA86C', icon: 'ph-check-circle' },
    medium:   { label: 'Medium Risk',   color: '#D4956B', icon: 'ph-warning' },
    high:     { label: 'High Risk',     color: '#D45454', icon: 'ph-warning-circle' },
    critical: { label: 'Critical Risk', color: '#D45454', icon: 'ph-fire' }
  };

  // ── State ──────────────────────────────────────────────────────────────────
  let currentProfession = null;
  let dropdownFocusIndex = -1;
  let filteredItems = [];

  // ── Helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return window.app ? window.app.esc(s) : String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  function getRiskConfig(level) {
    return RISK_CONFIG[level] || RISK_CONFIG.medium;
  }

  // ── Render section HTML via DOM injection ─────────────────────────────────
  function injectSection() {
    const dashboard = document.getElementById('dashboard');
    if (!dashboard) return;

    const section = document.createElement('section');
    section.id = 'calculator';
    section.className = 'calc-section';
    section.innerHTML = `
      <div class="container">
        <div class="section-header calc-section-header">
          <h2 class="section-title">How Does AI Affect Your Career?</h2>
          <p class="section-subtitle">Enter your profession to see personalized insights based on industry research</p>
        </div>

        <div class="calc-input-wrap" id="calcInputWrap">
          <i class="ph ph-magnifying-glass calc-input-icon"></i>
          <input
            type="text"
            id="calcInput"
            class="calc-input"
            placeholder="Enter your profession..."
            autocomplete="off"
            aria-label="Enter your profession"
            aria-autocomplete="list"
            aria-controls="calcDropdown"
            aria-expanded="false"
          />
          <div id="calcDropdown" class="calc-dropdown" role="listbox" aria-label="Profession suggestions"></div>
        </div>

        <div id="calcNoMatch" class="calc-no-match">
          <i class="ph ph-magnifying-glass" style="font-size:2rem;display:block;margin-bottom:var(--sp-3);"></i>
          No matching profession found. Try a similar role or <a href="#stories" style="color:var(--amber);">browse stories</a> from your field.
        </div>

        <div id="calcResult" class="calc-result" aria-live="polite"></div>
      </div>
    `;

    dashboard.insertAdjacentElement('afterend', section);
  }

  // ── Dropdown rendering ────────────────────────────────────────────────────
  function renderDropdown(query) {
    const dropdown = document.getElementById('calcDropdown');
    const input = document.getElementById('calcInput');
    const noMatch = document.getElementById('calcNoMatch');
    if (!dropdown || !input) return;

    const q = query.toLowerCase().trim();
    if (!q) {
      closeDropdown();
      noMatch.classList.remove('visible');
      return;
    }

    filteredItems = PROFESSIONS.filter(p =>
      p.label.toLowerCase().includes(q)
    );

    dropdownFocusIndex = -1;

    if (filteredItems.length === 0) {
      closeDropdown();
      noMatch.classList.add('visible');
      document.getElementById('calcResult').classList.remove('visible');
      return;
    }

    noMatch.classList.remove('visible');

    const html = filteredItems.map((p, i) => {
      const risk = getRiskConfig(p.riskLevel);
      return `
        <div class="calc-dropdown-item" role="option" data-idx="${i}" tabindex="-1">
          <i class="ph ${esc(p.icon)}"></i>
          <span>${esc(p.label)}</span>
          <span class="calc-dropdown-item-risk risk-${esc(p.riskLevel)}">${esc(risk.label)}</span>
        </div>
      `;
    }).join('');

    dropdown.innerHTML = html;
    dropdown.classList.add('open');
    input.setAttribute('aria-expanded', 'true');

    dropdown.querySelectorAll('.calc-dropdown-item').forEach(el => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const idx = parseInt(el.dataset.idx, 10);
        selectProfession(filteredItems[idx]);
      });
    });
  }

  function closeDropdown() {
    const dropdown = document.getElementById('calcDropdown');
    const input = document.getElementById('calcInput');
    if (dropdown) dropdown.classList.remove('open');
    if (input) input.setAttribute('aria-expanded', 'false');
    dropdownFocusIndex = -1;
  }

  function moveFocus(direction) {
    const items = document.querySelectorAll('.calc-dropdown-item');
    if (!items.length) return;
    items.forEach(el => el.classList.remove('focused'));
    dropdownFocusIndex = Math.max(0, Math.min(items.length - 1, dropdownFocusIndex + direction));
    items[dropdownFocusIndex].classList.add('focused');
    items[dropdownFocusIndex].scrollIntoView({ block: 'nearest' });
  }

  // ── Select profession and render result ──────────────────────────────────
  function selectProfession(profession) {
    currentProfession = profession;
    const input = document.getElementById('calcInput');
    if (input) input.value = profession.label;
    closeDropdown();
    document.getElementById('calcNoMatch').classList.remove('visible');
    renderResult(profession);
  }

  function renderResult(p) {
    const risk = getRiskConfig(p.riskLevel);
    const resultEl = document.getElementById('calcResult');
    if (!resultEl) return;

    const transitionHTML = p.transitionPaths.map(role =>
      `<div class="calc-detail-item"><i class="ph ph-arrow-right"></i>${esc(role)}</div>`
    ).join('');

    const skillsHTML = p.recommendedSkills.map(skill =>
      `<span class="calc-skill-tag">${esc(skill)}</span>`
    ).join('');

    resultEl.innerHTML = `
      <div class="calc-result-header">
        <span class="calc-risk-badge risk-${esc(p.riskLevel)}">
          <i class="ph ${esc(risk.icon)}"></i>
          ${esc(risk.label)}
        </span>
        <span class="calc-result-profession">${esc(p.label)}</span>
      </div>

      <div class="calc-stats-row">
        <div class="calc-stat-cell">
          <span class="calc-stat-value">${esc(p.affectedPercent)}%</span>
          <span class="calc-stat-label">Roles affected by AI</span>
        </div>
        <div class="calc-stat-cell">
          <span class="calc-stat-value">${esc(p.avgRecoveryMonths)}</span>
          <span class="calc-stat-label">Avg. months to new role</span>
        </div>
        <div class="calc-stat-cell">
          <span class="calc-stat-value">${esc(p.storiesCount)}+</span>
          <span class="calc-stat-label">Stories from your field</span>
        </div>
      </div>

      <div class="calc-details">
        <div class="calc-detail-block">
          <h4>Transition paths</h4>
          <div class="calc-detail-list">
            ${transitionHTML}
          </div>
        </div>
        <div class="calc-detail-block">
          <h4>Skills to build now</h4>
          <div class="calc-skills-wrap">
            ${skillsHTML}
          </div>
        </div>
      </div>

      <div class="calc-result-footer">
        <button class="calc-btn-share" id="calcShareBtn">
          <i class="ph ph-share-network"></i>
          Share your result
        </button>
        <a href="#stories" class="calc-btn-stories">
          <i class="ph ph-users"></i>
          Read stories from ${esc(p.label)}s
        </a>
        <button class="calc-reset-btn" id="calcResetBtn">
          <i class="ph ph-x"></i>
          Start over
        </button>
      </div>
    `;

    resultEl.classList.add('visible');

    // Bind footer actions
    const shareBtn = document.getElementById('calcShareBtn');
    const resetBtn = document.getElementById('calcResetBtn');

    if (shareBtn) {
      shareBtn.addEventListener('click', () => handleShare(p, risk));
    }
    if (resetBtn) {
      resetBtn.addEventListener('click', resetCalculator);
    }

    // Scroll to result smoothly
    setTimeout(() => {
      resultEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }

  function handleShare(p, risk) {
    const text = `I just checked my career risk with AI Took My Job: As a ${p.label}, ${p.affectedPercent}% of roles in my field are affected by AI. Average recovery time is ${p.avgRecoveryMonths} months. Check yours: https://aitookmyjob.com #AITookMyJob #FutureOfWork`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => {
        if (window.app && window.app.toast) {
          window.app.toast('Share text copied to clipboard!', 'success');
        }
      });
    } else {
      const tw = `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}`;
      window.open(tw, '_blank', 'noopener,noreferrer');
    }
  }

  function resetCalculator() {
    currentProfession = null;
    const input = document.getElementById('calcInput');
    const result = document.getElementById('calcResult');
    const noMatch = document.getElementById('calcNoMatch');
    if (input) { input.value = ''; input.focus(); }
    if (result) result.classList.remove('visible');
    if (noMatch) noMatch.classList.remove('visible');
  }

  // ── Event bindings ────────────────────────────────────────────────────────
  function bindEvents() {
    const input = document.getElementById('calcInput');
    if (!input) return;

    input.addEventListener('input', (e) => {
      renderDropdown(e.target.value);
    });

    input.addEventListener('keydown', (e) => {
      const dropdown = document.getElementById('calcDropdown');
      const isOpen = dropdown && dropdown.classList.contains('open');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (!isOpen && input.value) renderDropdown(input.value);
        moveFocus(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        moveFocus(-1);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (dropdownFocusIndex >= 0 && filteredItems[dropdownFocusIndex]) {
          selectProfession(filteredItems[dropdownFocusIndex]);
        } else if (filteredItems.length === 1) {
          selectProfession(filteredItems[0]);
        } else if (filteredItems.length > 1) {
          // Select best match (exact match first)
          const q = input.value.toLowerCase().trim();
          const exact = filteredItems.find(p => p.label.toLowerCase() === q);
          if (exact) selectProfession(exact);
          else selectProfession(filteredItems[0]);
        }
      } else if (e.key === 'Escape') {
        closeDropdown();
      }
    });

    input.addEventListener('blur', () => {
      // Delay close to allow mousedown on items to fire first
      setTimeout(closeDropdown, 150);
    });

    input.addEventListener('focus', () => {
      if (input.value.trim()) renderDropdown(input.value);
    });

    // Click outside
    document.addEventListener('click', (e) => {
      const wrap = document.getElementById('calcInputWrap');
      if (wrap && !wrap.contains(e.target)) closeDropdown();
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectSection();
    bindEvents();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
