const assert = require('assert');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const request = require('supertest');
const { createServer } = require('../../server');
const { readFixtureBuffer } = require('../helpers/fixtures');

function makeFetchReturningFixture(htmlBuffer) {
  let calls = 0;
  return {
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => htmlBuffer,
      };
    },
    getCalls: () => calls,
  };
}

describe('SQLite tournament cache behavior', () => {
  let tempDir;
  let dbPath;

  beforeEach(async () => {
    tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dbf-cache-test-'));
    dbPath = path.join(tempDir, 'cache.sqlite');
  });

  afterEach(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true });
  });

  it('treats old parser rows as misses after parser version change', async () => {
    const fixture = readFixtureBuffer('turn_pair.html');

    const v1Fetch = makeFetchReturningFixture(fixture);
    const serverV1 = createServer({
      fetchImpl: v1Fetch.fetchImpl,
      env: {
        CACHE_DB_PATH: dbPath,
        TURN_CACHE_PARSER_VERSION: 'turn-v1',
        HOST: '127.0.0.1',
      }
    });

    const first = await request(serverV1).get('/api/turn?turnId=11111');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.cache, 'MISS');
    assert.strictEqual(v1Fetch.getCalls(), 1);

    serverV1.close();

    const v2Fetch = makeFetchReturningFixture(fixture);
    const serverV2 = createServer({
      fetchImpl: v2Fetch.fetchImpl,
      env: {
        CACHE_DB_PATH: dbPath,
        TURN_CACHE_PARSER_VERSION: 'turn-v2',
        HOST: '127.0.0.1',
      }
    });

    const statusBefore = await request(serverV2).get('/api/cache-status');
    assert.strictEqual(statusBefore.status, 200);
    assert.strictEqual(statusBefore.body.sqliteCache.stats.currentVersionRows, 0);
    assert.strictEqual(statusBefore.body.sqliteCache.stats.otherVersionRows >= 1, true);

    const second = await request(serverV2).get('/api/turn?turnId=11111');
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.cache, 'MISS');
    assert.strictEqual(second.body.cacheSource, 'upstream');
    assert.strictEqual(v2Fetch.getCalls(), 1);

    serverV2.close();
  });

  it('purges old parser rows when startup purge is enabled', async () => {
    const fixture = readFixtureBuffer('turn_pair.html');

    const seedFetch = makeFetchReturningFixture(fixture);
    const seedServer = createServer({
      fetchImpl: seedFetch.fetchImpl,
      env: {
        CACHE_DB_PATH: dbPath,
        TURN_CACHE_PARSER_VERSION: 'turn-v1',
        HOST: '127.0.0.1',
      }
    });

    const seed = await request(seedServer).get('/api/turn?turnId=22222');
    assert.strictEqual(seed.status, 200);
    seedServer.close();

    const purgeFetch = makeFetchReturningFixture(fixture);
    const purgeServer = createServer({
      fetchImpl: purgeFetch.fetchImpl,
      env: {
        CACHE_DB_PATH: dbPath,
        TURN_CACHE_PARSER_VERSION: 'turn-v2',
        TURN_CACHE_PURGE_OLD_VERSIONS_ON_START: '1',
        HOST: '127.0.0.1',
      }
    });

    const status = await request(purgeServer).get('/api/cache-status');
    assert.strictEqual(status.status, 200);
    assert.strictEqual(status.body.sqliteCache.stats.otherVersionRows, 0);

    purgeServer.close();

    assert.strictEqual(fs.existsSync(dbPath), true);
  });
});
