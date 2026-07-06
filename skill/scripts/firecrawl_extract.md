# Firecrawl Extraction Patterns

## Overview
SkillForge uses the **Firecrawl Cloud API** for web content extraction. This document
provides the agent with patterns for using Firecrawl effectively.

---

## Firecrawl Setup

The user must have a Firecrawl API key. If not configured:

1. Ask: "Do you have a Firecrawl API key? If not, get one at https://firecrawl.dev"
2. The API key should be available as an environment variable: `FIRECRAWL_API_KEY`
3. If using Firecrawl MCP server, it may already be configured

---

## Extraction Strategies by URL Type

### Standard Webpage
```
Method: Scrape (single page)
URL: [as provided]
Format: markdown
Options:
  - onlyMainContent: true (skip nav, footer, ads)
  - waitFor: 2000 (wait for dynamic content to load)
```

### YouTube Video
```
Method: Scrape
URL: https://www.youtube.com/watch?v=[ID]
Format: markdown
Notes:
  - Firecrawl can extract the video page including description
  - For transcript: try scraping the transcript URL pattern
  - Fallback: Use browser automation to open video, click "Show transcript", extract text
  - Fallback 2: Use a YouTube transcript API/service
```

### Instagram Post
```
Method: Scrape
URL: https://www.instagram.com/p/[ID]/
Format: markdown
Notes:
  - Instagram may require authentication for some content
  - Firecrawl may bypass some restrictions
  - Fallback: Ask user to paste the caption/content manually
  - Extract: caption, date, engagement metrics if visible
```

### Instagram Reel / YouTube Short
```
Method: Scrape
URL: [as provided]
Format: markdown
Notes:
  - Very short content — usually 1-2 key points
  - Transcript extraction is harder for short-form video
  - Fallback: Browser automation to read auto-captions
  - Fallback 2: Ask user for manual input
```

### Multi-Page Article / Documentation
```
Method: Crawl (follows links within the same domain)
URL: [starting page URL]
Options:
  - limit: 5 (max pages to crawl)
  - onlyMainContent: true
Notes:
  - Use crawl mode for documentation that spans multiple pages
  - Set reasonable limits to avoid crawling entire websites
```

---

## Fallback Chain

When Firecrawl is unavailable or fails:

```
1. Firecrawl Cloud API (primary)
   ↓ (if fails)
2. read_url_content tool (built-in HTTP fetch, converts HTML to markdown)
   ↓ (if fails — dynamic content, login wall)
3. Browser automation (browser_subagent tool — renders JavaScript, can interact)
   ↓ (if fails — content truly inaccessible)
4. Manual paste request ("Please paste the content from [URL]")
```

---

## Rate Limiting

- Firecrawl Cloud API has rate limits based on plan
- Add 1-2 second delays between requests
- If rate limited (429 response), wait 30 seconds and retry
- Process URLs sequentially, not in parallel

---

## Content Quality Checks

After extraction, verify:
- [ ] Content is not empty or just navigation text
- [ ] Content is the actual article/video content, not an error page
- [ ] Content is in a readable format (not garbled)
- [ ] If content seems truncated, try extracting again with different options

---

## YouTube Transcript Extraction Tips

YouTube transcripts can be accessed through several methods:

1. **Firecrawl scrape of the video page** — Gets title, description, some metadata
2. **Transcript URL pattern** — YouTube exposes transcripts via API; Firecrawl or browser can access
3. **Browser automation approach**:
   - Navigate to the video URL
   - Click "...More" on the description
   - Look for "Show transcript" button
   - Extract the transcript panel text
4. **Third-party transcript services** — Some tools extract YouTube transcripts directly

The agent should try methods in order and use whichever succeeds.
