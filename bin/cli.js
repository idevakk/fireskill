#!/usr/bin/env node

/**
 * FireSkill CLI — Install AI agent skills from npm or GitHub.
 *
 * Usage:
 *   npx fireskill install                        → Install FireSkill's built-in meta-skill (interactive)
 *   npx fireskill install --agent gemini --global → Install for specific agent globally
 *   npx fireskill add owner/repo                  → Install any skill from a GitHub repo
 *   npx fireskill add owner/repo --agent claude   → Install GitHub skill for specific agent
 *   npx fireskill remove owner/repo               → Remove a GitHub-installed skill
 *   npx fireskill uninstall                       → Remove FireSkill's built-in meta-skill
 *   npx fireskill list                            → List all installed skills
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import ora from 'ora';
import https from 'https';
import { createGunzip } from 'zlib';
import { pipeline } from 'stream/promises';
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

// ─── GitHub Utilities ──────────────────────────────────────────────────────────

/**
 * Parse a GitHub identifier like "owner/repo" or "owner/repo#branch"
 */
function parseGitHubId(id) {
  const match = id.match(/^([^/]+)\/([^#]+)(?:#(.+))?$/);
  if (!match) return null;
  return { owner: match[1], repo: match[2], branch: match[3] || 'main' };
}

/**
 * Download and extract a GitHub repo tarball to a temp directory.
 * Returns the path to the extracted content.
 */
async function downloadGitHubRepo(owner, repo, branch) {
  const url = `https://api.github.com/repos/${owner}/${repo}/tarball/${branch}`;
  const tmpDir = path.join(os.tmpdir(), `fireskill-${owner}-${repo}-${Date.now()}`);
  await fs.ensureDir(tmpDir);

  return new Promise((resolve, reject) => {
    const makeRequest = (requestUrl, redirectCount = 0) => {
      if (redirectCount > 5) {
        reject(new Error('Too many redirects'));
        return;
      }

      const urlObj = new URL(requestUrl);
      const options = {
        hostname: urlObj.hostname,
        path: urlObj.pathname + urlObj.search,
        headers: {
          'User-Agent': 'fireskill-cli',
          'Accept': 'application/vnd.github+json',
        }
      };

      // Add GitHub token if available (for private repos)
      const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
      if (token) {
        options.headers['Authorization'] = `Bearer ${token}`;
      }

      https.get(options, (res) => {
        // Handle redirects (GitHub always redirects tarball URLs)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          makeRequest(res.headers.location, redirectCount + 1);
          return;
        }

        if (res.statusCode === 404) {
          // Try 'master' branch if 'main' failed
          if (branch === 'main') {
            reject(new Error('RETRY_MASTER'));
          } else {
            reject(new Error(`Repository not found: ${owner}/${repo} (branch: ${branch})`));
          }
          return;
        }

        if (res.statusCode !== 200) {
          reject(new Error(`GitHub API returned ${res.statusCode}`));
          return;
        }

        // Extract tarball
        const extractStream = tarExtract({
          cwd: tmpDir,
          strip: 1 // Remove the top-level directory from the archive
        });

        pipeline(res, createGunzip(), extractStream)
          .then(() => resolve(tmpDir))
          .catch(reject);
      }).on('error', reject);
    };

    makeRequest(url);
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
 * Extract skill name from SKILL.md frontmatter
 */
async function getSkillName(skillDir) {
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (!await fs.pathExists(skillMd)) return null;

  const content = await fs.readFile(skillMd, 'utf-8');
  const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!frontmatterMatch) return null;

  const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)$/m);
  return nameMatch ? nameMatch[1].trim() : null;
}

// ─── Install Functions ─────────────────────────────────────────────────────────

async function installToAgent(sourceDir, skillName, agentKey, isGlobal) {
  const agent = AGENTS[agentKey];
  const baseDir = isGlobal
    ? agent.globalSkillDir()
    : agent.localSkillDir(process.cwd());
  const targetDir = path.join(baseDir, skillName);

  const spinner = ora(`Installing "${skillName}" for ${agent.name}...`).start();

  try {
    await fs.ensureDir(targetDir);
    await fs.copy(sourceDir, targetDir, { overwrite: true });
    spinner.succeed(chalk.green(`✓ "${skillName}" installed for ${agent.name} → ${targetDir}`));
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

function resolveAgents(agentFlag) {
  if (!agentFlag) return null; // trigger interactive mode
  if (agentFlag === 'all') return Object.keys(AGENTS);
  if (AGENTS[agentFlag.toLowerCase()]) return [agentFlag.toLowerCase()];
  console.log(chalk.red(`  Unknown agent: ${agentFlag}`));
  console.log(chalk.dim(`  Available: ${Object.keys(AGENTS).join(', ')}, all`));
  process.exit(1);
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
    let isGlobal = options.global || false;

    if (!selectedAgents) {
      const answers = await promptAgentSelection();
      selectedAgents = answers.agents;
      isGlobal = answers.global;
    }

    if (selectedAgents.length === 0) {
      console.log(chalk.yellow('  No agents selected. Exiting.'));
      process.exit(0);
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
      process.exit(1);
    }

    console.log(chalk.dim(`  Repository: ${chalk.white(`${ghId.owner}/${ghId.repo}`)} (branch: ${ghId.branch})`));
    console.log('');

    // Download repo
    let repoDir;
    const dlSpinner = ora('Downloading repository...').start();
    try {
      repoDir = await downloadGitHubRepo(ghId.owner, ghId.repo, ghId.branch);
      dlSpinner.succeed(chalk.green('✓ Repository downloaded'));
    } catch (err) {
      if (err.message === 'RETRY_MASTER') {
        // Retry with 'master' branch
        dlSpinner.text = 'Trying master branch...';
        try {
          ghId.branch = 'master';
          repoDir = await downloadGitHubRepo(ghId.owner, ghId.repo, 'master');
          dlSpinner.succeed(chalk.green('✓ Repository downloaded (master branch)'));
        } catch (err2) {
          dlSpinner.fail(chalk.red(`✗ Failed to download: ${err2.message}`));
          process.exit(1);
        }
      } else {
        dlSpinner.fail(chalk.red(`✗ Failed to download: ${err.message}`));
        console.log('');
        console.log(chalk.dim('  Tips:'));
        console.log(chalk.dim('  • Check the repo exists and is public'));
        console.log(chalk.dim('  • For private repos, set GITHUB_TOKEN or GH_TOKEN env variable'));
        console.log(chalk.dim('  • Specify a branch: owner/repo#branch-name'));
        process.exit(1);
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
      await fs.remove(repoDir);
      process.exit(1);
    }
    findSpinner.succeed(chalk.green('✓ Skill found'));

    // Determine skill name
    let skillName = options.name || await getSkillName(skillDir) || ghId.repo;
    skillName = skillName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();
    console.log(chalk.dim(`  Skill name: ${chalk.white(skillName)}`));
    console.log('');

    // Agent selection
    let selectedAgents = resolveAgents(options.agent);
    let isGlobal = options.global || false;

    if (!selectedAgents) {
      const answers = await promptAgentSelection();
      selectedAgents = answers.agents;
      isGlobal = answers.global;
    }

    if (selectedAgents.length === 0) {
      console.log(chalk.yellow('  No agents selected. Exiting.'));
      await fs.remove(repoDir);
      process.exit(0);
    }

    console.log('');

    // Install
    let successCount = 0;
    for (const agentKey of selectedAgents) {
      const ok = await installToAgent(skillDir, skillName, agentKey, isGlobal);
      if (ok) successCount++;
    }

    // Cleanup temp dir
    await fs.remove(repoDir);

    printResult(successCount, selectedAgents.length);
    console.log(chalk.dim(`  Installed from: ${chalk.white(`github.com/${ghId.owner}/${ghId.repo}`)}`));
    console.log('');
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

    skillName = skillName.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase();

    let selectedAgents = resolveAgents(options.agent);
    let isGlobal = options.global || false;

    if (!selectedAgents) {
      const answers = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'agents',
          message: `Remove "${skillName}" from which agents?`,
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
      const targetDir = path.join(baseDir, skillName);

      const spinner = ora(`Removing "${skillName}" from ${agent.name}...`).start();
      if (await fs.pathExists(targetDir)) {
        try {
          await fs.remove(targetDir);
          spinner.succeed(chalk.green(`✓ Removed "${skillName}" from ${agent.name}`));
        } catch (err) {
          spinner.fail(chalk.red(`✗ Failed: ${err.message}`));
        }
      } else {
        spinner.warn(chalk.yellow(`⊘ "${skillName}" not found for ${agent.name}`));
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
      const targetDir = path.join(baseDir, 'fireskill');

      const spinner = ora(`Removing FireSkill from ${agent.name}...`).start();
      if (await fs.pathExists(targetDir)) {
        try {
          await fs.remove(targetDir);
          spinner.succeed(chalk.green(`✓ Removed from ${agent.name}`));
        } catch (err) {
          spinner.fail(chalk.red(`✗ Failed: ${err.message}`));
        }
      } else {
        spinner.warn(chalk.yellow(`⊘ FireSkill not found for ${agent.name}`));
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

    const selectedAgents = resolveAgents(options.agent) || Object.keys(AGENTS);
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

program.parse();
