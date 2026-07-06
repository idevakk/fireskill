# Authentication Framework — Claim Verification Protocol

## Overview
This document defines how to verify, cross-reference, and score every extracted claim
before it enters the final skill. NO claim bypasses this process.

---

## Step 1: Build the Cross-Reference Matrix

After all sources are extracted, create a matrix mapping claims to sources:

```
| Claim                          | S001 | S002 | S003 | S004 | S005 | Count |
|--------------------------------|------|------|------|------|------|-------|
| Use descriptive title tags     | ✓    | ✓    | ✓    | ✓    |      | 4     |
| Keyword density should be 2-3% | ✓    |      |      |      | ✗    | 1 (C) |
| Mobile-first indexing matters  |      | ✓    | ✓    | ✓    |      | 3     |
```

Legend:
- ✓ = Source supports this claim
- ✗ = Source contradicts this claim
- (C) = Contradiction exists
- Empty = Source doesn't mention this

---

## Step 2: Identify Claim Categories

### Category A: CONSENSUS CLAIMS
- Mentioned by 3+ sources with NO contradictions
- These are strong candidates for HIGH confidence

### Category B: SUPPORTED CLAIMS
- Mentioned by 2 sources OR 1 authoritative source (official docs, recognized expert)
- These are candidates for MEDIUM confidence

### Category C: LONE CLAIMS
- Mentioned by only 1 source, no external verification yet
- These need external verification to rise above LOW confidence

### Category D: CONTRADICTED CLAIMS
- Sources disagree on this claim
- These require careful analysis — both sides must be examined

### Category E: GENERIC/VAGUE CLAIMS
- "Create quality content", "Be consistent", "Know your audience"
- These are filler — EXCLUDE unless they come with specific, actionable sub-steps

---

## Step 3: External Verification

For each claim in Categories B, C, and D, perform web search verification:

### Verification Sources (in order of authority):

1. **Official Platform Documentation**
   - Google Search Central (for SEO)
   - Meta Business Help (for social media)
   - Platform-specific docs for the relevant domain
   - Weight: HIGHEST

2. **Peer-Reviewed Research / Published Studies**
   - Academic papers with methodology
   - Large-scale industry studies (e.g., Ahrefs, SEMrush, HubSpot research)
   - Weight: HIGH

3. **Recognized Industry Experts**
   - People with verified track records (e.g., John Mueller for SEO, Dan Abramov for React)
   - Must be the actual expert, not someone quoting them
   - Weight: HIGH

4. **Industry-Standard Resources**
   - MDN Web Docs, W3C specs, RFC documents
   - Well-maintained open-source project docs
   - Weight: HIGH

5. **Community Consensus**
   - Stack Overflow accepted answers (with high votes)
   - Reddit threads with substantial discussion
   - Weight: MEDIUM (good for "does this work in practice" validation)

6. **Blog Posts / Tutorials**
   - Independent blogs with demonstrated expertise
   - Weight: LOW-MEDIUM (depends on author credibility)

### Verification Process:

For each claim needing verification:

```
1. Search: "[claim keyword] site:official-docs-domain"
2. Search: "[claim keyword] best practice 2024 2025"
3. Search: "[claim keyword] research study data"
4. Check: Does any authoritative source CONFIRM this?
5. Check: Does any authoritative source DENY this?
6. Record: Verification source URL + what it says
```

---

## Step 4: Confidence Scoring

### Score Assignment Rules:

#### 🟢 HIGH Confidence
ALL of the following must be true:
- Supported by 3+ independent sources
- Confirmed by official documentation OR peer-reviewed research
- No credible contradictions
- Specific and actionable (not generic)
- Current (advice is < 18 months old for fast-moving fields, < 5 years for stable fields)

#### 🟡 MEDIUM Confidence
ANY of the following:
- Supported by 2 independent sources + no contradictions
- Supported by 1 official documentation source
- Supported by 1 recognized expert with demonstrated track record
- Consensus claim but slightly outdated (18-36 months for fast-moving fields)

#### 🟠 LOW Confidence
ANY of the following:
- Single source only, unverified externally
- Plausible but no supporting evidence found
- Anecdotal ("worked for me" without broader validation)
- Advice from a source with potential bias (sponsored, affiliate)
- Outdated but not contradicted by newer info

#### 🔴 REJECTED
ANY of the following:
- Directly contradicted by official documentation
- Based on outdated information that has been explicitly superseded
- Demonstrably false (verifiable claim that's factually wrong)
- Pure opinion with no evidence, presented as fact
- Black-hat or policy-violating advice (e.g., keyword stuffing, buying links)

---

## Step 5: Contradiction Resolution

When sources disagree:

### Resolution Protocol:
1. **Identify the exact point of disagreement** — Often sources seem to contradict but are talking about different contexts
2. **Check dates** — Is one source newer? The field may have changed
3. **Check authority** — Does the official source say something different from a blogger?
4. **Check specificity** — Is one source making a nuanced point that another oversimplifies?

### Resolution Outcomes:
- **Context-dependent**: Both are right in different situations → Create a decision tree
- **Temporal**: One is outdated → Use newer, flag the change
- **Authority wins**: Official docs override blog speculation → Go with official
- **Genuinely debated**: Experts disagree → Present both sides with evidence, let skill user decide

### Documentation Format for Contradictions:

```markdown
## Contradiction: [Topic]
### Position A: [Claim] — Sources: S001, S003
- Evidence: [What they say]
### Position B: [Claim] — Sources: S002
- Evidence: [What they say]
### Resolution: [Context-dependent / Temporal / Authority / Debated]
- Reasoning: [Why we resolved it this way]
- In the skill: [How this is presented — decision tree / note / excluded]
```

---

## Step 6: Actionability Filter

Even verified claims get filtered for actionability:

### KEEP if the claim:
- Provides a specific action ("set meta description to 150-160 characters")
- Provides a specific metric ("page load < 3 seconds")
- Provides a clear condition ("if your site has > 10,000 pages, use...")
- Provides a tool or method ("use Lighthouse to audit performance")

### DEMOTE (move to supplementary notes) if the claim:
- Is true but obvious ("have a mobile-friendly website")
- Is too broad without sub-steps ("focus on user experience")
- Is a mindset/philosophy without actionable implementation

### REJECT if the claim:
- Is pure motivation with zero actionable content
- Is brand-specific marketing disguised as advice
- Is a repeat of another claim already captured

---

## Output: Confidence Report

After authentication, generate `references/confidence_report.md`:

```markdown
# Confidence Report — [Skill Topic]
Generated: [Date]
Sources Processed: [N]
Total Claims Extracted: [N]

## Summary
| Confidence | Count | Percentage |
|------------|-------|------------|
| 🟢 HIGH    | XX    | XX%        |
| 🟡 MEDIUM  | XX    | XX%        |
| 🟠 LOW     | XX    | XX%        |
| 🔴 REJECTED| XX    | XX%        |

## HIGH Confidence Claims
1. [Claim] — Sources: [S001, S002, S003] + [Official Doc URL]
2. ...

## MEDIUM Confidence Claims
1. [Claim] — Sources: [S001, S002] | Note: [why not HIGH]
2. ...

## LOW Confidence Claims (included with caveat)
1. [Claim] — Source: [S001] | Note: [unverified, single source]
2. ...

## REJECTED Claims (excluded from skill)
1. [Claim] — Source: [S002] | Reason: [Contradicted by official docs]
2. ...

## Contradictions Resolved
1. [Topic] — Resolution: [How it was handled]
2. ...
```
