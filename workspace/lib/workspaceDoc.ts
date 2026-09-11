import * as Y from "yjs"

/**
 * Canonical room key shared with aivory-collab.
 *
 * Collab normalizes every HTTP doc id to `workspace:{id}` and keys its rooms
 * (and OctoBase pg rows) by that full id, merging the legacy bare-id row on
 * first access. The dashboard pg fallback must read the same way, otherwise a
 * collab outage serves a stale bare-id snapshot while the canonical room row
 * holds the merged state.
 */
export function canonicalRoomId(id: string): string {
  return id.startsWith("workspace:") ? id : `workspace:${id}`
}

/** Legacy bare doc id (dashboard snapshot rows written before canonicalization). */
export function legacyDocId(id: string): string {
  return id.startsWith("workspace:") ? id.slice("workspace:".length) : id
}

/**
 * Project room conventions (Fase 2 Opsi C).
 *
 * A project is a doc flagged `props.isProject` whose `props.projectDocs`
 * lists member doc ids (bare ids, max 50). The project room
 * (`workspace:room:{id}`) is the shared presence channel; each member doc
 * keeps its own `workspace:{doc}` / `workspace:db:{doc}` CRDT rooms so
 * per-doc ACL keeps enforcing. The aggregate board (F2-3) unions member
 * databases server-side, gated per doc.
 */
export function canonicalProjectRoomId(id: string): string {
  const bare = id
    .replace(/^workspace:room:/, "")
    .replace(/^workspace:/, "")
  return `workspace:room:${bare}`
}

/** True when a collab room key is a project presence room. */
export function isProjectRoom(roomKey: string): boolean {
  return roomKey.startsWith("workspace:room:")
}

/** Member doc ids from a project doc's props (validated, deduped, capped). */
export function projectMemberDocs(props: unknown): string[] {
  if (!props || typeof props !== "object" || Array.isArray(props)) return []
  const raw = (props as Record<string, unknown>).projectDocs
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const v of raw.slice(0, 50)) {
    if (typeof v !== "string") continue
    const bare = legacyDocId(v.trim()).slice(0, 64)
    if (!bare || bare === "room" || seen.has(bare)) continue
    seen.add(bare)
    out.push(bare)
  }
  return out
}

/**
 * Yjs-merge several full-state updates into one. Union-only: blocks/rows that
 * exist in any input survive, which is exactly the crash-safe behavior we want
 * for fallback reads (never synthesize deletions across divergent snapshots).
 * Returns null when every input is empty/invalid so callers keep 404 semantics.
 */
export function mergeYjsUpdates(parts: Array<Uint8Array | Buffer | null | undefined>): Buffer | null {
  const doc = new Y.Doc()
  let applied = false
  for (const part of parts) {
    if (!part || part.length === 0) continue
    try {
      Y.applyUpdate(doc, part instanceof Uint8Array ? part : new Uint8Array(part))
      applied = true
    } catch {
      // Ignore corrupt snapshots — a bad row must not break the merged read.
    }
  }
  if (!applied) return null
  return Buffer.from(Y.encodeStateAsUpdate(doc))
}
