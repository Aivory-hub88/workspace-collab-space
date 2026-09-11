-- F2-5: doc icon (emoji) — pg-backed, like AFFiNE DocIconPicker
-- Applied:
--   docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-icon.sql
ALTER TABLE dashboard.workspace_docs
  ADD COLUMN IF NOT EXISTS icon TEXT;
