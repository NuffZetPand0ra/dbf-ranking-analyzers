const assert = require('assert');
const request = require('supertest');
const nock = require('nock');
const { createTestServer } = require('../helpers/test-server');
const { readFixtureBuffer } = require('../helpers/fixtures');

describe('API server', () => {
  before(() => {
    nock.disableNetConnect();
    nock.enableNetConnect('127.0.0.1');
  });

  after(() => {
    nock.enableNetConnect();
  });

  afterEach(() => {
    nock.cleanAll();
  });

  it('returns 400 on /api/turn without turnId', async () => {
    const server = createTestServer();

    const res = await request(server).get('/api/turn');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Missing turnId query param');
  });

  it('returns MISS then HIT for /api/turn', async () => {
    const server = createTestServer();
    const turnFixture = readFixtureBuffer('turn_pair.html');

    nock('https://medlemmer.bridge.dk')
      .get('/LookUpTURN.php')
      .query({ TurnID: '12345' })
      .reply(200, turnFixture);

    const first = await request(server).get('/api/turn?turnId=12345');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.cache, 'MISS');
    assert.strictEqual(first.body.cacheSource, 'upstream');

    const second = await request(server).get('/api/turn?turnId=12345');
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.cache, 'HIT');
    assert.strictEqual(second.body.cacheSource, 'memory');
  });

  it('bypasses memory cache when refresh=1', async () => {
    const server = createTestServer();
    const turnFixture = readFixtureBuffer('turn_pair.html');

    nock('https://medlemmer.bridge.dk')
      .get('/LookUpTURN.php')
      .query({ TurnID: '99111' })
      .times(2)
      .reply(200, turnFixture);

    const first = await request(server).get('/api/turn?turnId=99111');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.cache, 'MISS');

    const refreshed = await request(server).get('/api/turn?turnId=99111&refresh=1');
    assert.strictEqual(refreshed.status, 200);
    assert.strictEqual(refreshed.body.cache, 'MISS');
    assert.strictEqual(refreshed.body.cacheSource, 'upstream');
  });

  it('returns 400 on /api/turns with invalid body shape', async () => {
    const server = createTestServer();

    const res = await request(server)
      .post('/api/turns')
      .set('Content-Type', 'application/json')
      .send({ ids: [] });

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Missing ids array in body');
  });

  it('returns per-item mixed results on /api/turns', async () => {
    const server = createTestServer();
    const turnFixture = readFixtureBuffer('turn_pair.html');

    nock('https://medlemmer.bridge.dk')
      .get('/LookUpTURN.php')
      .query({ TurnID: '12345' })
      .reply(200, turnFixture);

    nock('https://medlemmer.bridge.dk')
      .get('/LookUpTURN.php')
      .query({ TurnID: '54321' })
      .reply(502, 'upstream error');

    const res = await request(server)
      .post('/api/turns')
      .set('Content-Type', 'application/json')
      .send({ ids: ['12345', '54321'] });

    assert.strictEqual(res.status, 200);
    assert.strictEqual(Array.isArray(res.body.results), true);
    assert.strictEqual(res.body.results.length, 2);

    assert.strictEqual(res.body.results[0].turnId, '12345');
    assert.strictEqual(res.body.results[0].cache, 'MISS');
    assert.strictEqual(res.body.results[0].cacheSource, 'upstream');

    assert.strictEqual(res.body.results[1].turnId, '54321');
    assert.strictEqual(res.body.results[1].error, 'Upstream fetch failed');
    assert.strictEqual(res.body.results[1].status, 502);
  });

  it('reports policy and memory counters in /api/cache-status', async () => {
    const server = createTestServer();
    const turnFixture = readFixtureBuffer('turn_pair.html');

    nock('https://medlemmer.bridge.dk')
      .get('/LookUpTURN.php')
      .query({ TurnID: '80001' })
      .reply(200, turnFixture);

    const seed = await request(server).get('/api/turn?turnId=80001');
    assert.strictEqual(seed.status, 200);

    const statusRes = await request(server).get('/api/cache-status');
    assert.strictEqual(statusRes.status, 200);
    assert.strictEqual(statusRes.body.cachePolicy.mutableTtlHours, 12);
    assert.strictEqual(statusRes.body.cachePolicy.immutableDays, 60);
    assert.strictEqual(statusRes.body.cachePolicy.parserVersion, 'turn-v1');
    assert.strictEqual(statusRes.body.memoryCache.freshEntries, 1);
    assert.strictEqual(statusRes.body.sqliteCache.enabled, false);
  });
});
