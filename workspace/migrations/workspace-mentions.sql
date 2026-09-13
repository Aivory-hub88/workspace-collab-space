-- Workspace mentions inbox (Fase 4b) — @agent / @email parsed at write time.
-- Applied: docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-mentions.sql
--
-- A mention is created when comment text or a row description contains
-- @<agent name|type> (resolved to the 5 known agent types) or @<email>.
-- Readers: the notification inbox (per agent type or user email).
-- Read state per (mention, reader) would fan out; instead mark-read is a
-- watermark: dashboard.workspace_mention_reads(reader_kind, reader_id, read_at)
-- and inbox shows mentions created after the reader's watermark.

CREATE TABLE IF NOT EXISTS dashboard.workspace_mentions (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  doc_id TEXT NOT NULL,
  row_id TEXT,
  actor_type TEXT NOT NULL DEFAULT 'user',
  actor_id TEXT,
  actor_name TEXT,
  mentioned_kind TEXT NOT NULL CHECK (mentioned_kind IN ('agent', 'user')),
  mentioned_id TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'comment' CHECK (source IN ('comment', 'description')),
  excerpt TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_mentions_inbox
  ON dashboard.workspace_mentions(mentioned_kind, mentioned_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_mentions_doc
  ON dashboard.workspace_mentions(doc_id, created_at DESC);

CREATE TABLE IF NOT EXISTS dashboard.workspace_mention_reads (
  reader_kind TEXT NOT NULL CHECK (reader_kind IN ('agent', 'user')),
  reader_id TEXT NOT NULL,
  read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (reader_kind, reader_id)
);
