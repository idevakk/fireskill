# 🔥 FireSkill

**Transform scattered knowledge into production-ready AI agent skills.**

FireSkill is a meta-skill that extracts genuine expertise from multiple sources (websites, YouTube videos, Instagram posts, documentation), authenticates every claim through cross-referencing and verification, and produces a polished, production-ready AI agent skill — complete with confidence scoring and source citations.

**Also a universal skill installer** — install any AI skill from GitHub into any agent with one command.

---

## ✨ What It Does

1. **Extracts** content from any URL — websites, YouTube, Instagram, Shorts, docs
2. **Cross-references** claims across all sources to find consensus
3. **Verifies** against official documentation and authoritative sources
4. **Scores** every piece of advice (🟢 HIGH / 🟡 MEDIUM / 🟠 LOW / 🔴 REJECTED)
5. **Filters** out BS, fluff, and unverified claims
6. **Generates** production-ready skills for your AI agent of choice

## 🤖 Supported Agents

| Agent | Format | Output |
|-------|--------|--------|
| **Universal** | Markdown | Always generated — works with any AI |
| **Gemini / Antigravity** | SKILL.md + YAML frontmatter | Full skill directory with references/ |
| **Claude Code** | SKILL.md / CLAUDE.md | Claude-optimized instructions |
| **Cursor** | .cursorrules | Single-file rules format |
| **Windsurf** | .windsurfrules | Windsurf rules format |
| **OpenAI / ChatGPT** | Custom instructions | Formatted for ChatGPT's system |

---

## 📦 Installation

### Install FireSkill's Built-in Meta-Skill

```bash
# Interactive (choose agents + global/local)
npx fireskill install

# Specific agent, globally
npx fireskill install --agent gemini --global

# All agents, locally
npx fireskill install --agent all
```

### Install Any Skill from GitHub

```bash
# Install a skill from any GitHub repo
npx fireskill add owner/repo-name

# Install for a specific agent
npx fireskill add owner/repo-name --agent claude --global

# Install from a specific branch
npx fireskill add owner/repo-name#dev

# Install for all agents globally
npx fireskill add owner/repo-name --agent all --global
```

The `add` command:
1. Downloads the repo tarball from GitHub
2. Finds the `skill/` directory (or `SKILL.md` at root)
3. Reads the skill name from SKILL.md frontmatter
4. Copies it to the correct location for your chosen agent(s)

> **Private repos**: Set `GITHUB_TOKEN` or `GH_TOKEN` environment variable.

---

## 🔧 All Commands

| Command | Description |
|---------|-------------|
| `npx fireskill install` | Install FireSkill's built-in meta-skill |
| `npx fireskill add owner/repo` | Install any skill from GitHub |
| `npx fireskill remove skill-name` | Remove an installed skill by name |
| `npx fireskill uninstall` | Remove FireSkill's built-in meta-skill |
| `npx fireskill list` | List all installed skills |

### Command Options

| Flag | Description |
|------|-------------|
| `-g, --global` | Install/remove from global config (all projects) |
| `-a, --agent <name>` | Target agent: `gemini`, `claude`, `cursor`, `windsurf`, `openai`, `all` |
| `-n, --name <name>` | Override skill name (for `add` command) |

---

## 🚀 Usage (After Installing the Meta-Skill)

Tell your AI agent:

```
Use the FireSkill skill to build a [TOPIC] skill from these sources:
- https://example.com/article
- https://www.youtube.com/watch?v=VIDEO_ID
- https://www.instagram.com/p/POST_ID/
- [more URLs...]

Target audience: [Beginner / Intermediate / Advanced / All]
Output format: [gemini / claude / cursor / windsurf / openai / all / universal]
```

### Example
```
Use FireSkill to build an SEO skill from these sources:
- https://developers.google.com/search/docs
- https://www.youtube.com/watch?v=abc123
- https://moz.com/beginners-guide-to-seo
- https://www.instagram.com/p/seo_tips/

Target: All levels
Format: Gemini + Claude
```

---

## 📁 What Gets Generated

FireSkill produces a complete skill directory:

```
generated-skill/
├── SKILL.md                    # Core skill (Gemini format)
├── CLAUDE.md                   # Claude format
├── .cursorrules                # Cursor format
├── .windsurfrules              # Windsurf format
├── openai_instructions.md      # OpenAI format
├── universal_skill.md          # Universal format (always)
├── references/
│   ├── source_citations.md     # All sources with credibility notes
│   ├── rejected_claims.md      # Filtered-out claims with reasons
│   └── confidence_report.md    # Full scoring breakdown
├── examples/
│   ├── usage_scenarios.md      # How to use the generated skill
│   └── sample_output.md        # Expected output examples
└── metadata.json               # Skill metadata
```

---

## 🔍 How Authentication Works

Every claim goes through a rigorous verification pipeline:

```
Source Extraction → Cross-Reference Matrix → External Verification → Confidence Scoring
```

### Confidence Levels

| Level | Badge | Criteria |
|-------|-------|----------|
| HIGH | 🟢 | 3+ sources agree + official docs confirm + no contradictions |
| MEDIUM | 🟡 | 2+ sources OR official docs, minor caveats |
| LOW | 🟠 | Single source, unverified, or outdated |
| REJECTED | 🔴 | Contradicted by official sources or demonstrably wrong |

Only HIGH and MEDIUM claims make it into the final skill. LOW claims are included with explicit warnings. REJECTED claims are documented in a "Myths & Misconceptions" section.

---

## 📝 Making Your Own Skill Installable via FireSkill

Want others to install YOUR skill with `npx fireskill add your-name/your-repo`?

Structure your repo like this:

```
your-repo/
├── skill/
│   ├── SKILL.md          # Required — must have name in YAML frontmatter
│   ├── references/       # Optional — supporting documentation
│   ├── examples/         # Optional — usage examples
│   └── scripts/          # Optional — helper scripts
├── README.md
└── ...
```

The only requirement is a `SKILL.md` with YAML frontmatter containing a `name` field:

```yaml
---
name: my-awesome-skill
description: What this skill does and when to use it
---
```

FireSkill will find it automatically in `skill/`, `skills/`, `.skill/`, or the repo root.

---

## 🔧 Prerequisites

- **Node.js 18+**: Required for the CLI
- **Firecrawl API Key** (optional): For the meta-skill's content extraction
  - Set as environment variable: `FIRECRAWL_API_KEY`
  - Falls back to built-in tools if unavailable

---

## 🗑️ Uninstall

```bash
# Remove FireSkill's built-in meta-skill
npx fireskill uninstall

# Remove a specific installed skill
npx fireskill remove skill-name
```

---

## 📋 Project Structure

```
fireskill/
├── bin/
│   └── cli.js                          # CLI with install/add/remove/list
├── skill/
│   ├── SKILL.md                        # Core meta-skill instructions
│   ├── references/
│   │   ├── extraction_protocol.md      # Source extraction patterns
│   │   ├── authentication_framework.md # Verification & scoring
│   │   └── output_formats.md           # Agent format templates
│   ├── examples/
│   │   ├── seo_skill_example.md        # Sample generated skill
│   │   └── sample_prompts.md           # Example usage prompts
│   └── scripts/
│       └── firecrawl_extract.md        # Firecrawl patterns
├── package.json
├── README.md
└── LICENSE
```

---

## 🤝 Contributing

1. Fork this repo
2. Create a feature branch
3. Make your changes
4. Submit a Pull Request

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
