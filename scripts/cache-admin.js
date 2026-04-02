#!/usr/bin/env node

function getBaseUrl() {
  if (process.env.CACHE_API_BASE_URL) return process.env.CACHE_API_BASE_URL.replace(/\/$/, '');
  const envHost = process.env.HOST || '127.0.0.1';
  const host = envHost === '0.0.0.0' || envHost === '::' ? '127.0.0.1' : envHost;
  const port = process.env.PORT || '4173';
  return `http://${host}:${port}`;
}

function usage(log = console.log) {
  log([
    'Usage:',
    '  npm run cache -- status',
    '  npm run cache -- refresh hacalle',
    '  npm run cache -- refresh lookup <dbfNr>',
    '  npm run cache -- clear hacalle',
    '  npm run cache -- clear lookup <dbfNr>',
    '  npm run cache -- clear lookup --all',
    '  npm run cache -- clear turns <turnId>',
    '  npm run cache -- clear turns --all',
    '',
    'Optional env:',
    '  CACHE_API_BASE_URL=http://127.0.0.1:4173',
    '  HOST=127.0.0.1 PORT=4173',
  ].join('\n'));
}

async function requestJson(method, pathname, body) {
  const baseUrl = getBaseUrl();
  const res = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    const message = payload && payload.error ? payload.error : `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  return payload;
}

async function main() {
  return run(process.argv.slice(2));
}

async function run(argv, deps = {}) {
  const [command, scope, value] = argv;
  const request = deps.requestJson || requestJson;
  const log = deps.log || console.log;
  const usageFn = deps.usage || usage;
  const setExitCode = deps.setExitCode || (code => {
    process.exitCode = code;
  });

  if (!command) {
    usageFn(log);
    setExitCode(1);
    return;
  }

  if (command === 'status') {
    const payload = await request('GET', '/api/cache-status');
    log(JSON.stringify(payload, null, 2));
    return;
  }

  if (command === 'refresh') {
    if (scope === 'hacalle') {
      const payload = await request('POST', '/api/cache/refresh/hacalle');
      log(JSON.stringify(payload, null, 2));
      return;
    }

    if (scope === 'lookup' && value) {
      const payload = await request('POST', '/api/cache/refresh/lookup', { dbfNr: value });
      log(JSON.stringify(payload, null, 2));
      return;
    }

    usageFn(log);
    setExitCode(1);
    return;
  }

  if (command === 'clear') {
    if (scope === 'hacalle') {
      const payload = await request('POST', '/api/cache/clear/hacalle');
      log(JSON.stringify(payload, null, 2));
      return;
    }

    if (scope === 'lookup') {
      const body = value === '--all' ? { all: true } : value ? { dbfNr: value } : null;
      if (!body) {
        usageFn(log);
        setExitCode(1);
        return;
      }
      const payload = await request('POST', '/api/cache/clear/lookup', body);
      log(JSON.stringify(payload, null, 2));
      return;
    }

    if (scope === 'turns') {
      const body = value === '--all' ? { all: true } : value ? { turnId: value } : null;
      if (!body) {
        usageFn(log);
        setExitCode(1);
        return;
      }
      const payload = await request('POST', '/api/cache/clear/turns', body);
      log(JSON.stringify(payload, null, 2));
      return;
    }

    if (scope === 'all') {
      const results = {
        hacalle: await request('POST', '/api/cache/clear/hacalle'),
        lookup: await request('POST', '/api/cache/clear/lookup', { all: true }),
        turns: await request('POST', '/api/cache/clear/turns', { all: true }),
      };
      log(JSON.stringify(results, null, 2));
      return;
    }

    usageFn(log);
    setExitCode(1);
    return;
  }

  usageFn(log);
  setExitCode(1);
}

if (require.main === module) {
  main().catch(err => {
    console.error(err.message);
    process.exitCode = 1;
  });
}

module.exports = {
  getBaseUrl,
  usage,
  requestJson,
  run,
  main,
};
