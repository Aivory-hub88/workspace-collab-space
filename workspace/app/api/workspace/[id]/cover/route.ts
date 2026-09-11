import { NextRequest, NextResponse } from "next/server"
import { query } from "@/lib/db"
import { workspaceCredential, unauthorized, forbidden } from "@/lib/workspaceAuth"
import { getDocRole, canWrite } from "@/lib/workspaceAccess"

export const runtime = "nodejs"

// Cover uploads via MinIO/S3 were removed. Existing cover_url values still
// render; new uploads are disabled and clearing still works via DELETE.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!canWrite(role)) return forbidden()
  void req
  return NextResponse.json({ error: "cover uploads are disabled" }, { status: 410 })
}

// DELETE /api/workspace/[id]/cover — clear cover (owner/editor)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const cred = workspaceCredential(req)
  if (!cred) return unauthorized()
  const role = await getDocRole(cred, id)
  if (!canWrite(role)) return forbidden()

  try {
    await query(`UPDATE dashboard.workspace_docs SET cover_url = NULL, updated_at = now() WHERE id = $1 OR id = $3`, [`workspace:${id}`, id])
  } catch (e) {
    console.error("[cover DELETE pg]", e)
    return NextResponse.json({ error: "db" }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
