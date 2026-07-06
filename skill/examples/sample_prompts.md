# Sample Prompts — How to Use FireSkill

## Overview
These are example prompts a user can give to an AI agent that has FireSkill installed.
Each example shows the user's prompt and what the expected behavior should be.

---

## Example 1: SEO Skill from Multiple Sources

**User Prompt:**
```
Use the FireSkill skill to build an SEO skill from these sources:
- https://developers.google.com/search/docs
- https://www.youtube.com/watch?v=abc123 (Ahrefs SEO tutorial)
- https://www.youtube.com/shorts/def456 (Quick SEO tip)
- https://www.instagram.com/p/xyz789/ (SEO carousel post)
- https://moz.com/beginners-guide-to-seo
- https://backlinko.com/seo-strategy

Target audience: Intermediate
Output format: Gemini + Claude
```

**Expected Agent Behavior:**
1. Reads SKILL.md → loads the FireSkill workflow
2. Reads extraction_protocol.md → knows how to handle each source type
3. Extracts content from all 6 sources using Firecrawl (with fallbacks)
4. Reads authentication_framework.md → cross-references claims
5. Performs web searches to verify claims against Google's official docs
6. Assigns confidence scores to each claim
7. Reads output_formats.md → generates Gemini + Claude + Universal formats
8. Produces complete skill directory with all files
9. Presents summary to user

---

## Example 2: Email Marketing Skill

**User Prompt:**
```
FireSkill: Build me an email marketing skill.
Sources:
- https://mailchimp.com/resources/email-marketing-guide/
- https://www.youtube.com/watch?v=email123 (Email expert tutorial)
- https://blog.hubspot.com/marketing/email-marketing-guide
- https://www.instagram.com/p/emailtips/ (Email tips carousel)

Output for all agents.
```

**Expected Agent Behavior:**
- Same workflow as above
- Generates output for ALL agent formats (Gemini, Claude, Cursor, Windsurf, OpenAI, Universal)
- Each format follows its specific template from output_formats.md

---

## Example 3: Minimal Input

**User Prompt:**
```
Use FireSkill with these links:
- https://react.dev/learn
- https://www.youtube.com/watch?v=react123
```

**Expected Agent Behavior:**
- Agent infers topic: "React Development"
- Agent asks for: target audience and output format preferences
- Defaults to Universal format if user doesn't specify
- Proceeds with only 2 sources but notes that cross-referencing is limited

---

## Example 4: Single Source (Edge Case)

**User Prompt:**
```
FireSkill: Build a skill from this video: https://www.youtube.com/watch?v=solo123
```

**Expected Agent Behavior:**
- Agent warns: "Only 1 source provided. Cross-referencing will be limited."
- Agent asks: "Would you like me to search for additional sources on this topic to improve verification?"
- If user says yes → Agent searches for related sources and adds them
- If user says no → Proceeds but marks all claims as LOW confidence
- Agent still performs external verification via web search

---

## Example 5: Specifying Audience and Detail Level

**User Prompt:**
```
FireSkill: I want an advanced TypeScript skill for senior developers.
Sources:
- https://www.typescriptlang.org/docs/
- https://www.youtube.com/watch?v=ts-advanced
- https://effectivetypescript.com/
- https://github.com/type-challenges/type-challenges

Skip beginner content. Only include advanced patterns.
```

**Expected Agent Behavior:**
- Filters out beginner-level advice during synthesis
- Focuses on advanced patterns, type gymnastics, performance optimization
- Tags audience as "Advanced" in metadata
- Generated skill is dense with expert-level content

---

## Anti-Pattern Prompts (What Should NOT Happen)

### Bad: Asking for a summary instead of a skill
```
"Summarize these articles for me"
```
→ FireSkill should NOT activate. This is summarization, not skill building.

### Bad: Single webpage read
```
"Read this webpage and tell me what it says"
```
→ FireSkill should NOT activate. This is simple content reading.

### Bad: No sources provided
```
"Build me an SEO skill"
```
→ FireSkill should ask for sources before proceeding. It MUST NOT generate a skill from its own training data alone.
