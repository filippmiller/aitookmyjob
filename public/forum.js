// Modern Forum Component for AI Took My Job - 2026 Edition
// Implements advanced forum functionality with glassmorphism design

class ModernForum {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.state = {
      topics: [],
      categories: [],
      currentUser: null,
      currentPage: 1,
      topicsPerPage: 10,
      searchTerm: '',
      selectedCategory: 'all'
    };
    this.init();
  }

  async init() {
    await this.loadInitialData();
    this.render();
    this.setupEventListeners();
  }

  async loadInitialData() {
    // Load forum data from API
    const [topicsRes, categoriesRes] = await Promise.all([
      fetch('/api/forum/topics'),
      fetch('/api/forum/categories')
    ]);
    
    if (topicsRes.ok) {
      const topicsData = await topicsRes.json();
      this.state.topics = topicsData.topics || [];
    }
    
    if (categoriesRes.ok) {
      const categoriesData = await categoriesRes.json();
      this.state.categories = [
        { id: 'all', key: 'All Topics', count: this.state.topics.length },
        ...(categoriesData.categories || [])
      ];
    }
    
    // Load current user
    const userRes = await fetch('/api/auth/me');
    if (userRes.ok) {
      this.state.currentUser = await userRes.json();
    }
  }

  render() {
    this.container.innerHTML = this.template();
    this.renderTopics();
    this.renderSidebar();
  }

  template() {
    return `
      <div class="forum-container">
        <aside class="forum-sidebar glass-card">
          <div class="sidebar-content">
            <h3>Forum Categories</h3>
            <ul class="category-list">
              ${this.state.categories.map(category => `
                <li class="category-item ${this.state.selectedCategory === category.id ? 'active' : ''}">
                  <a href="#" class="category-link" data-category="${category.id}">
                    <i class="ph ph-hash"></i>
                    ${this.esc(category.key)}
                    <span class="badge">${category.count || 0}</span>
                  </a>
                </li>
              `).join('')}
            </ul>
            
            <div class="forum-stats glass-card">
              <h4>Forum Statistics</h4>
              <div class="stat-item">
                <span>Total Topics</span>
                <span class="stat-value">${this.state.topics.length}</span>
              </div>
              <div class="stat-item">
                <span>Total Posts</span>
                <span class="stat-value">${this.calculateTotalPosts()}</span>
              </div>
              <div class="stat-item">
                <span>Active Users</span>
                <span class="stat-value">${this.calculateActiveUsers()}</span>
              </div>
            </div>
            
            ${this.state.currentUser ? `
              <button class="glass-button full-width new-topic-btn">
                <i class="ph ph-plus"></i>
                New Topic
              </button>
            ` : `
              <div class="require-login">
                <p>You need to be logged in to create topics</p>
                <a href="#auth" class="glass-button">Log In</a>
              </div>
            `}
          </div>
        </aside>
        
        <main class="forum-main">
          <div class="forum-header">
            <div class="forum-controls">
              <input type="text" class="glass-input search-input" placeholder="Search discussions..." value="${this.state.searchTerm}">
              <select class="glass-input category-filter" value="${this.state.selectedCategory}">
                ${this.state.categories.map(category => `
                  <option value="${category.id}">${this.esc(category.key)}</option>
                `).join('')}
              </select>
            </div>
            
            <div class="forum-actions">
              <button class="glass-button sort-btn" data-sort="recent">
                <i class="ph ph-sort"></i>
                Sort
              </button>
            </div>
          </div>
          
          <div class="forum-topics" id="topicsContainer">
            <!-- Topics will be rendered here -->
          </div>
          
          <div class="pagination" id="paginationContainer">
            <!-- Pagination will be rendered here -->
          </div>
        </main>
      </div>
      
      <!-- New Topic Modal -->
      <div class="modal-overlay" id="newTopicModal" style="display: none;">
        <div class="glass-modal new-topic-modal">
          <div class="modal-header">
            <h3>Create New Topic</h3>
            <button class="modal-close">&times;</button>
          </div>
          <form class="new-topic-form">
            <div class="form-group">
              <label for="topicCategory">Category</label>
              <select id="topicCategory" class="glass-input" required>
                ${this.state.categories.slice(1).map(category => `
                  <option value="${category.id}">${this.esc(category.key)}</option>
                `).join('')}
              </select>
            </div>
            <div class="form-group">
              <label for="topicTitle">Title</label>
              <input type="text" id="topicTitle" class="glass-input" placeholder="Enter topic title" maxlength="100" required>
            </div>
            <div class="form-group">
              <label for="topicBody">Description</label>
              <textarea id="topicBody" class="glass-input" rows="6" placeholder="Describe your topic..." maxlength="2000" required></textarea>
            </div>
            <div class="form-actions">
              <button type="button" class="glass-button cancel-btn">Cancel</button>
              <button type="submit" class="primary-btn">Create Topic</button>
            </div>
          </form>
        </div>
      </div>
    `;
  }

  renderTopics() {
    const container = document.getElementById('topicsContainer');
    if (!container) return;

    // Filter and sort topics
    let filteredTopics = this.state.topics;
    
    if (this.state.searchTerm) {
      const term = this.state.searchTerm.toLowerCase();
      filteredTopics = filteredTopics.filter(topic => 
        topic.title.toLowerCase().includes(term) || 
        topic.body.toLowerCase().includes(term)
      );
    }
    
    if (this.state.selectedCategory !== 'all') {
      filteredTopics = filteredTopics.filter(topic => 
        topic.categoryId === this.state.selectedCategory
      );
    }

    // Paginate
    const startIndex = (this.state.currentPage - 1) * this.state.topicsPerPage;
    const paginatedTopics = filteredTopics.slice(startIndex, startIndex + this.state.topicsPerPage);

    container.innerHTML = paginatedTopics.map(topic => `
      <article class="topic-item glass-card">
        <div class="topic-avatar">
          <div class="avatar" title="${this.esc(topic.author || 'Anonymous')}">
            ${this.getInitials(topic.author || 'Anonymous')}
          </div>
        </div>
        <div class="topic-content">
          <div class="topic-header">
            <h3 class="topic-title">
              <a href="/forum/topic/${topic.id}" class="topic-link">
                ${this.esc(topic.title)}
              </a>
              ${topic.pinned ? '<span class="topic-badge glass-badge pinned">Pinned</span>' : ''}
              ${topic.locked ? '<span class="topic-badge glass-badge locked">Locked</span>' : ''}
              ${this.isHotTopic(topic) ? '<span class="topic-badge glass-badge hot">Hot</span>' : ''}
            </h3>
          </div>
          <p class="topic-excerpt">${this.esc(this.truncateText(topic.body, 150))}</p>
          <div class="topic-meta">
            <span class="topic-category">${this.getCategoryName(topic.categoryId)}</span>
            <span class="topic-author">by ${this.esc(topic.author || 'Anonymous')}</span>
            <span class="topic-date">${this.formatDate(topic.createdAt)}</span>
            ${topic.tags && topic.tags.length > 0 ? `
              <div class="topic-tags">
                ${topic.tags.slice(0, 3).map(tag => `<span class="tag">${this.esc(tag)}</span>`).join('')}
              </div>
            ` : ''}
          </div>
        </div>
        <div class="topic-stats">
          <div class="stat">
            <i class="ph ph-chat"></i>
            <span>${topic.replies || 0}</span>
          </div>
          <div class="stat">
            <i class="ph ph-eye"></i>
            <span>${topic.views || 0}</span>
          </div>
          <div class="stat">
            <i class="ph ph-heart"></i>
            <span>${topic.likes || 0}</span>
          </div>
          ${topic.lastActivity ? `
            <div class="stat last-reply">
              <small>Last reply<br>${this.formatTimeAgo(topic.lastActivity)}</small>
            </div>
          ` : ''}
        </div>
      </article>
    `).join('');

    this.renderPagination(filteredTopics.length);
  }

  renderSidebar() {
    // Sidebar is already rendered in the main template
    // Just need to ensure event listeners are set up
  }

  renderPagination(totalItems) {
    const container = document.getElementById('paginationContainer');
    if (!container) return;

    const totalPages = Math.ceil(totalItems / this.state.topicsPerPage);
    if (totalPages <= 1) {
      container.innerHTML = '';
      return;
    }

    let paginationHtml = '<div class="pagination-controls">';

    // Previous button
    paginationHtml += `<button class="glass-button ${this.state.currentPage === 1 ? 'disabled' : ''}" data-page="${Math.max(1, this.state.currentPage - 1)}">Previous</button>`;

    // Page numbers
    const startPage = Math.max(1, this.state.currentPage - 2);
    const endPage = Math.min(totalPages, this.state.currentPage + 2);

    if (startPage > 1) {
      paginationHtml += `<button class="glass-button" data-page="1">1</button>`;
      if (startPage > 2) paginationHtml += '<span>...</span>';
    }

    for (let i = startPage; i <= endPage; i++) {
      paginationHtml += `<button class="glass-button ${i === this.state.currentPage ? 'active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (endPage < totalPages) {
      if (endPage < totalPages - 1) paginationHtml += '<span>...</span>';
      paginationHtml += `<button class="glass-button" data-page="${totalPages}">${totalPages}</button>`;
    }

    // Next button
    paginationHtml += `<button class="glass-button ${this.state.currentPage === totalPages ? 'disabled' : ''}" data-page="${Math.min(totalPages, this.state.currentPage + 1)}">Next</button>`;

    paginationHtml += '</div>';

    container.innerHTML = paginationHtml;
  }

  setupEventListeners() {
    // Category filtering
    this.container.addEventListener('click', (e) => {
      const categoryLink = e.target.closest('.category-link');
      if (categoryLink) {
        e.preventDefault();
        const categoryId = categoryLink.dataset.category;
        this.state.selectedCategory = categoryId;
        this.state.currentPage = 1;
        this.renderTopics();
        this.updateActiveCategory(categoryId);
      }

      // New topic button
      if (e.target.closest('.new-topic-btn')) {
        this.showNewTopicModal();
      }

      // Modal close
      if (e.target.closest('.modal-close') || e.target.closest('.modal-overlay')) {
        this.hideNewTopicModal();
      }

      // Cancel button in modal
      if (e.target.closest('.cancel-btn')) {
        this.hideNewTopicModal();
      }

      // Pagination
      const pageBtn = e.target.closest('.pagination-controls .glass-button:not(.disabled)');
      if (pageBtn) {
        const page = parseInt(pageBtn.dataset.page);
        if (!isNaN(page)) {
          this.state.currentPage = page;
          this.renderTopics();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }
    });

    // Search and filter
    const searchInput = this.container.querySelector('.search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.state.searchTerm = e.target.value;
        this.state.currentPage = 1;
        this.renderTopics();
      });
    }

    const categoryFilter = this.container.querySelector('.category-filter');
    if (categoryFilter) {
      categoryFilter.addEventListener('change', (e) => {
        this.state.selectedCategory = e.target.value;
        this.state.currentPage = 1;
        this.renderTopics();
      });
    }

    // Form submission
    const form = this.container.querySelector('.new-topic-form');
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        this.submitNewTopic();
      });
    }
  }

  updateActiveCategory(activeCategoryId) {
    const categoryItems = this.container.querySelectorAll('.category-item');
    categoryItems.forEach(item => {
      item.classList.toggle('active', 
        item.querySelector('.category-link').dataset.category === activeCategoryId
      );
    });
  }

  async submitNewTopic() {
    const title = document.getElementById('topicTitle').value.trim();
    const body = document.getElementById('topicBody').value.trim();
    const category = document.getElementById('topicCategory').value;

    if (!title || !body || !category) {
      this.showMessage('Please fill in all required fields', 'error');
      return;
    }

    try {
      const response = await fetch('/api/forum/topics', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          categoryId: category,
          title,
          body,
          country: 'global', // Would come from app state
          language: 'en'     // Would come from app state
        })
      });

      const result = await response.json();

      if (response.ok) {
        this.showMessage('Topic created successfully!', 'success');
        this.hideNewTopicModal();
        document.querySelector('.new-topic-form').reset();
        
        // Refresh topics
        await this.loadInitialData();
        this.renderTopics();
      } else {
        this.showMessage(result.message || 'Failed to create topic', 'error');
      }
    } catch (error) {
      this.showMessage('Network error. Please try again.', 'error');
    }
  }

  showNewTopicModal() {
    document.getElementById('newTopicModal').style.display = 'block';
    document.body.style.overflow = 'hidden';
  }

  hideNewTopicModal() {
    document.getElementById('newTopicModal').style.display = 'none';
    document.body.style.overflow = '';
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
      z-index: 10000;
      animation: slideIn 0.3s ease-out;
    `;
    
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease-out';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  // Helper methods
  esc(str) {
    if (typeof str !== 'string') return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  truncateText(text, maxLength) {
    if (text.length <= maxLength) return text;
    return text.substr(0, maxLength) + '...';
  }

  getInitials(name) {
    return name.split(' ').map(part => part[0]).join('').substr(0, 2).toUpperCase();
  }

  getCategoryName(categoryId) {
    const category = this.state.categories.find(cat => cat.id === categoryId);
    return category ? category.key : 'General';
  }

  formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleDateString();
  }

  formatTimeAgo(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);

    if (diffInSeconds < 60) return 'Just now';
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  }

  isHotTopic(topic) {
    const replies = topic.replies || 0;
    const views = topic.views || 0;
    const ageInDays = (Date.now() - new Date(topic.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    
    // Hot if has many replies/views relative to age
    return (replies > 10 && ageInDays < 7) || (views > 100 && ageInDays < 30);
  }

  calculateTotalPosts() {
    // This would come from API in a real implementation
    return this.state.topics.reduce((sum, topic) => sum + (topic.replies || 0), 0);
  }

  calculateActiveUsers() {
    // This would come from API in a real implementation
    return Math.floor(this.state.topics.length / 3);
  }
}

// Initialize forum when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('forum-container')) {
    window.modernForum = new ModernForum('forum-container');
  }
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ModernForum;
}