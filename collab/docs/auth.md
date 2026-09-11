# Auth model — aivory-collab

All RBAC is enforced inside the engine (`resolve_access`), called BEFORE any
room is created or any row persisted, on both the WebSocket upgrade path and
the HTTP API path.

## Identities

| Credential | Identity | Scope |
|---|---|---|
| `X-Service-Token` = `COLLAB_SERVICE_TOKEN` | `service` | Full access — UNLESS a known agent type is asserted (see below) |
| `Authorization: Bearer <HS256 JWT>` | `user` / `admin` | `account_type` `admin`/`superadmin` → owner everywhere |
| `?token=` (WS only — browsers can't set headers) | same as above | Same rules |

JWT: HS256, `exp` enforced with 60s leeway. Identity comes from `sub` or
`user_id`. No other claims are read.

## Effective access per doc (first match wins)

1. `service` without asserted agent → `owner`
2. `service` with **known** asserted agent → that agent's
   `workspace_agent_acl(doc_id)` grant (`editor`/`viewer`), else **deny**
3. `admin` JWT → `owner`
4. `dashboard.workspace_docs.owner = user_id` → `owner`
5. ownerless doc → `editor` (first writer claims ownership via
   INSERT-OR-CLAIM with `COALESCE`, so ownership can't be stolen)
6. `dashboard.workspace_doc_acl(doc_id, user_id)` → its role
7. `dashboard.workspace_members(workspace_id, user_id)` →
   `owner`/`editor` collapse to `editor`, `viewer` stays `viewer`
8. otherwise → `deny` (401 no/invalid credential, 403 valid but unauthorized)

## Agent principals

Agents are non-human collaborators identified by an `agent_type` string
(e.g. `lex`, `finn`). They are invited per doc into `workspace_agent_acl`
with `editor` or `viewer`. The type travels as `X-Agent-Type` (HTTP) or
`?agent=` (WS) and is **trusted only with the service identity** — a normal
user asserting it is treated as `"user"`. Unknown agent strings keep legacy
full service access (backwards compatibility for existing integrations).

Viewers (human or agent): HTTP PUT → `403`; WS sync updates dropped
server-side; broadcasts and awareness presence still received (read-only sync).

## Configuration

| Var | Required | Purpose |
|---|---|---|
| `PORT` | no (3200) | listen port |
| `DATABASE_URL` | no (in-memory fallback) | `postgresql://…`; pool lazy, max 4 |
| `JWT_SECRET` | for user JWT | HS256 secret |
| `COLLAB_SERVICE_TOKEN` | for service/agent peers | compared in constant shape (non-empty equality) |
| `RUST_LOG` | no (`info`) | log level |
