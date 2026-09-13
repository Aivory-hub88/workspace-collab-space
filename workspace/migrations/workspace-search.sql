-- Workspace search support (Fase 4c): trigram similarity for doc titles.
-- Applied: docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-search.sql
--
-- Row content lives in Yjs blobs and is decoded at request time (bounded);
-- only titles/tags are indexed here. Requires a role that can CREATE
-- extensions (the aivory role already owns the vector extension).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_workspace_docs_title_trgm
  ON dashboard.workspace_docs USING gin (title gin_trgm_ops);
