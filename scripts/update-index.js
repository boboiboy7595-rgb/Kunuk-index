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

  // Always keep index.pb compiled and in sync
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
