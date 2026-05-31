# SourceVault Crawler

SourceVault Crawler turns this project into a website source scraper/crawler.

## What it does

- Scrapes a target site starting from one URL.
- Captures source files for HTML pages, CSS files, and JS files.
- Stores scraped results in browser local storage.
- Provides a file manager with clickable files.
- Uses route-style file viewing:
	- `/{scraped-site-shortname}/{filename}`
	- Example: `/example-com/index.html`

## How it works

- Frontend: `index.html`
	- Submits scrape requests to `/api/scrape`.
	- Renders saved scrapes and file manager.
	- Uses history routes to open files directly.
- Backend: `api/scrape.js`
	- Crawls pages on the same origin.
	- Extracts CSS/JS assets.
	- Returns scraped files and metadata as JSON.

## Local development

1. Install Vercel CLI if needed.
2. Run `vercel dev` in the project root.
3. Open the local URL shown by Vercel.

## Notes and limits

- The crawler applies page/asset limits to avoid oversized responses.
- Very large scrapes can exceed local storage limits.
- Some sites block bot traffic or require JavaScript rendering; those pages may return incomplete content.