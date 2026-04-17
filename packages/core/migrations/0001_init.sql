-- Migration: 0001_init.sql
--
-- What:  Initial schema for MCPInsight local database.
-- Why:   First MVP — tracks MCP tool calls, daily rollups, scan state, telemetry consent.
-- Date:  2026-04-18
-- Author: MCPInsight
--
-- Rules:
-- 1. APPEND-ONLY. Never edit this file after it's been applied in production.
-- 2. Every new column is NULLABLE or has a DEFAULT.
-- 3. Every index has a comment naming the query it serves.

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;

-- ─────────────────────────────────────────────────────────────────
-- Migration tracking
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT    NOT NULL
);

-- ─────────────────────────────────────────────────────────────────
-- Core event table — every parsed & normalized MCP tool call.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE mcp_calls (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  client             TEXT    NOT NULL,                 -- 'claude-code' | 'codex' | ...
  session_id         TEXT    NOT NULL,
  project_identity   TEXT    NOT NULL,                 -- INV-01: git-remote-derived preferred
  server_name        TEXT    NOT NULL,
  tool_name          TEXT    NOT NULL,
  ts                 INTEGER NOT NULL,                 -- unix ms
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd           REAL    NOT NULL DEFAULT 0,
  cost_is_estimated  INTEGER NOT NULL DEFAULT 1,       -- INV-02: 0 = real, 1 = estimate
  is_error           INTEGER,                          -- nullable for compacted sessions
  duration_ms        INTEGER
);

-- Serves: date-range queries on /api/servers
CREATE INDEX idx_mcp_calls_ts               ON mcp_calls (ts);
-- Serves: per-server time-series on /api/servers/:name
CREATE INDEX idx_mcp_calls_server_ts        ON mcp_calls (server_name, ts);
-- Serves: --client filter in CLI + /api/clients endpoint
CREATE INDEX idx_mcp_calls_client_server_ts ON mcp_calls (client, server_name, ts);
-- Serves: State of MCP "median cost" — only real costs
CREATE INDEX idx_mcp_cost_real              ON mcp_calls (cost_is_estimated) WHERE cost_is_estimated = 0;

-- ─────────────────────────────────────────────────────────────────
-- Daily rollup — precomputed aggregate per (day, client, server, project).
-- Written by the aggregator on ingest; read by dashboard + CLI `top`.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE server_stats_daily (
  day                TEXT    NOT NULL,                 -- 'YYYY-MM-DD'
  client             TEXT    NOT NULL,
  server_name        TEXT    NOT NULL,
  project_identity   TEXT    NOT NULL,
  calls              INTEGER NOT NULL DEFAULT 0,
  errors             INTEGER NOT NULL DEFAULT 0,
  unique_tools       INTEGER NOT NULL DEFAULT 0,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd_real      REAL    NOT NULL DEFAULT 0,
  cost_usd_est       REAL    NOT NULL DEFAULT 0,
  PRIMARY KEY (day, client, server_name, project_identity)
);

-- Serves: top-servers query (ORDER BY calls DESC over a date range)
CREATE INDEX idx_server_stats_day ON server_stats_daily (day);

-- ─────────────────────────────────────────────────────────────────
-- Scan state — where the parser left off per file.
-- Enables incremental re-scans without re-reading the entire file.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE scan_state (
  file_path          TEXT    PRIMARY KEY,
  last_byte_offset   INTEGER NOT NULL DEFAULT 0,
  last_scanned_at    INTEGER NOT NULL,                 -- unix ms
  client             TEXT    NOT NULL
);

-- ─────────────────────────────────────────────────────────────────
-- Telemetry consent — versioned (INV-03).
-- One row per consent decision the user has made.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE telemetry_consent (
  consent_given_at   INTEGER PRIMARY KEY,              -- unix ms
  anonymous_user_id  TEXT    NOT NULL,
  consent_version    INTEGER NOT NULL,                 -- bumped when schema_fields change
  schema_fields      TEXT    NOT NULL,                 -- JSON array of opted-in field names
  last_synced_at     INTEGER,
  decision           TEXT    NOT NULL                  -- 'opt_in' | 'decline' | 'revoked'
);

-- ─────────────────────────────────────────────────────────────────
-- Telemetry pending — locally-queued events awaiting sync to Worker.
-- Aggregates; no raw calls leave the user's machine.
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE telemetry_pending (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_start_ts     INTEGER NOT NULL,
  batch_end_ts       INTEGER NOT NULL,
  payload_json       TEXT    NOT NULL,                 -- serialized aggregate
  schema_version     INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
);

CREATE INDEX idx_telemetry_pending_created ON telemetry_pending (created_at);

-- ─────────────────────────────────────────────────────────────────
-- License cache — CLI-side copy of license status (offline-capable).
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE license_cache (
  key_hash           TEXT    PRIMARY KEY,              -- sha256 of the full license key
  tier               TEXT    NOT NULL,                 -- 'presale' | 'pro' | 'team'
  expires_at         INTEGER,                          -- unix ms, null = lifetime
  last_validated_at  INTEGER NOT NULL,
  validation_status  TEXT    NOT NULL                  -- 'valid' | 'revoked' | 'grace' | 'offline'
);

-- ─────────────────────────────────────────────────────────────────
-- Record this migration as applied.
-- ─────────────────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, applied_at) VALUES (1, datetime('now'));
