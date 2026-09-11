# aivory-collab

Yjs-compatible realtime collaboration engine (Rust, `yrs`): one WebSocket +
HTTP-OctetStream service for documents and databases with per-doc RBAC backed
by Postgres. Original code, MIT licensed.

## What it does

- Speaks the `y-protocols` sync protocol (compatible with `yjs` 13 browser
  clients) over `GET /yjs/:room` (101 upgrade) plus `GET/PUT
  /api/workspace/:id/doc` (`application/octet-stream`, full-state V1).
- Rooms are keyed `workspace:{id}` (docs/pages), `workspace:db:{id}`
  (databases), `workspace:room:{id}` (project presence channels).
- In-memory rooms (`DashMap`, per-room broadcast) + debounced persist
  (~300ms) into Postgres (`dashboard.workspace_docs.yjs_update`).
- Lazy-load: room-keyed row first, legacy bare-id row merged on first access.
- Closed-by-default RBAC enforced **before** any room is created:
  service credential → full access (or scoped to an asserted agent grant),
  admin JWT → owner, doc owner → owner, per-doc ACL → editor/viewer,
  workspace membership → editor/viewer, first writer of a new doc claims
  ownership, otherwise deny. Viewer writes are dropped server-side
  (HTTP 403; WS updates ignored while broadcasts + awareness still flow).

## Quickstart

```bash
cp .env.example .env   # set DATABASE_URL, JWT_SECRET, COLLAB_SERVICE_TOKEN
docker compose -f compose.minimal.yml up -d --build
curl localhost:3200/health
psql "$DATABASE_URL" -f schema.sql
```

Or local: `cargo run` with `PORT` / `DATABASE_URL` set (no DB → in-memory
mode; authz degrades to authenticated-writer, logged as a warning).

## Auth model (detail: docs/auth.md, protocol: docs/protocol.md)

- `X-Service-Token: <COLLAB_SERVICE_TOKEN>` → service identity. With a known
  `X-Agent-Type` header (HTTP) or `?agent=` param (WS), the caller is scoped
  to that agent's `workspace_agent_acl` grant (fail-closed).
- `Authorization: Bearer <HS256-JWT>` → user identity. Claims: `sub` or
  `user_id`, `account_type` (`admin`/`superadmin` bypass as owner).

## Attribution

Original implementation. No third-party copyleft code is included or
required; dependencies are declared in `Cargo.toml`/`Cargo.lock`.
