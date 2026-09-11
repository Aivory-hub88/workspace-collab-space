-- Fase 2-1: doc properties + tags (AFFiNE-style WorkspacePropertiesTable)
-- JSONB `tags` (array of {id,label,color}) + `props` (flags) + `created_at`
-- Applied:
--   docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-props-tags.sql
ALTER TABLE dashboard.workspace_docs
  ADD COLUMN IF NOT EXISTS tags JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE dashboard.workspace_docs
  ADD COLUMN IF NOT EXISTS props JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE dashboard.workspace_docs
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

-- Backfill created_at from updated_at where still default (so old docs show correct age)
UPDATE dashboard.workspace_docs
  SET created_at = updated_at
  WHERE created_at = updated_at AND updated_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_workspace_docs_tags_gin
  ON dashboard.workspace_docs USING gin (tags);
