# ⚒️ SkillForge

**Transform scattered knowledge into production-ready AI agent skills.**

SkillForge is a meta-skill that extracts genuine expertise from multiple sources (websites, YouTube videos, Instagram posts, documentation), authenticates every claim through cross-referencing and verification, and produces a polished, production-ready AI agent skill — complete with confidence scoring and source citations.

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

### Quick Install (npx)
```bash
npx skillforge install
```

This launches an interactive installer that lets you choose:
- Which AI agents to install for
- Whether to install globally or project-locally

### Install for Specific Agent
```bash
npx skillforge install --agent gemini --global
npx skillforge install --agent claude
npx skillforge install --agent all --global
```

### Manual Install
Clone this repo and copy the `skill/` directory to your agent's skill location:

```bash
# For Gemini/Antigravity (global)
cp -r skill/ ~/.gemini/config/skills/skillforge/

# For Claude Code (project)
cp -r skill/ .claude/skills/skillforge/

# For Cursor (project)
cp -r skill/ .cursor/skills/skillforge/
```

---

## 🚀 Usage

After installation, tell your AI agent:

```
Use the SkillForge skill to build a [TOPIC] skill from these sources:
- https://example.com/article
- https://www.youtube.com/watch?v=VIDEO_ID
- https://www.instagram.com/p/POST_ID/
- [more URLs...]

Target audience: [Beginner / Intermediate / Advanced / All]
Output format: [gemini / claude / cursor / windsurf / openai / all / universal]
```

### Example
```
Use SkillForge to build an SEO skill from these sources:
- https://developers.google.com/search/docs
- https://www.youtube.com/watch?v=abc123
- https://moz.com/beginners-guide-to-seo
- https://www.instagram.com/p/seo_tips/

Target: All levels
Format: Gemini + Claude
```

---

## 📁 What Gets Generated

SkillForge produces a complete skill directory:

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

## 🔧 Prerequisites

- **Firecrawl API Key**: SkillForge uses [Firecrawl](https://firecrawl.dev) for web content extraction
  - Set as environment variable: `FIRECRAWL_API_KEY`
  - Falls back to built-in tools if Firecrawl is unavailable
- **Node.js 18+**: Required for the CLI installer

---

## 🗑️ Uninstall

```bash
npx skillforge uninstall
```

Or manually delete the `skillforge/` directory from your agent's skills folder.

---

## 📋 Skill Structure

SkillForge itself is structured as:

```
skill/
├── SKILL.md                          # Core meta-skill instructions
├── references/
│   ├── extraction_protocol.md        # How to extract from each source type
│   ├── authentication_framework.md   # How to verify and score claims
│   └── output_formats.md            # Templates for each agent format
├── examples/
│   ├── seo_skill_example.md         # Sample generated skill
│   └── sample_prompts.md            # Example usage prompts
└── scripts/
    └── firecrawl_extract.md         # Firecrawl-specific patterns
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
