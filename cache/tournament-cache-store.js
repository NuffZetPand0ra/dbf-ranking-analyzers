const fs = require('fs');
const path = require('path');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_IMMUTABLE_DAYS = 60;
const DEFAULT_MUTABLE_TTL_HOURS = 12;
const DEFAULT_PARSER_VERSION = 'turn-v1';

function parsePlayedAtToEpoch(playedAtRaw) {
  if (!playedAtRaw) return null;
  const text = String(playedAtRaw).trim();

  let match = text.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (match) {
    const day = Number(match[1]);
    const month = Number(match[2]);
    const year = Number(match[3]);
    return Date.UTC(year, month - 1, day);
  }

  match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return Date.UTC(year, month - 1, day);
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function safePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

function normalizeParserVersion(value) {
  const version = String(value || '').trim();
  if (!version) return DEFAULT_PARSER_VERSION;
  return version.slice(0, 64);
}

function createTournamentCacheStore(options = {}) {
  const dbPath = options.dbPath;
  const immutableDays = safePositiveInt(options.immutableDays, DEFAULT_IMMUTABLE_DAYS);
  const mutableTtlHours = safePositiveInt(options.mutableTtlHours, DEFAULT_MUTABLE_TTL_HOURS);
  const mutableTtlMs = mutableTtlHours * 60 * 60 * 1000;
  const parserVersion = normalizeParserVersion(options.parserVersion);

  if (!dbPath) {
    return {
      enabled: false,
      reason: 'CACHE_DB_PATH was not set',
      immutableDays,
      mutableTtlHours,
      parserVersion,
      get: () => null,
      upsert: () => null,
      deleteTurn: () => 0,
      clearAll: () => 0,
      deleteExpiredMutable: () => 0,
      deleteRowsForOtherParserVersions: () => 0,
      stats: () => null,
    };
  }

  let Database;
  try {
    Database = require('better-sqlite3');
  } catch (err) {
    return {
      enabled: false,
      reason: `better-sqlite3 unavailable: ${err.message}`,
      immutableDays,
      mutableTtlHours,
      parserVersion,
      get: () => null,
      upsert: () => null,
      deleteTurn: () => 0,
      clearAll: () => 0,
      deleteExpiredMutable: () => 0,
      deleteRowsForOtherParserVersions: () => 0,
      stats: () => null,
    };
  }

  const absoluteDbPath = path.resolve(dbPath);
  const directory = path.dirname(absoluteDbPath);
  fs.mkdirSync(directory, { recursive: true });

  const db = new Database(absoluteDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS turn_cache (
      turn_id TEXT PRIMARY KEY,
      payload_json TEXT NOT NULL,
      cached_at INTEGER NOT NULL,
      played_at INTEGER,
      immutable INTEGER NOT NULL,
      expires_at INTEGER,
      parser_version TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_turn_cache_expires_at ON turn_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_turn_cache_immutable ON turn_cache(immutable);
  `);

  const selectStmt = db.prepare(`
    SELECT payload_json, cached_at, played_at, immutable, expires_at
    FROM turn_cache
    WHERE turn_id = ? AND parser_version = ?
  `);

  const upsertStmt = db.prepare(`
    INSERT INTO turn_cache (
      turn_id, payload_json, cached_at, played_at, immutable, expires_at, parser_version
    ) VALUES (
      @turnId, @payloadJson, @cachedAt, @playedAt, @immutable, @expiresAt, @parserVersion
    )
    ON CONFLICT(turn_id) DO UPDATE SET
      payload_json = excluded.payload_json,
      cached_at = excluded.cached_at,
      played_at = excluded.played_at,
      immutable = excluded.immutable,
      expires_at = excluded.expires_at,
      parser_version = excluded.parser_version
  `);

  const deleteOneStmt = db.prepare('DELETE FROM turn_cache WHERE turn_id = ?');
  const clearAllStmt = db.prepare('DELETE FROM turn_cache');
  const deleteExpiredStmt = db.prepare('DELETE FROM turn_cache WHERE immutable = 0 AND expires_at IS NOT NULL AND expires_at <= ?');
  const deleteOtherVersionsStmt = db.prepare('DELETE FROM turn_cache WHERE parser_version <> ?');
  const statsStmt = db.prepare(`
    SELECT
      COUNT(*) AS totalRows,
      SUM(CASE WHEN parser_version = @parserVersion THEN 1 ELSE 0 END) AS currentVersionRows,
      SUM(CASE WHEN parser_version <> @parserVersion THEN 1 ELSE 0 END) AS otherVersionRows,
      SUM(CASE WHEN immutable = 1 THEN 1 ELSE 0 END) AS immutableRows,
      SUM(CASE WHEN immutable = 0 THEN 1 ELSE 0 END) AS mutableRows,
      SUM(CASE WHEN immutable = 0 AND expires_at IS NOT NULL AND expires_at <= @nowTs THEN 1 ELSE 0 END) AS expiredMutableRows
    FROM turn_cache
  `);

  function classify(payload, now) {
    const playedAtMs = parsePlayedAtToEpoch(payload && payload.playedAt);
    const immutableCutoff = now - immutableDays * DAY_MS;
    const immutable = Number.isFinite(playedAtMs) && playedAtMs <= immutableCutoff;
    const expiresAt = immutable ? null : now + mutableTtlMs;

    return { playedAtMs, immutable, expiresAt };
  }

  function get(turnId, now = Date.now()) {
    try {
      const row = selectStmt.get(String(turnId), parserVersion);
      if (!row) return null;

      const isImmutable = row.immutable === 1;
      if (!isImmutable && row.expires_at !== null && row.expires_at <= now) {
        deleteOneStmt.run(String(turnId));
        return null;
      }

      return {
        data: JSON.parse(row.payload_json),
        cachedAt: row.cached_at,
        immutable: isImmutable,
        expiresAt: row.expires_at,
      };
    } catch (_) {
      return null;
    }
  }

  function upsert(turnId, payload, now = Date.now()) {
    try {
      const { playedAtMs, immutable, expiresAt } = classify(payload, now);
      upsertStmt.run({
        turnId: String(turnId),
        payloadJson: JSON.stringify(payload),
        cachedAt: now,
        playedAt: playedAtMs,
        immutable: immutable ? 1 : 0,
        expiresAt,
        parserVersion,
      });
      return { cachedAt: now, immutable, expiresAt };
    } catch (_) {
      return null;
    }
  }

  function deleteExpiredMutable(now = Date.now()) {
    try {
      const result = deleteExpiredStmt.run(now);
      return result.changes || 0;
    } catch (_) {
      return 0;
    }
  }

  function deleteTurn(turnId) {
    try {
      const result = deleteOneStmt.run(String(turnId));
      return result.changes || 0;
    } catch (_) {
      return 0;
    }
  }

  function clearAll() {
    try {
      const result = clearAllStmt.run();
      return result.changes || 0;
    } catch (_) {
      return 0;
    }
  }

  function deleteRowsForOtherParserVersions() {
    try {
      const result = deleteOtherVersionsStmt.run(parserVersion);
      return result.changes || 0;
    } catch (_) {
      return 0;
    }
  }

  function stats(now = Date.now()) {
    try {
      const row = statsStmt.get({ parserVersion, nowTs: now });
      return {
        totalRows: row.totalRows || 0,
        currentVersionRows: row.currentVersionRows || 0,
        otherVersionRows: row.otherVersionRows || 0,
        immutableRows: row.immutableRows || 0,
        mutableRows: row.mutableRows || 0,
        expiredMutableRows: row.expiredMutableRows || 0,
      };
    } catch (_) {
      return null;
    }
  }

  return {
    enabled: true,
    dbPath: absoluteDbPath,
    immutableDays,
    mutableTtlHours,
    parserVersion,
    get,
    upsert,
    deleteTurn,
    clearAll,
    deleteExpiredMutable,
    deleteRowsForOtherParserVersions,
    stats,
  };
}

module.exports = {
  createTournamentCacheStore,
};
