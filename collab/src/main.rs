use axum::{
    body::Bytes,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Path, Query, State,
    },
    http::{HeaderMap, StatusCode},
    response::IntoResponse,
    routing::get,
    Router,
};
use dashmap::DashMap;
use futures::{sink::SinkExt, stream::StreamExt};
use sqlx::Row;
use std::{collections::HashMap, net::SocketAddr, sync::Arc, time::Duration};
use tokio::sync::{broadcast, mpsc};
use tracing::{info, warn};
use yrs::{updates::decoder::Decode, Doc, ReadTxn, StateVector, Transact, Update};

type RoomId = String;

#[derive(Clone)]
struct Room {
    doc: Arc<Doc>,
    tx: broadcast::Sender<Vec<u8>>,
    flush_tx: mpsc::UnboundedSender<()>,
}

#[derive(Clone)]
struct AppState {
    rooms: Arc<DashMap<RoomId, Room>>,
    pg: Option<sqlx::postgres::PgPool>,
    auth: AuthConfig,
}

// ---- AuthZ: JWT (HS256, shared JWT_SECRET) + service token + per-doc RBAC ----
//
// Credential transport: `Authorization: Bearer <jwt>` on HTTP, `?token=<jwt>`
// on the WS upgrade (browsers cannot set WS headers). The dashboard's
// server-side proxy attaches `X-Service-Token: <COLLAB_SERVICE_TOKEN>` for
// agent-originated calls that carry no user session — only then is the
// client-asserted `X-Agent-Type` trusted.
//
// Effective access for a doc (closed by default):
//   service credential / account_type admin|superadmin / doc owner  → write
//   workspace_doc_acl(doc, user) = editor                            → write
//   workspace_doc_acl(doc, user) = viewer                            → read-only
//   workspace_members(doc workspace, user) = editor|owner            → write
//   workspace_members(doc workspace, user) = viewer                  → read-only
//   no doc row yet (new doc)                                         → write (first writer claims owner)
//   otherwise                                                        → deny
// Viewers: HTTP PUT → 403; WS sync updates from them are dropped server-side
// (they still receive broadcasts + awareness, i.e. read-only sync).

#[derive(Debug, serde::Deserialize)]
struct Claims {
    #[serde(default)]
    sub: Option<String>,
    #[serde(default)]
    user_id: Option<String>,
    #[serde(default)]
    account_type: Option<String>,
}

#[derive(Clone, Default)]
struct AuthConfig {
    jwt_secret: Option<Vec<u8>>,
    service_token: Option<String>,
}

#[derive(Clone, Debug)]
enum Identity {
    Service,
    Admin { user_id: String },
    User { user_id: String },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Role {
    Owner,
    Editor,
    Viewer,
    Deny,
}

#[derive(Clone, Debug)]
struct Access {
    role: Role,
    user_id: String,
}

impl Access {
    fn can_read(&self) -> bool {
        self.role != Role::Deny
    }
    fn can_write(&self) -> bool {
        matches!(self.role, Role::Owner | Role::Editor)
    }
    fn role_name(&self) -> &'static str {
        match self.role {
            Role::Owner => "owner",
            Role::Editor => "editor",
            Role::Viewer => "viewer",
            Role::Deny => "deny",
        }
    }
}

fn parse_role(s: &str) -> Role {
    match s {
        "owner" => Role::Owner,
        "editor" => Role::Editor,
        "viewer" => Role::Viewer,
        _ => Role::Deny,
    }
}

fn bearer_token(headers: &HeaderMap) -> Option<String> {
    headers
        .get(axum::http::header::AUTHORIZATION)?
        .to_str()
        .ok()?
        .strip_prefix("Bearer ")
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Credential from request headers: `X-Service-Token` (dashboard→collab agent
/// calls) first, then `Authorization: Bearer <jwt>` (users).
fn extract_credential(headers: &HeaderMap) -> Option<String> {
    if let Some(v) = headers.get("x-service-token").and_then(|v| v.to_str().ok()) {
        if !v.trim().is_empty() {
            return Some(v.trim().to_string());
        }
    }
    bearer_token(headers)
}

/// Verify a credential string → Identity. Service token first, then HS256 JWT
/// (exp enforced, 60s leeway). Returns None for missing/invalid credentials.
fn verify_credential(auth: &AuthConfig, credential: Option<&str>) -> Option<Identity> {
    let tok = credential.filter(|s| !s.is_empty())?;
    if let Some(svc) = &auth.service_token {
        if !svc.is_empty() && tok == svc {
            return Some(Identity::Service);
        }
    }
    let secret = auth.jwt_secret.as_ref()?;
    let mut validation = jsonwebtoken::Validation::new(jsonwebtoken::Algorithm::HS256);
    validation.leeway = 60;
    let data = jsonwebtoken::decode::<Claims>(
        tok,
        &jsonwebtoken::DecodingKey::from_secret(secret),
        &validation,
    )
    .ok()?;
    let c = data.claims;
    let user_id = c.user_id.or(c.sub).filter(|s| !s.is_empty())?;
    match c.account_type.as_deref() {
        Some("admin") | Some("superadmin") => Some(Identity::Admin { user_id }),
        _ => Some(Identity::User { user_id }),
    }
}

/// Trusted agent type for service callers only (X-Agent-Type header).
/// Returns None for everyone else — client-asserted values from users
/// must never scope (or expand) access.
fn trusted_agent(headers: &HeaderMap, id: &Identity) -> Option<String> {
    if !matches!(id, Identity::Service) {
        return None;
    }
    headers
        .get("x-agent-type")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Split a WS room (`workspace:{id}`, `workspace:db:{id}`, bare) into the
/// room key (CRDT identity) and the bare doc id (authz identity).
fn room_doc_ids(room: &str) -> (String, String) {
    let bare = room
        .trim_start_matches("workspace:")
        .trim_start_matches("db:")
        .to_string();
    (room.to_string(), bare)
}

/// Agent types the dashboard may invite to a doc (Fase 1 Opsi C).
/// Must match `KNOWN_AGENT_TYPES` in dashboard lib/workspaceAccess.ts.
fn is_known_agent(s: &str) -> bool {
    matches!(
        s,
        "autonomous" | "customer_service" | "leads_qualifier" | "finance_invoice_ops" | "office_assistant"
    )
}

/// Access for a service caller asserting a known agent type: scoped to the
/// agent's grant in dashboard.workspace_agent_acl (editor/viewer).
/// Not invited / revoked → Deny. Unknown table (pre-migration) → Deny
/// (closed by default; fail-closed is the safe side for agents).
async fn agent_access(state: &AppState, doc_id: &str, agent: &str) -> Access {
    let user_id = format!("agent:{agent}");
    let Some(pg) = &state.pg else {
        warn!("authz degraded: no pg store, invited agent denied (in-memory mode)");
        return Access { role: Role::Deny, user_id };
    };
    match sqlx::query_scalar::<_, String>(
        "SELECT role FROM dashboard.workspace_agent_acl WHERE doc_id = $1 AND agent_type = $2",
    )
    .bind(doc_id)
    .bind(agent)
    .fetch_optional(pg)
    .await
    {
        Ok(Some(role)) => Access { role: parse_role(&role), user_id },
        _ => Access { role: Role::Deny, user_id },
    }
}

/// Resolve effective access. Called BEFORE ensure_room so denied callers never
/// create rooms (or persist rows) as a side effect.
///
/// `agent` is the trusted agent type (Some only when the caller proved the
/// service identity — X-Agent-Type header or ?agent= WS param). A known agent
/// type scopes the service caller to that agent's grant; anything else keeps
/// legacy full service access.
async fn resolve_access(
    state: &AppState,
    doc_id: &str,
    room_key: &str,
    id: &Identity,
    agent: Option<&str>,
) -> Access {
    let user_id = match id {
        Identity::Service => {
            if let Some(a) = agent.map(str::trim).filter(|s| !s.is_empty() && *s != "user") {
                if is_known_agent(a) {
                    return agent_access(state, doc_id, a).await;
                }
            }
            return Access { role: Role::Owner, user_id: "service".into() };
        }
        Identity::Admin { user_id } => return Access { role: Role::Owner, user_id: user_id.clone() },
        Identity::User { user_id } => user_id.clone(),
    };
    let Some(pg) = &state.pg else {
        warn!("authz degraded: no pg store, authenticated user gets write (in-memory mode)");
        return Access { role: Role::Editor, user_id };
    };
    // doc row: prefer the room-keyed (OctoBase) row, fall back to legacy bare-id row
    let rows = sqlx::query(
        "SELECT id, owner, workspace_id FROM dashboard.workspace_docs WHERE id = $1 OR id = $2",
    )
    .bind(room_key)
    .bind(doc_id)
    .fetch_all(pg)
    .await
    .unwrap_or_default();
    let row = rows.iter().find(|r| r.get::<String, _>("id") == room_key).or_else(|| rows.first());
    let Some(row) = row else {
        // new doc — any authenticated user may create it (first writer claims owner)
        return Access { role: Role::Editor, user_id };
    };
    let owner: Option<String> = row.try_get("owner").ok().flatten();
    if owner.as_deref() == Some(user_id.as_str()) {
        return Access { role: Role::Owner, user_id };
    }
    if owner.is_none() {
        // ownerless doc (new or backfill miss) — first writer claims ownership
        return Access { role: Role::Editor, user_id };
    }
    let workspace_id: String = row
        .try_get("workspace_id")
        .ok()
        .filter(|s: &String| !s.is_empty())
        .unwrap_or_else(|| "default".to_string());
    // per-doc override wins over workspace membership
    if let Ok(Some(role)) = sqlx::query_scalar::<_, String>(
        "SELECT role FROM dashboard.workspace_doc_acl WHERE doc_id = $1 AND user_id = $2",
    )
    .bind(doc_id)
    .bind(&user_id)
    .fetch_optional(pg)
    .await
    {
        return Access { role: parse_role(&role), user_id };
    }
    if let Ok(Some(role)) = sqlx::query_scalar::<_, String>(
        "SELECT role FROM dashboard.workspace_members WHERE workspace_id = $1 AND user_id = $2",
    )
    .bind(&workspace_id)
    .bind(&user_id)
    .fetch_optional(pg)
    .await
    {
        return Access { role: parse_role(&role), user_id };
    }
    Access { role: Role::Deny, user_id }
}

/// Load a Yjs update (V1) from OctoBase pg store and apply it into `doc`.
async fn octobase_load(pg: &sqlx::postgres::PgPool, key: &str, doc: &Doc) -> Option<usize> {
    let row = sqlx::query("SELECT yjs_update FROM dashboard.workspace_docs WHERE id = $1")
        .bind(key)
        .fetch_optional(pg)
        .await
        .ok()??;
    let bytes: Vec<u8> = row.try_get("yjs_update").ok()?;
    if bytes.is_empty() {
        return None;
    }
    let n = bytes.len();
    if let Ok(update) = Update::decode_v1(&bytes) {
        let mut txn = doc.transact_mut();
        txn.apply_update(update);
        Some(n)
    } else {
        None
    }
}

/// Debounced flush task per room: on trigger, wait out the window, then
/// encode the full doc state and upsert into OctoBase pg store.
async fn flush_task(state: AppState, room_id: RoomId, doc: Arc<Doc>, mut rx: mpsc::UnboundedReceiver<()>) {
    loop {
        if rx.recv().await.is_none() {
            break; // room dropped
        }
        // debounce window — collapse bursts of edits into one flush
        tokio::time::sleep(Duration::from_millis(300)).await;
        while rx.try_recv().is_ok() {}
        let Some(pg) = state.pg.clone() else { continue };
        // yrs Transaction is !Send — scope it so no borrow crosses the await below
        let upd = {
            let txn = doc.transact();
            txn.encode_state_as_update_v1(&StateVector::default())
        };
        if upd.len() <= 2 {
            continue; // empty doc, nothing to persist
        }
        match sqlx::query(
            "INSERT INTO dashboard.workspace_docs (id, yjs_update, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (id) DO UPDATE SET yjs_update = EXCLUDED.yjs_update, updated_at = now()",
        )
        .bind(&room_id)
        .bind(upd)
        .execute(&pg)
        .await
        {
            Ok(_) => {}
            Err(e) => warn!(room=%room_id, "OctoBase flush failed: {}", e),
        }
    }
}

impl AppState {
    /// Get or create a room, lazily loading its state from the OctoBase pg
    /// store on first access. Rooms are keyed by their full room id
    /// (`workspace:{docId}`, `workspace:db:{docId}`). On first-ever access it
    /// also merges the legacy dashboard BYTEA row (keyed by bare docId) —
    /// that is the built-in yjs→OctoBase migration.
    async fn ensure_room(self, room_id: &str) -> Room {
        if let Some(r) = self.rooms.get(room_id) {
            return r.clone();
        }
        let doc = Arc::new(Doc::new());
        if let Some(pg) = &self.pg {
            // 1) OctoBase row (room-keyed)
            if let Some(n) = octobase_load(pg, room_id, &doc).await {
                info!(room=%room_id, bytes=%n, "OctoBase lazy-load");
            }
            // 2) legacy dashboard row (bare docId) — yjs→OctoBase migration, applied once
            let legacy_id = room_id
                .trim_start_matches("workspace:")
                .trim_start_matches("db:");
            if legacy_id != room_id {
                if let Some(n) = octobase_load(pg, legacy_id, &doc).await {
                    info!(room=%room_id, legacy=%legacy_id, bytes=%n, "legacy BYTEA migrated into y-octo");
                }
            }
        }
        let (tx, _) = broadcast::channel(1024);
        let (flush_tx, flush_rx) = mpsc::unbounded_channel();
        let room = Room { doc: doc.clone(), tx, flush_tx };
        self.rooms.insert(room_id.to_string(), room.clone());
        let st = self.clone();
        let rid = room_id.to_string();
        tokio::spawn(flush_task(st, rid, doc, flush_rx));
        room
    }
}

async fn health() -> impl IntoResponse {
    (StatusCode::OK, "aivory-collab ok 3200 y-octo")
}

async fn info() -> impl IntoResponse {
    axum::Json(serde_json::json!({
        "service": "aivory-collab",
        "port": 3200,
        "crdt": "y-octo (yrs 0.17, yjs 13 compat)",
        "store": "OctoBase pg-backed (dashboard.workspace_docs, lazy-load + debounce flush)",
        "ws": "/yjs/:room — 101 y-websocket compat",
        "health": "/health",
        "api": "/api/workspace/:id/doc (GET/PUT octet-stream, X-Agent-Type)"
    }))
}

async fn http_get_doc(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let Some(identity) = verify_credential(&state.auth, extract_credential(&headers).as_deref()) else {
        return (StatusCode::UNAUTHORIZED, "missing or invalid credential").into_response();
    };
    let (room_key, doc_id) = room_doc_ids(&format!("workspace:{}", id));
    let agent_hdr = trusted_agent(&headers, &identity);
    let access = resolve_access(&state, &doc_id, &room_key, &identity, agent_hdr.as_deref()).await;
    if !access.can_read() {
        warn!(id=%id, user=%access.user_id, "GET /api/workspace/:id/doc denied");
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let room = state.clone().ensure_room(&room_key).await;
    let txn = room.doc.transact();
    let upd = txn.encode_state_as_update_v1(&StateVector::default());
    // if doc empty, return 404 to let caller fallback to localStorage
    if upd.len() <= 2 {
        return (StatusCode::NOT_FOUND, "empty").into_response();
    }
    (
        StatusCode::OK,
        [
            (axum::http::header::CONTENT_TYPE, "application/octet-stream"),
            (axum::http::header::CACHE_CONTROL, "no-store"),
        ],
        upd,
    )
        .into_response()
}

async fn http_put_doc(
    Path(id): Path<String>,
    State(state): State<AppState>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if body.is_empty() {
        return (StatusCode::BAD_REQUEST, "empty").into_response();
    }
    let Some(identity) = verify_credential(&state.auth, extract_credential(&headers).as_deref()) else {
        return (StatusCode::UNAUTHORIZED, "missing or invalid credential").into_response();
    };
    let (room_key, doc_id) = room_doc_ids(&format!("workspace:{}", id));
    // X-Agent-Type is client-asserted: trust it only for the service identity
    // (dashboard proxy with COLLAB_SERVICE_TOKEN). Everyone else is "user".
    // Extracted BEFORE resolve_access so an asserted known agent is scoped
    // to its workspace_agent_acl grant instead of getting full service access.
    let agent_hdr = trusted_agent(&headers, &identity);
    let access = resolve_access(&state, &doc_id, &room_key, &identity, agent_hdr.as_deref()).await;
    if !access.can_write() {
        warn!(id=%id, user=%access.user_id, role=%access.role_name(), "PUT /api/workspace/:id/doc denied");
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let agent = agent_hdr.unwrap_or_else(|| "user".to_string());
    let room = state.clone().ensure_room(&room_key).await;
    // first writer claims ownership of ownerless docs (closed-by-default model).
    // INSERT-OR-CLAIM: the flush task creates the row ~300ms later, so a plain
    // UPDATE here would match nothing for brand-new docs. COALESCE keeps an
    // existing owner (no ownership theft). NOTE: must run BEFORE touching the
    // yjs update — yrs `Update` is !Send and must not be alive across an await.
    if let Some(pg) = &state.pg {
        let _ = sqlx::query(
            "INSERT INTO dashboard.workspace_docs (id, workspace_id, owner, yjs_update, updated_at)
             VALUES ($1, 'default', $2, ''::bytea, now())
             ON CONFLICT (id) DO UPDATE
               SET owner = COALESCE(dashboard.workspace_docs.owner, EXCLUDED.owner),
                   updated_at = now()",
        )
        .bind(&room_key)
        .bind(&access.user_id)
        .execute(pg)
        .await;
    }
    // apply update to doc
    if let Ok(update) = Update::decode_v1(&body) {
        {
            let mut txn = room.doc.transact_mut();
            txn.apply_update(update);
        }
        // broadcast as sync update to ws peers
        let mut fwd = Vec::with_capacity(2 + body.len() + 8);
        fwd.push(0);
        fwd.push(2);
        encode_var_uint(body.len(), &mut fwd);
        fwd.extend_from_slice(&body);
        let _ = room.tx.send(fwd);
        let _ = room.flush_tx.send(()); // OctoBase persist (debounced)
        info!(id=%id, user=%access.user_id, role=%access.role_name(), agent=%agent, bytes=%body.len(), "http PUT /api/workspace/:id/doc via y-octo");
        return (StatusCode::OK, axum::Json(serde_json::json!({ "id": id, "agent": agent, "bytes": body.len() }))).into_response();
    }
    (StatusCode::BAD_REQUEST, "invalid yjs update").into_response()
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Path(room): Path<String>,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    // browsers cannot set WS headers → credential travels as ?token= (or the
    // service token for server-side agent peers). Checked BEFORE ensure_room
    // so denied callers never create rooms as a side effect.
    let credential = params
        .get("token")
        .cloned()
        .or_else(|| extract_credential(&headers));
    let Some(identity) = verify_credential(&state.auth, credential.as_deref()) else {
        warn!(room=%room, "ws upgrade denied: missing or invalid credential");
        return (StatusCode::UNAUTHORIZED, "missing or invalid credential").into_response();
    };
    let (room_key, doc_id) = room_doc_ids(&room);
    // Server-side agent peers (Cerveau worker) assert their type via ?agent=
    // — trusted only with the service token, like the X-Agent-Type header.
    let ws_agent = if matches!(identity, Identity::Service) {
        params
            .get("agent")
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
    } else {
        None
    };
    let access = resolve_access(&state, &doc_id, &room_key, &identity, ws_agent.as_deref()).await;
    if !access.can_read() {
        warn!(room=%room, user=%access.user_id, "ws upgrade denied: forbidden");
        return (StatusCode::FORBIDDEN, "forbidden").into_response();
    }
    let can_write = access.can_write();
    info!(room=%room, user=%access.user_id, role=%access.role_name(), write=%can_write, agent=?ws_agent, "ws upgrade /yjs/:room");
    ws.on_upgrade(move |socket| handle_socket(socket, room, state, can_write))
}

async fn ws_handler_root(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    State(state): State<AppState>,
) -> impl IntoResponse {
    ws_handler(ws, headers, Path("default".to_string()), Query(params), State(state)).await
}

fn encode_var_uint(mut n: usize, out: &mut Vec<u8>) {
    loop {
        let b = (n & 0x7f) as u8;
        n >>= 7;
        if n == 0 {
            out.push(b);
            break;
        } else {
            out.push(b | 0x80);
        }
    }
}

fn decode_var_uint(buf: &[u8]) -> (usize, usize) {
    let mut num: usize = 0;
    let mut shift = 0;
    for (i, &b) in buf.iter().enumerate() {
        num |= ((b & 0x7f) as usize) << shift;
        shift += 7;
        if b & 0x80 == 0 {
            return (num, i + 1);
        }
        if shift >= 28 {
            break;
        }
    }
    (0, 0)
}

async fn handle_socket(socket: WebSocket, room: String, state: AppState, can_write: bool) {
    let room_obj = state.clone().ensure_room(&room).await;
    let doc = room_obj.doc.clone();
    let tx = room_obj.tx.clone();
    let flush = room_obj.flush_tx.clone();
    let rx = tx.subscribe();

    let (ws_sender, mut ws_receiver) = socket.split();
    let (mpsc_tx, mut mpsc_rx) = tokio::sync::mpsc::unbounded_channel::<Vec<u8>>();

    // syncStep1 init
    {
        let txn = doc.transact();
        let sv = txn.state_vector();
        use yrs::updates::encoder::{Encode, Encoder, EncoderV1};
        let mut enc = EncoderV1::new();
        sv.encode(&mut enc);
        let sv_bytes = enc.to_vec();
        let mut msg = Vec::with_capacity(2 + sv_bytes.len() + 4);
        msg.push(0u8);
        msg.push(0u8);
        encode_var_uint(sv_bytes.len(), &mut msg);
        msg.extend_from_slice(&sv_bytes);
        let _ = mpsc_tx.send(msg);
    }

    let mpsc_tx_bcast = mpsc_tx.clone();
    let bcast_task = tokio::spawn(async move {
        let mut rx = rx;
        while let Ok(msg) = rx.recv().await {
            if mpsc_tx_bcast.send(msg).is_err() {
                break;
            }
        }
    });

    let mut sender = ws_sender;
    let forward_task = tokio::spawn(async move {
        while let Some(bytes) = mpsc_rx.recv().await {
            if sender.send(Message::Binary(bytes)).await.is_err() {
                break;
            }
        }
    });

    while let Some(Ok(msg)) = ws_receiver.next().await {
        let data = match msg {
            Message::Binary(b) => b,
            Message::Text(t) => t.into_bytes(),
            Message::Close(_) => break,
            _ => continue,
        };
        if data.is_empty() {
            continue;
        }
        match data[0] {
            0 => {
                if data.len() < 2 {
                    continue;
                }
                let sync_type = data[1];
                let payload = &data[2..];
                let (len, offset) = decode_var_uint(payload);
                if len == 0 && offset == 0 {
                    continue;
                }
                if payload.len() < offset + len {
                    continue;
                }
                let update_bytes = &payload[offset..offset + len];
                match sync_type {
                    0 => {
                        // syncStep1 -> syncStep2
                        let sv = match StateVector::decode_v1(update_bytes) {
                            Ok(sv) => sv,
                            Err(_) => continue,
                        };
                        let txn = doc.transact();
                        let diff = txn.encode_state_as_update_v1(&sv);
                        let mut reply = Vec::with_capacity(2 + diff.len() + 8);
                        reply.push(0);
                        reply.push(1);
                        encode_var_uint(diff.len(), &mut reply);
                        reply.extend_from_slice(&diff);
                        let _ = mpsc_tx.send(reply);
                    }
                    1 => {
                        // syncStep2 / update from peer = a write: viewers are
                        // read-only, their updates are dropped (no apply, no
                        // broadcast, no persist) while they keep receiving sync.
                        if !can_write {
                            continue;
                        }
                        if let Ok(update) = Update::decode_v1(update_bytes) {
                            let mut txn = doc.transact_mut();
                            txn.apply_update(update);
                            drop(txn);
                            let _ = flush.send(()); // OctoBase persist (debounced)
                        }
                    }
                    2 => {
                        // update from peer = a write (see above for viewers)
                        if !can_write {
                            continue;
                        }
                        if let Ok(update) = Update::decode_v1(update_bytes) {
                            let mut txn = doc.transact_mut();
                            txn.apply_update(update);
                            drop(txn);
                            let mut fwd = Vec::with_capacity(2 + update_bytes.len() + 8);
                            fwd.push(0);
                            fwd.push(2);
                            encode_var_uint(update_bytes.len(), &mut fwd);
                            fwd.extend_from_slice(update_bytes);
                            let _ = tx.send(fwd);
                            let _ = flush.send(()); // OctoBase persist (debounced)
                        }
                    }
                    _ => {}
                }
            }
            1 => {
                let _ = tx.send(data.to_vec());
            }
            _ => warn!("unknown y-protocols type {}", data[0]),
        }
    }

    forward_task.abort();
    bcast_task.abort();
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(tracing_subscriber::EnvFilter::from_default_env())
        .init();

    let pg = match std::env::var("DATABASE_URL") {
        Ok(url) if !url.trim().is_empty() => {
            match sqlx::postgres::PgPoolOptions::new()
                .max_connections(4)
                .connect_lazy(&url)
            {
                Ok(pool) => {
                    info!("OctoBase pg store: pool ready (dashboard.workspace_docs)");
                    Some(pool)
                }
                Err(e) => {
                    warn!("DATABASE_URL invalid, in-memory only: {}", e);
                    None
                }
            }
        }
        _ => {
            warn!("DATABASE_URL unset, in-memory only (no OctoBase persist)");
            None
        }
    };

    let state = AppState {
        rooms: Arc::new(DashMap::new()),
        pg,
        auth: AuthConfig {
            jwt_secret: std::env::var("JWT_SECRET")
                .ok()
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.into_bytes()),
            service_token: std::env::var("COLLAB_SERVICE_TOKEN")
                .ok()
                .filter(|s| !s.trim().is_empty()),
        },
    };

    let app = Router::new()
        .route("/health", get(health))
        .route("/info", get(info))
        .route("/yjs", get(ws_handler_root))
        .route("/yjs/", get(ws_handler_root))
        .route("/yjs/:room", get(ws_handler))
        .route("/api/workspace/:id/doc", get(http_get_doc).put(http_put_doc))
        // y-websocket compat: also handle /yjs/:room via http GET for fallback
        .route("/api/workspace/:id/doc/", get(http_get_doc).put(http_put_doc))
        .with_state(state)
        .layer(tower_http::cors::CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(3200);
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("aivory-collab listening on {} (y-octo yrs compat, ws /yjs/:room)", addr);
    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
