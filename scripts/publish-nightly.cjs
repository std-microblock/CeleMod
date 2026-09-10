const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function collectAssets(directory) {
  const files = fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? collectAssets(fullPath) : entry.isFile() ? [fullPath] : [];
  });
  return files.sort();
}

module.exports = async function publishNightly({ github, context, core, directory }) {
  // Never hide the previous release unless all platforms produced their assets.
  const files = collectAssets(directory);
  const names = files.map(file => path.basename(file));
  for (const suffix of ['.exe', '.dmg', '.AppImage', '.deb', '.apk', '.apk.sha256']) {
    if (!names.some(name => name.endsWith(suffix))) {
      throw new Error(`Missing nightly asset: ${suffix}`);
    }
  }
  if (new Set(names).size !== names.length) throw new Error('Duplicate nightly asset names');
  for (const file of files.filter(file => file.endsWith('.apk'))) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    const expected = `${hash}  ${path.basename(file)}`;
    if (fs.readFileSync(`${file}.sha256`, 'utf8').trim() !== expected) {
      throw new Error(`APK checksum mismatch: ${file}`);
    }
  }

  const repo = context.repo;
  const { data: head } = await github.rest.git.getRef({ ...repo, ref: 'heads/master' });
  if (head.object.sha !== context.sha) {
    core.info('Skipping superseded build; nightly only follows the current master commit.');
    return;
  }

  const tag = 'nightly';
  const runUrl = `${context.serverUrl}/${repo.owner}/${repo.repo}/actions/runs/${context.runId}`;
  const body = [
    'Rolling development build from `master`. Replaced after each successful build.',
    '',
    `Commit: ${context.sha}`,
    `Build: ${runUrl}`,
    '',
    'Includes Windows, macOS, Linux and Android ARM64 downloads.',
    'Android is a debug-signed APK (Android 9+); a different signing key requires uninstalling the old app.',
    'Development builds may be unstable. No Celeste game resources are included.',
  ].join('\n');

  let release;
  try {
    ({ data: release } = await github.rest.repos.getReleaseByTag({ ...repo, tag }));
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const metadata = {
    ...repo, tag_name: tag, target_commitish: context.sha,
    name: 'CeleMod Nightly', body, prerelease: true, draft: true, make_latest: 'false',
  };
  if (release) {
    await github.rest.repos.updateRelease({ ...metadata, release_id: release.id });
    const assets = await github.paginate(github.rest.repos.listReleaseAssets, {
      ...repo, release_id: release.id, per_page: 100,
    });
    for (const asset of assets) {
      await github.rest.repos.deleteReleaseAsset({ ...repo, asset_id: asset.id });
    }
  } else {
    ({ data: release } = await github.rest.repos.createRelease(metadata));
  }

  // Stay in draft if an upload fails: never expose a half-populated nightly.
  for (const file of files) {
    const data = fs.readFileSync(file);
    await github.rest.repos.uploadReleaseAsset({
      ...repo, release_id: release.id, name: path.basename(file), data,
      headers: { 'content-type': 'application/octet-stream', 'content-length': data.length },
    });
  }
  try {
    await github.rest.git.getRef({ ...repo, ref: `tags/${tag}` });
    await github.rest.git.updateRef({ ...repo, ref: `tags/${tag}`, sha: context.sha, force: true });
  } catch (error) {
    if (error.status !== 404) throw error;
    await github.rest.git.createRef({ ...repo, ref: `refs/tags/${tag}`, sha: context.sha });
  }
  await github.rest.repos.updateRelease({
    ...metadata, release_id: release.id, draft: false,
  });
  core.info(`Published nightly for ${context.sha}`);
};
