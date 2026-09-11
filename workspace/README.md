# workspace engine

Project boards, task databases with custom fields, and collaboration rooms
that AI agents can join as first-class members. Original code, Apache-2.0.

## What it is

- **Pages** (`/` Write view): block notes with slash commands, tags,
  properties, comments, history, backlinks.
- **Data** (`?view=database`): Table / Board / Calendar over one Yjs-backed
  row store, with saved views, row templates, WIP limits, overdue detection,
  threaded row comments, row history, and CSV import.
- **Custom fields**: text / number / select / multi-select / checkbox / date /
  URL — definitions in Postgres props, values in row cells.
- **Projects** (`?view=board`): union board across member docs with per-doc
  read gates; drag cards between columns (atomic move endpoint, WIP-aware).
- **Agent rooms**: invite non-human workers per doc (`editor`/`viewer`,
  Sharing → Agents tab); enforced identically by the collab engine and this
  API, including the Postgres-fallback path when the engine is unreachable.

Companion service: [`../collab`](../collab/README.md) (MIT) — the realtime
sync engine this API proxies through.

## Quickstart

```bash
cp .env.example .env   # fill DATABASE_URL / JWT_SECRET / COLLAB_SERVICE_TOKEN
docker compose -f compose.workspace.yml up -d --build
psql "$DATABASE_URL" -f ../collab/schema.sql
open http://localhost:3000/workspace
```

Local dev: `npm ci && npm run dev` (needs Postgres + collab reachable —
point `DATABASE_URL` / `COLLAB_URL` at them).

## Identity contract

Bring any token issuer that signs HS256 JWTs shaped
`{user_id|sub, email?, account_type?}` (`admin`/`superadmin` bypass as
owner). Tokens travel as `Authorization: Bearer` or the `ws_access_token` /
`ws_session_token` cookies. Service peers use `X-Service-Token` with an
optional asserted `X-Agent-Type` (see `lib/authProvider.ts`).

User display data (emails/names in sharing UI) resolves through a
`UserDirectory` (`lib/authProvider.ts`): id-only by default; implement
`findByEmail`/`describe` against your store and call `setUserDirectory()`.
Email invites 404 until one is configured — user-ID invites always work.

## Key routes

- `GET/POST /api/workspace` — list / create docs
- `GET/PATCH/DELETE /api/workspace/[id]` — meta / rename / props / delete
- `GET/PUT /api/workspace/[id]/doc` — Yjs octet-stream (collab-first)
- `GET/POST /api/workspace/[id]/database` — rows (WIP-gated creates: 409)
- `PATCH/DELETE /api/workspace/[id]/database/[rowId]` — row edit (cell merge)
- `POST /api/workspace/[id]/database/[rowId]/move` — atomic status move
- `GET/POST /api/workspace/[id]/database/[rowId]/comments` — append-only thread
- `GET/POST /api/workspace/[id]/agents`, `DELETE .../agents/[type]` — invites
- `GET /api/workspace/projects/[id]/board` — cross-doc aggregate
- `GET /api/workspace/[id]/activity[?targetType&targetId]` — audit feed

## Attribution

Original implementation. No third-party copyleft code is included.
