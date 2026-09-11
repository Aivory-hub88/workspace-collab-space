-- Workspace Agent ACL (Fase 1 Opsi C) — Cerveau agents as first-class principals.
-- Applied: docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-agent-acl.sql
--
-- Access model addition (enforced in dashboard lib/workspaceAccess.ts +
-- aivory-collab resolve_access, service-credential + X-Agent-Type only):
--   dashboard.workspace_agent_acl(doc_id, agent_type) → editor / viewer
-- Agents are NOT in identity.users and can NOT request access; only the doc
-- owner (or admin) can invite/revoke them via /api/workspace/[id]/agents.
-- Service calls WITHOUT an asserted agent type keep legacy full access.
-- Agent types (validated in API, not CHECK-constrained so new agents don't
-- need a migration): autonomous, customer_service, leads_qualifier,
-- finance_invoice_ops, office_assistant.

CREATE TABLE IF NOT EXISTS dashboard.workspace_agent_acl (
  doc_id TEXT NOT NULL,
  agent_type TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  granted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, agent_type)
);

CREATE INDEX IF NOT EXISTS idx_workspace_agent_acl_agent
  ON dashboard.workspace_agent_acl(agent_type);
