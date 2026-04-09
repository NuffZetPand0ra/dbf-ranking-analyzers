# dbf-ranking-analyzers

Small web tools for exploring handicap data from Danmarks Bridgeforbund.

Live site:
- `https://dbf-ranking-analyzers.onrender.com/`

## License

This project is licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE). You may use, modify, and share the code for any noncommercial purpose. Commercial use is not permitted.

## What It Does

This project provides four browser-based analyzers:

1. **Handicap comparison**
   Compare handicap development for multiple DBf players over time.

2. **Handicap distribution**
   Explore handicap distribution across clubs and inspect summary statistics.

3. **Player badge**
   Generate a shareable badge for a single player with HC history, forecast via linear regression, stability score, and national/club percentile.

4. **Hvor & Hvem (Where & Who)**
   Explore where a player has played and with whom. Expandable partner tree with club, tournament title, HC adjustments, and direct links to bridge.dk. Cross-reference partners by location and locations by partner.

There is also a hidden **If-Only analyzer** easter egg — see below for how to access it.

The site is built as static pages with Eleventy and uses a small Node relay for DBf requests so the browser can fetch data without CORS issues.

## Routes

- `/`: Dashboard
- `/tools/handicap-comparison/`: Player handicap comparison
- `/tools/handicap-distribution/`: Handicap distribution by club
- `/tools/player-badge/`: Player badge with HC forecast
- `/tools/where-played/`: Hvor & Hvem
- `/privacy/`: Privacy page
- `/tools/if-only/`: If-Only analyzer *(hidden easter egg)*

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

### Player badge

- Open `/tools/player-badge/`
- Search for a player by name or DBf number
- View HC history with adjustable date range
- Forecast future HC via linear regression with optimism slider
- See stability score and national/club percentile

### Hvor & Hvem

- Open `/tools/where-played/`
- Search for a player by name or DBf number
- Browse the partner list with total count and summed HC effect
- Expand a partner row to see individual tournaments with date, club, title, and HC adjustment
- View all locations with tournament count
- Cross-reference: select a location to see partners, or a partner to see locations

### Privacy page

- Open `/privacy/`
- Brief overview of what data is shown, how it is cached, and how it relates to DBf's publicly available data
- No tracking or marketing cookies are used

### If-Only analyzer *(easter egg)*

The If-Only analyzer is not listed on the dashboard. To access it:

- Type `hvis` on the dashboard to be redirected automatically
- Or navigate directly to `/tools/if-only/`

Once open:

- Search for a player by name or DBf number
- Toggle between club and player exclusion mode
- Select a club or partner to exclude
- Compare the actual HC curve with the alternative trajectory
- Share via URL with preselected player and source

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

## Testing

Run all tests:

```bash
npm test
```

Run only API tests:

```bash
npm run test:api
```

Run only parser/unit tests:

```bash
npm run test:unit
```

Inspect or manage caches from the command line while the local relay server is running:

```bash
npm run cache -- status
npm run cache -- refresh hacalle
npm run cache -- refresh lookup 78976
npm run cache -- clear hacalle
npm run cache -- clear lookup 78976
npm run cache -- clear lookup --all
npm run cache -- clear turns 12345
npm run cache -- clear turns --all
```

Notes:

- Tests use committed fixtures in `tests/fixtures/`, so CI does not depend on local `sample_html/` files.
- API tests run with mocked upstream responses to keep them deterministic.
- The cache CLI targets `http://127.0.0.1:4173` by default. Override with `CACHE_API_BASE_URL`, or with `HOST` and `PORT`.

## Data Access

The frontend uses local relay endpoints exposed by the Node server:

- `GET /api/hacalle` — all players with current HC
- `GET /api/lookup?dbfNr=78976` — individual player HC history
- `POST /api/cache/refresh/hacalle` — force refresh the HACAlle cache
- `POST /api/cache/refresh/lookup` — force refresh one player cache (JSON body: `{ "dbfNr": "78976" }`)
- `POST /api/cache/clear/hacalle` — clear the HACAlle cache
- `POST /api/cache/clear/lookup` — clear one player cache (`{ "dbfNr": "78976" }`) or all player caches (`{ "all": true }`)
- `GET /api/turn?turnId=12345` — single tournament details
- `POST /api/turns` — batch tournament details (JSON body: `{ "ids": [...] }`)
- `POST /api/cache/clear/turns` — clear one tournament cache (`{ "turnId": "12345" }`) or all tournament caches (`{ "all": true }`)
- `GET /api/cache-status` — in-memory + SQLite tournament cache health and row stats

These endpoints proxy DBf sources so the tools can fetch data from the browser without cross-origin issues.

## Deploy

The repository includes a Render blueprint in `render.yaml`.

Deploy flow:

1. Push the repository to GitHub
2. Create a new Render Blueprint service
3. Connect the repository
4. Deploy

Render runs `npm install && npm run build` and then starts `server.js` to serve the generated site and relay API.

## Google Site Verification Files

Google verification is served dynamically by the Node server and is not stored on disk.

Set this environment variable:

- `GOOGLE_SITE_VERIFICATION_ID` with the token only (no `google` prefix and no `.html` suffix)

Example:

- `GOOGLE_SITE_VERIFICATION_ID=30d00bb02eef3b20`

With that value, the server responds on:

- `/google30d00bb02eef3b20.html`

And returns this exact payload:

- `google-site-verification: google30d00bb02eef3b20.html`

How to use on Render:

1. Set `GOOGLE_SITE_VERIFICATION_ID` in the Render service environment
2. Deploy or restart the service

How to use locally:

1. Export `GOOGLE_SITE_VERIFICATION_ID`
2. Start the relay server (`npm run dev` or `node server.js`)
3. Open `http://127.0.0.1:4173/google<id>.html`

## Tournament Cache Persistence

Tournament relay responses are cached in two layers:

- In-memory cache for fast hot reads.
- SQLite cache for persistence across server restarts.

By default:

- `/api/lookup` and `/api/hacalle` cache entries are valid for `12` hours.
- Tournaments older than 60 days are treated as stable and cached without expiration.
- Newer tournaments use a rolling TTL (`12` hours by default).

Environment variables:

- `CACHE_DB_PATH`: SQLite file path (default: `.cache/tournament-cache.sqlite`)
- `TURN_MUTABLE_TTL_HOURS`: TTL for mutable tournament cache entries (default: `12`)
- `TOURNAMENT_IMMUTABLE_DAYS`: age threshold for immutable tournament cache entries (default: `60`)
- `TURN_CACHE_PARSER_VERSION`: parser schema/version key for tournament cache rows (default: `turn-v1`)
- `TURN_CACHE_PURGE_OLD_VERSIONS_ON_START`: set to `1` to delete rows from older parser versions on startup

On Render, keep the cache DB on a persistent disk mount (for example `/var/data/tournament-cache.sqlite`).
