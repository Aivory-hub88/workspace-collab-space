-- Workspace AuthZ (collab y-octo) — workspaces, membership with roles, per-doc ACL.
-- Applied: docker exec -i avry-postgres psql -U aivory -d aivory < migrations/workspace-authz.sql
--
-- Access model (closed by default, enforced in aivory-collab + dashboard proxy):
--   1. service credential (COLLAB_SERVICE_TOKEN) → full access, X-Agent-Type trusted
--   2. account_type admin/superadmin (verified JWT claim) → full access
--   3. dashboard.workspace_docs.owner = user_id → full access (doc owner)
--   4. dashboard.workspace_doc_acl(doc_id, user_id) → editor / viewer
--   5. dashboard.workspace_members(workspace_id, user_id) → editor / viewer
--      (workspace taken from the doc row's workspace_id, default 'default')
--   6. otherwise → deny (401 no/invalid credential, 403 valid but unauthorized)
-- Viewers: read-only — HTTP PUT 403, WS sync updates dropped server-side.
-- New docs: first writer claims owner (owner = user_id).

CREATE TABLE IF NOT EXISTS dashboard.workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the default workspace. Owner = oldest superadmin, else oldest user,
-- else 'system' (no users yet). Admins always bypass, so the seed owner is
-- only a fallback contact, not a gate.
INSERT INTO dashboard.workspaces (id, name, owner)
SELECT 'default', 'Default Workspace',
       COALESCE(
         (SELECT id FROM identity.users WHERE is_superadmin ORDER BY created_at ASC LIMIT 1),
         (SELECT id FROM identity.users ORDER BY created_at ASC LIMIT 1),
         'system'
       )
ON CONFLICT (id) DO NOTHING;

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

-- Per-doc override, managed by the doc owner (or workspace owner / admin).
-- When a row exists it wins over workspace membership for that (doc, user).
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

-- Backfill: assign ownerless docs to the workspace owner (admin) so existing
-- content stays reachable and manageable during the closed-by-default cutover
-- (admins bypass access checks anyway; the owner is what enables invites).
-- Rows in workspaces without a real owner ('system') keep owner NULL → their
-- docs stay accessible to admins only, which is the safe default.
UPDATE dashboard.workspace_docs wd
SET owner = ws.owner
FROM dashboard.workspaces ws
WHERE wd.owner IS NULL
  AND ws.id = wd.workspace_id
  AND ws.owner <> 'system';
