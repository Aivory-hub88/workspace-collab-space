-- F3-2: bi-directional links (tanpa BacklinkIndexer 0.19.5) — custom kecil
-- Tabel link src -> dst, pg-backed, bukan Yjs. Digunakan untuk panel
-- BiDirectionalLinkPanel ala AFFiNE.
-- Applied:
--   docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-doc-links.sql
CREATE TABLE IF NOT EXISTS dashboard.workspace_doc_links (
  src TEXT NOT NULL,
  dst TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT,
  PRIMARY KEY (src, dst),
  CHECK (src <> dst)
);

CREATE INDEX IF NOT EXISTS idx_workspace_doc_links_src ON dashboard.workspace_doc_links(src);
CREATE INDEX IF NOT EXISTS idx_workspace_doc_links_dst ON dashboard.workspace_doc_links(dst);
