# FireSkill CLI — Security Audit & Hardening

Branch: `fm/fireskill-security-hardening`
Audit date: 2026-08-18
Scope: complete review of the published `fireskill` npm package (repo `github.com/idevakk/fireskill`), all commands and helpers in `bin/cli.js`, packaging metadata, dependency tree, README claims, and installed skill content.

---

## Audited surfaces (whole codebase)

- `bin/cli.js` — every code path: `install`, `add`, `remove`, `uninstall`, `list`, and every helper (`downloadGitHubRepo`→`downloadAndExtractGitHub`/`streamTarballToDir`, `findSkillDir`, `getSkillName`, `installToAgent`, `listSkillsInDir`, `resolveAgents`, `promptAgentSelection`, `printResult`, `getHomedir`).
- `package.json` / `package-lock.json` — dependency audit (`npm audit`), published file list (`files`), lifecycle scripts, engines floor.
- README claims vs. behavior — only claims that were themselves security statements (private-repo token handling, install behavior).
- `skill/` and `.agents/` markdown — reviewed for dangerous embedded commands (see §10).
- Installed dependency internals: `node-tar` 7.5.19/7.5.22 protections and `fs-extra` copy semantics were read from the installed packages to verify real (not assumed) behavior.

---

## Findings and fixes

### F1. CRITICAL — Tar extraction: path traversal / symlink escape / tar-bomb (untrusted repo content)
**Where:** `downloadGitHubRepo` → `tarExtract({ cwd: tmpDir, strip: 1 })` (original `bin/cli.js`, `downloadGitHubRepo` function).
**Exploit sketch:** Any user runs `npx fireskill add attacker/repo`. The repo tarball is attacker-controlled. A crafted tarball containing `../`-prefixed entries, absolute paths, or symlink entries pointing outside the extraction root could write or create links outside the temp dir; on the default (non-strict) tar mode such entries are merely skipped with warnings, and a symlink that points outside the root survives into the extracted tree. Combined with the subsequent `fs.copy(skillDir, targetDir)` (see F6), a link or file can reach arbitrary locations on the user's machine.
**Fix (layers, each independently sufficient):**
1. `extractAndValidateArchive()` now extracts with `strict: true`, `preservePaths: false`, and `strip: 1`. Verified against the installed `node-tar` 7.5.22 source: `..`-containing paths, extraction-through-symlink parents, absolute paths, and depth > 1024 all abort extraction in strict mode. (`tar`'s `filter`/`files` options are deliberately not used; they carry their own DoS advisory — see F8.)
2. `createAutoGunzip()` — gunzip only when the stream actually carries gzip magic; a hostile server serving plain tar is still parsed safely.
3. Entry-count cap (`MAX_ARCHIVE_ENTRIES = 100 000`) enforced on the extractor's `entry` events; uncompressed byte cap (`MAX_ARCHIVE_BYTES = 1 GiB`) enforced by a counting transform mid-pipeline.
4. `assertRepoContained()` — a post-extraction walk that lstat-bases every entry without following links, `realpath()`-checks every symlink target against the extraction root (dangling links are unlinked; links resolving to the root itself or outside are rejected), and rejects unsupported entry types. This independently proves that nothing on disk resolves outside the extraction dir.
5. Hard wall-clock deadline (`EXTRACT_TIMEOUT_MS`, 10 min) on the entire download+extract operation for the `add` flow and on the extraction pipeline itself, aborting the in-flight HTTPS request and the tar stream; the temp dir is removed on every failure path and the command fails with a clear timeout error. This bounds node-tar 7.5.x async-unpack deadlocks on crafted symlink shapes, which otherwise leave `add` spinning forever.
6. Symlink entries whose linkname resolves to the link's own ancestor or itself (e.g. `skill/self -> skill`) are rejected at the `entry` event before materialization — the exact class that deadlocks node-tar's unpack or materializes infinite link chains — while benign contained links (file/sibling targets) still extract and are dereferenced at copy time.
**Tests:** `test/security.test.js` — hostile `../` tarball, absolute-path tarball, escaping symlink, entry-count/byte caps, dangling-symlink removal, ancestor/self-referencing symlink rejection, non-terminating stream deadline, benign extraction.

### F2. CRITICAL — Skill-name path traversal into agent config dirs
**Where:** `add` (name from frontmatter / `--name` / repo fallback) and `remove <skill-name>`; `sanitizeSkillName` existed but was the whole defense.
**Exploit sketch:** An attacker-controlled repo supplies `name: ../../.ssh/evil` in SKILL.md frontmatter (or a user passes `--name '../x'` / `remove '..'`). The old sanitizer replaced bad chars with `-` (so `../x` → `--x`, contained), but a name that sanitizes to empty (e.g. `remove ''-ish` or a name of only invalid chars) joined onto the base dir would target the base dir itself — `remove` with an empty skill name resolved to the entire `~/.claude/skills` directory and deleted it. The sanitizer alone is not a hard guarantee (it was the only layer, and several edge shapes were not covered: `'', '.', '..'`, all-dash, Windows reserved names, >100 chars).
**Fix:**
- `sanitizeSkillName()` keeps the legacy transform (chars outside `[a-zA-Z0-9_-]` → `-`, lowercased) so installed names don't change, but now rejects: empty, `.`, `..`, all-dash, >100 chars, and Windows reserved names (`con`, `prn`, `aux`, `nul`, `com[1-9]`, `lpt[1-9]`, with extensions).
- `resolveSafeSkillTarget()` is a hard containment gate used by BOTH `installToAgentDir()` and `removeAgentSkillDir()`: it resolves the base, resolves the target, and throws unless the target is strictly inside the resolved base — before any write or any delete. It also refuses path separators/`\0` in names and refuses to operate through a symlink planted at the exact target path.
**Tests:** traversal-shaped names (install + remove), empty/dot names, reserved names, length caps, symlink-at-target refusal, round-trip install/remove.

### F3. CRITICAL — Deletion path abuse (`remove` / `uninstall`)
**Where:** `remove` and `uninstall` handlers.
**Exploit sketch:** `remove` previously did `path.join(baseDir, sanitized)` then `fs.remove(target)` with no containment proof and no directory check — an empty/odd name could resolve to the base dir itself (deleting every installed skill) or, via a symlinked base component, delete something outside the skills tree.
**Fix:** `removeAgentSkillDir()` goes through `resolveSafeSkillTarget()` (containment), requires the target to be an existing real directory (refuses symlinks and non-directories), and never falls back to deleting anything else on weird resolution. `uninstall` uses the same path with the fixed name `fireskill`. `remove` of a missing skill still reports the friendly "not found" (no deletion).
**Tests:** base-dir self-deletion attempt, symlink refusal, keep-other-skills assertion.

### F4. HIGH — GitHub redirect following + token leakage off-host
**Where:** `downloadGitHubRepo`'s redirect loop re-attached `Authorization: Bearer <GH_TOKEN/GITHUB_TOKEN>` to every hop, with no host, scheme, or count validation before following `Location`.
**Exploit sketch:** A malicious/compromised repo can't control api.github.com's `Location` alone, but a MITM or a mis-configured proxy/cache serving redirects (or GitHub-side compromise) can redirect to `http://evil.example/...`; the token is then re-sent verbatim to the third party. Redirect chains were also unbounded.
**Fix (testable pure functions):**
- `ALLOWED_DOWNLOAD_HOSTS` allowlist: `github.com`, `api.github.com`, `codeload.github.com`, `objects.githubusercontent.com`, `raw.githubusercontent.com`.
- `validateDownloadUrl()` — https-only + allowlisted host, checked before ANY request.
- `buildRequestOptions()` — the `Authorization` header is attached only when the request hostname is in the allowlist.
- `resolveRedirectUrl()` — every redirect must be https, allowlisted, and credential-free; capped at `MAX_REDIRECTS = 5`; relative `Location` values resolve against the already-validated URL.
**Tests:** token present on GitHub hosts, absent on evil hosts; redirects to non-https/off-allowlist/embedded-credentials rejected; relative redirects accepted; first-hop validation.

### F5. HIGH — Predictable temp dir (symlink race / multi-user host)
**Where:** `os.tmpdir() + 'fireskill-' + owner + '-' + repo + '-' + Date.now()` (predictable; attacker can pre-create as a symlink so extraction/copy writes elsewhere). Temp dirs were also leaked on several error branches (`process.exit` before cleanup, RETRY path, extraction failure).
**Fix:** `createSecureTempDir()` uses `fs.mkdtemp` (unpredictable random suffix) with an explicit `chmod 0700`; the `add` handler wraps download→find→install in `try/finally` so the temp dir is always removed; `downloadAndExtractGitHub()` also cleans up after itself on failure. All `process.exit(...)` calls were replaced with `process.exitCode = 1; return;` so pending `finally` cleanup always runs.
**Tests:** unique dirs across calls, mode `0700` (POSIX), cleanup verified in the end-to-end flow test; live smoke confirmed zero `/tmp/fireskill-*` leftovers across success and all failure flows.

### F6. HIGH — Symlink abuse in downloaded content at copy time
**Where:** `findSkillDir` + `fs.copy(sourceDir, targetDir, { overwrite: true })`.
**Exploit sketch:** The old `fs.copy` (default `dereference: false`) copied symlinks from the repo verbatim into the user's agent config dirs. A repo-committed symlink pointing outside the skill tree would survive into the installed skill (and any later agent read of that path would follow it). Because GitHub tarballs preserve committed symlinks, this was reachable without any tar-level bypass.
**Fix:** (1) `assertRepoContained()` guarantees every surviving symlink resolves inside the extraction root (F1.4); (2) the install copy runs with `dereference: true`, so no symlink is ever materialized into the user's directories — links become real files/dirs whose content was validated as contained. Dangling links never reach the copy step (removed during validation).
**Tests:** contained symlink dereferences to a real file in the installed skill (no links survive), escaping symlink aborts, dangling symlink is dropped, end-to-end archive→find→install.

### F7. HIGH — Repo/owner/branch parsing accepted hostile components
**Where:** `parseGitHubId` — `owner`, `repo`, `branch` flowed into URL paths and (for the name fallback) into file-system names without validation.
**Exploit sketch:** inputs like `../x/y`, `a/../../b`, control characters, `%2e%2e` style fragments, or branch values containing `/`, `?`, `#`, `%` could shape the request URL/redirect path or the installed name — smuggling path components into either the download request or the filesystem.
**Fix:** each component is now validated: owner ≤ 64 and repo ≤ 100 chars of `[A-Za-z0-9._-]` starting alphanumeric, no `.`/`..`/`..` sequences; branch ≤ 100 chars of `[A-Za-z0-9._/-]` with no empty/`..` segments, no `//`, no `..`; total id ≤ 200; anything else → `null` → "Invalid format" error.
**Tests:** table of malformed ids (traversal, separators, control bytes, over-length, percent-encoding) all rejected; valid ids (including `owner/repo#feature/x` branches) accepted.

### F8. MEDIUM — Dependency: node-tar DoS advisory (GHSA-r292-9mhp-454m)
**Where:** `package.json` — `tar ^7.4.0` resolved to 7.5.19, inside the vulnerable range `<=7.5.20` (uncontrolled recursion in `mapHas`/`filesFilter` — uncatchable stack-overflow DoS via crafted long-path tar when `filter`/`files` member-selection options are used, CWE-400/674).
**Exploit sketch:** discharge requires the `filter`/`files` tar options; this codebase did not and does not use them, so the concrete vector was not reachable — but the direct dependency was in a vulnerable range.
**Fix:** `tar` bumped to `^7.5.22` (latest, outside the vulnerable range). Verified resolved `node_modules/tar@7.5.22`, `npm audit` = **0 vulnerabilities**. The extraction code also documents why `filter`/`files` are avoided (they are the advisory's trigger surface) — a defense-in-depth note against future regressions.
**Record:** `npm audit` (fresh, after fix): `found 0 vulnerabilities`.

### F9. MEDIUM — Unbounded reads / unbounded archive → memory & disk DoS
**Where:** `getSkillName` read the entire untrusted SKILL.md into memory; archive extraction had no size/entry bounds.
**Fix:** frontmatter read capped at `MAX_FRONTMATTER_BYTES = 64 KiB` via a positional `fd.read`; archive extraction capped by entry count and uncompressed byte count (F1.3). Skill-name length capped (F2).
**Tests:** 5 MB SKILL.md → name still read from bounded prefix; entry-count/byte caps covered.

### F10. INFO — Skill content review (`skill/`, `.agents/`)
Reviewed all markdown for instructions that would make an agent execute unsanitized commands. `skill/` content is descriptive (no shell snippets). `.agents/skills/firecrawl/SKILL.md` is Firecrawl's own onboarding skill; it includes standard patterns such as `echo "FIRECRAWL_API_KEY=fc-..." >> .env` (storing the user's own key in the project env file) and `curl`-free auth flows. No remote-exec, exfiltration, or destructive instructions found. Not rewritten per scope. Note: this file is NOT shipped in the npm package (`files` whitelist excludes `.agents/`).

### F11. LOW — Hygiene / misc
**Where:** various.
- `import { execSync } from 'child_process'` was unused (dead import) — removed. Dead `downloadGitHubRepo` RETRY branch in the `add` handler — removed in favor of a single clean path; the visible "Trying master branch…" UX is preserved.
- `package.json` `repository.url` was empty — set to `git+https://github.com/idevakk/fireskill.git`.
- No lifecycle scripts anywhere (no `preinstall`/`postinstall`); confirmed.
- `files` ships exactly `bin/`, `skill/`, `README.md`, `LICENSE`, and `package.json` (verified with `npm pack --dry-run`; `.agents/` and `test/` are not published).
- `process.exit` replaced with `process.exitCode` so cleanup finalizers run (F5).
- Error messages never echo the request URL (which for GitHub tarball redirects can carry a short-lived signed token) — download errors show only status codes and safe context.

### F12. INFO — Residual risks (documented, accepted)
1. **Local same-host adversary** with write access to the user's agent config dirs or `$TMPDIR` can race the check-then-act windows (`lstat` after `ensureDir`, `realpath` walks) or pre-plant files there; that adversary already controls the account. We defend the final-target symlink case and contain every write to the resolved base, but a determined local attacker with the user's privileges is out of scope.
2. **Base-dir symlinks**: a legitimately symlinked agent config dir (e.g. `~/.claude` → a dotfiles repo) is resolved through `realpath` and containment is enforced against the resolved base — by design. An attacker-planted symlink replacing the user's own `~/.claude/skills` would redirect installs into the target; since that path is the user's persistent configuration, we treat it as user intent (documented).
3. **Multi-level `..` symlinks committed in repos**: a repo symlink like `docs/foo -> ../../README.md` that resolves outside the stripped extraction namespace is rejected (extraction aborts). Repos shipping such links (usually accidental) will fail the install with an explicit error; single-level `..` links inside the repo tree are supported.
4. **Skill content is still untrusted instructions**: an installed skill can instruct an agent to run commands. This is inherent to the product (installing skills), is the same trust model as the Anthropic/OpenAI skill ecosystems, and is documented in the README trust model; the CLI itself never executes repo content.

---

## Test suite

`test/security.test.js` (27 tests, offline, `npm test`): crafted malicious tarballs (`../` entries, absolute paths, hostile symlinks, dangling symlinks, oversized counts/bytes) cannot write or read outside the extraction dir; traversal-shaped skill names on add+remove cannot escape the agent skill base; the token is never attached off-allowlist; temp dirs are unique and mode 0700; malformed repo ids are rejected; install/remove/list behave correctly against fixtures with a sandboxed `HOME`; symlinks never survive into installed skills.

Live smoke (real GitHub, sandboxed HOME): `install`, `add idevakk/fireskill`, `list`, `remove`, `uninstall`, bad-branch not-found message, invalid repo ids — all behave as documented, exit codes correct, zero temp-dir leaks.

## npm audit (final)

```
found 0 vulnerabilities
```