/**
 * Security regression tests for the FireSkill CLI hardening.
 *
 * Every test is offline: archives are crafted locally, targets live under
 * freshly created temp directories, and HOME is redirected so nothing touches
 * the real machine's agent config dirs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
  parseGitHubId,
  isAllowedDownloadHost,
  validateDownloadUrl,
  resolveRedirectUrl,
  buildRequestOptions,
  createSecureTempDir,
  extractAndValidateArchive,
  assertRepoContained,
  sanitizeSkillName,
  resolveSafeSkillTarget,
  installToAgentDir,
  removeAgentSkillDir,
  getSkillName,
  findSkillDir,
  listSkillsInDir,
  MAX_REDIRECTS,
} from '../bin/cli.js';
import { tarEntry, tarArchive, gitHubStyleArchive } from './helpers/tar-builder.js';
import { Readable } from 'stream';

const win32 = process.platform === 'win32';

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fireskill-test-'));
  try {
    return await fn(dir);
  } finally {
    await fs.remove(dir).catch(() => {});
  }
}

// ─── Finder: recursive listing of everything under a root, for assertions ─────

async function listAll(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      out.push({ abs, isDir: e.isDirectory(), isLink: e.isSymbolicLink() });
      if (e.isDirectory()) stack.push(abs);
    }
  }
  return out;
}

// ─── 1. Tar extraction: path traversal / absolute paths / hostile symlinks ───

test('hostile tarball with `../` entries cannot write outside the extraction dir', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    const hostile = tarArchive([
      tarEntry({ name: 'root', type: '5' }),
      tarEntry({ name: 'root/skill/SKILL.md', data: '---\nname: ok\n---\n' }),
      tarEntry({ name: 'root/../escape.txt', data: 'pwned' }), // traversal
    ]);

    await assert.rejects(
      () => extractAndValidateArchive(hostile, dest),
      /extraction failed/i
    );

    // Nothing appeared outside dest under tmp.
    const leaked = (await fs.readdir(tmp)).filter((n) => n !== 'out');
    assert.deepEqual(leaked, [], 'no file may appear outside the extraction dir');
  });
});

test('absolute-path tarball entries are neutralized (never escape the extraction dir)', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    const abs = tarArchive([
      tarEntry({ name: 'root', type: '5' }),
      tarEntry({ name: '/etc/fireskill-pwned', data: 'boom' }), // absolute
    ]);

    // Either the extraction aborts or the entry lands inside dest — both safe.
    try {
      await extractAndValidateArchive(abs, dest);
    } catch {
      /* aborted: fine */
    }
    const files = await listAll(dest);
    for (const f of files) {
      assert.ok(f.abs.startsWith(dest + path.sep), `entry escaped root: ${f.abs}`);
    }
    assert.ok(!(await fs.pathExists('/etc/fireskill-pwned')), 'must not write /etc/fireskill-pwned');
  });
});

test('hostile symlink escaping the extraction dir aborts extraction', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    const hostile = gitHubStyleArchive([
      { name: 'link-evil', type: '2', linkname: '../../../../etc/outside' },
      { name: 'skill/SKILL.md', data: '---\nname: x\n---\n' },
    ]);

    await assert.rejects(
      () => extractAndValidateArchive(hostile, dest),
      /extraction failed/i
    );
  });
});

test('symlinks that resolve inside the extraction dir survive and are contained', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    const archive = gitHubStyleArchive([
      { name: 'skill/real.md', data: 'real content' },
      { name: 'skill/alias.md', type: '2', linkname: 'real.md' },
    ]);

    await extractAndValidateArchive(archive, dest);
    await assertRepoContained(dest);

    const files = await listAll(dest);
    for (const f of files) {
      if (f.isLink) {
        const target = await fs.realpath(f.abs);
        assert.ok(target.startsWith(dest + path.sep), 'symlink target escapes root');
      }
    }
  });
});

test('dangling symlinks are removed during validation', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    const archive = gitHubStyleArchive([
      { name: 'skill/SKILL.md', data: '---\nname: x\n---\n' },
      { name: 'skill/dangling.md', type: '2', linkname: 'does-not-exist.md' },
    ]);

    await extractAndValidateArchive(archive, dest);
    assert.ok(!(await fs.pathExists(path.join(dest, 'skill', 'dangling.md'))), 'dangling symlink must be removed');
  });
});

test('an archive whose symlink references its own ancestor fails fast instead of hanging', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    // node-tar 7.5.x deadlocks its async unpack on this shape; the gate must
    // reject it promptly so `add` never spins on a malicious repo.
    const hostile = gitHubStyleArchive([
      { name: 'skill', type: '5' },
      { name: 'skill/self', type: '2', linkname: 'skill' },
    ]);
    const started = Date.now();
    await assert.rejects(
      () => extractAndValidateArchive(hostile, dest),
      /self-referencing|ancestor/i
    );
    assert.ok(Date.now() - started < 10000, 'must fail fast instead of hanging');
  });
});

test('a `..`-spelled ancestor-referencing symlink is rejected at extraction', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    // `skill/self-up -> ../skill` lexically resolves to the link's own parent
    // directory. node-tar accepts this spelling (it resolves inside the
    // extraction dir), so the gate must treat it like `self -> skill`.
    const hostile = gitHubStyleArchive([
      { name: 'skill', type: '5' },
      { name: 'skill/SKILL.md', data: '---\nname: x\n---\n' },
      { name: 'skill/self-up', type: '2', linkname: '../skill' },
    ]);
    const started = Date.now();
    await assert.rejects(
      () => extractAndValidateArchive(hostile, dest),
      /self-referencing|ancestor|dereferences/i
    );
    assert.ok(Date.now() - started < 10000, 'must fail fast instead of hanging');
    assert.deepEqual(
      (await fs.readdir(tmp)).filter((n) => n !== 'out'),
      [],
      'nothing may leak outside the extraction dir'
    );
  });
});

test('a `.`/`..`-spelled self-parent symlink cannot survive extraction', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    // `skill/a -> ..` resolves to the extraction root, which the containment
    // walk treats as escaping (dereferencing it would recurse over the whole
    // tree); `skill/a -> .` resolves to the link's own parent dir. Both
    // spellings must abort extraction with a clear error, not a hang.
    for (const linkname of ['.', '..']) {
      const hostile = gitHubStyleArchive([
        { name: 'skill', type: '5' },
        { name: 'skill/SKILL.md', data: '---\nname: x\n---\n' },
        { name: 'skill/a', type: '2', linkname },
      ]);
      const started = Date.now();
      await assert.rejects(
        () => extractAndValidateArchive(hostile, dest),
        /escaping|dereferences|ancestor/i
      );
      assert.ok(Date.now() - started < 10000, 'must fail fast instead of hanging');
      assert.deepEqual(
        (await fs.readdir(tmp)).filter((n) => n !== 'out'),
        [],
        'nothing may leak outside the extraction dir'
      );
      await fs.remove(dest);
      await fs.mkdir(dest);
    }
  });
});

test('assertRepoContained rejects a self-parent symlink built directly on disk', async () => {
  await withTempDir(async (tmp) => {
    const root = path.join(tmp, 'root');
    await fs.ensureDir(path.join(root, 'sub'));
    await fs.writeFile(path.join(root, 'SKILL.md'), 'x');
    // sub/a -> . resolves to the link's own parent directory: a
    // dereferencing copy would recurse into itself forever.
    await fs.symlink('.', path.join(root, 'sub', 'a'));

    await assert.rejects(
      () => assertRepoContained(root),
      /dereferenc/i
    );
    // A benign contained link elsewhere still passes the boundary check.
    await fs.remove(path.join(root, 'sub', 'a'));
    await fs.symlink(path.join(root, 'SKILL.md'), path.join(root, 'sub', 'alias.md'));
    await assertRepoContained(root);
  });
});

test('sibling-style links with `..` targets that resolve inside the root are not false positives', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    // `links/doc-link -> ../common/doc.md` resolves to a sibling path inside
    // the root, not to any ancestor of the link itself.
    const archive = gitHubStyleArchive([
      { name: 'common', type: '5' },
      { name: 'common/doc.md', data: 'doc' },
      { name: 'links', type: '5' },
      { name: 'links/doc-link', type: '2', linkname: '../common/doc.md' },
      { name: 'skill', type: '5' },
      { name: 'skill/SKILL.md', data: '---\nname: x\n---\n' },
    ]);
    await extractAndValidateArchive(archive, dest);
    const files = await listAll(dest);
    for (const f of files) {
      if (f.isLink) {
        const target = await fs.realpath(f.abs);
        assert.ok(target.startsWith(dest + path.sep), 'symlink target escapes root');
      }
    }
  });
});

test('installToAgentDir refuses a source tree containing a dereference-cycle symlink', async () => {
  await withSandboxedHome(async (home) => {
    const src = path.join(home, 'cycle-src');
    await fs.ensureDir(src);
    await fs.writeFile(path.join(src, 'SKILL.md'), '---\nname: cycle\n---\n');
    await fs.symlink(src, path.join(src, 'back')); // back -> own parent dir

    await assert.rejects(
      () => installToAgentDir(src, 'cycle', 'claude', true),
      /Refusing to copy|dereferences/i
    );
    assert.ok(
      !(await fs.pathExists(path.join(home, '.claude', 'skills', 'cycle'))),
      'nothing may be installed from a cycle-shaped source'
    );
  });
});

test('the extraction deadline bounds even a never-ending archive stream', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    const archive = gitHubStyleArchive([
      { name: 'skill/SKILL.md', data: 'x' },
    ]);
    const neverEnding = new Readable({ read() {} });
    neverEnding.push(archive);
    // Never push(null): the stream never terminates, so only the watchdog
    // can bound this call.
    const started = Date.now();
    await assert.rejects(
      () => extractAndValidateArchive(neverEnding, dest, { timeoutMs: 1000 }),
      /timed out/i
    );
    assert.ok(Date.now() - started < 10000, 'must fail within the deadline');
  });
});

test('entry-count cap and byte cap reject oversized archives', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    const archive = gitHubStyleArchive([
      { name: 'a.md', data: 'a' },
      { name: 'b.md', data: 'b' },
      { name: 'c.md', data: 'c' },
    ]);

    await assert.rejects(
      () => extractAndValidateArchive(archive, dest, { maxEntries: 2 }),
      /more than 2 entries/
    );
    await assert.rejects(
      () => extractAndValidateArchive(archive, dest, { maxBytes: 5 }),
      /byte download limit/
    );
  });
});

test('benign GitHub-style archive extracts to the expected layout', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'out');
    await fs.mkdir(dest);
    const archive = gitHubStyleArchive([
      { name: 'skill/SKILL.md', data: '---\nname: super-skill\n---\nbody' },
      { name: 'skill/references/a.md', data: 'ref' },
      { name: 'README.md', data: '# readme' },
    ]);

    await extractAndValidateArchive(archive, dest);
    assert.equal(await fs.readFile(path.join(dest, 'skill', 'SKILL.md'), 'utf8'), '---\nname: super-skill\n---\nbody');
    assert.equal(await fs.readFile(path.join(dest, 'skill', 'references', 'a.md'), 'utf8'), 'ref');
    assert.equal(await fs.readFile(path.join(dest, 'README.md'), 'utf8'), '# readme');
  });
});

// ─── 2. Skill-name sanitization & target containment ─────────────────────────

test('sanitizeSkillName neutralizes traversal and hostile shapes', () => {
  assert.equal(sanitizeSkillName('../../etc/passwd'), '------etc-passwd'); // contained, inert
  assert.equal(sanitizeSkillName('My Skill!'), 'my-skill-'); // legacy transform keeps trailing dash
  assert.equal(sanitizeSkillName('FireSkill'), 'fireskill');
  assert.equal(sanitizeSkillName('..'), null);
  assert.equal(sanitizeSkillName('.'), null);
  assert.equal(sanitizeSkillName(''), null);
  assert.equal(sanitizeSkillName('-'), null);
  assert.equal(sanitizeSkillName('---'), null);
  assert.equal(sanitizeSkillName('a'.repeat(101)), null);
  assert.equal(sanitizeSkillName('nul'), null);
  assert.equal(sanitizeSkillName('CON'), null);
  assert.equal(sanitizeSkillName('COM1'), null);
  assert.equal(sanitizeSkillName(null), null);
  assert.equal(sanitizeSkillName(undefined), null);
});

test('resolveSafeSkillTarget enforces containment on install/remove targets', async () => {
  await withTempDir(async (tmp) => {
    const base = path.join(tmp, 'skills-base');
    await fs.ensureDir(base);

    const ok = await resolveSafeSkillTarget(base, 'my-skill');
    assert.equal(ok.target, path.join(base, 'my-skill'));

    for (const bad of ['', '.', '..']) {
      await assert.rejects(() => resolveSafeSkillTarget(base, bad), /Invalid skill name/);
    }
    for (const bad of ['../esc', 'a/b', 'a\\b', 'a\0b']) {
      await assert.rejects(() => resolveSafeSkillTarget(base, bad), /Invalid skill name/);
    }
  });
});

test('a symlink planted at the exact target path is refused', async () => {
  await withTempDir(async (tmp) => {
    const base = path.join(tmp, 'skills-base');
    const loot = path.join(tmp, 'loot');
    await fs.ensureDir(base);
    await fs.ensureDir(loot);
    await fs.writeFile(path.join(loot, 'flag.txt'), 'pwned');

    // Attacker pre-creates target as a symlink to the loot dir.
    await fs.symlink(loot, path.join(base, 'victim'));

    // Removal refuses to go through it.
    await assert.rejects(
      () => removeAgentSkillDir(base, 'victim'),
      /Refusing|symlink/
    );
    assert.ok((await fs.readdir(loot)).includes('flag.txt'), 'loot must be untouched');

    // Install refused when the same symlink sits at the eventual target path
    // under the real agent base dir.
    await withSandboxedHome(async (home) => {
      const homeBase = path.join(home, '.claude', 'skills');
      await fs.ensureDir(homeBase);
      await fs.symlink(loot, path.join(homeBase, 'victim'));
      const src = path.join(home, 'src');
      await fs.ensureDir(src);
      await fs.writeFile(path.join(src, 'SKILL.md'), 'x');

      await assert.rejects(
        () => installToAgentDir(src, 'victim', 'claude', true),
        /Refusing|symlink/
      );
      assert.ok((await fs.readdir(loot)).includes('flag.txt'), 'loot must be untouched');
    });
  });
});

// ─── 3. Temp dir: unpredictable + mode-restricted ─────────────────────────────

test('temp dirs are unique and 0700', async () => {
  const a = await createSecureTempDir('fireskill-test-');
  const b = await createSecureTempDir('fireskill-test-');
  try {
    assert.notEqual(a, b, 'temp dirs must be unique (unpredictable)');
    if (!win32) {
      const st = await fs.stat(a);
      assert.equal(st.mode & 0o777, 0o700, 'temp dir must be mode 0700');
    }
  } finally {
    await fs.remove(a);
    await fs.remove(b);
  }
});

// ─── 4. Redirect / token handling ─────────────────────────────────────────────

test('the token is only ever attached to allowlisted GitHub hosts', () => {
  const opts = buildRequestOptions('https://api.github.com/repos/a/b/tarball/main', 'sekrit');
  assert.equal(opts.headers.Authorization, 'Bearer sekrit');

  const evil = buildRequestOptions('https://evil.example.com/steal', 'sekrit');
  assert.equal(evil.headers.Authorization, undefined, 'token must never leave GitHub hosts');

  const codeload = buildRequestOptions('https://codeload.github.com/a/b/tar.gz/main', 'sekrit');
  assert.equal(codeload.headers.Authorization, 'Bearer sekrit');
});

test('redirects are only followed to https GitHub-owned hosts', () => {
  assert.ok(isAllowedDownloadHost('api.github.com'));
  assert.ok(isAllowedDownloadHost('API.GitHub.com'));
  assert.ok(isAllowedDownloadHost('codeload.github.com'));
  assert.ok(isAllowedDownloadHost('objects.githubusercontent.com'));
  assert.ok(isAllowedDownloadHost('raw.githubusercontent.com'));
  assert.ok(!isAllowedDownloadHost('github.com.evil.example'));
  assert.ok(!isAllowedDownloadHost('evil.example.com'));
  assert.ok(!isAllowedDownloadHost('githubusercontent.com'));

  const from = 'https://api.github.com/repos/a/b/tarball/main';
  assert.equal(resolveRedirectUrl(from, 'https://codeload.github.com/a/b/tar.gz/main?token=sig'), 'https://codeload.github.com/a/b/tar.gz/main?token=sig');
  assert.equal(resolveRedirectUrl(from, 'http://codeload.github.com/x'), null, 'scheme downgrade refused');
  assert.equal(resolveRedirectUrl(from, 'https://evil.example.com/x'), null, 'off-host refused');
  assert.equal(resolveRedirectUrl(from, 'https://user:pass@codeload.github.com/x'), null, 'embedded credentials refused');
  // Relative locations resolve against the (already validated) current URL.
  assert.equal(
    resolveRedirectUrl(from, '/repos/a/b/tarball/main?sig'),
    'https://api.github.com/repos/a/b/tarball/main?sig'
  );
  assert.equal(MAX_REDIRECTS, 5);
});

test('download URL validation refuses non-https and off-host first hops', () => {
  assert.ok(validateDownloadUrl('https://api.github.com/repos/a/b/tarball/main'));
  assert.throws(() => validateDownloadUrl('http://api.github.com/x'), /non-HTTPS/);
  assert.throws(() => validateDownloadUrl('https://evil.example.com/x'), /non-GitHub/);
  assert.throws(() => validateDownloadUrl('https://github.com.evil.example/x'), /non-GitHub/);
  assert.throws(() => validateDownloadUrl('not a url'), /Invalid download URL/);

  // Redirect resolution re-applies the same policy on every hop.
  const from = 'https://api.github.com/repos/a/b/tarball/main';
  const hop1 = resolveRedirectUrl(from, 'https://codeload.github.com/a/b/tar.gz/main?sig');
  assert.equal(hop1, 'https://codeload.github.com/a/b/tar.gz/main?sig');
  assert.equal(resolveRedirectUrl(hop1, 'https://evil.example.com/steal'), null);
});

// ─── 5. GitHub id parsing ──────────────────────────────────────────────────────

test('parseGitHubId accepts only well-formed GitHub identifiers', () => {
  const ok = parseGitHubId('octocat/Hello-World');
  assert.deepEqual(ok, { owner: 'octocat', repo: 'Hello-World', branch: 'main' });

  const withBranch = parseGitHubId('octocat/Hello-World#dev');
  assert.equal(withBranch.branch, 'dev');

  const branchWithSlash = parseGitHubId('octocat/Hello-World#feature/x');
  assert.equal(branchWithSlash.branch, 'feature/x');

  const dotRepo = parseGitHubId('my-org/my.repo');
  assert.equal(dotRepo.repo, 'my.repo');

  const malformed = [
    '', 'norepo', '/x', 'x/', '../x/y', 'a/../b', 'a/b/c', 'x//y',
    'a/b#bad..ref', 'a/b#..', 'a/b#.', 'a/b#main\x01', 'a/b%2fc',
    'a b/c', 'a/b#x y', '\u0000a/b', 'a'.repeat(300),
    'a/b#%2e%2e/evil',
  ];
  for (const bad of malformed) {
    assert.equal(parseGitHubId(bad), null, `should reject: "${bad}"`);
  }
});

// ─── 6. getSkillName bounded read ─────────────────────────────────────────────

test('getSkillName reads only the bounded frontmatter region', async () => {
  await withTempDir(async (tmp) => {
    const skillDir = path.join(tmp, 'skill');
    await fs.ensureDir(skillDir);
    const big = 'x'.repeat(5 * 1024 * 1024); // 5 MB file
    await fs.writeFile(path.join(skillDir, 'SKILL.md'), '---\nname: bounded-name\n---\n' + big);

    const name = await getSkillName(skillDir);
    assert.equal(name, 'bounded-name');

    await fs.writeFile(path.join(skillDir, 'SKILL.md'), 'no frontmatter here');
    assert.equal(await getSkillName(skillDir), null);
  });
});

// ─── 7. install/remove flows on a sandboxed HOME ──────────────────────────────

async function withSandboxedHome(fn) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'fireskill-home-'));
  const prevHome = process.env.HOME;
  const prevUserProfile = process.env.USERPROFILE;
  process.env.HOME = home;
  delete process.env.USERPROFILE;
  try {
    return await fn(home);
  } finally {
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    await fs.remove(home).catch(() => {});
  }
}

test('installToAgentDir copies a skill and dereferences contained symlinks', async () => {
  await withSandboxedHome(async (home) => {
    const src = path.join(home, 'skill-src');
    await fs.ensureDir(path.join(src, 'references'));
    await fs.writeFile(path.join(src, 'SKILL.md'), '---\nname: demo\n---\nhi');
    await fs.writeFile(path.join(src, 'references', 'a.md'), 'ref');
    await fs.symlink(path.join(src, 'SKILL.md'), path.join(src, 'alias.md'));

    const target = await installToAgentDir(src, 'Demo Skill', 'claude', true);
    const expected = path.join(home, '.claude', 'skills', 'demo-skill');
    assert.equal(target, expected);
    assert.equal(await fs.readFile(path.join(expected, 'SKILL.md'), 'utf8'), '---\nname: demo\n---\nhi');
    assert.equal(await fs.readFile(path.join(expected, 'alias.md'), 'utf8'), '---\nname: demo\n---\nhi');

    // No symlinks may survive into the installed skill.
    const files = await listAll(expected);
    for (const f of files) assert.ok(!f.isLink, `symlink survived install: ${f.abs}`);
  });
});

test('install+remove round trip via removeAgentSkillDir', async () => {
  await withSandboxedHome(async (home) => {
    const src = path.join(home, 'skill-src');
    await fs.ensureDir(src);
    await fs.writeFile(path.join(src, 'SKILL.md'), '---\nname: roundtrip\n---\n');

    const baseDir = path.join(home, '.claude', 'skills');
    await installToAgentDir(src, 'roundtrip', 'claude', true);
    assert.ok(await fs.pathExists(path.join(baseDir, 'roundtrip', 'SKILL.md')));

    assert.equal(await removeAgentSkillDir(baseDir, 'roundtrip'), 'removed');
    assert.ok(!(await fs.pathExists(path.join(baseDir, 'roundtrip'))));

    assert.equal(await removeAgentSkillDir(baseDir, 'roundtrip'), 'missing');

    // Removal never touches the base dir itself.
    await fs.ensureDir(path.join(baseDir, 'keep'));
    await fs.writeFile(path.join(baseDir, 'keep', 'SKILL.md'), 'x');
    await installToAgentDir(src, 'roundtrip', 'claude', true);
    assert.equal(await removeAgentSkillDir(baseDir, 'roundtrip'), 'removed');
    assert.ok(await fs.pathExists(path.join(baseDir, 'keep')));
  });
});

test('end-to-end: crafted fixture archive -> findSkillDir -> install', async () => {
  await withSandboxedHome(async (home) => {
    const dest = path.join(home, 'repo');
    await fs.mkdir(dest);
    const archive = gitHubStyleArchive([
      { name: 'skill/SKILL.md', data: '---\nname: fixture-skill\n---\nbody' },
      { name: 'skill/examples/e.md', data: 'example' },
    ]);
    await extractAndValidateArchive(archive, dest);

    const skillDir = await findSkillDir(dest);
    assert.ok(skillDir, 'findSkillDir must locate the skill');
    assert.equal(path.basename(skillDir), 'skill');

    await installToAgentDir(skillDir, await getSkillName(skillDir), 'gemini', true);
    const installed = path.join(home, '.gemini', 'config', 'skills', 'fixture-skill');
    assert.equal(await fs.readFile(path.join(installed, 'SKILL.md'), 'utf8'), '---\nname: fixture-skill\n---\nbody');
    assert.equal(await fs.readFile(path.join(installed, 'examples', 'e.md'), 'utf8'), 'example');
  });
});

test('listSkillsInDir reports only real directories (never symlinks)', async () => {
  await withSandboxedHome(async (home) => {
    const base = path.join(home, '.cursor', 'skills');
    await fs.ensureDir(path.join(base, 'real-skill'));
    await fs.writeFile(path.join(base, 'real-skill', 'SKILL.md'), 'x');
    const outside = path.join(home, 'outside');
    await fs.ensureDir(outside);
    await fs.symlink(outside, path.join(base, 'linked-skill'));

    const skills = await listSkillsInDir(base, 'global');
    const names = skills.map((s) => s.name).sort();
    assert.deepEqual(names, ['real-skill']);
  });
});