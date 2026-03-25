# dbf-ranking-analyzers
Various analyzers for bridge ranking in the Danish Bridge Federation

## Structure
- `views/layouts/base.hbs`: Shared HTML document shell used by all rendered pages
- `views/pages/dashboard.html`: Dashboard view body
- `views/pages/handicap.html`: Player handicap comparison view body
- `views/pages/handicap_histogram.html`: Handicap distribution view body
- `views/partials/analyzer_header.hbs`: Shared Handlebars header partial for analyzer pages
- `views/partials/footer.hbs`: Shared Handlebars footer partial
- `.eleventy.js`: Eleventy build configuration and passthrough asset setup
- `css/analyzer-theme.css`: Shared UI theme used by both analyzers
- `css/dbf_handicap.css`: Page-specific styles for comparison analyzer
- `css/dbf_handicap_histogram.css`: Page-specific styles for histogram analyzer
- `js/dbf_handicap.js`: Script for comparison analyzer
- `js/dbf_handicap_histogram.js`: Script for histogram analyzer

Eleventy now builds the page layer from `views/pages/*.html` through the shared Handlebars layout, while `server.js` stays focused on the DBf relay endpoints and serving the generated `_site/` output.

## Run locally
This project uses Eleventy to build the pages and a small Node server to serve the generated site plus relay DBf requests through local API routes to avoid browser CORS issues.

1. Install dependencies:
	- `npm install`
2. Start the dashboard and Eleventy watcher:
	- `npm run dev`
3. Start directly on the handicap tool route:
	- `npm run dev:handicap`
4. Start directly on the distribution tool route:
	- `npm run dev:histogram`
5. Create a production build:
	- `npm run build`

By default, `npm run dev` starts on port 4173.

## Routes
- `/`: Dashboard / landing page
- `/tools/handicap-comparison/`: Player handicap comparison analyzer
- `/tools/handicap-distribution/`: Handicap distribution analyzer

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
- `render.yaml` runs `npm run build` before starting the relay/static server.
- Render injects `PORT` automatically, and `server.js` already uses it.
- The homepage is `/`, backed by the Eleventy-generated dashboard page.
