-- Workspace access requests (MVP gated sharing)
-- Requester asks for access to a doc they can't open; owner/admin approves/denies.
-- Applied: docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-access-requests.sql

CREATE TABLE IF NOT EXISTS dashboard.workspace_access_requests (
  id TEXT PRIMARY KEY,
  doc_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  requester_id TEXT NOT NULL,
  requester_email TEXT,
  role_requested TEXT NOT NULL CHECK (role_requested IN ('viewer','editor')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','denied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by TEXT,
  UNIQUE (doc_id, requester_id, status) -- one pending per user per doc
);

CREATE INDEX IF NOT EXISTS idx_workspace_access_requests_doc
  ON dashboard.workspace_access_requests(doc_id, status);
CREATE INDEX IF NOT EXISTS idx_workspace_access_requests_requester
  ON dashboard.workspace_access_requests(requester_id);
