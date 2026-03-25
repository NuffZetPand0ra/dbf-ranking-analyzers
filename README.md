# dbf-ranking-analyzers

Small web tools for exploring handicap data from Danmarks Bridgeforbund.

Live site:
- `https://dbf-ranking-analyzers.onrender.com/`

## What It Does

This project provides two browser-based analyzers:

1. Handicap comparison
   Compare handicap development for multiple DBf players over time.

2. Handicap distribution
   Explore handicap distribution across clubs and inspect summary statistics.

The site is built as static pages with Eleventy and uses a small Node relay for DBf requests so the browser can fetch data without CORS issues.

## Routes

- `/`: Dashboard
- `/tools/handicap-comparison/`: Player handicap comparison
- `/tools/handicap-distribution/`: Handicap distribution by club

## How To Use

### Handicap comparison

- Open `/tools/handicap-comparison/`
- Search for a player by DBf number and fetch data from DBf
- Compare multiple players in the same chart
- Filter by date range and time grouping
- Export or share the current chart view

### Handicap distribution

- Open `/tools/handicap-distribution/`
- Fetch the latest `HACAlle` data from DBf
- Filter by club and handicap interval
- Adjust the number of bins in the histogram
- Switch between count, percentage, cumulative curve, and trendline views

## Run Locally

Requirements:
- Node.js
- npm

Install dependencies:

```bash
npm install
```

Start the full local dev setup:

```bash
npm run dev
```

Useful dev commands:

- `npm run dev`: dashboard on port `4173`
- `npm run dev:handicap`: opens on the handicap comparison route on port `4174`
- `npm run dev:histogram`: opens on the distribution route on port `4175`
- `npm run build`: build the static site into `_site/`
- `npm run preview`: build first, then serve the production output locally

## Data Access

The frontend uses local relay endpoints exposed by the Node server:

- `GET /api/hacalle`
- `GET /api/lookup?dbfNr=78976`

These endpoints proxy DBf sources so the tools can fetch data from the browser without cross-origin issues.

## Deploy

The repository includes a Render blueprint in `render.yaml`.

Deploy flow:

1. Push the repository to GitHub
2. Create a new Render Blueprint service
3. Connect the repository
4. Deploy

Render runs `npm install && npm run build` and then starts `server.js` to serve the generated site and relay API.
