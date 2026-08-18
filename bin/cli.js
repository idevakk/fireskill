#!/usr/bin/env node

/**
 * FireSkill CLI — Install AI agent skills from npm or GitHub.
 *
 * Usage:
 *   npx fireskill install                        → Install FireSkill's built-in meta-skill (interactive)
 *   npx fireskill install --agent gemini --global → Install for specific agent globally
 *   npx fireskill add owner/repo                  → Install any skill from a GitHub repo
 *   npx fireskill add owner/repo --agent claude   → Install GitHub skill for specific agent
 *   npx fireskill remove skill-name               → Remove an installed skill by name
 *   npx fireskill uninstall                       → Remove FireSkill's built-in meta-skill
 *   npx fireskill list                            → List all installed skills
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import ora from 'ora';
import https from 'https';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
import { Readable, Transform } from 'stream';
import { extract as tarExtract } from 'tar';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// ─── Agent Configuration ───────────────────────────────────────────────────────

const AGENTS = {
  gemini: {
    name: 'Antigravity / Gemini',
    globalSkillDir: () => path.join(getHomedir(), '.gemini', 'config', 'skills'),
    localSkillDir: (cwd) => path.join(cwd, '.agents', 'skills'),
  },
  claude: {
    name: 'Claude Code',
    globalSkillDir: () => path.join(getHomedir(), '.claude', 'skills'),
    localSkillDir: (cwd) => path.join(cwd, '.claude', 'skills'),
  },
  cursor: {
    name: 'Cursor',
    globalSkillDir: () => path.join(getHomedir(), '.cursor', 'skills'),
    localSkillDir: (cwd) => path.join(cwd, '.cursor', 'skills'),
  },
  windsurf: {
    name: 'Windsurf',
    globalSkillDir: () => path.join(getHomedir(), '.windsurf', 'skills'),
    localSkillDir: (cwd) => path.join(cwd, '.windsurf', 'skills'),
  },
  openai: {
    name: 'OpenAI / ChatGPT',
    globalSkillDir: () => path.join(getHomedir(), '.openai', 'skills'),
    localSkillDir: (cwd) => path.join(cwd, '.openai', 'skills'),
  }
};

function getHomedir() {
  return process.env.HOME || process.env.USERPROFILE || os.homedir();
}

// ─── GitHub Security Policy ────────────────────────────────────────────────────
// Defense in depth: these limits are enforced on top of what the `tar` package
// does by default. Never rely on upstream guarantees alone.

// Only GitHub-owned hosts may be contacted while downloading. The token is
// attached exclusively to requests whose hostname is in this allowlist.
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
  'raw.githubusercontent.com',
]);

const MAX_REDIRECTS = 5;
const MAX_ARCHIVE_ENTRIES = 100000; // 100k files is far beyond any sane skill repo
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024; // 1 GiB uncompressed tarball cap
const EXTRACT_TIMEOUT_MS = 10 * 60 * 1000; // hard deadline: a hostile archive must never hang the CLI
const MAX_FRONTMATTER_BYTES = 64 * 1024; // SKILL.md frontmatter read cap
const MAX_SKILL_NAME_LENGTH = 100;
const GITHUB_COMPONENT_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*)$/;
const GITHUB_BRANCH_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*)$/;
const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/;

function isAllowedDownloadHost(hostname) {
  return typeof hostname === 'string' && ALLOWED_DOWNLOAD_HOSTS.has(hostname.toLowerCase());
}

/**
 * Resolve a redirect location against the current URL.
 * Returns the next URL string, or null if the redirect is not safe
 * (non-https, off-allowlist host, embedded credentials).
 */
function resolveRedirectUrl(currentUrl, location) {
  try {
    const next = new URL(location, new URL(currentUrl));
    if ((next.protocol || '') !== 'https:') return null;
    if (!isAllowedDownloadHost(next.hostname)) return null;
    if (next.username || next.password) return null;
    return next.href;
  } catch {
    return null;
  }
}

/**
 * Build request options for a download URL.
 * The Authorization header is only ever attached to allowlisted GitHub hosts.
 */
function buildRequestOptions(urlStr, token) {
  const u = new URL(urlStr);
  const headers = {
    'User-Agent': 'fireskill-cli',
    'Accept': 'application/vnd.github+json',
  };
  if (token && isAllowedDownloadHost(u.hostname)) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return { hostname: u.hostname, path: u.pathname + u.search, headers };
}

// ─── GitHub Utilities ──────────────────────────────────────────────────────────

/**
 * Parse a GitHub identifier like "owner/repo" or "owner/repo#branch".
 * Every component is anchored to the GitHub-allowed charset and length;
 * anything else is rejected outright.
 */
function parseGitHubId(id) {
  if (typeof id !== 'string' || id.length === 0 || id.length > 200) return null;
  const match = id.match(/^([^/]+)\/([^#]+?)(?:#(.+))?$/);
  if (!match) return null;

  const owner = match[1];
  const repo = match[2];
  const branch = match[3] || 'main';

  if (!isValidGitHubComponent(owner, 64)) return null;
  if (!isValidGitHubComponent(repo, 100)) return null;
  if (!isValidGitHubBranch(branch)) return null;

  return { owner, repo, branch };
}

function isValidGitHubComponent(s, maxLen) {
  if (typeof s !== 'string' || s.length === 0 || s.length > maxLen) return false;
  if (s === '.' || s === '..' || s.includes('..')) return false;
  return GITHUB_COMPONENT_RE.test(s);
}

function isValidGitHubBranch(b) {
  if (typeof b !== 'string' || b.length === 0 || b.length > 100) return false;
  if (b === '.' || b === '..' || b.includes('..') || b.includes('//')) return false;
  if (!GITHUB_BRANCH_RE.test(b)) return false;
  for (const segment of b.split('/')) {
    if (segment === '.' || segment === '..') return false;
  }
  return true;
}

// ─── Secure temp directory ─────────────────────────────────────────────────────

/**
 * Create an unpredictable, mode-restricted temp directory via mkdtemp.
 * Never use a predictable name under os.tmpdir(): a local attacker could
 * pre-create it as a symlink and redirect writes.
 */
async function createSecureTempDir(prefix = 'fireskill-') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.chmod(dir, 0o700); // explicit regardless of umask
  return dir;
}

// ─── Tar extraction with layered validation ────────────────────────────────────

function createByteLimitTransform(limit) {
  let total = 0;
  return new Transform({
    transform(chunk, _enc, cb) {
      total += chunk.length;
      if (total > limit) {
        cb(Object.assign(new Error(`Archive exceeds the ${limit}-byte download limit`), {
          code: 'ERR_ARCHIVE_TOO_LARGE',
        }));
        return;
      }
      cb(null, chunk);
    },
  });
}

/**
 * Gunzip the stream only when it is actually gzipped (magic bytes 0x1f 0x8b);
 * otherwise pass it through untouched. GitHub serves gzipped tarballs, but
 * this also tolerates plain tar streams and makes extraction testable with
 * locally crafted archives.
 */
function createAutoGunzip() {
  let gunzip = null;
  let decided = false;
  return new Transform({
    transform(chunk, _enc, cb) {
      if (!decided) {
        decided = true;
        if (chunk.length >= 2 && chunk[0] === 0x1f && chunk[1] === 0x8b) {
          gunzip = createGunzip();
          gunzip.on('data', (d) => this.push(d));
          gunzip.on('error', (e) => this.destroy(e));
        }
      }
      if (gunzip) {
        gunzip.write(chunk, cb);
      } else {
        cb(null, chunk);
      }
    },
    flush(cb) {
      if (gunzip) {
        gunzip.end();
        gunzip.on('end', () => cb());
      } else {
        cb();
      }
    },
  });
}

/**
 * Extract a gzip tarball stream into destRoot and then verify the result.
 * Safety layers (each independently sufficient, all applied):
 *  1. node-tar with `strict: true`: any entry with `..`, absolute paths,
 *     extraction-through-symlink, or depth > 1024 aborts extraction.
 *     (Do NOT use tar's `filter`/`files` options: they carry their own
 *     recursion DoS advisory, GHSA-r292-9mhp-454m.)
 *  2. `preservePaths: false` (explicit default): absolute paths and `..`
 *     are never honored.
 *  3. Entry-count cap enforced via the extractor's `entry` events.
 *  4. Uncompressed byte cap via a counting transform.
 *  5. Post-extraction walk (`assertRepoContained`): independent verification
 *     that nothing on disk resolves outside destRoot.
 *  6. A hard wall-clock deadline aborts the whole pipeline (and the caller's
 *     signal can abort it too), so a deadlocking archive can never hang the
 *     CLI; the caller's cleanup path removes the temp dir on this error.
 *  7. Symlink entries whose target resolves to the link's own ancestor or
 *     itself are rejected before materialization: node-tar 7.x deadlocks its
 *     async unpack on some of these shapes and dereferencing them recurses.
 */
async function extractAndValidateArchive(source, destRoot, opts = {}) {
  const maxEntries = opts.maxEntries ?? MAX_ARCHIVE_ENTRIES;
  const maxBytes = opts.maxBytes ?? MAX_ARCHIVE_BYTES;
  const timeoutMs = opts.timeoutMs ?? EXTRACT_TIMEOUT_MS;

  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  const extractor = tarExtract({
    cwd: destRoot,
    strip: 1, // mirror the previous behavior: drop the archive's top directory
    strict: true,
    preservePaths: false,
  });

  let entryCount = 0;
  extractor.on('entry', (entry) => {
    entryCount += 1;
    if (entryCount > maxEntries) {
      // Minipass-based tar streams expose abort() rather than destroy().
      extractor.abort(Object.assign(new Error(`Archive contains more than ${maxEntries} entries`), {
        code: 'ERR_ARCHIVE_TOO_MANY_ENTRIES',
      }));
      return;
    }
    if (isSelfReferencingSymlink(entry)) {
      extractor.abort(Object.assign(new Error(
        `Archive contains a symlink referencing itself or its own ancestor: ${entry.path || ''}`
      ), { code: 'ERR_ARCHIVE_SELF_REFERENCING_SYMLINK' }));
    }
  });

  const limiter = createByteLimitTransform(maxBytes);
  try {
    // A raw Buffer source must be wrapped: pipeline() would otherwise treat
    // it as a byte-iterable and hand numbers to the streams.
    const sourceStream = Buffer.isBuffer(source)
      ? Readable.from([source])
      : source;
    await pipeline(sourceStream, createAutoGunzip(), limiter, extractor, { signal: controller.signal });
  } catch (err) {
    if (err && err.code === 'ERR_ARCHIVE_TOO_MANY_ENTRIES') throw err;
    if (err && err.code === 'ERR_ARCHIVE_TOO_LARGE') throw err;
    if (err && err.code === 'ERR_ARCHIVE_SELF_REFERENCING_SYMLINK') throw err;
    if (controller.signal.aborted || (err && err.name === 'AbortError')) {
      throw Object.assign(new Error(`Archive extraction timed out after ${timeoutMs}ms`), {
        code: 'ERR_FIRESKILL_TIMED_OUT',
      });
    }
    throw new Error(`Archive extraction failed: ${err && err.message ? err.message : String(err)}`);
  } finally {
    clearTimeout(watchdog);
    if (opts.signal) opts.signal.removeEventListener('abort', onExternalAbort);
  }

  await assertRepoContained(destRoot, { maxEntries });
  return destRoot;
}

function isSelfReferencingSymlink(entry) {
  if (!entry || entry.type !== 'SymbolicLink') return false;
  const linkPath = String(entry.path || '').replace(/\\/g, '/');
  const rawLink = entry.linkpath;
  if (rawLink == null || rawLink === '') return false;
  if (typeof rawLink !== 'string') return false;
  const target = rawLink.replace(/\\/g, '/');
  if (target.includes('\0')) return false;
  const candidates = [];
  if (target.startsWith('/')) {
    candidates.push(path.posix.normalize(target.replace(/^\/+/, '')));
  } else {
    candidates.push(path.posix.normalize(target));
    candidates.push(path.posix.normalize(path.posix.join(path.posix.dirname(linkPath), target)));
  }
  for (const candidate of candidates) {
    if (candidate === '' || candidate === '.' || candidate === '..' || candidate.startsWith('../')) continue;
    if (linkPath === candidate || linkPath.startsWith(candidate + '/')) return true;
  }
  return false;
}

/**
 * Walk an extracted tree WITHOUT following symlinks and verify containment:
 *  - every regular file/dir lives inside root;
 *  - every symlink resolves (realpath) inside root; dangling symlinks are
 *    removed so they can never be followed or copied elsewhere;
 *  - unsupported entry types are rejected.
 */
async function assertRepoContained(rootDir, opts = {}) {
  const maxEntries = opts.maxEntries ?? MAX_ARCHIVE_ENTRIES;
  let root;
  try {
    root = await fs.realpath(rootDir);
  } catch (err) {
    throw new Error(`Extraction directory is unusable: ${err.message}`);
  }

  const stack = [root];
  let count = 0;

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      throw new Error(`Failed to inspect extracted directory: ${err.message}`);
    }
    for (const entry of entries) {
      count += 1;
      if (count > maxEntries) {
        throw new Error(`Extracted archive exceeds the entry limit (${maxEntries})`);
      }
      const abs = path.join(dir, entry.name);

      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = await fs.realpath(abs);
        } catch {
          // Dangling symlink: no real content, remove so it can never be
          // materialized or followed on the destination machine.
          await fs.remove(abs).catch(() => {});
          continue;
        }
        if (isPathOutside(root, target)) {
          throw new Error(`Extracted archive contains a symlink escaping the extraction directory: ${entry.name}`);
        }
        if (isDereferenceCycle(abs, target)) {
          throw new Error(`Extracted archive contains a symlink dereferencing into its own directory tree: ${entry.name}`);
        }
        // Contained symlink (strictly inside): it will be dereferenced at
        // copy time so no symlinks ever reach the user's agent directories.
      } else if (entry.isDirectory()) {
        stack.push(abs);
      } else if (!entry.isFile()) {
        throw new Error(`Extracted archive contains an unsupported entry type: ${entry.name}`);
      }
    }
  }
  return true;
}

function isPathOutside(root, target) {
  // A link resolving to the extraction root itself counts as escaping: when
  // dereferenced, it would attempt a self-recursive copy of the whole tree.
  const rel = path.relative(root, target);
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel);
}

/**
 * True when a symlink resolves to a path that contains the link itself
 * (the dereference-cycle condition): a dereferencing recursive copy would
 * keep following the link forever, so such a link must never survive.
 */
function isDereferenceCycle(linkAbsPath, resolvedTarget) {
  const rel = path.relative(resolvedTarget, linkAbsPath);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Walk a source tree without following symlinks and refuse any symlink that
 * would make a dereferencing recursive copy spin. Independent of the
 * extraction-time validation: this guards the copy boundary itself so a
 * cycle-shaped source can never reach fs.copy.
 */
async function rejectDereferenceCycles(sourceDir) {
  const stack = [sourceDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        let target;
        try {
          target = await fs.realpath(abs);
        } catch {
          continue;
        }
        if (isDereferenceCycle(abs, target)) {
          throw new Error(`Refusing to copy a symlink that dereferences into its own directory tree: ${entry.name}`);
        }
      } else if (entry.isDirectory()) {
        stack.push(abs);
      }
    }
  }
}

// ─── Skill name handling ───────────────────────────────────────────────────────

/**
 * Sanitize a skill name the same way the previous version did
 * (non [a-zA-Z0-9_-] characters become '-', lowercased) but reject
 * results that are empty, path-like, reserved on Windows, or oversized.
 * Returns null when the name is unusable.
 */
function sanitizeSkillName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
  if (name.length === 0 || name.length > MAX_SKILL_NAME_LENGTH) return null;
  if (name === '.' || name === '..' || /^-+$/.test(name)) return null;
  if (WINDOWS_RESERVED_NAME.test(name)) return null;
  return name;
}

/**
 * Resolve the skill target directory under baseDir and prove containment.
 * The base is resolved through realpath (legit symlinked agent config dirs
 * keep working), and the final containment check runs against the resolved
 * base. A symlink planted at the exact target path is refused.
 */
async function resolveSafeSkillTarget(baseDir, skillName) {
  if (typeof skillName !== 'string' || skillName.length === 0 ||
      skillName === '.' || skillName === '..' ||
      skillName.includes('/') || skillName.includes('\\') || skillName.includes('\0')) {
    throw new Error(`Invalid skill name: "${skillName}"`);
  }
  const base = path.resolve(baseDir);
  const target = path.resolve(path.join(base, skillName));

  const realBase = (await fs.pathExists(base)) ? await fs.realpath(base) : base;
  const realTarget = (await fs.pathExists(target)) ? await fs.realpath(target) : target;

  const rel = path.relative(realBase, realTarget);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Refusing to operate outside the skill base directory: ${target}`);
  }

  const lstat = await fs.lstat(target).catch(() => null);
  if (lstat && lstat.isSymbolicLink()) {
    throw new Error(`Refusing to operate through a symlink at: ${target}`);
  }

  return { base: realBase, target, realTarget };
}

// ─── Install / Remove primitives (no IO side effects on console) ──────────────

async function installToAgentDir(sourceDir, skillName, agentKey, isGlobal) {
  const agent = AGENTS[agentKey];
  if (!agent) throw new Error(`Unknown agent: ${agentKey}`);
  const name = sanitizeSkillName(skillName);
  if (name === null) throw new Error(`Invalid skill name: "${skillName}"`);

  await rejectDereferenceCycles(sourceDir);

  const baseDir = path.resolve(isGlobal ? agent.globalSkillDir() : agent.localSkillDir(process.cwd()));
  const { target } = await resolveSafeSkillTarget(baseDir, name);

  await fs.ensureDir(baseDir);
  await fs.ensureDir(target);

  const st = await fs.lstat(target);
  if (st.isSymbolicLink()) throw new Error(`Refusing to install through a symlink: ${target}`);
  if (!st.isDirectory()) throw new Error(`Refusing to install into a non-directory: ${target}`);

  // dereference: symlinks in the downloaded repo (all validated to resolve
  // inside the extraction root) become real files/dirs in the user's agent
  // directory, so no link ever survives into installed skills.
  await fs.copy(sourceDir, target, { overwrite: true, dereference: true });
  return target;
}

async function removeAgentSkillDir(baseDir, skillName) {
  const name = sanitizeSkillName(skillName);
  if (name === null) throw new Error(`Invalid skill name: "${skillName}"`);

  const { target } = await resolveSafeSkillTarget(baseDir, name);

  if (!(await fs.pathExists(target))) return 'missing';

  const st = await fs.lstat(target);
  if (st.isSymbolicLink()) throw new Error(`Refusing to remove through a symlink: ${target}`);
  if (!st.isDirectory()) throw new Error(`Refusing to remove a non-directory: ${target}`);

  await fs.remove(target);
  return 'removed';
}

// ─── GitHub download ───────────────────────────────────────────────────────────

/**
 * Download + extract + validate a GitHub repo tarball into a fresh secure
 * temp dir. Cleans up its own temp dir on failure.
 */
async function downloadAndExtractGitHub(owner, repo, branch) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!owner || !repo || !isValidGitHubComponent(owner, 64) || !isValidGitHubComponent(repo, 100)) {
    throw new Error(`Invalid GitHub repository identifier: ${owner}/${repo}`);
  }
  if (!isValidGitHubBranch(branch)) {
    throw new Error(`Invalid branch: ${branch}`);
  }

  const tmpDir = await createSecureTempDir('fireskill-');

  const controller = new AbortController();
  const watchdog = setTimeout(() => controller.abort(), EXTRACT_TIMEOUT_MS);

  try {
    await streamTarballToDir(
      `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`,
      token,
      tmpDir,
      controller.signal
    );
    return tmpDir;
  } catch (err) {
    await fs.remove(tmpDir).catch(() => {});
    if (err && err.code === 'ERR_FIRESKILL_TIMED_OUT') throw err;
    if (err.message === 'RETRY_MASTER') {
      // 404 on the default branch: the CLI handler retries 'master' so the
      // user sees the attempt; other branches get a clear not-found message.
      if (branch === 'main') throw new Error('RETRY_MASTER');
      throw new Error(`Repository not found: ${owner}/${repo} (branch: ${branch})`);
    }
    throw err;
  } finally {
    clearTimeout(watchdog);
  }
}

/**
 * Validate an absolute download URL before any request is made:
 * https-only, GitHub-owned host.
 * Returns the parsed URL object or throws.
 */
function validateDownloadUrl(urlStr) {
  let urlObj;
  try {
    urlObj = new URL(urlStr);
  } catch {
    throw new Error('Invalid download URL');
  }
  if (urlObj.protocol !== 'https:') {
    throw new Error('Refusing non-HTTPS download URL');
  }
  if (!isAllowedDownloadHost(urlObj.hostname)) {
    throw new Error(`Refusing request to non-GitHub host: ${urlObj.hostname}`);
  }
  return urlObj;
}

/**
 * GET a URL following only safe redirects (https, GitHub-owned hosts,
 * capped count) and extracting the gzip response into destDir.
 * An external AbortSignal (the operation-wide watchdog) aborts the
 * in-flight request and any ongoing extraction.
 */
function streamTarballToDir(requestUrl, token, destDir, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (err) => { if (settled) return; settled = true; reject(err); };
    const succeed = (value) => { if (settled) return; settled = true; resolve(value); };

    let req = null;
    const onAbort = () => {
      if (settled) return;
      const timeoutError = Object.assign(
        new Error(`Download and extraction timed out after ${EXTRACT_TIMEOUT_MS}ms`),
        { code: 'ERR_FIRESKILL_TIMED_OUT' }
      );
      if (req && !req.destroyed) req.destroy();
      fail(timeoutError);
    };
    if (signal) {
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    const makeRequest = (currentUrl, redirectCount) => {
      if (settled) return;
      if (redirectCount > MAX_REDIRECTS) {
        fail(new Error('Too many redirects'));
        return;
      }

      let urlObj;
      try {
        urlObj = validateDownloadUrl(currentUrl);
      } catch (err) {
        fail(err);
        return;
      }

      const options = buildRequestOptions(urlObj.href, token);
      req = https.get(options, (res) => {
        if (settled) return;
        // Redirects: validate the target before following; the token is only
        // ever re-attached for allowlisted GitHub hosts (buildRequestOptions).
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume(); // drain so we never hold sockets open
          const next = resolveRedirectUrl(currentUrl, res.headers.location);
          if (!next) {
            fail(new Error('Unsafe redirect target'));
            return;
          }
          makeRequest(next, redirectCount + 1);
          return;
        }

        if (res.statusCode === 404) {
          res.resume();
          fail(new Error('RETRY_MASTER'));
          return;
        }

        if (res.statusCode !== 200) {
          res.resume();
          fail(new Error(`GitHub API returned ${res.statusCode}`));
          return;
        }

        extractAndValidateArchive(res, destDir, { signal }).then(succeed, fail);
      });
      req.on('error', fail);
    };

    makeRequest(requestUrl, 0);
  });
}

/**
 * Find the skill directory within a downloaded repo.
 * Looks for: skill/, skills/, .skill/, or root SKILL.md
 */
async function findSkillDir(repoDir) {
  // Priority order for finding skill content
  const candidates = [
    path.join(repoDir, 'skill'),
    path.join(repoDir, 'skills'),
    path.join(repoDir, '.skill'),
  ];

  for (const candidate of candidates) {
    if (await fs.pathExists(candidate)) {
      const skillMd = path.join(candidate, 'SKILL.md');
      if (await fs.pathExists(skillMd)) {
        return candidate;
      }
    }
  }

  // Check if SKILL.md is at root
  const rootSkillMd = path.join(repoDir, 'SKILL.md');
  if (await fs.pathExists(rootSkillMd)) {
    return repoDir;
  }

  return null;
}

/**
 * Extract skill name from SKILL.md frontmatter.
 * Reads at most MAX_FRONTMATTER_BYTES so an untrusted repo cannot force an
 * unbounded read of a huge file.
 */
async function getSkillName(skillDir) {
  const skillMd = path.join(skillDir, 'SKILL.md');

  let fd;
  try {
    fd = await fs.promises.open(skillMd, 'r');
  } catch {
    return null;
  }

  try {
    const buf = Buffer.alloc(MAX_FRONTMATTER_BYTES);
    const { bytesRead } = await fd.read(buf, 0, MAX_FRONTMATTER_BYTES, 0);
    const content = buf.toString('utf8', 0, bytesRead);
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) return null;

    const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)$/m);
    return nameMatch ? nameMatch[1].trim() : null;
  } finally {
    await fd.close().catch(() => {});
  }
}

// ─── Install Functions ─────────────────────────────────────────────────────────

async function installToAgent(sourceDir, skillName, agentKey, isGlobal) {
  const agent = AGENTS[agentKey];
  const baseDir = isGlobal
    ? agent.globalSkillDir()
    : agent.localSkillDir(process.cwd());

  const spinner = ora(`Installing "${skillName}" for ${agent.name}...`).start();

  try {
    const target = await installToAgentDir(sourceDir, skillName, agentKey, isGlobal);
    spinner.succeed(chalk.green(`✓ "${skillName}" installed for ${agent.name} → ${target}`));
    return true;
  } catch (err) {
    spinner.fail(chalk.red(`✗ Failed to install for ${agent.name}: ${err.message}`));
    return false;
  }
}

async function promptAgentSelection() {
  const answers = await inquirer.prompt([
    {
      type: 'checkbox',
      name: 'agents',
      message: 'Which AI agents should this be installed for?',
      choices: Object.entries(AGENTS).map(([key, val]) => ({
        name: val.name,
        value: key,
        checked: key === 'gemini' || key === 'claude'
      }))
    },
    {
      type: 'confirm',
      name: 'global',
      message: 'Install globally (available across all projects)?',
      default: true
    }
  ]);
  return answers;
}

/**
 * Returns:
 *  - null when no --agent flag was given (interactive mode to follow)
 *  - the agent list otherwise
 * On an unknown agent: prints the error, sets exit code 1 and returns false.
 */
function resolveAgents(agentFlag) {
  if (!agentFlag) return null; // trigger interactive mode
  if (agentFlag === 'all') return Object.keys(AGENTS);
  if (AGENTS[agentFlag.toLowerCase()]) return [agentFlag.toLowerCase()];
  console.log(chalk.red(`  Unknown agent: ${agentFlag}`));
  console.log(chalk.dim(`  Available: ${Object.keys(AGENTS).join(', ')}, all`));
  process.exitCode = 1;
  return false;
}

// ─── CLI Commands ──────────────────────────────────────────────────────────────

const program = new Command();

program
  .name('fireskill')
  .description(chalk.bold('🔥 FireSkill') + ' — Install AI agent skills from npm or GitHub.')
  .version('1.0.0');

// ─── install: Install FireSkill's built-in meta-skill ───────────────────────

program
  .command('install')
  .description("Install FireSkill's built-in knowledge-extraction meta-skill")
  .option('-g, --global', 'Install to global agent config directory')
  .option('-a, --agent <agent>', 'Target agent: gemini, claude, cursor, windsurf, openai, all')
  .action(async (options) => {
    console.log('');
    console.log(chalk.bold.hex('#FF6B35')('  🔥 FireSkill Installer'));
    console.log(chalk.dim('  ─────────────────────────────────────'));
    console.log(chalk.dim('  Installing the built-in knowledge-extraction meta-skill'));
    console.log('');

    let selectedAgents = resolveAgents(options.agent);
    if (selectedAgents === false) return;
    let isGlobal = options.global || false;

    if (!selectedAgents) {
      const answers = await promptAgentSelection();
      selectedAgents = answers.agents;
      isGlobal = answers.global;
    }

    if (selectedAgents.length === 0) {
      console.log(chalk.yellow('  No agents selected. Exiting.'));
      return;
    }

    console.log('');
    const skillSourceDir = path.join(PACKAGE_ROOT, 'skill');

    let successCount = 0;
    for (const agentKey of selectedAgents) {
      const ok = await installToAgent(skillSourceDir, 'fireskill', agentKey, isGlobal);
      if (ok) successCount++;
    }

    printResult(successCount, selectedAgents.length);
    console.log(chalk.dim('  Usage: Tell your AI agent:'));
    console.log(chalk.white('  "Use the FireSkill skill to build a skill from these sources: [links]"'));
    console.log('');
  });

// ─── add: Install a skill from a GitHub repo ────────────────────────────────

program
  .command('add <repo>')
  .description('Install a skill from a GitHub repo (e.g., owner/repo or owner/repo#branch)')
  .option('-g, --global', 'Install to global agent config directory')
  .option('-a, --agent <agent>', 'Target agent: gemini, claude, cursor, windsurf, openai, all')
  .option('-n, --name <name>', 'Override the skill name (default: from SKILL.md frontmatter)')
  .action(async (repo, options) => {
    console.log('');
    console.log(chalk.bold.hex('#FF6B35')('  🔥 FireSkill — GitHub Installer'));
    console.log(chalk.dim('  ─────────────────────────────────────'));
    console.log('');

    // Parse GitHub ID
    const ghId = parseGitHubId(repo);
    if (!ghId) {
      console.log(chalk.red(`  Invalid format: "${repo}"`));
      console.log(chalk.dim('  Expected: owner/repo or owner/repo#branch'));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.dim(`  Repository: ${chalk.white(`${ghId.owner}/${ghId.repo}`)} (branch: ${ghId.branch})`));
    console.log('');

    let repoDir = null;
    try {
      // Download repo
      const dlSpinner = ora('Downloading repository...').start();
      try {
        repoDir = await downloadAndExtractGitHub(ghId.owner, ghId.repo, ghId.branch);
        dlSpinner.succeed(chalk.green('✓ Repository downloaded'));
      } catch (err) {
        if (err.message === 'RETRY_MASTER') {
          // Retry with 'master' branch
          dlSpinner.text = 'Trying master branch...';
          try {
            ghId.branch = 'master';
            repoDir = await downloadAndExtractGitHub(ghId.owner, ghId.repo, 'master');
            dlSpinner.succeed(chalk.green('✓ Repository downloaded (master branch)'));
          } catch (err2) {
            dlSpinner.fail(chalk.red(`✗ Failed to download: ${err2.message}`));
            process.exitCode = 1;
            return;
          }
        } else {
          dlSpinner.fail(chalk.red(`✗ Failed to download: ${err.message}`));
          console.log('');
          console.log(chalk.dim('  Tips:'));
          console.log(chalk.dim('  • Check the repo exists and is public'));
          console.log(chalk.dim('  • For private repos, set GITHUB_TOKEN or GH_TOKEN env variable'));
          console.log(chalk.dim('  • Specify a branch: owner/repo#branch-name'));
          process.exitCode = 1;
          return;
        }
      }

      // Find skill directory
      const findSpinner = ora('Locating skill files...').start();
      const skillDir = await findSkillDir(repoDir);

      if (!skillDir) {
        findSpinner.fail(chalk.red('✗ No skill found in repository'));
        console.log('');
        console.log(chalk.dim('  The repo must contain one of:'));
        console.log(chalk.dim('  • skill/SKILL.md'));
        console.log(chalk.dim('  • skills/SKILL.md'));
        console.log(chalk.dim('  • SKILL.md (at root)'));
        process.exitCode = 1;
        return;
      }
      findSpinner.succeed(chalk.green('✓ Skill found'));

      // Determine skill name
      const rawName = options.name || await getSkillName(skillDir) || ghId.repo;
      const skillName = sanitizeSkillName(rawName);
      if (skillName === null) {
        console.log(chalk.red(`  ✗ Invalid skill name derived from "${rawName}"`));
        console.log(chalk.dim('  Use --name to provide a valid name (letters, digits, - and _).'));
        process.exitCode = 1;
        return;
      }
      console.log(chalk.dim(`  Skill name: ${chalk.white(skillName)}`));
      console.log('');

      // Agent selection
      let selectedAgents = resolveAgents(options.agent);
      if (selectedAgents === false) return;
      let isGlobal = options.global || false;

      if (!selectedAgents) {
        const answers = await promptAgentSelection();
        selectedAgents = answers.agents;
        isGlobal = answers.global;
      }

      if (selectedAgents.length === 0) {
        console.log(chalk.yellow('  No agents selected. Exiting.'));
        return;
      }

      console.log('');

      // Install
      let successCount = 0;
      for (const agentKey of selectedAgents) {
        const ok = await installToAgent(skillDir, skillName, agentKey, isGlobal);
        if (ok) successCount++;
      }

      printResult(successCount, selectedAgents.length);
      console.log(chalk.dim(`  Installed from: ${chalk.white(`github.com/${ghId.owner}/${ghId.repo}`)}`));
      console.log('');
    } finally {
      // Always clean up the temp dir, on every path above.
      if (repoDir) {
        await fs.remove(repoDir).catch(() => {});
      }
    }
  });

// ─── remove: Remove a GitHub-installed skill ─────────────────────────────────

program
  .command('remove <skill-name>')
  .description('Remove an installed skill by name')
  .option('-g, --global', 'Remove from global agent config directory')
  .option('-a, --agent <agent>', 'Target agent: gemini, claude, cursor, windsurf, openai, all')
  .action(async (skillName, options) => {
    console.log('');
    console.log(chalk.bold.red('  🗑️  FireSkill — Remove Skill'));
    console.log('');

    const name = sanitizeSkillName(skillName);
    if (name === null) {
      console.log(chalk.red(`  Invalid skill name: "${skillName}"`));
      process.exitCode = 1;
      return;
    }

    let selectedAgents = resolveAgents(options.agent);
    if (selectedAgents === false) return;
    let isGlobal = options.global || false;

    if (!selectedAgents) {
      const answers = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'agents',
          message: `Remove "${name}" from which agents?`,
          choices: Object.entries(AGENTS).map(([key, val]) => ({
            name: val.name,
            value: key
          }))
        },
        {
          type: 'confirm',
          name: 'global',
          message: 'Remove from global config?',
          default: true
        }
      ]);
      selectedAgents = answers.agents;
      isGlobal = answers.global;
    }

    for (const agentKey of selectedAgents) {
      const agent = AGENTS[agentKey];
      const baseDir = isGlobal
        ? agent.globalSkillDir()
        : agent.localSkillDir(process.cwd());

      const spinner = ora(`Removing "${name}" from ${agent.name}...`).start();
      try {
        const result = await removeAgentSkillDir(baseDir, name);
        if (result === 'removed') {
          spinner.succeed(chalk.green(`✓ Removed "${name}" from ${agent.name}`));
        } else {
          spinner.warn(chalk.yellow(`⊘ "${name}" not found for ${agent.name}`));
        }
      } catch (err) {
        spinner.fail(chalk.red(`✗ Failed: ${err.message}`));
      }
    }
    console.log('');
  });

// ─── uninstall: Remove FireSkill's built-in meta-skill ───────────────────────

program
  .command('uninstall')
  .description("Remove FireSkill's built-in meta-skill")
  .option('-g, --global', 'Uninstall from global agent config directory')
  .option('-a, --agent <agent>', 'Target agent: gemini, claude, cursor, windsurf, openai, all')
  .action(async (options) => {
    console.log('');
    console.log(chalk.bold.red('  🗑️  FireSkill Uninstaller'));
    console.log('');

    let selectedAgents = resolveAgents(options.agent);
    if (selectedAgents === false) return;
    let isGlobal = options.global || false;

    if (!selectedAgents) {
      const answers = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'agents',
          message: 'Uninstall from which agents?',
          choices: Object.entries(AGENTS).map(([key, val]) => ({
            name: val.name,
            value: key
          }))
        },
        {
          type: 'confirm',
          name: 'global',
          message: 'Uninstall from global config?',
          default: true
        }
      ]);
      selectedAgents = answers.agents;
      isGlobal = answers.global;
    }

    for (const agentKey of selectedAgents) {
      const agent = AGENTS[agentKey];
      const baseDir = isGlobal
        ? agent.globalSkillDir()
        : agent.localSkillDir(process.cwd());

      const spinner = ora(`Removing FireSkill from ${agent.name}...`).start();
      try {
        const result = await removeAgentSkillDir(baseDir, 'fireskill');
        if (result === 'removed') {
          spinner.succeed(chalk.green(`✓ Removed from ${agent.name}`));
        } else {
          spinner.warn(chalk.yellow(`⊘ FireSkill not found for ${agent.name}`));
        }
      } catch (err) {
        spinner.fail(chalk.red(`✗ Failed: ${err.message}`));
      }
    }
    console.log('');
  });

// ─── list: Show all installed skills ─────────────────────────────────────────

program
  .command('list')
  .description('List all installed skills')
  .option('-g, --global', 'List from global agent config directory')
  .option('-a, --agent <agent>', 'Target agent: gemini, claude, cursor, windsurf, openai, all')
  .action(async (options) => {
    console.log('');
    console.log(chalk.bold.hex('#FF6B35')('  🔥 FireSkill — Installed Skills'));
    console.log(chalk.dim('  ─────────────────────────────────────'));
    console.log('');

    let selectedAgents = resolveAgents(options.agent);
    if (selectedAgents === false) return;
    if (!selectedAgents) selectedAgents = Object.keys(AGENTS);
    const isGlobal = options.global !== undefined ? options.global : true;

    for (const agentKey of selectedAgents) {
      const agent = AGENTS[agentKey];
      const globalDir = agent.globalSkillDir();
      const localDir = agent.localSkillDir(process.cwd());

      console.log(chalk.bold(`  ${agent.name}:`));

      // Check global
      const globalSkills = await listSkillsInDir(globalDir, 'global');
      // Check local
      const localSkills = await listSkillsInDir(localDir, 'local');

      const allSkills = [...globalSkills, ...localSkills];

      if (allSkills.length === 0) {
        console.log(chalk.dim('    (none installed)'));
      } else {
        for (const skill of allSkills) {
          const badge = skill.scope === 'global'
            ? chalk.blue(' [global]')
            : chalk.green(' [local]');
          console.log(`    • ${chalk.white(skill.name)}${badge}`);
        }
      }
      console.log('');
    }
  });

async function listSkillsInDir(dir, scope) {
  const skills = [];
  if (!await fs.pathExists(dir)) return skills;

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const skillMdPath = path.join(dir, entry.name, 'SKILL.md');
        if (await fs.pathExists(skillMdPath)) {
          skills.push({ name: entry.name, scope, path: path.join(dir, entry.name) });
        }
      }
    }
  } catch (err) {
    // Directory not readable, skip
  }
  return skills;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function printResult(successCount, totalCount) {
  console.log('');
  if (successCount === totalCount) {
    console.log(chalk.bold.green('  ✅ All installations complete!'));
  } else if (successCount > 0) {
    console.log(chalk.yellow(`  ⚠ ${successCount}/${totalCount} installations succeeded.`));
  } else {
    console.log(chalk.red('  ✗ All installations failed.'));
  }
  console.log('');
}

// ─── Parse & Run ─────────────────────────────────────────────────────────────

// Only run the CLI when executed directly, so tests can import the module
// without triggering commander or process.exit behavior.
const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  program.parse();
}

// ─── Exports (test surface) ───────────────────────────────────────────────────

export {
  AGENTS,
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
  MAX_ARCHIVE_ENTRIES,
  MAX_ARCHIVE_BYTES,
};