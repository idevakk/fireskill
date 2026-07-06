# Output Formats — Agent-Specific Skill Templates

## Overview
This document defines the exact output format for each supported AI agent platform.
When generating a skill, the agent MUST follow the format specification for each selected target.

The **Universal** format is ALWAYS generated regardless of other selections.

---

## 1. Universal Format (`universal_skill.md`)

This is a standalone markdown document that any AI (or human) can use.

### Structure:
```markdown
# [Skill Name] — Expert Knowledge Skill

> **Topic**: [e.g., SEO, Email Marketing]
> **Audience**: [Beginners / Intermediate / Advanced / All]
> **Sources**: [N] sources processed, [N] claims verified
> **Generated**: [Date] by FireSkill
> **Confidence**: [X]% HIGH, [X]% MEDIUM, [X]% LOW
> **Refresh by**: [Date — typically 6-12 months after generation]

---

## Purpose
[2-3 sentences: What this skill enables. What expertise it encapsulates.]

## When to Use This Skill
- [Trigger condition 1]
- [Trigger condition 2]

## When NOT to Use This Skill
- [Anti-trigger 1]
- [Anti-trigger 2]

---

## Core Knowledge

### [Category 1: e.g., Technical Foundations]

#### [Subcategory if needed]

**[Specific advice/instruction]** 🟢
[Detailed explanation with actionable steps]
- Step 1: ...
- Step 2: ...
> Sources: [S001], [S003], [Official Doc URL]

**[Another piece of advice]** 🟡
[Explanation]
> Sources: [S002] | Note: [caveat]

[...continue for all categories...]

---

## Decision Trees

### [Decision 1: e.g., "Which image format to use?"]
```
IF target is photos → Use WebP (fallback: JPEG)
ELSE IF target is graphics/logos → Use SVG (fallback: PNG)
ELSE IF target needs animation → Use WebP animated (fallback: GIF)
ELSE → Default to WebP
```

[...more decision trees...]

---

## Step-by-Step Workflows

### Workflow 1: [e.g., "Optimizing a new page for search"]
1. [Step with specific action]
2. [Step with specific action]
3. [Checkpoint: verify X]
4. [Step with specific action]
...

[...more workflows...]

---

## Anti-Patterns — What NOT to Do

| Anti-Pattern | Why It's Harmful | What to Do Instead |
|-------------|------------------|-------------------|
| [Bad practice] | [Explanation] | [Good practice] |
| ... | ... | ... |

---

## Myths & Misconceptions

| Myth | Reality | Source |
|------|---------|--------|
| "[Common misconception]" | [What's actually true] | [Official source] |
| ... | ... | ... |

---

## Experimental / Low-Confidence Tips 🟠

> ⚠️ The following advice has limited verification. Use with caution and test before committing.

1. [Tip] — Source: [single source] | Why LOW: [reason]
2. ...

---

## Source Citations

| ID | Source | Type | Author | Date | Credibility |
|----|--------|------|--------|------|-------------|
| S001 | [URL] | [type] | [name] | [date] | [HIGH/MEDIUM/LOW] |
| S002 | [URL] | [type] | [name] | [date] | [HIGH/MEDIUM/LOW] |
| ... | ... | ... | ... | ... | ... |

---

## Changelog
- v1.0 ([Date]): Initial skill generated from [N] sources
```

---

## 2. Gemini / Antigravity Format

### Directory Structure:
```
.agents/skills/{skill-name}/
├── SKILL.md              # Main skill file with YAML frontmatter
├── references/
│   ├── source_citations.md
│   ├── rejected_claims.md
│   └── confidence_report.md
└── examples/
    ├── usage_scenarios.md
    └── sample_output.md
```

### SKILL.md Template:
```markdown
---
name: [skill-name-kebab-case]
description: >
  [Concise description of what this skill does, when to trigger it,
  and when NOT to trigger it. This is used for semantic matching.]
---

# [Skill Name]

## Purpose
[2-3 sentences]

## Rules
- MUST: [imperative rule 1]
- MUST: [imperative rule 2]
- NEVER: [prohibition 1]
- NEVER: [prohibition 2]

## Core Knowledge
[Same content as universal, but formatted for Gemini's skill system]
[Reference other files: "See references/source_citations.md for full citations"]

## Workflows
[Step-by-step numbered workflows]

## Anti-Patterns
[What NOT to do]

## Confidence Notes
[Which advice is experimental vs. verified]
```

### Key Gemini-Specific Rules:
- Frontmatter MUST have `name` and `description`
- Description is the trigger — write it as "Use when... Do NOT use when..."
- Body should be < 500 lines; overflow goes to `references/`
- Use imperative language: MUST, NEVER, ALWAYS

---

## 3. Claude Code Format

### Directory Structure:
```
.claude/
└── skills/
    └── [skill-name]/
        ├── SKILL.md         # Instructions (Claude reads this)
        └── references/      # Supporting docs
```

OR as a `CLAUDE.md` at project root for project-wide rules.

### SKILL.md Template for Claude:
```markdown
---
name: [skill-name]
description: [When to use this skill]
---

# [Skill Name]

## Instructions

[Claude responds well to clear, direct instructions]

### When activated, you MUST:
1. [Action 1]
2. [Action 2]
3. [Action 3]

### Knowledge Base
[Organized knowledge with clear headers]

### Important Rules
- Always [rule]
- Never [rule]

### Source Documentation
[Citations and confidence notes]
```

### Key Claude-Specific Rules:
- Claude responds well to structured markdown with clear hierarchy
- Use "you MUST" and "you MUST NOT" for hard rules
- Numbered lists for sequential workflows
- Claude handles longer documents well — less need to split into references

---

## 4. Cursor Format (`.cursorrules`)

### File: `.cursorrules` (at project root)
```markdown
# [Skill Topic] Expert Rules

## Context
You are an expert in [topic]. Apply the following verified knowledge
when working on related tasks.

## Rules

### [Category 1]
- [Rule 1]: [Specific instruction]
- [Rule 2]: [Specific instruction]

### [Category 2]
- [Rule 1]: [Specific instruction]

## Workflows
[Condensed workflows — Cursor rules should be more concise]

## Anti-Patterns
- NEVER [bad practice]: [why]
- NEVER [bad practice]: [why]

## Sources
Knowledge sourced from [N] verified sources. See [universal_skill.md] for full citations.
```

### Key Cursor-Specific Rules:
- `.cursorrules` is a single file — everything must fit in one document
- Keep it more concise than other formats
- Focus on RULES and ANTI-PATTERNS (most impactful for code assistance)
- Cursor reads this on every prompt — keep it lean and action-oriented

---

## 5. Windsurf Format (`.windsurfrules`)

### File: `.windsurfrules` (at project root)
```markdown
# [Skill Topic] — Windsurf Rules

## Expert Knowledge
[Condensed, high-confidence knowledge organized by category]

## Workflows
[Step-by-step for common tasks]

## Rules
- [DO]: [action]
- [DON'T]: [action]

## Sources
[Brief citation list]
```

### Key Windsurf-Specific Rules:
- Similar to Cursor format — single file, concise
- Windsurf supports markdown rules files
- Focus on actionable rules over lengthy explanations

---

## 6. OpenAI / ChatGPT Format (`openai_instructions.md`)

### File: `openai_instructions.md`
```markdown
# Custom Instructions — [Skill Topic]

## What would you like ChatGPT to know about you?
I work with [topic]. I need expert-level, verified advice based on
authenticated sources. I prefer specific, actionable guidance over generic tips.

## How would you like ChatGPT to respond?
Apply the following expert knowledge when answering questions about [topic]:

### Verified Knowledge (High Confidence)
[Condensed high-confidence knowledge]

### Conditional Advice
[Decision trees in natural language]

### Common Mistakes to Avoid
[Anti-patterns list]

### Important Caveats
[Low-confidence items with warnings]

### Sources
This knowledge was extracted and verified from [N] sources on [date].
[Brief citation list]
```

### Key OpenAI-Specific Rules:
- Must fit within custom instructions character limit (~1500 chars for "about you", ~1500 for "how to respond")
- If content exceeds limits, create a condensed version for custom instructions + full version as a reference document
- Focus on the highest-confidence, most actionable items
- Use natural language (not markdown heavy) — ChatGPT processes it better

---

## Metadata File (`metadata.json`)

Always generate this alongside the skill:

```json
{
  "FireSkill_version": "1.0.0",
  "skill_name": "[name]",
  "topic": "[topic]",
  "audience": "[target audience]",
  "generated_date": "[ISO date]",
  "refresh_by": "[ISO date]",
  "sources_count": 0,
  "claims_extracted": 0,
  "claims_verified": 0,
  "confidence_breakdown": {
    "high": 0,
    "medium": 0,
    "low": 0,
    "rejected": 0
  },
  "formats_generated": ["universal"],
  "source_urls": []
}
```
