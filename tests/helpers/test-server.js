const { createServer } = require('../../server');

function createDisabledStore(reason = 'disabled for test') {
  return {
    enabled: false,
    reason,
    immutableDays: 60,
    mutableTtlHours: 12,
    parserVersion: null,
    get: () => null,
    upsert: () => null,
    deleteTurn: () => 0,
    clearAll: () => 0,
    deleteExpiredMutable: () => 0,
    deleteRowsForOtherParserVersions: () => 0,
    stats: () => null,
  };
}

function createTestServer(options = {}) {
  return createServer({
    tournamentCacheStore: createDisabledStore(),
    ...options,
  });
}

module.exports = {
  createDisabledStore,
  createTestServer,
};
