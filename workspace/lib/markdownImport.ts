/**
 * Markdown → page blocks importer (pure, client-safe, no dependencies).
 *
 * Maps common Markdown to the WorkspaceEditor block set
 * (h1/h2/h3/p/todo/bullet/numbered/quote/code/divider). Unknown constructs
 * degrade to plain paragraphs — never throw, never drop text silently.
 */

export type ImportedBlock = {
  type: "h1" | "h2" | "h3" | "p" | "todo" | "bullet" | "numbered" | "quote" | "code" | "divider"
  text: string
  checked?: boolean
}

export const MAX_IMPORT_BLOCKS = 500
const MAX_TEXT = 2000

/** Strip inline formatting, keeping readable text. */
function inline(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1") // images → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // links → label
    .replace(/(\*\*|__)(.*?)\1/g, "$2") // bold
    .replace(/(^|\W)\*([^*\n]+)\*/g, "$1$2") // italic *
    .replace(/(^|\W)_([^_\n]+)_/g, "$1$2") // italic _
    .replace(/~~(.*?)~~/g, "$1") // strikethrough
    .replace(/`([^`\n]*)`/g, "$1") // inline code
    .trim()
    .slice(0, MAX_TEXT)
}

export function parseMarkdown(src: string): ImportedBlock[] {
  const out: ImportedBlock[] = []
  const lines = src.replace(/\r\n?/g, "\n").split("\n")
  let inCode = false
  let codeBuf: string[] = []

  const push = (b: ImportedBlock) => {
    if (out.length < MAX_IMPORT_BLOCKS) out.push(b)
  }

  for (const raw of lines) {
    const line = raw.replace(/\t/g, "  ")
    // Fenced code blocks.
    if (/^\s*```/.test(line)) {
      if (inCode) {
        push({ type: "code", text: codeBuf.join("\n").slice(0, MAX_TEXT) })
        codeBuf = []
        inCode = false
      } else {
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(raw)
      continue
    }
    if (!line.trim()) continue

    let m: RegExpMatchArray | null
    if ((m = line.match(/^\s*(#{1,3})\s+(.*)$/))) {
      const level = m[1].length
      push({ type: level === 1 ? "h1" : level === 2 ? "h2" : "h3", text: inline(m[2]) || "Untitled" })
    } else if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) {
      push({ type: "divider", text: "—" })
    } else if ((m = line.match(/^\s*>\s?(.*)$/))) {
      push({ type: "quote", text: inline(m[1]) })
    } else if ((m = line.match(/^\s*[-*•]\s+\[([ xX])\]\s+(.*)$/))) {
      push({ type: "todo", text: inline(m[2]), checked: m[1].toLowerCase() === "x" })
    } else if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) {
      push({ type: "bullet", text: inline(m[1]) })
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      push({ type: "numbered", text: inline(m[1]) })
    } else {
      const t = inline(line.trim())
      if (t) push({ type: "p", text: t })
    }
    if (out.length >= MAX_IMPORT_BLOCKS) break
  }
  if (inCode && codeBuf.length > 0) {
    push({ type: "code", text: codeBuf.join("\n").slice(0, MAX_TEXT) })
  }
  return out
}
