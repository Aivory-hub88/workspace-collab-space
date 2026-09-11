-- F4-4: history snapshots (yjs_update versions) per doc
-- Applied:
--   docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-history.sql
CREATE TABLE IF NOT EXISTS dashboard.workspace_doc_history (
  id BIGSERIAL PRIMARY KEY,
  doc_id TEXT NOT NULL,
  yjs_update BYTEA NOT NULL,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_doc_history_doc_time ON dashboard.workspace_doc_history(doc_id, created_at DESC);
