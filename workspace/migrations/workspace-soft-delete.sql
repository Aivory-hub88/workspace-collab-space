-- F3-3: trash soft-delete + restore (deleted_at)
-- Applied:
--   docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-soft-delete.sql
ALTER TABLE dashboard.workspace_docs
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_workspace_docs_deleted_at ON dashboard.workspace_docs(deleted_at) WHERE deleted_at IS NOT NULL;
