const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

const SOURCES_FILE = path.join(__dirname, '..', 'sources.json');
const INDEX_FILE = path.join(__dirname, '..', 'index.json');
const PROTO_FILE = path.join(__dirname, '..', 'schema.proto');
const PB_FILE = path.join(__dirname, '..', 'index.pb');

function parseGitHubRepo(input) {
  if (!input) return null;
  const cleaned = input.trim().replace(/^git@github\.com:/, '');
  const match = cleaned.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([^/\s#?]+)\/([^/\s#?]+)/) ||
                cleaned.match(/^([^/\s#?]+)\/([^/\s#?]+)$/);
  if (match) {
    const owner = match[1];
    const repo = match[2].replace(/\.git$/, '');
    return `${owner}/${repo}`;
  }
  return null;
}

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

async function processSource(entry) {
  const ownerRepo = parseGitHubRepo(entry.github);
  if (!ownerRepo) {
    console.error(`Invalid GitHub repo specified: ${entry.github}`);
    return null;
  }

  console.log(`Generating metadata for ${ownerRepo}...`);
  const repoInfo = await fetchJSON(`https://api.github.com/repos/${ownerRepo}`);

  const repoType = entry.type || 'usagi';
  const repoId = entry.id || ownerRepo.toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const repoName = entry.name || repoInfo.name || ownerRepo;
  const author = repoInfo.owner?.login || '';
  const iconUrl = repoInfo.owner?.avatar_url || 'https://avatars.githubusercontent.com/u/113362897?s=200';
  const description = repoInfo.description || '';

  let version = '1.0.0';
  let jarUrl = '';
  let indexUrl = '';
  let sizeBytes = 0;
  let sourcesCount = 1;

  // 1. Keiyoushi Special Handling
  if (ownerRepo.toLowerCase() === 'keiyoushi/extensions') {
    indexUrl = 'https://raw.githubusercontent.com/keiyoushi/extensions/repo/index.min.json';
    try {
      const commitData = await fetchJSON('https://api.github.com/repos/keiyoushi/extensions/commits/repo');
      version = commitData.sha.substring(0, 7);
    } catch (_) {}

    try {
      const assets = await fetchJSON('https://raw.githubusercontent.com/keiyoushi/extensions/repo/release-assets.json');
      sourcesCount = Object.keys(assets).length || 1000;
    } catch (_) {}
  }
  // 2. Custom Release Repo (e.g., Kototoro built in Kunuk-index releases)
  else if (entry.release_repo) {
    try {
      const releases = await fetchJSON(`https://api.github.com/repos/${entry.release_repo}/releases`);
      const prefix = entry.release_tag_prefix || '';
      const matchingRelease = releases.find(r => r.tag_name && r.tag_name.startsWith(prefix)) || releases[0];
      if (matchingRelease) {
        version = matchingRelease.tag_name.replace(prefix, '');
        const asset = matchingRelease.assets.find(a => a.name.endsWith('.jar')) || matchingRelease.assets[0];
        if (asset) {
          jarUrl = asset.browser_download_url;
          sizeBytes = asset.size || 0;
        }
      }
      if (!jarUrl) {
        jarUrl = `https://github.com/${entry.release_repo}/releases`;
      }
    } catch (e) {
      console.warn(`Could not fetch custom release from ${entry.release_repo}:`, e.message);
      if (!jarUrl) {
        jarUrl = `https://github.com/${entry.release_repo}/releases`;
      }
    }
  }
  // 3. Standard Usagi / Mihon release asset detection
  else {
    try {
      let release = null;
      try {
        release = await fetchJSON(`https://api.github.com/repos/${ownerRepo}/releases/latest`);
      } catch (_) {
        const releases = await fetchJSON(`https://api.github.com/repos/${ownerRepo}/releases`);
        if (Array.isArray(releases) && releases.length > 0) release = releases[0];
      }

      if (release) {
        version = release.tag_name || version;
        const jarAsset = release.assets?.find(a => a.name.endsWith('.jar')) ||
                         release.assets?.find(a => a.name.endsWith('.apk')) ||
                         release.assets?.[0];
        if (jarAsset) {
          jarUrl = jarAsset.browser_download_url;
          sizeBytes = jarAsset.size || 0;
        }
      }
    } catch (e) {
      console.warn(`No releases found for ${ownerRepo}:`, e.message);
    }

    if (repoType === 'mihon') {
      indexUrl = `https://raw.githubusercontent.com/${ownerRepo}/main/index.min.json`;
    }
  }

  return {
    id: repoId,
    name: repoName,
    type: repoType,
    description: description,
    author: author,
    icon_url: iconUrl,
    version: version,
    version_code: 100,
    jar_url: jarUrl,
    index_url: indexUrl,
    sources_count: sourcesCount,
    size_bytes: sizeBytes,
    min_app_version: '1.0.0',
    github: ownerRepo
  };
}

async function buildIndex() {
  if (!fs.existsSync(SOURCES_FILE)) {
    throw new Error(`sources.json not found at ${SOURCES_FILE}`);
  }

  let sources = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));

  // Handle addition of a new repo via CLI or Workflow input
  const inputRepoUrl = process.env.ADD_REPO_URL || process.argv[2];
  const inputRepoType = process.env.ADD_REPO_TYPE || process.argv[3] || 'usagi';

  if (inputRepoUrl) {
    const parsed = parseGitHubRepo(inputRepoUrl);
    if (parsed) {
      const exists = sources.some(s => parseGitHubRepo(s.github)?.toLowerCase() === parsed.toLowerCase());
      if (!exists) {
        console.log(`Adding ${parsed} to sources.json`);
        sources.push({
          github: parsed,
          type: inputRepoType
        });
        fs.writeFileSync(SOURCES_FILE, JSON.stringify(sources, null, 2) + '\n');
      }
    }
  }

  const generatedRepositories = [];
  for (const entry of sources) {
    try {
      const repoData = await processSource(entry);
      if (repoData) {
        generatedRepositories.push(repoData);
      }
    } catch (err) {
      console.error(`Failed to generate entry for ${entry.github}:`, err.message);
    }
  }

  const indexData = {
    version: 1,
    last_updated: new Date().toISOString(),
    repositories: generatedRepositories
  };

  fs.writeFileSync(INDEX_FILE, JSON.stringify(indexData, null, 2) + '\n');
  console.log(`Successfully generated index.json with ${generatedRepositories.length} repositories.`);

  await compileProtobuf(indexData);
}

buildIndex();
