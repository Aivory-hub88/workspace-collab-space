import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { workspaceCredential, unauthorized, forbidden } from '@/lib/workspaceAuth'
import { getDocRole, canWrite } from '@/lib/workspaceAccess'
import { parseFieldDefs } from '@/lib/workspaceDb'
import { parseAutomationRules } from '@/lib/workspaceDbModel'
import { recordWorkspaceActivity } from '@/lib/workspaceActivity'

export const runtime = 'nodejs'

// PATCH /api/workspace/[id] — rename (title),
// favorite/star. Owner/editor only. Partial update: only present keys change.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!canWrite(role)) return forbidden()
  let body: { title?: unknown; mode?: unknown; favorite?: unknown; tags?: unknown; props?: unknown; icon?: unknown } = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 })
  }
  const sets: string[] = []
  const values: unknown[] = []
  let nextParam = 2
  let title: string | undefined
  let mode: string | undefined
  let favorite: boolean | undefined
  let tags: Array<{ id: string; label: string; color: string }> | undefined
  let props: Record<string, unknown> | undefined
  let icon: string | null | undefined
  if (body.title !== undefined) {
    title = (body.title ?? '').toString().slice(0, 200).trim()
    if (!title) return NextResponse.json({ error: 'title required' }, { status: 400 })
    sets.push(`title = $${nextParam++}`)
    values.push(title)
  }
  if (body.mode !== undefined) {
    // Legacy clients may still send mode (page/edgeless era). Accept and
    // normalize to page — canvas mode was removed.
    mode = 'page'
    sets.push(`mode = $${nextParam++}`)
    values.push(mode)
  }
  if (body.favorite !== undefined) {
    if (typeof body.favorite !== 'boolean') {
      return NextResponse.json({ error: 'favorite must be boolean' }, { status: 400 })
    }
    favorite = body.favorite
    sets.push(`favorite = $${nextParam++}`)
    values.push(favorite)
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags)) return NextResponse.json({ error: 'tags must be array' }, { status: 400 })
    const cleaned: Array<{ id: string; label: string; color: string }> = []
    const allowedColors = new Set(["gray","blue","green","yellow","red","purple","pink","orange"])
    for (const t of body.tags.slice(0, 20)) {
      if (!t || typeof t !== "object") continue
      const label = (t as { label?: unknown }).label?.toString().slice(0, 24).trim()
      if (!label) continue
      const id = (t as { id?: unknown }).id?.toString().slice(0, 32) || `tag-${Math.random().toString(36).slice(2, 6)}`
      const color = allowedColors.has((t as { color?: unknown }).color as string) ? (t as { color: string }).color : "gray"
      cleaned.push({ id, label, color })
    }
    tags = cleaned
    sets.push(`tags = $${nextParam++}::jsonb`)
    values.push(JSON.stringify(tags))
  }
  if (body.props !== undefined) {
    if (!body.props || typeof body.props !== "object" || Array.isArray(body.props)) {
      return NextResponse.json({ error: 'props must be object' }, { status: 400 })
    }
    // Only allow known flags + persisted DB views; strip everything else to avoid JSON bloat.
    // Atomic shallow merge in SQL (COALESCE(props,'{}') || patch): caller sends
    // ONLY the keys it changes, Postgres preserves the rest. No read-then-write,
    // so no 500 from a transient SELECT and no lost-update when Properties and
    // Database panels PATCH concurrently (previous revert cause).
    const propsPatch: Record<string, unknown> = {}
    const src = body.props as Record<string, unknown>
    if (typeof src.isJournal === "boolean") propsPatch.isJournal = src.isJournal
    if (typeof src.isTemplate === "boolean") propsPatch.isTemplate = src.isTemplate
    if (src.pageWidth === "full" || src.pageWidth === "standard") propsPatch.pageWidth = src.pageWidth
    // Project docs (Fase 2): flags a doc as a project + its member doc ids.
    if (typeof src.isProject === "boolean") propsPatch.isProject = src.isProject
    if (Array.isArray(src.projectDocs)) {
      const cleanedDocs: string[] = []
      const seen = new Set<string>()
      for (const v of src.projectDocs.slice(0, 50)) {
        if (typeof v !== "string") continue
        const bare = v.trim().replace(/^workspace:(room:)?/, "").slice(0, 64)
        if (!bare || bare === "room" || seen.has(bare)) continue
        seen.add(bare)
        cleanedDocs.push(bare)
      }
      propsPatch.projectDocs = cleanedDocs
    } else if (src.projectDocs !== undefined) {
      return NextResponse.json({ error: 'props.projectDocs must be array' }, { status: 400 })
    }
    // Custom database fields (Fase 3b): validated via parseFieldDefs —
    // [{id, name, type, options}]. Definitions live here in props; per-row
    // values live in the Yjs row maps under `cells`.
    if (Array.isArray(src.dbFields)) {
      propsPatch.dbFields = parseFieldDefs(src.dbFields)
    } else if (src.dbFields !== undefined) {
      return NextResponse.json({ error: 'props.dbFields must be array' }, { status: 400 })
    }
    // Persisted database views (saved filters/sorts) — array of lightweight view configs.
    // Kept inside props so one JSONB column holds all per-doc UI state, no extra table.
    if (Array.isArray(src.dbViews)) {
      const kinds = new Set(["table","kanban","calendar"])
      const sortFields = new Set(["title","status","priority","due","assignee"])
      const sortDirs = new Set(["asc","desc"])
      const dueFilters = new Set(["All","Overdue","Today","This week","Next 7 days","No date"])
      const cleanedViews: unknown[] = []
      for (const v of src.dbViews.slice(0, 10)) {
        if (!v || typeof v !== "object") continue
        const vv = v as Record<string, unknown>
        const id = vv.id?.toString().slice(0, 32) || `view-${Math.random().toString(36).slice(2, 6)}`
        const name = vv.name?.toString().slice(0, 24).trim() || "Untitled"
        const kind = kinds.has(vv.kind as string) ? (vv.kind as string) : "table"
        const statusFilter = typeof vv.statusFilter === "string" ? vv.statusFilter.slice(0, 16) : "All"
        const priorityFilter = typeof vv.priorityFilter === "string" ? vv.priorityFilter.slice(0, 16) : "All"
        const q = typeof vv.q === "string" ? vv.q.slice(0, 64) : ""
        const sortField = sortFields.has(vv.sortField as string) ? (vv.sortField as string) : "title"
        const sortDir = sortDirs.has(vv.sortDir as string) ? (vv.sortDir as string) : "asc"
        const dueFilter = dueFilters.has(vv.dueFilter as string) ? (vv.dueFilter as string) : "All"
        cleanedViews.push({ id, name, kind, statusFilter, priorityFilter, q, sortField, sortDir, dueFilter })
      }
      propsPatch.dbViews = cleanedViews
    } else if (src.dbViews === undefined) {
      // No change — Postgres || preserves the existing value, no action needed.
    } else {
      return NextResponse.json({ error: 'props.dbViews must be array' }, { status: 400 })
    }
    // Row templates for DB (AppFlowy-style): quick-create from saved row shape
    if (Array.isArray(src.dbTemplates)) {
      const cleanedTpl: unknown[] = []
      for (const t of src.dbTemplates.slice(0, 10)) {
        if (!t || typeof t !== "object") continue
        const tt = t as Record<string, unknown>
        const id = tt.id?.toString().slice(0, 32) || `tpl-${Math.random().toString(36).slice(2, 6)}`
        const name = tt.name?.toString().slice(0, 24).trim() || "Template"
        const title = typeof tt.title === "string" ? tt.title.slice(0, 100) : ""
        const status = typeof tt.status === "string" ? tt.status.slice(0, 16) : "Todo"
        const priority = ["Low","Med","High"].includes(tt.priority as string) ? (tt.priority as string) : "Med"
        const assignee = typeof tt.assignee === "string" ? tt.assignee.slice(0, 64) : ""
        const due = typeof tt.due === "string" ? tt.due.slice(0, 16) : ""
        const description = typeof tt.description === "string" ? tt.description.slice(0, 800) : ""
        cleanedTpl.push({ id, name, title, status, priority, assignee, due, description })
      }
      propsPatch.dbTemplates = cleanedTpl
    } else if (src.dbTemplates !== undefined) {
      return NextResponse.json({ error: 'props.dbTemplates must be array' }, { status: 400 })
    }
        // Kanban WIP limits per status column: { Todo: 5, Doing: 3 }. Small ints
    // so the column header can warn instead of silently overflowing.
    if (src.dbWip !== undefined) {      if (!src.dbWip || typeof src.dbWip !== "object" || Array.isArray(src.dbWip)) {
        return NextResponse.json({ error: 'props.dbWip must be object' }, { status: 400 })
      }
      const cleanedWip: Record<string, number> = {}
      for (const [k, v] of Object.entries(src.dbWip as Record<string, unknown>).slice(0, 10)) {
        const key = k.slice(0, 16).trim()
        const n = typeof v === "number" ? Math.floor(v) : parseInt((v as string)?.toString?.() ?? "", 10)
        if (!key || !Number.isFinite(n) || n < 1 || n > 50) continue
        cleanedWip[key] = n
      }
      propsPatch.dbWip = cleanedWip
    }
    // Automation rules (Fase 4e): validated structurally here; the runner
    // enforces WIP + writes activity at execution time.
    if (Array.isArray(src.dbAutomations)) {
      propsPatch.dbAutomations = parseAutomationRules(src.dbAutomations)
    } else if (src.dbAutomations !== undefined) {
      return NextResponse.json({ error: 'props.dbAutomations must be array' }, { status: 400 })
    }
    if (Object.keys(propsPatch).length === 0) {
      return NextResponse.json({ error: 'props has no known keys' }, { status: 400 })
    }
    props = propsPatch
    sets.push(`props = COALESCE(props, '{}'::jsonb) || $${nextParam++}::jsonb`)
    values.push(JSON.stringify(props))
  }
  if (body.icon !== undefined) {
    // Emoji icon — single grapheme, max 8 chars, nullable to clear.
    if (body.icon === null || body.icon === "") {
      icon = null
      sets.push(`icon = $${nextParam++}`)
      values.push(null)
    } else {
      const raw = body.icon.toString().trim().slice(0, 8)
      // Very permissive: allow any emoji/short text, but cap length.
      if (!raw) return NextResponse.json({ error: 'icon required' }, { status: 400 })
      icon = raw
      sets.push(`icon = $${nextParam++}`)
      values.push(icon)
    }
  }
  if (sets.length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  const idParam = nextParam++
  try {
    const upd = await query(
      `UPDATE dashboard.workspace_docs SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 OR id = $${idParam} RETURNING props`,
      [`workspace:${id}`, ...values, id],
    )
    // Return the merged server truth so the client can reconcile instead of
    // guessing — this is what the Network tab should show for the revert bug.
    const mergedProps = (upd.rows[0]?.props as Record<string, unknown> | null) ?? props ?? undefined
    if (title !== undefined) {
      await recordWorkspaceActivity({
        docId: id,
        credential: cred,
        action: 'page.renamed',
        summary: `Renamed page to “${title}”`,
        targetType: 'page',
        targetId: id,
      })
    }
    return NextResponse.json({ id, ...(title !== undefined ? { title } : {}), ...(mode !== undefined ? { mode } : {}), ...(favorite !== undefined ? { favorite } : {}), ...(tags !== undefined ? { tags } : {}), ...(props !== undefined ? { props: mergedProps } : {}), ...(icon !== undefined ? { icon } : {}) })
  } catch (e) {
    console.error('[workspace patch]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

// DELETE /api/workspace/[id] — soft delete (owner only). Sets deleted_at.
// Hard delete is now via ?hard=1 or via restore flow. Collab room not purged
// (still-open client that writes afterwards will still have soft-deleted doc
// hidden from list until restored — accepted).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  const isOwner = role === 'owner'
  if (!isOwner) return forbidden()
  const hard = req.nextUrl.searchParams.get('hard') === '1'
  try {
    if (hard) {
      await query(`DELETE FROM dashboard.workspace_docs WHERE id = ANY($1::text[])`, [[id, `workspace:${id}`, `workspace:db:${id}`, `db:${id}`]])
      await query(`DELETE FROM dashboard.workspace_doc_acl WHERE doc_id = $1`, [id])
      await query(`DELETE FROM dashboard.workspace_access_requests WHERE doc_id = $1`, [id])
      await query(`DELETE FROM dashboard.workspace_doc_links WHERE src = $1 OR dst = $1`, [id])
      await query(`DELETE FROM dashboard.workspace_agent_acl WHERE doc_id = $1`, [id])
      await query(`DELETE FROM dashboard.workspace_mentions WHERE doc_id = $1`, [id])
      await query(`DELETE FROM dashboard.workspace_chunks WHERE doc_id = $1`, [id])
    } else {
      await query(`UPDATE dashboard.workspace_docs SET deleted_at = now() WHERE id = ANY($1::text[]) AND deleted_at IS NULL`, [[id, `workspace:${id}`, `workspace:db:${id}`, `db:${id}`]])
    }
    return NextResponse.json({ ok: true, id, hard })
  } catch (e) {
    console.error('[workspace delete]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}

// POST /api/workspace/[id]/restore — owner only, clears deleted_at
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  // Even if soft-deleted, owner's ACL still resolvable via workspace_doc_acl, so check owner via direct query
  const isOwner = role === 'owner'
  if (!isOwner) {
    // Fallback: check workspace_docs owner directly for soft-deleted rows (getDocRole filters deleted)
    try {
      const r = await query(`SELECT owner FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 1`, [id, `workspace:${id}`])
      const owner = r.rows[0]?.owner as string | undefined
      const caller = cred.kind === 'user' ? cred.user.user_id : 'service'
      if (owner !== caller) return forbidden()
    } catch { return forbidden() }
  }
  try {
    await query(`UPDATE dashboard.workspace_docs SET deleted_at = NULL WHERE id = ANY($1::text[])`, [[id, `workspace:${id}`, `workspace:db:${id}`, `db:${id}`]])
    return NextResponse.json({ ok: true, id })
  } catch (e) {
    console.error('[workspace restore]', e)
    return NextResponse.json({ error: 'db' }, { status: 500 })
  }
}
