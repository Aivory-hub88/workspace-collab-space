# workspace-collab-space — canonical storage schema for aivory-collab
#
# The engine reads/writes ONLY these tables (schema `dashboard`).
# Apply once:  psql "$DATABASE_URL" < schema.sql
#
# Design notes:
# - One row per collab room, keyed by the canonical room id
#   (`workspace:{docId}` / `workspace:db:{docId}` / `workspace:room:{id}`).
# - `yjs_update` holds the full Yjs (yrs) document state (BYTEA).
# - Access tables are read on every WS upgrade and HTTP call, before any
#   room is created (closed-by-default: no row → deny, except first-writer
#   claims on brand-new docs).

CREATE SCHEMA IF NOT EXISTS dashboard;

CREATE TABLE IF NOT EXISTS dashboard.workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO dashboard.workspaces (id, name, owner)
VALUES ('default', 'Default Workspace', 'system')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS dashboard.workspace_docs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'default',
  yjs_update BYTEA NOT NULL,
  title TEXT,
  owner TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_docs_workspace_id
  ON dashboard.workspace_docs(workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS dashboard.workspace_members (
  workspace_id TEXT NOT NULL REFERENCES dashboard.workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  added_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user
  ON dashboard.workspace_members(user_id);

CREATE TABLE IF NOT EXISTS dashboard.workspace_doc_acl (
  doc_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  granted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (doc_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_doc_acl_doc
  ON dashboard.workspace_doc_acl(doc_id);

-- Agent principals (non-human collaborators, e.g. AI workers).
-- Enforced only for service-credential callers asserting a known
-- X-Agent-Type (HTTP) or ?agent= (WS). Unknown/absent agent types keep
-- legacy full service access; invited agents are scoped to their grant
-- and fail closed (no row → deny).
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
