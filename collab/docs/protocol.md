# Sync protocol — aivory-collab

Compatible with the `y-protocols` sync flow used by `yjs` 13 clients, served
over one port for HTTP and WebSocket.

## Endpoints

| Route | Auth | Behaviour |
|---|---|---|
| `GET /health` | none | `ok` + version string |
| `GET /info` | none | service/crdt/store/ws/api JSON |
| `GET /yjs`, `/yjs/` | `?token=` | WS fallback room `default` |
| `GET /yjs/:room` | `?token=` / `X-Service-Token` / `Bearer` (+ `?agent=` for service peers) | `101` upgrade; denied callers never create rooms |
| `GET /api/workspace/:id/doc` | same as WS | full-state V1 octet-stream; `404` when empty (`len ≤ 2`); `403` when unreadable |
| `PUT /api/workspace/:id/doc` | same + `X-Agent-Type` | apply update + broadcast `0x00 0x02` to WS peers + debounced persist; `403` when unwriteable; `400` on empty/invalid body |

## Message flow (WS)

Standard `y-protocols`: `sync step1 → step2`, `update` apply + broadcast to
room peers, `awareness` (message type 1) passthrough. `yrs` transactions are
`!Send` and never cross `.await` (scoped blocks).

## Reverse-proxy note

`/yjs*` must reach the engine untouched: no path rewriting, no buffering of
the `101` upgrade. A prefix-adding or wrapping proxy in front breaks sync
(the engine answers `404` on plain HTTP to a WS route — that is expected).
