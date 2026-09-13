import * as Y from "yjs"
import { query } from "@/lib/db"
import { rowsFromDbDoc, wipExceeded } from "@/lib/workspaceDb"
import { parseAutomationRules, matchRules, type AutomationRule } from "@/lib/workspaceDbModel"

/**
 * Status-change automations (Fase 4e): when a row moves INTO a status, run
 * assignee/comment/move actions. Pure model + map mutation; routes own
 * persistence, WIP gating, and activity logging. Depth-1 only: chained
 * moveTo never re-triggers (no loops, ever).
 */

export type AppliedAutomation = { ruleId: string; ruleName: string; movedTo?: string; skippedMoveWip?: boolean }

/**
 * Apply one rule to a row map INSIDE the caller's transact. Returns what was
 * applied (for activity). moveTo is pre-gated by the caller against WIP via
 * `allowMove`; a denied move is reported, never forced.
 */
export function applyRuleToRow(
  m: Y.Map<unknown>,
  rule: AutomationRule,
  allowMove: boolean,
  actorName: string,
): AppliedAutomation {
  const applied: AppliedAutomation = { ruleId: rule.id, ruleName: rule.name }
  if (rule.setAssignee !== undefined) m.set("assignee", rule.setAssignee)
  if (rule.moveTo !== undefined) {
    if (allowMove) {
      m.set("status", rule.moveTo)
      applied.movedTo = rule.moveTo
    } else {
      applied.skippedMoveWip = true
    }
  }
  if (rule.addComment !== undefined) {
    const raw = m.get("comments")
    const list = Array.isArray(raw) ? (raw as unknown[]) : []
    const comment = {
      id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      text: rule.addComment.slice(0, 500),
      author: actorName.slice(0, 100),
      at: new Date().toISOString(),
    }
    m.set("comments", [...list, comment].slice(-100))
  }
  return applied
}

/** Automation rules for a doc (empty when none configured). */
export async function getAutomationRules(docId: string): Promise<AutomationRule[]> {
  try {
    const r = await query(`SELECT props FROM dashboard.workspace_docs WHERE id = $1 OR id = $2 LIMIT 1`, [
      `workspace:${docId}`,
      docId,
    ])
    const props = r.rows[0]?.props as Record<string, unknown> | undefined
    return parseAutomationRules(props?.dbAutomations)
  } catch {
    return []
  }
}

/**
 * Load + run matching rules for a status entry, mutating the row map inside
 * ONE transact owned by the caller. Returns applied descriptors (for
 * activity); empty when nothing matched. moveTo is WIP-gated per rule.
 */
export async function runStatusAutomations(args: {
  doc: Y.Doc
  rowId: string
  prevStatus: string | null
  wipLimits: Record<string, number>
  actorName: string
  origin: string
  getRules: () => Promise<AutomationRule[]>
}): Promise<AppliedAutomation[]> {
  const arr = args.doc.getArray<Y.Map<unknown>>("database")
  const idx = arr.toArray().findIndex((m) => (m.get("id") as string) === args.rowId)
  if (idx < 0) return []
  const m = arr.get(idx) as Y.Map<unknown>
  const nextStatus = (m.get("status") as string) ?? "Todo"
  const rules = matchRules(await args.getRules(), args.prevStatus, nextStatus)
  if (rules.length === 0) return []
  const applied: AppliedAutomation[] = []
  args.doc.transact(() => {
    const rows = rowsFromDbDoc(args.doc)
    for (const rule of rules) {
      let allowMove = true
      if (rule.moveTo !== undefined) {
        const limited = wipExceeded(rows, rule.moveTo, args.wipLimits, args.rowId)
        allowMove = limited === null
      }
      applied.push(applyRuleToRow(m, rule, allowMove, args.actorName))
    }
  }, args.origin)
  return applied
}
