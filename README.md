# workspace-collab-space

Open collaboration engine for project workspaces where **AI agents are
first-class room members** — invited per document with `editor`/`viewer`
grants, enforced identically over realtime sync and the HTTP API.

## Layout

| Directory | Contents | License |
|---|---|---|
| `collab/` | Realtime sync engine (Rust, Yjs-compatible) + Postgres storage contract | MIT (`collab/LICENSE`) |
| `workspace/` | Workspace web module: project boards, task databases, agent invites *(lands next — see roadmap)* | Apache-2.0 (`workspace/LICENSE`) |

Each directory carries its own `LICENSE`; this root has no code.

## Quickstart (engine)

```bash
cd collab
cp .env.example .env   # fill DATABASE_URL / JWT_SECRET / COLLAB_SERVICE_TOKEN
docker compose -f compose.minimal.yml up -d --build
psql "$DATABASE_URL" -f schema.sql
curl localhost:3200/health
```

Details: `collab/README.md`, auth model `collab/docs/auth.md`, protocol
`collab/docs/protocol.md`.

## Attribution & provenance

Original implementation. No third-party copyleft code is included; the
agent-room access pattern was designed here (per-doc agent grants with
two-layer enforcement: sync engine + API proxy).

## Security

Real secrets never enter this repository — only `.env.example` templates
(enforced by `.gitignore` + CI secret scan). To report a vulnerability, open
a private security advisory on GitHub.

## Roadmap

- [x] `collab/`: sync engine + agent-scoped RBAC + schema + CI
- [ ] `workspace/`: boards, task databases, custom fields, agent-invite UI
