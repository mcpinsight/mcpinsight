-- Migration: NNNN_<snake_case>.sql
--
-- What:  <one-sentence description>
-- Why:   <link to story/ADR, plus 1-line rationale>
-- Date:  YYYY-MM-DD
-- Author: <name>
--
-- Rules (repeated here because every migration needs them):
-- 1. APPEND-ONLY. Do not edit previously-applied migrations.
-- 2. Every new column is NULLABLE or has a DEFAULT.
-- 3. No destructive ops (DROP TABLE, DROP COLUMN) without an ADR and a `superseded_by` plan.
-- 4. Every index has a comment naming the query it serves.
-- 5. Transactions are implicit — the migration runner wraps each file in one.

-- ─────────────────────────────────────────────────────────────────
-- Example: adding a column
-- ─────────────────────────────────────────────────────────────────

-- ALTER TABLE mcp_calls
--   ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
-- -- Serves: retry analysis in STORY-042
-- CREATE INDEX idx_mcp_calls_retry ON mcp_calls (retry_count) WHERE retry_count > 0;

-- ─────────────────────────────────────────────────────────────────
-- Example: new table
-- ─────────────────────────────────────────────────────────────────

-- CREATE TABLE tool_confusion (
--   server_name   TEXT NOT NULL,
--   pair_a        TEXT NOT NULL,
--   pair_b        TEXT NOT NULL,
--   similarity    REAL NOT NULL,
--   computed_at   INTEGER NOT NULL,
--   PRIMARY KEY (server_name, pair_a, pair_b)
-- );
-- -- Serves: /api/servers/:name/tool-confusion endpoint
