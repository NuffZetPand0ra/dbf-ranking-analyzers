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
This project uses a Node-based static server so files are easy to view in the browser.

1. Install dependencies:
	- `npm install`
2. Start the handicap analyzer page:
	- `npm run dev`
3. Start the histogram page:
	- `npm run dev:histogram`

By default, `npm run dev` starts on port 4173 and opens `dbf_handicap.html`.
