-- F4-infra: cover image URL (MinIO workspace-blobs) — pg-backed
-- Applied:
--   docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-cover.sql
ALTER TABLE dashboard.workspace_docs
  ADD COLUMN IF NOT EXISTS cover_url TEXT;
