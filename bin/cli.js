#!/usr/bin/env node

/**
 * SkillForge CLI — Install the SkillForge meta-skill into any project or globally.
 *
 * Usage:
 *   npx skillforge install              → Interactive installer
 *   npx skillforge install --global     → Install to global ~/.gemini/config/skills/
 *   npx skillforge install --agent gemini  → Install for specific agent
 *   npx skillforge install --agent claude  → Install for Claude Code
 *   npx skillforge install --agent all     → Install for all agents
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import ora from 'ora';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PACKAGE_ROOT = path.resolve(__dirname, '..');

const AGENTS = {
  gemini: {
    name: 'Antigravity / Gemini',
    globalPath: () => path.join(getHomedir(), '.gemini', 'config', 'skills', 'skillforge'),
    localPath: (cwd) => path.join(cwd, '.agents', 'skills', 'skillforge'),
    files: ['skill/SKILL.md', 'skill/references/extraction_protocol.md', 'skill/references/authentication_framework.md', 'skill/references/output_formats.md', 'skill/examples/seo_skill_example.md', 'skill/examples/sample_prompts.md', 'skill/scripts/firecrawl_extract.md']
  },
  claude: {
    name: 'Claude Code',
    globalPath: () => path.join(getHomedir(), '.claude', 'skills', 'skillforge'),
    localPath: (cwd) => path.join(cwd, '.claude', 'skills', 'skillforge'),
    files: ['skill/SKILL.md', 'skill/references/extraction_protocol.md', 'skill/references/authentication_framework.md', 'skill/references/output_formats.md', 'skill/examples/seo_skill_example.md', 'skill/examples/sample_prompts.md', 'skill/scripts/firecrawl_extract.md']
  },
  cursor: {
    name: 'Cursor',
    globalPath: () => path.join(getHomedir(), '.cursor', 'skills', 'skillforge'),
    localPath: (cwd) => path.join(cwd, '.cursor', 'skills', 'skillforge'),
    files: ['skill/SKILL.md', 'skill/references/extraction_protocol.md', 'skill/references/authentication_framework.md', 'skill/references/output_formats.md', 'skill/examples/seo_skill_example.md', 'skill/examples/sample_prompts.md', 'skill/scripts/firecrawl_extract.md']
  },
  windsurf: {
    name: 'Windsurf',
    globalPath: () => path.join(getHomedir(), '.windsurf', 'skills', 'skillforge'),
    localPath: (cwd) => path.join(cwd, '.windsurf', 'skills', 'skillforge'),
    files: ['skill/SKILL.md', 'skill/references/extraction_protocol.md', 'skill/references/authentication_framework.md', 'skill/references/output_formats.md', 'skill/examples/seo_skill_example.md', 'skill/examples/sample_prompts.md', 'skill/scripts/firecrawl_extract.md']
  },
  openai: {
    name: 'OpenAI / ChatGPT',
    globalPath: () => path.join(getHomedir(), '.openai', 'skills', 'skillforge'),
    localPath: (cwd) => path.join(cwd, '.openai', 'skills', 'skillforge'),
    files: ['skill/SKILL.md', 'skill/references/extraction_protocol.md', 'skill/references/authentication_framework.md', 'skill/references/output_formats.md', 'skill/examples/seo_skill_example.md', 'skill/examples/sample_prompts.md', 'skill/scripts/firecrawl_extract.md']
  }
};

function getHomedir() {
  return process.env.HOME || process.env.USERPROFILE || '';
}

async function installSkill(targetDir, agentName) {
  const spinner = ora(`Installing SkillForge for ${agentName}...`).start();

  try {
    const skillSourceDir = path.join(PACKAGE_ROOT, 'skill');

    // Copy the entire skill directory
    await fs.ensureDir(targetDir);
    await fs.copy(skillSourceDir, targetDir, { overwrite: true });

    spinner.succeed(chalk.green(`✓ SkillForge installed for ${agentName} → ${targetDir}`));
    return true;
  } catch (err) {
    spinner.fail(chalk.red(`✗ Failed to install for ${agentName}: ${err.message}`));
    return false;
  }
}

const program = new Command();

program
  .name('skillforge')
  .description('Install the SkillForge meta-skill for AI agent knowledge extraction and skill building.')
  .version('1.0.0');

program
  .command('install')
  .description('Install SkillForge skill files')
  .option('-g, --global', 'Install to global agent config directory')
  .option('-a, --agent <agent>', 'Target agent: gemini, claude, cursor, windsurf, openai, all')
  .action(async (options) => {
    console.log('');
    console.log(chalk.bold.cyan('  ⚒️  SkillForge Installer'));
    console.log(chalk.dim('  ─────────────────────────────────────'));
    console.log('');

    let selectedAgents = [];
    let isGlobal = options.global || false;

    // If agent specified via flag
    if (options.agent) {
      if (options.agent === 'all') {
        selectedAgents = Object.keys(AGENTS);
      } else if (AGENTS[options.agent.toLowerCase()]) {
        selectedAgents = [options.agent.toLowerCase()];
      } else {
        console.log(chalk.red(`  Unknown agent: ${options.agent}`));
        console.log(chalk.dim(`  Available: ${Object.keys(AGENTS).join(', ')}, all`));
        process.exit(1);
      }
    } else {
      // Interactive mode
      const answers = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'agents',
          message: 'Which AI agents should SkillForge be installed for?',
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

      selectedAgents = answers.agents;
      isGlobal = answers.global;
    }

    if (selectedAgents.length === 0) {
      console.log(chalk.yellow('  No agents selected. Exiting.'));
      process.exit(0);
    }

    console.log('');

    let successCount = 0;
    for (const agentKey of selectedAgents) {
      const agent = AGENTS[agentKey];
      const targetDir = isGlobal
        ? agent.globalPath()
        : agent.localPath(process.cwd());

      const ok = await installSkill(targetDir, agent.name);
      if (ok) successCount++;
    }

    console.log('');
    if (successCount === selectedAgents.length) {
      console.log(chalk.bold.green('  ✅ All installations complete!'));
    } else {
      console.log(chalk.yellow(`  ⚠ ${successCount}/${selectedAgents.length} installations succeeded.`));
    }

    console.log('');
    console.log(chalk.dim('  Usage: Tell your AI agent:'));
    console.log(chalk.white('  "Use the SkillForge skill to build an SEO skill from these sources: [links]"'));
    console.log('');
  });

program
  .command('uninstall')
  .description('Remove SkillForge skill files')
  .option('-g, --global', 'Uninstall from global agent config directory')
  .option('-a, --agent <agent>', 'Target agent: gemini, claude, cursor, windsurf, openai, all')
  .action(async (options) => {
    console.log('');
    console.log(chalk.bold.red('  🗑️  SkillForge Uninstaller'));
    console.log('');

    let selectedAgents = [];
    let isGlobal = options.global || false;

    if (options.agent) {
      selectedAgents = options.agent === 'all' ? Object.keys(AGENTS) : [options.agent.toLowerCase()];
    } else {
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
      const targetDir = isGlobal
        ? agent.globalPath()
        : agent.localPath(process.cwd());

      const spinner = ora(`Removing SkillForge for ${agent.name}...`).start();
      try {
        await fs.remove(targetDir);
        spinner.succeed(chalk.green(`✓ Removed for ${agent.name}`));
      } catch (err) {
        spinner.fail(chalk.red(`✗ Failed: ${err.message}`));
      }
    }
    console.log('');
  });

program.parse();
