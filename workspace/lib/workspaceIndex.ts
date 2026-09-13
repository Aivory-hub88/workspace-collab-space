import { query } from "@/lib/db"
import { embed } from "@/lib/embeddings"

/**
 * Row text indexing for semantic search (Fase 4c2). Best-effort and silent:
 * without an embedding key nothing is stored and ranking stays lexical.
 * Fire-and-forget from write paths (never block the response on the model).
 */

export function rowText(r: { title: string; description: string; assignee: string; comments: Array<{ text: string }> }): string {
  return [r.title, r.description, r.assignee, ...r.comments.map((c) => c.text)].filter(Boolean).join("\n");
}

export async function indexRow(
  docId: string,
  rowId: string,
  workspaceId: string,
  text: string,
): Promise<boolean> {
  try {
    const vec = await embed(text);
    if (!vec) return false;
    const lit = `[${vec.join(",")}]`;
    await query(
      `INSERT INTO dashboard.workspace_chunks (workspace_id, doc_id, row_id, text, embedding, updated_at)
       VALUES ($1, $2, $3, $4, $5::vector, now())
       ON CONFLICT (doc_id, row_id) DO UPDATE
         SET text = EXCLUDED.text, embedding = EXCLUDED.embedding, updated_at = now()`,
      [workspaceId, docId, rowId, text.slice(0, 4000), lit],
    );
    return true;
  } catch {
    return false;
  }
}

export async function removeRowIndex(docId: string, rowId: string): Promise<void> {
  try {
    await query(`DELETE FROM dashboard.workspace_chunks WHERE doc_id = $1 AND row_id = $2`, [docId, rowId]);
  } catch {}
}

export async function workspaceOf(docId: string): Promise<string> {
  try {
    const r = await query(`SELECT workspace_id FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 1`, [
      docId,
      `workspace:${docId}`,
    ]);
    return (r.rows[0]?.workspace_id as string | undefined) ?? "default";
  } catch {
    return "default";
  }
}
