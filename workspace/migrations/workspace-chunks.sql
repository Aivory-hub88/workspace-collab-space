-- Semantic search chunks (Fase 4c2): task-row texts + embeddings.
-- Applied: docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-chunks.sql
--
-- `embedding` is intentionally unconstrained `vector` (no fixed dims) so the
-- embedding model can change without a migration; exact cosine (<=>) is used
-- instead of an index (correct at our scale; add HNSW with fixed dims later
-- if rows ever approach six figures). Rows are (re)indexed best-effort on
-- write; missing embeddings simply don't participate in ranking.

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS dashboard.workspace_chunks (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  doc_id TEXT NOT NULL,
  row_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding vector,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (doc_id, row_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_chunks_doc
  ON dashboard.workspace_chunks(doc_id);
