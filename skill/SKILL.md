---
name: skillforge
description: >
  Meta-skill that builds production-ready AI agent skills from multiple knowledge sources.
  Use when the user provides URLs (websites, YouTube videos, Instagram posts, Shorts, articles, docs)
  and wants to extract, authenticate, cross-reference, and synthesize genuine expertise into a
  reusable agent skill. Supports output for Gemini/Antigravity, Claude Code, Cursor, Windsurf,
  OpenAI, and Universal formats. Do NOT use for simple Q&A, summarization without skill output,
  or when the user just wants to read a single webpage.
---

# SkillForge — Knowledge-to-Skill Builder

## Purpose
You are a **knowledge distillation engine**. Given multiple source links, you extract genuine expertise,
filter out fluff and marketing BS, cross-reference claims, verify against authoritative sources,
assign confidence scores, and produce a production-ready AI agent skill.

## CRITICAL RULES — READ BEFORE ANYTHING ELSE

1. **NEVER skip source extraction.** Every provided link MUST be read and processed. No exceptions.
2. **NEVER fabricate knowledge.** If a source is inaccessible, say so. Do not hallucinate content.
3. **NEVER include unverified advice as high-confidence.** Every claim must be cross-referenced.
4. **ALWAYS cite sources.** Every piece of advice in the output skill must trace back to its origin.
5. **ALWAYS produce a complete, usable skill.** Partial outputs are unacceptable.
6. **ALWAYS read `references/extraction_protocol.md` before starting extraction.**
7. **ALWAYS read `references/authentication_framework.md` before validating claims.**
8. **ALWAYS read `references/output_formats.md` before generating the final skill.**

---

## Workflow — Execute These Steps IN ORDER

### Phase 1: INPUT COLLECTION

**Step 1.1 — Gather Sources**
Ask the user for:
- All source URLs (websites, YouTube, Instagram, Shorts, articles, documentation)
- The **topic/domain** for the skill (e.g., "SEO", "Email Marketing", "React Performance")
- The **target audience** (beginners, intermediate, advanced, or all)
- Which **agent formats** to generate (gemini, claude, cursor, windsurf, openai, universal) — default: universal

**Step 1.2 — Validate Source List**
- Confirm you have at least 2 sources (more is better for cross-referencing)
- Categorize each source by type: `website`, `youtube`, `instagram`, `documentation`, `article`, `shorts`
- Present the categorized list to the user for confirmation before proceeding

---

### Phase 2: KNOWLEDGE EXTRACTION

**Step 2.1 — Extract Content from Every Source**

Use Firecrawl (Cloud API) to extract content from each source. Follow the protocol in
`references/extraction_protocol.md` for detailed instructions.

For each source, extract:
- **Core claims** — What specific, actionable advice is being given?
- **Reasoning/evidence** — Why does the source say this works? What data backs it?
- **Context/caveats** — Under what conditions? Any limitations mentioned?
- **Author credentials** — Who is saying this? What is their expertise?
- **Date** — When was this published? Is it still current?

**Step 2.2 — Build the Raw Knowledge Base**

Create an internal document (NOT shown to user) structured as:

```
## Source: [URL]
### Author: [Name/Channel] | Credentials: [What makes them credible]
### Date: [Published date] | Type: [website/youtube/etc.]

#### Claim 1: [Specific claim]
- Evidence: [What they cite]
- Context: [When this applies]
- Verbatim quote: [Key quote if available]

#### Claim 2: ...
```

**IMPORTANT**: Extract EVERYTHING of value. Do not summarize prematurely. Raw extraction first.

---

### Phase 3: AUTHENTICATION & CROSS-REFERENCING

Follow the full protocol in `references/authentication_framework.md`.

**Step 3.1 — Cross-Reference Across Sources**
For every claim extracted, check:
- How many sources mention this same advice? (Consensus score)
- Do any sources contradict this? (Contradiction flag)
- Is this generic filler or genuinely actionable? (Actionability score)

**Step 3.2 — External Verification**
Use web search to verify key claims against:
- Official documentation (Google's SEO docs, platform official guides, etc.)
- Published research / case studies
- Industry-standard references
- Known authoritative experts in the field

**Step 3.3 — Confidence Scoring**
Assign every piece of advice a confidence level:

| Level | Criteria |
|-------|----------|
| 🟢 **HIGH** | Confirmed by 3+ sources AND official documentation AND no contradictions |
| 🟡 **MEDIUM** | Confirmed by 2+ sources OR official documentation, minor caveats exist |
| 🟠 **LOW** | Single source only, plausible but unverified, or outdated |
| 🔴 **REJECTED** | Contradicted by official sources, outdated (>2 years for fast-moving fields), or demonstrably wrong |

**Step 3.4 — Filter and Flag**
- **INCLUDE** in final skill: 🟢 HIGH and 🟡 MEDIUM confidence items
- **INCLUDE with caveat**: 🟠 LOW confidence items (clearly marked as "unverified/experimental")
- **EXCLUDE**: 🔴 REJECTED items (but document WHY they were rejected in a "Myths & Misconceptions" section)
- **Flag contradictions**: When sources disagree, present both sides with evidence

---

### Phase 4: KNOWLEDGE SYNTHESIS

**Step 4.1 — Organize by Theme**
Group authenticated knowledge into logical categories/themes. For example, an SEO skill might group into:
- Technical SEO
- Content Strategy
- Link Building
- On-Page Optimization
- Analytics & Measurement

**Step 4.2 — Create Decision Trees**
For advice that depends on context, create clear decision paths:
```
IF [condition] THEN [do this]
ELSE IF [other condition] THEN [do that]
ELSE [default recommendation]
```

**Step 4.3 — Write Actionable Instructions**
Transform raw knowledge into imperative, step-by-step instructions:
- ❌ "It's good to optimize images" (vague)
- ✅ "Compress all images to WebP format. Target file size < 100KB for hero images, < 50KB for thumbnails. Use `cwebp -q 80` or equivalent tool." (actionable)

**Step 4.4 — Add Anti-Patterns Section**
From rejected claims and common mistakes found across sources, create a "What NOT to Do" section with explanations of why each anti-pattern is harmful.

---

### Phase 5: SKILL GENERATION

Read `references/output_formats.md` for the exact format specifications for each agent platform.

**Step 5.1 — Determine Output Formats**
Based on user's selection (or default "universal"), generate:

| Format | Output |
|--------|--------|
| **Universal** | Always generated. A single comprehensive markdown file any AI can use. |
| **Gemini/Antigravity** | `SKILL.md` with YAML frontmatter, proper `references/`, `examples/`, `scripts/` structure |
| **Claude Code** | `CLAUDE.md` or skill format compatible with Claude's system |
| **Cursor** | `.cursorrules` format |
| **Windsurf** | Windsurf-compatible rules/instructions |
| **OpenAI** | Custom instructions / system prompt format |

**Step 5.2 — Generate the Skill Structure**

For each selected format, create the complete skill directory:

```
generated-skill/
├── SKILL.md                    # Core skill (Gemini format)
├── CLAUDE.md                   # Claude format (if selected)
├── .cursorrules                # Cursor format (if selected)
├── .windsurfrules              # Windsurf format (if selected)
├── openai_instructions.md      # OpenAI format (if selected)
├── universal_skill.md          # Universal format (always generated)
├── references/
│   ├── source_citations.md     # All sources with links and credibility notes
│   ├── rejected_claims.md      # What was filtered out and why
│   └── confidence_report.md    # Full confidence scoring breakdown
├── examples/
│   ├── usage_scenarios.md      # Example prompts showing how to use the skill
│   └── sample_output.md        # What good output from this skill looks like
└── metadata.json               # Skill metadata: topic, sources, date, version
```

**Step 5.3 — Write the Core Skill Content**

The generated skill MUST include these sections:

1. **Frontmatter** — Name, description, trigger conditions (when to use / when NOT to use)
2. **Purpose** — What this skill does in 2-3 sentences
3. **Core Knowledge** — The authenticated, organized expertise (the main body)
4. **Step-by-Step Workflows** — Actionable procedures for common tasks
5. **Decision Trees** — Context-dependent guidance with clear if/then paths
6. **Anti-Patterns** — What NOT to do, with explanations
7. **Myths & Misconceptions** — Debunked claims from sources
8. **Source Citations** — Every claim linked to its source(s)
9. **Confidence Notes** — Where the skill is highly confident vs. where advice is experimental
10. **Update Notes** — When this skill was built, from which sources, and when it should be refreshed

**Step 5.4 — Quality Check**
Before presenting to user, verify:
- [ ] Every claim has at least one source citation
- [ ] No unverified claims are presented as HIGH confidence
- [ ] Step-by-step instructions are genuinely actionable (not vague)
- [ ] The skill can stand alone (no dependency on reading the sources)
- [ ] Format matches the target agent's requirements exactly
- [ ] Examples are realistic and demonstrate actual usage

---

### Phase 6: DELIVERY

**Step 6.1 — Present Summary**
Show the user:
- Number of sources processed
- Total claims extracted vs. claims that made it to the final skill
- Confidence breakdown (how many HIGH / MEDIUM / LOW)
- Key contradictions found (if any)
- List of rejected claims (brief)

**Step 6.2 — Write Files**
Write all generated skill files to the user's specified directory or the project workspace.

**Step 6.3 — Suggest Next Steps**
- "Review the `references/confidence_report.md` for detailed scoring"
- "Test the skill by asking your AI agent: [example prompt]"
- "Consider refreshing this skill in [X months] as the field evolves"

---

## Firecrawl Integration

This skill uses the **Firecrawl Cloud API** for content extraction. The agent MUST:

1. Use `read_url_content` or browser tools as a fallback if Firecrawl is unavailable
2. For YouTube videos: Extract transcript/captions via Firecrawl or fallback to browser automation
3. For Instagram: Use Firecrawl's scraping or fallback to asking user for manual content paste
4. For paywalled content: Inform user that the source cannot be accessed, do NOT hallucinate content

See `scripts/firecrawl_extract.md` for Firecrawl-specific extraction patterns.

---

## Error Handling

| Scenario | Action |
|----------|--------|
| Source URL returns 404/error | Log it, inform user, continue with remaining sources |
| Firecrawl API unavailable | Fall back to `read_url_content` or browser tools |
| < 2 accessible sources | WARN user that cross-referencing will be limited; proceed but mark all claims as LOW confidence |
| All sources inaccessible | STOP. Inform user. Do NOT generate a skill from zero sources. |
| YouTube video has no transcript | Try browser automation to capture captions; if still fails, log and skip |
| Contradictory claims across sources | Include BOTH sides with evidence, let the skill user decide |

---

## Important Notes

- **Freshness matters.** For fast-moving fields (SEO, social media, AI), flag advice older than 12 months.
- **Authority matters.** Weight official documentation and recognized experts higher than random blog posts.
- **Specificity matters.** Vague advice ("create good content") gets LOW confidence. Specific advice ("target keyword density of 1-2%, place primary keyword in first 100 words") gets higher confidence.
- **This skill builds OTHER skills.** The output must be a standalone, complete skill file — NOT a summary, NOT a blog post, NOT a report.
