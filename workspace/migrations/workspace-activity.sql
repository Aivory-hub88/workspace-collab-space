-- Durable human/agent activity for the shared workspace surface.
CREATE TABLE IF NOT EXISTS dashboard.workspace_activity (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  doc_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  summary TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('proposed', 'applied', 'rejected', 'failed')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_doc_time
  ON dashboard.workspace_activity(doc_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_workspace_activity_workspace_time
  ON dashboard.workspace_activity(workspace_id, created_at DESC);
