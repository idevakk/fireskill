# Extraction Protocol — Detailed Guide

## Overview
This document defines exactly how to extract knowledge from each source type.
The agent MUST follow these patterns to ensure consistent, thorough extraction.

---

## General Principles

1. **Extract before filtering.** Capture everything first. Filtering happens in Phase 3.
2. **Preserve context.** Don't strip away conditions, caveats, or "it depends" qualifiers.
3. **Capture authority signals.** Who is the author? What credentials do they have? How many followers/subscribers? Are they citing their own data or repeating others?
4. **Note the date.** Content freshness is a critical quality signal.
5. **Identify the content type.** Tutorial vs. opinion vs. case study vs. documentation — each has different reliability weight.

---

## Extraction by Source Type

### Website / Blog Article

**Tool**: Firecrawl Cloud API → fallback to `read_url_content` → fallback to browser automation

**Extract**:
- Full article text (not just headings)
- Author name and bio (if visible)
- Publication date
- Any data/statistics cited (with their original sources if mentioned)
- Code examples or configurations
- Images/diagrams descriptions (describe what they show)
- Comments section highlights (if notably useful, e.g., author corrections)

**Watch for**:
- Sponsored content / affiliate disclaimers → flag as potential bias
- "Updated on [date]" — use update date, not original publish date
- Multi-page articles — extract ALL pages
- Sidebar/footer content that may contain key information

### YouTube Video

**Tool**: Firecrawl (can extract YouTube transcripts) → fallback to browser automation to read captions → fallback to asking user for manual transcript paste

**Extract**:
- Full transcript/captions
- Video title and channel name
- Upload date
- View count and like/dislike ratio (if visible — signals community validation)
- Channel subscriber count (authority signal)
- Description text (often contains links, timestamps, key points)
- Pinned comments from creator (often contain corrections/updates)

**Processing the transcript**:
1. Transcripts are often messy (no punctuation, run-on sentences). Clean them up mentally.
2. Focus on **specific advice and claims**, not filler ("hey guys", "smash that like button").
3. Capture timestamps for key claims when possible — aids in verification.
4. Pay special attention to:
   - "The mistake most people make is..."
   - "What actually works is..."
   - "I tested this and..."
   - Any data shared ("I saw a 40% increase when...")

### YouTube Shorts / Instagram Reels

**Tool**: Firecrawl → fallback to browser automation

**Extract**:
- The core claim/tip (shorts usually have exactly ONE main point)
- Creator name and follower count
- Upload date
- Engagement metrics (if visible)

**Processing**:
- Shorts are inherently lower-reliability (limited depth, engagement-optimized)
- Treat each short as a SINGLE claim to be verified elsewhere
- Never assign HIGH confidence to a claim sourced only from shorts

### Instagram Post / Carousel

**Tool**: Firecrawl → fallback to browser automation → fallback to manual paste

**Extract**:
- Caption text (full, including hashtags)
- Carousel slide content (if text-based carousel)
- Creator handle and follower count
- Post date
- Top comments (if substantive)

**Processing**:
- Instagram captions can be content-rich (especially carousels)
- Hashtags may reveal the creator's claimed niche
- Carousel posts often have structured tips — extract each slide separately

### Official Documentation

**Tool**: Firecrawl or `read_url_content`

**Extract**:
- Full page content with hierarchy preserved
- Version/date of documentation
- Any deprecation notices
- Code examples (complete, not truncated)
- Related/linked pages that may contain deeper info

**Processing**:
- Official docs get automatic HIGH confidence for factual claims
- BUT: Check the date — documentation can be outdated
- Differentiate between "recommended" and "required" in the docs

### Research Paper / Case Study

**Tool**: Firecrawl or `read_url_content`

**Extract**:
- Abstract
- Methodology description
- Key findings/results
- Sample size and conditions
- Conclusions and limitations (authors' own caveats)
- Citation count (authority signal)

**Processing**:
- Case studies with real data are HIGH value
- Check methodology — is the sample size meaningful?
- Note any conflicts of interest (company publishing about own product)

---

## Extraction Quality Checklist

For EACH source, before moving to the next, verify:
- [ ] Full content extracted (not truncated)
- [ ] Author/creator identified
- [ ] Date captured
- [ ] All specific claims listed (not just the headline)
- [ ] Evidence/reasoning for claims captured
- [ ] Context and caveats preserved
- [ ] Content type classified (tutorial / opinion / case study / documentation / entertainment)
- [ ] Bias signals noted (sponsorship, affiliate, self-promotion)

---

## Handling Extraction Failures

| Failure | Recovery |
|---------|----------|
| Firecrawl returns empty | Try `read_url_content` |
| `read_url_content` returns empty | Try browser automation |
| Browser automation fails | Ask user: "I couldn't access [URL]. Can you paste the relevant content?" |
| Paywall blocks access | Inform user, skip source, note it was excluded |
| Content is in non-English language | Extract anyway, translate key claims, note the language |
| Video has no transcript/captions | Ask user to paste key points they remember from the video |

---

## Output Format for Raw Extraction

Store extracted data internally in this format:

```markdown
---
SOURCE_ID: S001
URL: [full URL]
TYPE: [website | youtube | instagram | shorts | documentation | paper]
AUTHOR: [name or handle]
AUTHOR_CREDENTIALS: [bio, subscriber count, expertise indicators]
DATE: [YYYY-MM-DD or approximate]
BIAS_FLAGS: [sponsored | affiliate | self-promotion | none]
EXTRACTION_METHOD: [firecrawl | read_url | browser | manual_paste]
EXTRACTION_STATUS: [complete | partial | failed]
---

## Claims Extracted:

### Claim S001-C01: [Concise claim statement]
- Detail: [Full explanation from source]
- Evidence cited: [Any data, stats, examples given]
- Context/caveats: [When this applies, limitations]
- Verbatim: "[Direct quote if notable]"

### Claim S001-C02: [Next claim]
...
```

This structured format enables systematic cross-referencing in Phase 3.
