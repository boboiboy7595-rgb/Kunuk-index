const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

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

async function fetchGitHubRepoDetails(ownerRepo, repoType = 'usagi') {
  console.log(`Fetching GitHub metadata for ${ownerRepo}...`);
  const repoInfo = await fetchJSON(`https://api.github.com/repos/${ownerRepo}`);

  let release = null;
  try {
    release = await fetchJSON(`https://api.github.com/repos/${ownerRepo}/releases/latest`);
  } catch (err) {
    console.warn(`No latest release for ${ownerRepo} (${err.message}). Checking releases list...`);
    try {
      const releases = await fetchJSON(`https://api.github.com/repos/${ownerRepo}/releases`);
      if (Array.isArray(releases) && releases.length > 0) {
        release = releases[0];
      }
    } catch (_) {}
  }

  let jarUrl = '';
  let sizeBytes = 0;
  let version = '1.0.0';

  if (release) {
    version = release.tag_name || version;
    if (Array.isArray(release.assets) && release.assets.length > 0) {
      const jarAsset = release.assets.find(a => a.name.endsWith('.jar')) ||
                       release.assets.find(a => a.name.endsWith('.apk')) ||
                       release.assets[0];
      if (jarAsset) {
        jarUrl = jarAsset.browser_download_url;
        sizeBytes = jarAsset.size || 0;
      }
    }
  }

  const repoId = ownerRepo.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

  return {
    id: repoId,
    name: repoInfo.name || ownerRepo,
    type: repoType,
    description: repoInfo.description || '',
    author: repoInfo.owner?.login || '',
    icon_url: repoInfo.owner?.avatar_url || 'https://avatars.githubusercontent.com/u/113362897?s=200',
    version: version,
    version_code: 100,
    jar_url: jarUrl,
    index_url: repoType === 'mihon' ? `https://raw.githubusercontent.com/${ownerRepo}/main/index.min.json` : '',
    sources_count: 1,
    size_bytes: sizeBytes,
    min_app_version: '1.0.0',
    github: ownerRepo
  };
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

  // 1. Ensure existing legacy entries have github mappings first
  for (const repo of data.repositories) {
    if (repo.id === 'uma-usagi' && !repo.github) repo.github = 'InvalidDavid/UMA';
    if (repo.id === 'manga-repo-usagi' && !repo.github) repo.github = 'dragonx943/manga-repo';
  }

  // 2. Check if a new repo URL was passed (via Workflow Dispatch or CLI)
  const inputRepoUrl = process.env.ADD_REPO_URL || process.argv[2];
  const inputRepoType = process.env.ADD_REPO_TYPE || process.argv[3] || 'usagi';

  if (inputRepoUrl) {
    const parsedRepo = parseGitHubRepo(inputRepoUrl);
    if (!parsedRepo) {
      console.error(`Invalid GitHub repository URL or format: ${inputRepoUrl}`);
    } else {
      console.log(`Processing repository: ${parsedRepo} (type: ${inputRepoType})`);
      try {
        const repoData = await fetchGitHubRepoDetails(parsedRepo, inputRepoType);
        const existingIdx = data.repositories.findIndex(
          r => (r.github && r.github.toLowerCase() === parsedRepo.toLowerCase()) || r.id === repoData.id
        );

        if (existingIdx >= 0) {
          console.log(`Repository ${parsedRepo} already exists at index ${existingIdx}. Updating it...`);
          data.repositories[existingIdx] = {
            ...data.repositories[existingIdx],
            ...repoData,
            name: data.repositories[existingIdx].name || repoData.name // keep customized name if set
          };
        } else {
          console.log(`Adding new repository ${parsedRepo} to index.`);
          data.repositories.push(repoData);
        }
        updated = true;
      } catch (err) {
        console.error(`Failed to add/update ${parsedRepo}:`, err.message);
      }
    }
  }

  // 3. Process each repository in index.json
  for (let i = 0; i < data.repositories.length; i++) {
    const repo = data.repositories[i];
    try {
      // Special logic for keiyoushi-mihon
      if (repo.id === 'keiyoushi-mihon') {
        const repoInfo = await fetchJSON('https://api.github.com/repos/keiyoushi/extensions');
        if (repoInfo.description && repo.description !== repoInfo.description) {
          repo.description = repoInfo.description;
          updated = true;
        }

        const commitData = await fetchJSON('https://api.github.com/repos/keiyoushi/extensions/commits/repo');
        const latestSha = commitData.sha.substring(0, 7);
        if (repo.version !== latestSha) {
          repo.version = latestSha;
          updated = true;
          console.log(`Updated Keiyoushi version to commit ${latestSha}`);
        }

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
        continue;
      }

      // Special logic for kototoro-parsers compiled releases
      if (repo.id === 'kototoro-parsers') {
        try {
          const releases = await fetchJSON('https://api.github.com/repos/boboiboy7595-rgb/Kunuk-index/releases');
          const kototoroRelease = releases.find(r => r.tag_name && r.tag_name.startsWith('kototoro-'));
          if (kototoroRelease) {
            const asset = kototoroRelease.assets.find(a => a.name.endsWith('.jar'));
            if (asset && (repo.version !== kototoroRelease.tag_name || repo.jar_url !== asset.browser_download_url)) {
              repo.version = kototoroRelease.tag_name.replace('kototoro-', '');
              repo.jar_url = asset.browser_download_url;
              repo.size_bytes = asset.size;
              updated = true;
              console.log(`Updated kototoro-parsers to ${kototoroRelease.tag_name}`);
            }
          }
        } catch (e) {
          console.warn('No Kototoro release found in Kunuk-index yet:', e.message);
        }
        continue;
      }

      // Generic GitHub handler (works for any repo with 'github' specified or newly added)
      if (repo.github) {
        const ownerRepo = parseGitHubRepo(repo.github);
        if (!ownerRepo) continue;

        // If repo has missing fields (e.g. user manually wrote only { "github": "..." } in index.json)
        if (!repo.name || !repo.author || !repo.icon_url || !repo.id) {
          console.log(`Populating missing fields for ${ownerRepo}...`);
          const fullDetails = await fetchGitHubRepoDetails(ownerRepo, repo.type || 'usagi');
          data.repositories[i] = { ...fullDetails, ...repo };
          updated = true;
          continue;
        }

        const repoInfo = await fetchJSON(`https://api.github.com/repos/${ownerRepo}`);
        if (repoInfo.description && repo.description !== repoInfo.description) {
          repo.description = repoInfo.description;
          updated = true;
        }

        try {
          const release = await fetchJSON(`https://api.github.com/repos/${ownerRepo}/releases/latest`);
          const asset = release.assets?.find(a => a.name.endsWith('.jar')) ||
                        release.assets?.find(a => a.name.endsWith('.apk')) ||
                        release.assets?.[0];

          if (asset && (repo.version !== release.tag_name || repo.jar_url !== asset.browser_download_url)) {
            repo.version = release.tag_name;
            repo.jar_url = asset.browser_download_url;
            repo.size_bytes = asset.size;
            updated = true;
            console.log(`Updated ${ownerRepo} to release ${release.tag_name} (${asset.name})`);
          }
        } catch (err) {
          // No releases or release fetch error
        }
      }
    } catch (err) {
      console.error(`Error updating ${repo.id || repo.github}:`, err.message);
    }
  }

  // Ensure default values are compliant with Protobuf schema
  data.repositories = data.repositories.map(r => ({
    id: String(r.id || ''),
    name: String(r.name || ''),
    type: String(r.type || 'usagi'),
    description: String(r.description || ''),
    author: String(r.author || ''),
    icon_url: String(r.icon_url || ''),
    version: String(r.version || '1.0.0'),
    version_code: Number(r.version_code || 100),
    jar_url: String(r.jar_url || ''),
    index_url: String(r.index_url || ''),
    sources_count: Number(r.sources_count || 1),
    size_bytes: Number(r.size_bytes || 0),
    min_app_version: String(r.min_app_version || '1.0.0'),
    github: String(r.github || '')
  }));

  if (updated || !fs.existsSync(PB_FILE)) {
    data.last_updated = new Date().toISOString();
    fs.writeFileSync(INDEX_FILE, JSON.stringify(data, null, 2) + '\n');
    await compileProtobuf(data);
    console.log('Successfully updated index.json and index.pb.');
  } else {
    await compileProtobuf(data);
    console.log('Verified index.pb is up to date.');
  }
}

updateIndex();
