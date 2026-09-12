import { describe, expect, it } from "vitest"
import { parseMarkdown, MAX_IMPORT_BLOCKS } from "./markdownImport"

describe("parseMarkdown", () => {
  it("maps headings, lists, todos, quotes, code, and dividers", () => {
    const md = [
      "# Title",
      "## Section",
      "### Sub",
      "",
      "Hello **bold** and [link](https://x.test).",
      "",
      "- [ ] open task",
      "- [x] done task",
      "- bullet",
      "1. first",
      "2. second",
      "> wisdom",
      "```",
      "const a = 1",
      "```",
      "---",
    ].join("\n")
    const blocks = parseMarkdown(md)
    expect(blocks).toMatchObject([
      { type: "h1", text: "Title" },
      { type: "h2", text: "Section" },
      { type: "h3", text: "Sub" },
      { type: "p", text: "Hello bold and link." },
      { type: "todo", text: "open task", checked: false },
      { type: "todo", text: "done task", checked: true },
      { type: "bullet", text: "bullet" },
      { type: "numbered", text: "first" },
      { type: "numbered", text: "second" },
      { type: "quote", text: "wisdom" },
      { type: "code", text: "const a = 1" },
      { type: "divider" },
    ])
  })

  it("closes unclosed code fences and caps block count", () => {
    const md = "```\n" + "x\n".repeat(10)
    expect(parseMarkdown(md)).toMatchObject([{ type: "code" }])
    const big = Array.from({ length: MAX_IMPORT_BLOCKS + 50 }, (_, i) => `para ${i}`).join("\n\n")
    expect(parseMarkdown(big)).toHaveLength(MAX_IMPORT_BLOCKS)
  })

  it("never drops text for unknown constructs", () => {
    const blocks = parseMarkdown("| a | b |\n|---|---|\n| 1 | 2 |")
    expect(blocks.length).toBeGreaterThan(0)
    expect(blocks.every((b) => b.text.length > 0 || b.type === "divider")).toBe(true)
  })
})
