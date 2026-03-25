const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const Handlebars = require('handlebars');
const path = require('path');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = process.cwd();
const DEFAULT_PAGE = process.env.OPEN_PAGE || 'dbf_dashboard.html';
const PARTIALS_DIR = path.join(ROOT, 'views', 'partials');

const TEMPLATE_ROUTES = new Map([
  ['/dbf_dashboard.html', 'dbf_dashboard.html'],
  ['/dbf_handicap.html', 'dbf_handicap.html'],
  ['/dbf_handicap_histogram.html', 'dbf_handicap_histogram.html']
]);

const HACALLE_URL = 'https://medlemmer.bridge.dk/HACAlle.php';
const LOOKUP_BASE_URL = 'https://medlemmer.bridge.dk/LookUpHAC.php';
const HACALLE_CACHE_MAX_AGE_MS = 12 * 60 * 60 * 1000;

let hacalleCache = null;

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
  const resolved = path.resolve(ROOT, candidatePath);
  return resolved.startsWith(ROOT + path.sep) || resolved === ROOT;
}

async function loadPartials(handlebars) {
  const entries = await fsp.readdir(PARTIALS_DIR, { withFileTypes: true });
  await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.endsWith('.hbs')).map(async (entry) => {
    const partialName = path.basename(entry.name, '.hbs');
    const partialPath = path.join(PARTIALS_DIR, entry.name);
    const partialSource = await fsp.readFile(partialPath, 'utf8');
    handlebars.registerPartial(partialName, partialSource);
  }));
}

async function renderTemplate(templateFile, templateData) {
  const templatePath = path.join(ROOT, templateFile);
  if (!isSafePath(templatePath)) {
    throw new Error('Forbidden template path');
  }

  const handlebars = Handlebars.create();
  await loadPartials(handlebars);

  const templateSource = await fsp.readFile(templatePath, 'utf8');
  const template = handlebars.compile(templateSource);
  return template(templateData);
}

async function serveTemplate(templateFile, res, templateData = {}) {
  try {
    const html = await renderTemplate(templateFile, templateData);
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-cache'
    });
    res.end(html);
  } catch (err) {
    sendJson(res, 500, {
      error: 'Template render failed',
      message: err.message,
      templateFile
    });
  }
}

async function serveStatic(reqUrl, res) {
  let pathname = decodeURIComponent(reqUrl.pathname);
  if (pathname === '/') {
    pathname = '/' + DEFAULT_PAGE;
  }

  if (TEMPLATE_ROUTES.has(pathname)) {
    await serveTemplate(TEMPLATE_ROUTES.get(pathname), res);
    return;
  }

  const filePath = path.join(ROOT, pathname);
  if (!isSafePath(filePath)) {
    sendJson(res, 403, { error: 'Forbidden path' });
    return;
  }

  try {
    const stat = await fsp.stat(filePath);
    if (stat.isDirectory()) {
      sendJson(res, 404, { error: 'Directory listing not allowed' });
      return;
    }
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

async function relayRemote(res, remoteUrl) {
  try {
    const upstream = await fetch(remoteUrl, {
      method: 'GET',
      headers: {
        'User-Agent': 'dbf-ranking-analyzers/1.0 relay'
      }
    });

    if (!upstream.ok) {
      sendJson(res, 502, {
        error: 'Upstream fetch failed',
        status: upstream.status,
        remoteUrl
      });
      return;
    }

    const buffer = Buffer.from(await upstream.arrayBuffer());
    const contentType = upstream.headers.get('content-type') || 'text/html; charset=windows-1252';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
      'X-Relay-Source': remoteUrl
    });
    res.end(buffer);
  } catch (err) {
    sendJson(res, 502, {
      error: 'Relay request failed',
      message: err.message,
      remoteUrl
    });
  }
}

function sendHtmlBuffer(res, buffer, contentType, extraHeaders) {
  res.writeHead(200, {
    'Content-Type': contentType || 'text/html; charset=windows-1252',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(buffer);
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method !== 'GET') {
    sendJson(res, 405, { error: 'Method not allowed' });
    return;
  }

  if (reqUrl.pathname === '/api/hacalle') {
    const now = Date.now();
    const forceRefresh = reqUrl.searchParams.get('refresh') === '1';
    const isFresh = hacalleCache && now - hacalleCache.ts <= HACALLE_CACHE_MAX_AGE_MS;

    if (!forceRefresh && isFresh) {
      sendHtmlBuffer(res, hacalleCache.buffer, hacalleCache.contentType, {
        'X-Relay-Source': HACALLE_URL,
        'X-Relay-Cache': 'HIT'
      });
      return;
    }

    try {
      const upstream = await fetch(HACALLE_URL, {
        method: 'GET',
        headers: {
          'User-Agent': 'dbf-ranking-analyzers/1.0 relay'
        }
      });

      if (!upstream.ok) {
        sendJson(res, 502, {
          error: 'Upstream fetch failed',
          status: upstream.status,
          remoteUrl: HACALLE_URL
        });
        return;
      }

      const buffer = Buffer.from(await upstream.arrayBuffer());
      const contentType = upstream.headers.get('content-type') || 'text/html; charset=windows-1252';
      hacalleCache = { ts: now, buffer, contentType };

      sendHtmlBuffer(res, buffer, contentType, {
        'X-Relay-Source': HACALLE_URL,
        'X-Relay-Cache': 'MISS'
      });
    } catch (err) {
      sendJson(res, 502, {
        error: 'Relay request failed',
        message: err.message,
        remoteUrl: HACALLE_URL
      });
    }
    return;
  }

  if (reqUrl.pathname === '/api/lookup') {
    const dbfNr = (reqUrl.searchParams.get('dbfNr') || '').replace(/\D/g, '');
    if (!dbfNr) {
      sendJson(res, 400, { error: 'Missing dbfNr query param' });
      return;
    }
    await relayRemote(res, `${LOOKUP_BASE_URL}?DBFNr=${encodeURIComponent(dbfNr)}`);
    return;
  }

  await serveStatic(reqUrl, res);
});

server.listen(PORT, HOST, () => {
  const base = `http://${HOST}:${PORT}`;
  console.log('DBf analyzer server started');
  console.log('Open:', `${base}/${DEFAULT_PAGE}`);
  console.log('Histogram:', `${base}/dbf_handicap_histogram.html`);
  console.log('Dashboard:', `${base}/dbf_dashboard.html`);
});
