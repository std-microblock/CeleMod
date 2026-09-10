const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { test } = require('node:test');
const publish = require('./publish-nightly.cjs');

function fixture(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'celemod-nightly-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const assets = ['CeleMod.exe', 'CeleMod.dmg', 'CeleMod.AppImage', 'CeleMod.deb', 'CeleMod.apk'];
  for (const name of assets) fs.writeFileSync(path.join(directory, name), name);
  const hash = crypto.createHash('sha256').update('CeleMod.apk').digest('hex');
  fs.writeFileSync(path.join(directory, 'CeleMod.apk.sha256'), `${hash}  CeleMod.apk\n`);
  const calls = [];
  const api = (name, fn = () => ({})) => async args => {
    calls.push({ name, args });
    return { data: await fn(args) };
  };
  const missing = () => { throw Object.assign(new Error('Not Found'), { status: 404 }); };
  const github = {
    rest: {
      git: {
        getRef: api('getRef', args => args.ref === 'heads/master'
          ? { object: { sha: options.stale ? 'newer' : 'commit' } }
          : options.newTag ? missing() : { object: { sha: 'old' } }),
        updateRef: api('updateRef'),
        createRef: api('createRef'),
      },
      repos: {
        getReleaseByTag: api('getReleaseByTag', () => {
          if (options.lookupError) throw Object.assign(new Error('API error'), { status: 500 });
          return options.newRelease ? missing() : { id: 7 };
        }),
        createRelease: api('createRelease', () => ({ id: 7 })),
        updateRelease: api('updateRelease'),
        listReleaseAssets: api('listReleaseAssets'),
        deleteReleaseAsset: api('deleteReleaseAsset'),
        uploadReleaseAsset: api('uploadReleaseAsset', () => {
          if (options.uploadError) throw new Error('Upload failed');
        }),
      },
    },
    paginate: async () => [{ id: 11 }, { id: 12 }],
  };
  return {
    directory, github, calls, core: { info() {} },
    context: { repo: { owner: 'owner', repo: 'repo' }, sha: 'commit', runId: 123, serverUrl: 'https://github.com' },
  };
}

test('creates a prerelease and tag only after uploading all platforms', async t => {
  const f = fixture(t, { newRelease: true, newTag: true });
  await publish(f);
  assert.equal(f.calls.filter(c => c.name === 'uploadReleaseAsset').length, 6);
  const created = f.calls.find(c => c.name === 'createRelease').args;
  assert.equal(created.draft, true);
  assert.equal(created.prerelease, true);
  assert.equal(created.make_latest, 'false');
  assert.equal(created.body, 'Commit: commit');
  assert.equal(f.calls.at(-2).name, 'createRef');
  assert.equal(f.calls.at(-2).args.ref, 'refs/tags/nightly');
  assert.equal(f.calls.at(-1).args.draft, false);
});

test('replaces all old assets and moves only the nightly tag', async t => {
  const f = fixture(t);
  await publish(f);
  assert.equal(f.calls.find(c => c.name === 'updateRelease').args.draft, true);
  assert.deepEqual(f.calls.filter(c => c.name === 'deleteReleaseAsset').map(c => c.args.asset_id), [11, 12]);
  assert.equal(f.calls.filter(c => c.name === 'uploadReleaseAsset').length, 6);
  const moved = f.calls.find(c => c.name === 'updateRef').args;
  assert.equal(moved.ref, 'tags/nightly');
  assert.equal(moved.sha, 'commit');
  assert.equal(moved.force, true);
  assert.equal(f.calls.at(-1).args.body, 'Commit: commit');
  assert.equal(f.calls.at(-1).args.draft, false);
});

test('an older build cannot overwrite a newer commit', async t => {
  const f = fixture(t, { stale: true });
  await publish(f);
  assert.deepEqual(f.calls.map(c => c.name), ['getRef']);
});

test('missing platform assets leave the previous release untouched', async t => {
  const f = fixture(t);
  fs.unlinkSync(path.join(f.directory, 'CeleMod.apk'));
  await assert.rejects(publish(f), /Missing nightly asset: .apk/);
  assert.equal(f.calls.length, 0);
});

test('duplicate basenames from nested artifacts are rejected', async t => {
  const f = fixture(t);
  fs.mkdirSync(path.join(f.directory, 'nested'));
  fs.writeFileSync(path.join(f.directory, 'nested', 'CeleMod.exe'), 'duplicate');
  await assert.rejects(publish(f), /Duplicate nightly asset names/);
  assert.equal(f.calls.length, 0);
});

test('bad APK checksums are rejected before modifying the release', async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.directory, 'CeleMod.apk'), 'corrupt');
  await assert.rejects(publish(f), /APK checksum mismatch/);
  assert.equal(f.calls.length, 0);
});

test('API errors do not get mistaken for a missing release', async t => {
  const f = fixture(t, { lookupError: true });
  await assert.rejects(publish(f), /API error/);
  assert.ok(!f.calls.some(c => c.name === 'createRelease'));
});

test('failed uploads never publish or advance the tag', async t => {
  const f = fixture(t, { uploadError: true });
  await assert.rejects(publish(f), /Upload failed/);
  assert.ok(!f.calls.some(c => c.name === 'updateRelease' && c.args.draft === false));
  assert.ok(!f.calls.some(c => ['updateRef', 'createRef'].includes(c.name)));
});
