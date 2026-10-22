function formatBytes(bytes) {
  if (!bytes || bytes === 0) return 'Index Catalog';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-msg');
  toastMsg.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// Client-side loader using protobuf.js to fetch and decode index.pb
async function loadProtobufIndex() {
  const root = await protobuf.load('schema.proto');
  const RepositoryIndex = root.lookupType('kunuk.RepositoryIndex');

  const response = await fetch('index.pb');
  if (!response.ok) {
    throw new Error(`Failed to load index.pb: ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  const message = RepositoryIndex.decode(uint8Array);
  return RepositoryIndex.toObject(message, {
    longs: Number,
    enums: String,
    bytes: String,
    defaults: true,
    arrays: true,
    objects: true,
    oneofs: true
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const grid = document.getElementById('apps-grid');
  const countAll = document.getElementById('count-all');
  const syncStatus = document.getElementById('sync-status');
  const searchInput = document.getElementById('search-input');
  const filterBtns = document.querySelectorAll('.filter-btn');
  const btnCopyRepo = document.getElementById('btn-copy-repo');
  const repoInput = document.getElementById('repo-url-input');

  let repositories = [];
  let currentFilter = 'all';
  let searchQuery = '';

  // Copy Repo URL
  btnCopyRepo.addEventListener('click', () => {
    navigator.clipboard.writeText(repoInput.value).then(() => {
      showToast('Protobuf index URL (.pb) copied!');
    });
  });

  // Load binary index.pb
  try {
    const data = await loadProtobufIndex();
    repositories = data.repositories || [];
    countAll.textContent = repositories.length;

    if (data.last_updated) {
      const date = new Date(data.last_updated);
      syncStatus.textContent = `Protobuf Decoded: ${date.toLocaleDateString()} (${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })})`;
    }
  } catch (e) {
    console.warn('Protobuf load failed, trying JSON fallback:', e);
    try {
      const res = await fetch('index.json');
      const data = await res.json();
      repositories = data.repositories || [];
      countAll.textContent = repositories.length;
    } catch (err) {
      grid.innerHTML = `<p style="grid-column: 1/-1; text-align: center; color: #f87171;">Failed to load index.pb. Ensure schema.proto and index.pb are present.</p>`;
      return;
    }
  }

  function render() {
    const filtered = repositories.filter(repo => {
      const matchesFilter = currentFilter === 'all' || repo.type === currentFilter;
      const q = searchQuery.toLowerCase();
      const matchesSearch = repo.name.toLowerCase().includes(q) ||
                            (repo.description && repo.description.toLowerCase().includes(q)) ||
                            repo.author.toLowerCase().includes(q);
      return matchesFilter && matchesSearch;
    });

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #94a3b8;">
          <p style="font-size: 1.1rem; font-weight: 600;">No extension repositories found.</p>
          <p style="font-size: 0.85rem; margin-top: 0.5rem;">Try adjusting your search query or filter.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = filtered.map(repo => {
      const isMihon = repo.type === 'mihon';
      const badgeClass = isMihon ? 'badge-mihon' : 'badge-usagi';
      const badgeText = isMihon ? 'Mihon / Tachi' : 'Usagi Plugin';
      const downloadUrl = repo.jar_url || repo.index_url;
      const downloadText = isMihon ? 'Copy Index URL' : 'Download JAR';
      const isJar = Boolean(repo.jar_url);

      const iconSrc = repo.icon_url || 'https://avatars.githubusercontent.com/u/113362897?s=200';

      return `
        <article class="app-card">
          <div class="app-header">
            <img class="app-icon" src="${iconSrc}" alt="${repo.name} Icon" onerror="this.src='https://avatars.githubusercontent.com/u/113362897?s=200'">
            <div class="app-info">
              <div class="app-title">
                <span>${repo.name}</span>
                <span class="badge-tag ${badgeClass}">${badgeText}</span>
              </div>
              <div class="app-author">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>
                <span>${repo.author}</span>
              </div>
            </div>
          </div>

          <p class="app-description">${repo.description || 'No description provided.'}</p>

          <div class="app-meta-stats">
            <div class="stat-item">
              <div class="stat-label">Version</div>
              <div class="stat-val">${repo.version}</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Sources</div>
              <div class="stat-val">${repo.sources_count}+</div>
            </div>
            <div class="stat-item">
              <div class="stat-label">Size</div>
              <div class="stat-val">${formatBytes(repo.size_bytes)}</div>
            </div>
          </div>

          <div class="app-actions">
            ${isJar ? `
              <a href="${downloadUrl}" class="btn-download" target="_blank" download>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                ${downloadText}
              </a>
            ` : `
              <button class="btn-download btn-copy-index" data-url="${downloadUrl}">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                ${downloadText}
              </button>
            `}
            <button class="btn-secondary btn-copy-direct" data-json='${JSON.stringify({ id: repo.id, name: repo.name, url: downloadUrl })}'>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
            </button>
          </div>
        </article>
      `;
    }).join('');

    document.querySelectorAll('.btn-copy-index').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const url = e.currentTarget.getAttribute('data-url');
        navigator.clipboard.writeText(url).then(() => {
          showToast('Index URL copied for Mihon/Tachiyomi!');
        });
      });
    });

    document.querySelectorAll('.btn-copy-direct').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const item = JSON.parse(e.currentTarget.getAttribute('data-json'));
        navigator.clipboard.writeText(item.url).then(() => {
          showToast(`Copied ${item.name} link!`);
        });
      });
    });
  }

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.getAttribute('data-filter');
      render();
    });
  });

  searchInput.addEventListener('input', (e) => {
    searchQuery = e.target.value;
    render();
  });

  render();
});
