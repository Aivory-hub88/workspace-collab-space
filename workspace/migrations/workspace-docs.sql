-- Workspace Yjs docs — Phase B persistence
-- Applied: docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-docs.sql

CREATE TABLE IF NOT EXISTS dashboard.workspace_docs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  yjs_update BYTEA NOT NULL,
  title TEXT,
  owner TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_docs_workspace_id ON dashboard.workspace_docs(workspace_id, updated_at DESC);
