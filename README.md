# dbf-ranking-analyzers
Various analyzers for bridge ranking in the Danish Bridge Federation

## Structure
- `dbf_handicap.html`: Player handicap comparison analyzer
- `dbf_handicap_histogram.html`: Handicap distribution analyzer
- `css/analyzer-theme.css`: Shared UI theme used by both analyzers
- `css/dbf_handicap.css`: Page-specific styles for comparison analyzer
- `css/dbf_handicap_histogram.css`: Page-specific styles for histogram analyzer
- `js/dbf_handicap.js`: Script for comparison analyzer
- `js/dbf_handicap_histogram.js`: Script for histogram analyzer

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
