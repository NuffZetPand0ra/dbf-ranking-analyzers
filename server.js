const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = process.cwd();
const STATIC_ROOT = path.join(ROOT, '_site');
const DEFAULT_ROUTE = process.env.OPEN_ROUTE || '/';

const HACALLE_URL = 'https://medlemmer.bridge.dk/HACAlle.php';
const LOOKUP_BASE_URL = 'https://medlemmer.bridge.dk/LookUpHAC.php';
const TURN_BASE_URL = 'https://medlemmer.bridge.dk/LookUpTURN.php';
const HACALLE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const LOOKUP_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const TURN_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

let hacalleCache = null;
const lookupCache = new Map(); // dbfNr -> { ts, data }
const turnCache = new Map(); // turnId -> { ts, data }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon'
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function isSafePath(candidatePath) {
  const resolved = path.resolve(STATIC_ROOT, candidatePath);
  return resolved.startsWith(STATIC_ROOT + path.sep) || resolved === STATIC_ROOT;
}

async function resolveStaticFile(pathname) {
  const candidates = [];

  if (pathname === '/') {
    candidates.push('index.html');
  } else if (pathname.endsWith('/')) {
    candidates.push(path.join(pathname.replace(/^\/+/, ''), 'index.html'));
  } else {
    const cleanPath = pathname.replace(/^\/+/, '');
    candidates.push(cleanPath);
    if (!path.extname(cleanPath)) {
      candidates.push(`${cleanPath}.html`);
      candidates.push(path.join(cleanPath, 'index.html'));
    }
  }

  for (const candidate of candidates) {
    const candidatePath = path.join(STATIC_ROOT, candidate);
    if (!isSafePath(candidatePath)) {
      continue;
    }

    try {
      const stat = await fsp.stat(candidatePath);
      if (stat.isFile()) {
        return candidatePath;
      }
    } catch (_) {
      continue;
    }
  }

  return null;
}

async function serveStatic(reqUrl, res) {
  const pathname = decodeURIComponent(reqUrl.pathname);
  const filePath = await resolveStaticFile(pathname);

  if (!filePath) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (_) {
    sendJson(res, 404, { error: 'Not found' });
  }
}

function decodeWindows1252(buffer) {
  return new TextDecoder('windows-1252').decode(buffer);
}

function extractCells(rowHtml) {
  const cells = [];
  const re = /<td[^>]*>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(rowHtml)) !== null) cells.push(m[1]);
  return cells;
}

function stripTags(html) {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseDanishNumber(text) {
  const value = parseFloat(String(text).replace(/\u00a0/g, '').replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(value) ? value : null;
}

function parseHacalleHtml(html) {
  const players = [];
  const rowRe = /<tr[^>]+class="[^"]*MasterPoint(?:Equal|Odd)Row[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = extractCells(rowMatch[1]);
    if (cells.length < 4) continue;
    const dbfNrMatch = cells[1].match(/DBFNr=(\d+)/i);
    const nameMatch = cells[1].match(/<a\b[^>]*>([^<]+)<\/a>/i);
    if (!dbfNrMatch || !nameMatch) continue;
    const dbfNr = dbfNrMatch[1];
    const name = nameMatch[1].trim().replace(/\s+/g, ' ');
    const club = stripTags(cells[2]);
    const hc = parseFloat(stripTags(cells[3]).replace(',', '.'));
    if (isNaN(hc)) continue;
    players.push({ name, club, dbfNr, hc });
  }
  return players;
}

function parseLookupHtml(html) {
  let name = '';
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const m = titleMatch[1].match(/for (.+)$/);
    if (m) name = m[1].trim();
  }
  if (!name) {
    const h3Match = html.match(/Handicap for (.+?):/i);
    if (h3Match) name = h3Match[1].trim();
  }

  let startHc = null;
  const startHcMatch = html.match(/Start handicap<\/TD><TD[^>]*>([^<]+)<\/TD>/i);
  if (startHcMatch) {
    startHc = parseDanishNumber(stripTags(startHcMatch[1]));
  }

  const entries = [];
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells = extractCells(rowMatch[1]);
    if (/Start handicap/i.test(rowMatch[1])) {
      if (cells.length >= 2) startHc = parseDanishNumber(stripTags(cells[1]));
      continue;
    }
    if (cells.length < 5) continue;

    const dateText = stripTags(cells[0]);
    const dm = dateText.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (!dm) continue;

    const tournament = stripTags(cells[1]);
    const turnIdMatch = cells[1].match(/TurnID=(\d+)/i);
    const club = stripTags(cells[2]);
    const change = parseDanishNumber(stripTags(cells[3]));
    const hc = parseDanishNumber(stripTags(cells[4]));
    if (hc === null) continue;

    const statusText = stripTags(cells[5] || '');
    const isApplied = /2713|✓/.test(cells[5] || '') || /ok|godkendt|aktiv/i.test(statusText);

    entries.push({
      date: `${dm[3]}-${dm[2]}-${dm[1]}`,
      tournament,
      club,
      change,
      hc,
      turnId: turnIdMatch ? turnIdMatch[1] : null,
      status: statusText,
      applied: isApplied,
      sourceType: 'club',
      sourceLabel: club,
    });
  }

  const chronologicalEntries = entries.reverse().map((entry, index) => ({
    ...entry,
    seq: index,
    id: entry.turnId ? `turn-${entry.turnId}` : `entry-${index}`,
  }));

  return { name, startHc, entries: chronologicalEntries };
}

function parseTurnHtml(html) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? stripTags(titleMatch[1]) : '';

  let organizer = '';
  let playedAt = '';
  let postedAt = '';

  const allRows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  for (const rowMatch of allRows) {
    const cells = extractCells(rowMatch[1]).map(stripTags);
    if (cells.length < 2) continue;
    if (!organizer && /^\d{3,5}\s/.test(cells[0])) {
      organizer = cells[0];
      continue;
    }
    if (/^Spilledato:/i.test(cells[0])) playedAt = cells[1];
    if (/^Posteringstidspunkt:/i.test(cells[0])) postedAt = cells[1];
  }

  const parsedRows = allRows.map(rowMatch => ({
    raw: rowMatch[0],
    cells: extractCells(rowMatch[1]).map(stripTags),
  }));

  const pairHeaderIndex = parsedRows.findIndex(row => {
    const headerKey = row.cells.join('|').toLowerCase();
    return /parnummer\|navn\|starthandicap\|score\|handicapscore/.test(headerKey);
  });

  if (pairHeaderIndex >= 0) {
    const groups = [];
    let currentGroup = null;
    for (const row of parsedRows.slice(pairHeaderIndex + 1)) {
      if (!/MasterPoint(?:Equal|Odd)Row/i.test(row.raw)) continue;
      const cells = row.cells;
      if (cells.length < 5) continue;

      const pairNo = cells[0];
      const name = cells[1];
      if (!name) continue;

      if (pairNo) {
        currentGroup = {
          groupKey: pairNo,
          players: [],
          score: parseDanishNumber(cells[3]),
          handicapScore: parseDanishNumber(cells[4]),
        };
        groups.push(currentGroup);
      } else if (!currentGroup) {
        currentGroup = {
          groupKey: `row-${groups.length + 1}`,
          players: [],
          score: parseDanishNumber(cells[3]),
          handicapScore: parseDanishNumber(cells[4]),
        };
        groups.push(currentGroup);
      }

      currentGroup.players.push({
        name,
        startHandicap: parseDanishNumber(cells[2]),
        score: parseDanishNumber(cells[3]),
        handicapScore: parseDanishNumber(cells[4]),
      });
    }

    return {
      title,
      organizer,
      playedAt,
      postedAt,
      formatHint: 'pair',
      relationshipConfidence: groups.length ? 'high' : 'none',
      groups,
    };
  }

  const teamHeaderIndex = parsedRows.findIndex(row => {
    const headerKey = row.cells.join('|').toLowerCase();
    return /holdnummer\|retning\|modstander holdnummer\|navn\|starthandicap\|butler imps\|handicapscore/.test(headerKey);
  });

  if (teamHeaderIndex >= 0) {
    const groups = [];
    let currentGroup = null;

    for (const row of parsedRows.slice(teamHeaderIndex + 1)) {
      if (!/MasterPoint(?:Equal|Odd)Row/i.test(row.raw)) continue;
      const cells = row.cells;
      if (cells.length < 7) continue;

      const holdNumber = cells[0];
      const direction = cells[1];
      const opponentHoldNumber = cells[2];
      const name = cells[3];
      if (!name) continue;

      if (holdNumber) {
        currentGroup = {
          groupKey: holdNumber,
          opponentGroupKey: opponentHoldNumber || null,
          players: [],
        };
        groups.push(currentGroup);
      } else if (!currentGroup) {
        currentGroup = {
          groupKey: `hold-${groups.length + 1}`,
          opponentGroupKey: opponentHoldNumber || null,
          players: [],
        };
        groups.push(currentGroup);
      }

      currentGroup.players.push({
        name,
        direction,
        startHandicap: parseDanishNumber(cells[4]),
        score: parseDanishNumber(cells[5]),
        handicapScore: parseDanishNumber(cells[6]),
      });
    }

    return {
      title,
      organizer,
      playedAt,
      postedAt,
      formatHint: 'team-known-seating',
      relationshipConfidence: groups.length ? 'high' : 'none',
      groups,
    };
  }

  return {
    title,
    organizer,
    playedAt,
    postedAt,
    formatHint: 'unknown',
    relationshipConfidence: 'none',
    groups: [],
  };
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === '/api/turns' && req.method === 'POST') {
    // Read JSON body
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      sendJson(res, 400, { error: 'Invalid JSON body' });
      return;
    }
    const rawIds = Array.isArray(body.ids) ? body.ids : [];
    const turnIds = [...new Set(rawIds.map(s => String(s).replace(/\D/g, '')).filter(Boolean))];
    if (!turnIds.length) {
      sendJson(res, 400, { error: 'Missing ids array in body' });
      return;
    }

    const now = Date.now();
    const BATCH_CONCURRENCY = 8;

    async function fetchOneTurn(turnId) {
      const cached = turnCache.get(turnId);
      if (cached && now - cached.ts <= TURN_CACHE_MAX_AGE_MS) {
        return { turnId, ...cached.data, cachedAt: cached.ts, cache: 'HIT' };
      }
      try {
        const upstream = await fetch(`${TURN_BASE_URL}?TurnID=${encodeURIComponent(turnId)}`, {
          method: 'GET',
          headers: { 'User-Agent': 'dbf-ranking-analyzers/1.0 relay' }
        });
        if (!upstream.ok) {
          return { turnId, error: 'Upstream fetch failed', status: upstream.status };
        }
        const buffer = Buffer.from(await upstream.arrayBuffer());
        const data = parseTurnHtml(decodeWindows1252(buffer));
        turnCache.set(turnId, { ts: now, data });
        return { turnId, ...data, cachedAt: now, cache: 'MISS' };
      } catch (err) {
        return { turnId, error: 'Relay request failed', message: err.message };
      }
    }

    const results = new Array(turnIds.length);
    let nextIdx = 0;
    async function worker() {
      while (nextIdx < turnIds.length) {
        const i = nextIdx++;
        results[i] = await fetchOneTurn(turnIds[i]);
      }
    }
    await Promise.all(Array.from({ length: Math.min(BATCH_CONCURRENCY, turnIds.length) }, () => worker()));

    sendJson(res, 200, { results });
    return;
  }

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (reqUrl.pathname === '/api/hacalle') {
    const now = Date.now();
    const forceRefresh = reqUrl.searchParams.get('refresh') === '1';
    const isFresh = hacalleCache && now - hacalleCache.ts <= HACALLE_CACHE_MAX_AGE_MS;

    if (!forceRefresh && isFresh) {
      sendJson(res, 200, { players: hacalleCache.players, cachedAt: hacalleCache.ts, cache: 'HIT' });
      return;
    }

    try {
      const upstream = await fetch(HACALLE_URL, {
        method: 'GET',
        headers: { 'User-Agent': 'dbf-ranking-analyzers/1.0 relay' }
      });

      if (!upstream.ok) {
        sendJson(res, 502, { error: 'Upstream fetch failed', status: upstream.status });
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      const players = parseHacalleHtml(decodeWindows1252(buffer));
      hacalleCache = { ts: now, players };

      sendJson(res, 200, { players, cachedAt: now, cache: 'MISS' });
    } catch (err) {
      sendJson(res, 502, { error: 'Relay request failed', message: err.message });
    }
    return;
  }

  if (reqUrl.pathname === '/api/lookup') {
    const dbfNr = (reqUrl.searchParams.get('dbfNr') || '').replace(/\D/g, '');
    if (!dbfNr) {
      sendJson(res, 400, { error: 'Missing dbfNr query param' });
      return;
    }

    const now = Date.now();
    const forceRefresh = reqUrl.searchParams.get('refresh') === '1';
    const cached = lookupCache.get(dbfNr);
    if (!forceRefresh && cached && now - cached.ts <= LOOKUP_CACHE_MAX_AGE_MS) {
      sendJson(res, 200, { ...cached.data, dbfNr, cachedAt: cached.ts, cache: 'HIT' });
      return;
    }

    try {
      const upstream = await fetch(`${LOOKUP_BASE_URL}?DBFNr=${encodeURIComponent(dbfNr)}`, {
        method: 'GET',
        headers: { 'User-Agent': 'dbf-ranking-analyzers/1.0 relay' }
      });

      if (!upstream.ok) {
        sendJson(res, 502, { error: 'Upstream fetch failed', status: upstream.status });
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      const data = parseLookupHtml(decodeWindows1252(buffer));
      lookupCache.set(dbfNr, { ts: now, data });
      sendJson(res, 200, { ...data, dbfNr, cachedAt: now, cache: 'MISS' });
    } catch (err) {
      sendJson(res, 502, { error: 'Relay request failed', message: err.message });
    }
    return;
  }

  if (reqUrl.pathname === '/api/turn') {
    const turnId = (reqUrl.searchParams.get('turnId') || '').replace(/\D/g, '');
    if (!turnId) {
      sendJson(res, 400, { error: 'Missing turnId query param' });
      return;
    }

    const now = Date.now();
    const forceRefresh = reqUrl.searchParams.get('refresh') === '1';
    const cached = turnCache.get(turnId);
    if (!forceRefresh && cached && now - cached.ts <= TURN_CACHE_MAX_AGE_MS) {
      sendJson(res, 200, { ...cached.data, turnId, cachedAt: cached.ts, cache: 'HIT' });
      return;
    }

    try {
      const upstream = await fetch(`${TURN_BASE_URL}?TurnID=${encodeURIComponent(turnId)}`, {
        method: 'GET',
        headers: { 'User-Agent': 'dbf-ranking-analyzers/1.0 relay' }
      });

      if (!upstream.ok) {
        sendJson(res, 502, { error: 'Upstream fetch failed', status: upstream.status });
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      const data = parseTurnHtml(decodeWindows1252(buffer));
      turnCache.set(turnId, { ts: now, data });
      sendJson(res, 200, { ...data, turnId, cachedAt: now, cache: 'MISS' });
    } catch (err) {
      sendJson(res, 502, { error: 'Relay request failed', message: err.message });
    }
    return;
  }

  await serveStatic(reqUrl, res);
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log('DBf analyzer server started');
  console.log('Open:', `${base}${DEFAULT_ROUTE}`);
  console.log('Handicap comparison:', `${base}/tools/handicap-comparison/`);
  console.log('Handicap distribution:', `${base}/tools/handicap-distribution/`);
  console.log('If-Only analyzer:', `${base}/tools/if-only/`);
  console.log('Where & Played:', `${base}/tools/where-played/`);
});
