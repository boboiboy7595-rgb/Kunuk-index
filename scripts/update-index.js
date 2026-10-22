const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.json');

async function fetchJSON(url) {
  const headers = { 'User-Agent': 'Kunuk-Index-Updater' };
  if (process.env.GITHUB_TOKEN) {
    headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}

async function updateIndex() {
  const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  let updated = false;

  for (const repo of data.repositories) {
    try {
      if (repo.id === 'uma-usagi') {
        const release = await fetchJSON('https://api.github.com/repos/InvalidDavid/UMA/releases/latest');
        const asset = release.assets.find(a => a.name.endsWith('.jar')) || release.assets[0];
        if (asset && (repo.version !== release.tag_name || repo.jar_url !== asset.browser_download_url)) {
          repo.version = release.tag_name;
          repo.jar_url = asset.browser_download_url;
          repo.size_bytes = asset.size;
          updated = true;
          console.log(`Updated UMA to ${release.tag_name}`);
        }
      } else if (repo.id === 'manga-repo-usagi') {
        const release = await fetchJSON('https://api.github.com/repos/dragonx943/manga-repo/releases/latest');
        const asset = release.assets.find(a => a.name.endsWith('.jar')) || release.assets[0];
        if (asset && (repo.version !== release.tag_name || repo.jar_url !== asset.browser_download_url)) {
          repo.version = release.tag_name;
          repo.jar_url = asset.browser_download_url;
          repo.size_bytes = asset.size;
          updated = true;
          console.log(`Updated manga-repo-usagi to ${release.tag_name}`);
        }
      } else if (repo.id === 'keiyoushi-mihon') {
        // Keiyoushi serves its index directly on branch 'repo'
        const branch = await fetchJSON('https://api.github.com/repos/keiyoushi/extensions/branches/repo');
        const latestCommit = branch.commit.sha.substring(0, 7);
        if (repo.version !== latestCommit) {
          repo.version = latestCommit;
          updated = true;
          console.log(`Updated keiyoushi to commit ${latestCommit}`);
        }
      }
    } catch (err) {
      console.error(`Error updating ${repo.id}:`, err.message);
    }
  }

  if (updated) {
    data.last_updated = new Date().toISOString();
    fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2) + '\n');
    console.log('index.json successfully updated.');
  } else {
    console.log('All repositories are already up to date.');
  }
}

updateIndex();
