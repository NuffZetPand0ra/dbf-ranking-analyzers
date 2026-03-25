# dbf-ranking-analyzers
Various analyzers for bridge ranking in the Danish Bridge Federation

## Structure
- `dbf_handicap.html`: Player handicap comparison analyzer
- `dbf_handicap_histogram.html`: Handicap distribution analyzer
- `views/partials/analyzer_header.hbs`: Shared Handlebars header partial for analyzer pages
- `views/partials/footer.hbs`: Shared Handlebars footer partial
- `css/analyzer-theme.css`: Shared UI theme used by both analyzers
- `css/dbf_handicap.css`: Page-specific styles for comparison analyzer
- `css/dbf_handicap_histogram.css`: Page-specific styles for histogram analyzer
- `js/dbf_handicap.js`: Script for comparison analyzer
- `js/dbf_handicap_histogram.js`: Script for histogram analyzer

The three `.html` pages are now rendered server-side as Handlebars templates so shared partials can be reused while keeping the same public URLs.

## Run locally
This project uses a small Node server that serves the pages and relays DBf requests through local API routes to avoid browser CORS issues.

1. Install dependencies:
	- `npm install`
2. Start the handicap analyzer page:
	- `npm run dev`
3. Start the histogram page:
	- `npm run dev:histogram`
4. Start the combined dashboard:
	- `npm run dev:dashboard`

By default, `npm run dev` starts on port 4173.

## Local relay API
- `GET /api/hacalle` -> fetches `https://medlemmer.bridge.dk/HACAlle.php`
- `GET /api/lookup?dbfNr=78976` -> fetches `https://medlemmer.bridge.dk/LookUpHAC.php?DBFNr=78976`

Both frontend analyzers now use these local endpoints when you click the DBf fetch buttons.

## Deploy on Render (from GitHub)
This is the easiest way to host this project publicly while keeping the relay API endpoints (`/api/hacalle` and `/api/lookup`).

1. Push this repository to GitHub.
2. Go to Render and choose New + -> Blueprint.
3. Connect your GitHub account and select this repository.
4. Render will detect `render.yaml` and create the web service automatically.
5. Click Deploy.

Notes:
- `render.yaml` sets `HOST=0.0.0.0` so the service is reachable on Render.
- Render injects `PORT` automatically, and `server.js` already uses it.
- Default landing page is `dbf_dashboard.html` (set via `OPEN_PAGE`).
