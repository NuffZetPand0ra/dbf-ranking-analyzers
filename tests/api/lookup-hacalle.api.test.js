const assert = require('assert');
const request = require('supertest');
const nock = require('nock');
const { createTestServer } = require('../helpers/test-server');
const { readFixtureBuffer } = require('../helpers/fixtures');

describe('API server lookup/hacalle', () => {
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

  it('returns 400 on /api/lookup without dbfNr', async () => {
    const server = createTestServer();

    const res = await request(server).get('/api/lookup');

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Missing dbfNr query param');
  });

  it('returns 400 on refresh lookup endpoint without dbfNr', async () => {
    const server = createTestServer();

    const res = await request(server)
      .post('/api/cache/refresh/lookup')
      .set('Content-Type', 'application/json')
      .send({});

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'Missing dbfNr in body');
  });

  it('returns MISS then HIT on /api/lookup', async () => {
    const server = createTestServer();
    const lookupFixture = readFixtureBuffer('lookup_dennis.html');

    nock('https://medlemmer.bridge.dk')
      .get('/LookUpHAC.php')
      .query({ DBFNr: '78976' })
      .reply(200, lookupFixture);

    const first = await request(server).get('/api/lookup?dbfNr=78976');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.cache, 'MISS');
    assert.strictEqual(first.body.dbfNr, '78976');
    assert.strictEqual(Array.isArray(first.body.entries), true);

    const second = await request(server).get('/api/lookup?dbfNr=78976');
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.cache, 'HIT');
    assert.strictEqual(second.body.dbfNr, '78976');
  });

  it('returns MISS then HIT on /api/hacalle', async () => {
    const server = createTestServer();
    const hacalleFixture = readFixtureBuffer('hacalle_rankings.html');

    nock('https://medlemmer.bridge.dk')
      .get('/HACAlle.php')
      .reply(200, hacalleFixture);

    const first = await request(server).get('/api/hacalle');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.cache, 'MISS');
    assert.strictEqual(Array.isArray(first.body.players), true);
    assert.strictEqual(first.body.players.length > 0, true);

    const second = await request(server).get('/api/hacalle');
    assert.strictEqual(second.status, 200);
    assert.strictEqual(second.body.cache, 'HIT');
    assert.strictEqual(Array.isArray(second.body.players), true);
  });

  it('refreshes lookup cache via dedicated endpoint', async () => {
    const server = createTestServer();
    const lookupFixture = readFixtureBuffer('lookup_dennis.html');

    nock('https://medlemmer.bridge.dk')
      .get('/LookUpHAC.php')
      .query({ DBFNr: '78976' })
      .reply(200, lookupFixture);

    const refreshed = await request(server)
      .post('/api/cache/refresh/lookup')
      .set('Content-Type', 'application/json')
      .send({ dbfNr: '78976' });

    assert.strictEqual(refreshed.status, 200);
    assert.strictEqual(refreshed.body.cache, 'REFRESH');
    assert.strictEqual(refreshed.body.refreshed, true);
    assert.strictEqual(refreshed.body.dbfNr, '78976');

    const cached = await request(server).get('/api/lookup?dbfNr=78976');
    assert.strictEqual(cached.status, 200);
    assert.strictEqual(cached.body.cache, 'HIT');
  });

  it('refreshes HACAlle cache via dedicated endpoint', async () => {
    const server = createTestServer();
    const hacalleFixture = readFixtureBuffer('hacalle_rankings.html');

    nock('https://medlemmer.bridge.dk')
      .get('/HACAlle.php')
      .reply(200, hacalleFixture);

    const refreshed = await request(server).post('/api/cache/refresh/hacalle');
    assert.strictEqual(refreshed.status, 200);
    assert.strictEqual(refreshed.body.cache, 'REFRESH');
    assert.strictEqual(refreshed.body.refreshed, true);
    assert.strictEqual(Array.isArray(refreshed.body.players), true);

    const cached = await request(server).get('/api/hacalle');
    assert.strictEqual(cached.status, 200);
    assert.strictEqual(cached.body.cache, 'HIT');
  });

  it('supports refresh=1 to bypass /api/hacalle cache', async () => {
    const server = createTestServer();
    const hacalleFixture = readFixtureBuffer('hacalle_rankings.html');

    nock('https://medlemmer.bridge.dk')
      .get('/HACAlle.php')
      .times(2)
      .reply(200, hacalleFixture);

    const first = await request(server).get('/api/hacalle');
    assert.strictEqual(first.status, 200);
    assert.strictEqual(first.body.cache, 'MISS');

    const refreshed = await request(server).get('/api/hacalle?refresh=1');
    assert.strictEqual(refreshed.status, 200);
    assert.strictEqual(refreshed.body.cache, 'MISS');
  });
});
