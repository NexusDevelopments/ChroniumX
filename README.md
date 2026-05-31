# ChroniumX Website Source Scraper

ChroniumX is a focused website source scraper built to collect and organize front-end source files from a target site. It is designed for quick inspection, browsing, and export of captured site code.

## What The Scraper Does

- Crawls a target website from a starting URL.
- Collects source files for HTML pages plus linked CSS and JavaScript assets.
- Tracks crawl progress in real time while pages and assets are processed.
- Organizes results into a built-in file manager with folder grouping and search.
- Supports route-based file viewing, including paths like `/{site-slug}/{file-path}`.
- Saves scrape sessions in browser storage so previously captured sites can be reopened.
- Exports scraped content as single files, selected files, folders, full ZIP bundles, and JSON manifest data.

## What Is Used

- Frontend: single-page interface in `index.html` using vanilla HTML, CSS, and JavaScript.
- Backend: serverless scraping endpoint in `api/scrape.js` (Node.js runtime).
- Data flow: NDJSON stream events for live scrape progress and completion payloads.
- Storage: browser `localStorage` for saved scrape sessions and preferences.
- Export tooling: JSZip (browser-side ZIP generation).
- Routing model: SPA history routing with file-style URLs and an updates route.