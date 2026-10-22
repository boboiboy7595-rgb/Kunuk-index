const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

const INDEX_FILE = path.join(__dirname, '..', 'index.json');
const PROTO_FILE = path.join(__dirname, '..', 'schema.proto');
const PB_FILE = path.join(__dirname, '..', 'index.pb');

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

async function compileProtobuf(jsonData) {
  const root = await protobuf.load(PROTO_FILE);
  const RepositoryIndex = root.lookupType('kunuk.RepositoryIndex');
  const errMsg = RepositoryIndex.verify(jsonData);
  if (errMsg) throw Error(errMsg);
  const message = RepositoryIndex.create(jsonData);
  const buffer = RepositoryIndex.encode(message).finish();
  fs.writeFileSync(PB_FILE, buffer);
  console.log(`Generated index.pb (${buffer.length} bytes)`);
}

async function updateIndex() {
  const data = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  let updated = false;

  for (const repo of data.repositories) {
    try {
      if (repo.id === 'uma-usagi') {
        const repoInfo = await fetchJSON('https://api.github.com/repos/InvalidDavid/UMA');
        const release = await fetchJSON('https://api.github.com/repos/InvalidDavid/UMA/releases/latest');
        const asset = release.assets.find(a => a.name.endsWith('.jar')) || release.assets[0];

        // Dynamic metadata extraction
        if (repoInfo.description && repo.description !== repoInfo.description) {
          repo.description = repoInfo.description;
          updated = true;
        }
        if (asset && (repo.version !== release.tag_name || repo.jar_url !== asset.browser_download_url)) {
          repo.version = release.tag_name;
          repo.jar_url = asset.browser_download_url;
          repo.size_bytes = asset.size;
          updated = true;
          console.log(`Updated UMA to ${release.tag_name}`);
        }

      } else if (repo.id === 'manga-repo-usagi') {
        const repoInfo = await fetchJSON('https://api.github.com/repos/dragonx943/manga-repo');
        const release = await fetchJSON('https://api.github.com/repos/dragonx943/manga-repo/releases/latest');
        const asset = release.assets.find(a => a.name.endsWith('.jar')) || release.assets[0];

        // Dynamic metadata extraction
        if (repoInfo.description && repo.description !== repoInfo.description) {
          repo.description = repoInfo.description;
          updated = true;
        }
        if (asset && (repo.version !== release.tag_name || repo.jar_url !== asset.browser_download_url)) {
          repo.version = release.tag_name;
          repo.jar_url = asset.browser_download_url;
          repo.size_bytes = asset.size;
          updated = true;
          console.log(`Updated manga-repo-usagi to ${release.tag_name}`);
        }

      } else if (repo.id === 'keiyoushi-mihon') {
        // 1. Dynamic Repo info & description from GitHub
        const repoInfo = await fetchJSON('https://api.github.com/repos/keiyoushi/extensions');
        if (repoInfo.description && repo.description !== repoInfo.description) {
          repo.description = repoInfo.description;
          updated = true;
        }

        // 2. Dynamic latest commit version & date from 'repo' branch
        const commitData = await fetchJSON('https://api.github.com/repos/keiyoushi/extensions/commits/repo');
        const latestSha = commitData.sha.substring(0, 7);
        if (repo.version !== latestSha) {
          repo.version = latestSha;
          updated = true;
          console.log(`Updated Keiyoushi version to commit ${latestSha}`);
        }

        // 3. Dynamic sources count from Keiyoushi release assets
        try {
          const assets = await fetchJSON('https://raw.githubusercontent.com/keiyoushi/extensions/repo/release-assets.json');
          const extCount = Object.keys(assets).length;
          if (extCount && repo.sources_count !== extCount) {
            repo.sources_count = extCount;
            updated = true;
            console.log(`Updated Keiyoushi sources count to ${extCount}`);
          }
        } catch (e) {
          console.warn('Could not fetch Keiyoushi release-assets.json:', e.message);
        }
      }
    } catch (err) {
      console.error(`Error updating ${repo.id}:`, err.message);
    }
  }

  if (updated || !fs.existsSync(PB_FILE)) {
    data.last_updated = new Date().toISOString();
    fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2) + '\n');
    await compileProtobuf(data);
    console.log('index.json & index.pb successfully updated.');
  } else {
    await compileProtobuf(data);
    console.log('Verified index.pb is up to date.');
  }
}

updateIndex();
