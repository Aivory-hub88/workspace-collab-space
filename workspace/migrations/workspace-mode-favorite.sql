-- Fase 1: pg-backed doc mode (page/edgeless) + favorite/star.
-- Reason: BlockSuite DocMeta collection (title/tags) does NOT persist in the
-- 1-doc-1-room architecture (only spaceDoc is PUT), so mode/favorite must
-- live in Postgres. Applied:
--   docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-mode-favorite.sql
ALTER TABLE dashboard.workspace_docs
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'page';

ALTER TABLE dashboard.workspace_docs
  ADD COLUMN IF NOT EXISTS favorite BOOLEAN NOT NULL DEFAULT false;

-- Constrain mode values (guarded so re-runs never fail).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'workspace_docs_mode_check'
  ) THEN
    ALTER TABLE dashboard.workspace_docs
      ADD CONSTRAINT workspace_docs_mode_check CHECK (mode IN ('page', 'edgeless'));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_workspace_docs_favorite
  ON dashboard.workspace_docs(favorite) WHERE favorite = true;
