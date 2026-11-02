// Replicas of what OpenCode puts on screen, shared by the tests and by the
// README screenshots (docs/shots.mjs): the session sidebar (shaped after a live
// tree dump: Context / MCP / Checklist slot / omo-slim slot / magic-context)
// and the home logo (a grid of 1×1 text cells).

import { readFileSync } from "node:fs"
import { BoxRenderable, RGBA, TextRenderable } from "@opentui/core"
import { MAGIC_CONTEXT_PALETTE } from "../src/skin.js"

export const C = { panel: "#141414", text: "#eeeeee", muted: "#808080", mc: "#9d7cd8", green: "#7fd88f" }

export const SEGMENTS = [
  [18_000, MAGIC_CONTEXT_PALETTE[0]], [4_000, MAGIC_CONTEXT_PALETTE[1]], [22_000, MAGIC_CONTEXT_PALETTE[2]],
  [3_000, MAGIC_CONTEXT_PALETTE[3]], [6_000, MAGIC_CONTEXT_PALETTE[4]], [31_000, MAGIC_CONTEXT_PALETTE[6]],
  [14_000, MAGIC_CONTEXT_PALETTE[7]], [9_000, MAGIC_CONTEXT_PALETTE[8]],
]

export const text = (ctx, content, fg, props = {}) => new TextRenderable(ctx, { content, fg, ...props })
export function row(ctx, parts, props = {}) {
  const r = new BoxRenderable(ctx, { width: "100%", flexDirection: "row", justifyContent: "space-between", height: 1, ...props })
  for (const [content, fg] of parts) r.add(text(ctx, content, fg))
  return r
}

// omo-slim: rebuilt wholesale on every poll, border {type:"single"}.
export function omoCard(ctx, clicks = []) {
  const card = new BoxRenderable(ctx, {
    width: "100%", flexDirection: "column", border: { type: "single" }, borderColor: "#ffffff",
    paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1,
  })
  const header = row(ctx, [["▼", "#ffffff"], ["OMO-Slim", "#ffffff"], ["v3.0.6", "#ffffff"]])
  header.onMouseDown = () => clicks.push("omo")
  card.add(header)
  card.add(row(ctx, [["• orchestrator", C.text], ["qwen3.8-max-auto", C.text]]))
  card.add(row(ctx, [["• explorer", C.text], ["qwen3.8-max-auto", C.text]]))
  return card
}

// Checklist-to-Goal: rebuilt every second; in the host its text nodes carry
// their own renderSelf (simulated here).
export function checklist(ctx, items = ["▸ ✓ 1. Pesquisar receitas"]) {
  const root = new BoxRenderable(ctx, { width: "100%", flexDirection: "column" })
  root.add(text(ctx, "Checklist", C.text))
  const bar = text(ctx, "███████░░░░░ 3/5 · 60%", C.text)
  bar.renderSelf = Object.getPrototypeOf(bar).renderSelf.bind(bar)
  root.add(bar)
  for (const item of items) root.add(text(ctx, item, C.muted))
  return root
}

export function buildSidebar(ctx, clicks = [], { width = 40, height = 44, checklistItems } = {}) {
  const container = new BoxRenderable(ctx, { width, height, backgroundColor: C.panel, flexDirection: "column", paddingLeft: 1, paddingRight: 1, gap: 1 })

  const context = new BoxRenderable(ctx, { width: "100%", flexDirection: "column" })
  context.add(text(ctx, "Context", C.text))
  context.add(text(ctx, "57.147 tokens", C.muted))
  context.add(text(ctx, "6% used", C.muted))
  container.add(context)
  container.add(new BoxRenderable(ctx, { width: "100%", height: 1 })) // gap

  const mcp = new BoxRenderable(ctx, { width: "100%", flexDirection: "column" })
  const mcpHeader = row(ctx, [["▼", C.text], ["MCP", C.text]], { justifyContent: "flex-start", gap: 1 })
  mcpHeader.onMouseDown = () => clicks.push("mcp")
  mcp.add(mcpHeader)
  mcp.add(row(ctx, [["• context7", C.text], ["Connected", C.muted]]))
  mcp.add(row(ctx, [["• web", C.text], ["Connected", C.muted]]))
  container.add(mcp)
  container.add(new BoxRenderable(ctx, { width: "100%", height: 1 })) // gap

  const checklistSlot = new BoxRenderable(ctx, { width: "100%", flexDirection: "column" })
  checklistSlot.add(checklist(ctx, checklistItems))
  container.add(checklistSlot)

  const omoSlot = new BoxRenderable(ctx, { width: "100%", flexDirection: "column", marginTop: 1 })
  omoSlot.add(omoCard(ctx, clicks))
  container.add(omoSlot)

  const mc = new BoxRenderable(ctx, {
    width: "100%", flexDirection: "column", border: { type: "single" }, borderColor: "#5c5c5c",
    paddingTop: 1, paddingBottom: 1, paddingLeft: 1, paddingRight: 1,
  })
  const mcHeader = new BoxRenderable(ctx, { flexDirection: "row", justifyContent: "space-between", height: 1 })
  mcHeader.onMouseDown = () => clicks.push("mc")
  const badge = new BoxRenderable(ctx, { paddingLeft: 1, paddingRight: 1, backgroundColor: C.mc })
  badge.add(text(ctx, "▶ Magic Context", C.panel))
  mcHeader.add(badge)
  mcHeader.add(text(ctx, "v0.49.35", C.muted))
  mc.add(mcHeader)
  mc.add(row(ctx, [["5.7% / 81.3%", C.mc], ["56K / 984K", C.mc]]))
  const bar = new BoxRenderable(ctx, { width: "100%", flexDirection: "row", height: 1 })
  for (const [tokens, c] of SEGMENTS) bar.add(new BoxRenderable(ctx, { flexGrow: tokens, flexBasis: 0, height: 1, backgroundColor: c }))
  mc.add(bar)
  mc.add(row(ctx, [["Hygiene", C.muted], ["67.9% · 13K/19K", C.text]]))
  mc.add(text(ctx, "Recomp [████████░░░░░░] 57%", C.mc))
  container.add(mc)
  return { container, mc, mcp, bar, omoSlot, checklistSlot }
}

// --- home logo ---

const OPEN = ["                   ", "█▀▀█ █▀▀█ █▀▀█ █▀▀▄", "█  █ █  █ █▀▀▀ █  █", "▀▀▀▀ █▀▀▀ ▀▀▀▀ ▀▀▀▀"]
const CODE = ["             ▄     ", "█▀▀▀ █▀▀█ █▀▀█ █▀▀█", "█    █  █ █  █ █▀▀▀", "▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀"]
// Letter interiors (row 2 spaces between strokes) carry a darker shadow bg.
const tone = {
  open: { fg: "#7d7d7d", shadow: "#3c3c3c" },
  code: { fg: "#eeeeee", shadow: "#5e5e5e" },
}

function half(ctx, rows, r, t) {
  const box = new BoxRenderable(ctx, { flexDirection: "row", width: 19, height: 1 })
  const line = rows[r]
  ;[...line].forEach((ch, i) => {
    const inLetter = r === 2 && ch === " " && line[i - 1] !== " " && i % 5 !== 4
    box.add(new TextRenderable(ctx, { content: ch, fg: t.fg, bg: inLetter ? t.shadow : undefined }))
  })
  return box
}

// The 39×4 logo, unwrapped (callers centre it).
export function logo(ctx) {
  const box = new BoxRenderable(ctx, { flexDirection: "column", width: 39, height: 4, flexShrink: 0 })
  for (let r = 0; r < 4; r++) {
    const line = new BoxRenderable(ctx, { flexDirection: "row", width: 39, height: 1, gap: 1 })
    line.add(half(ctx, OPEN, r, tone.open))
    line.add(half(ctx, CODE, r, tone.code))
    box.add(line)
  }
  return box
}

export function buildLogo(ctx) {
  const screen = new BoxRenderable(ctx, { width: 45, height: 6, backgroundColor: "#0a0a0a", alignItems: "center", justifyContent: "center" })
  screen.add(logo(ctx))
  return screen
}

// --- theme ---

// The user's real resolved theme (captured from the live TUI), hex → RGBA.
export const revive = (v) =>
  typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? RGBA.fromHex(v)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, revive(x)])) : v
export const realThemeJson = JSON.parse(readFileSync(new URL("./fixture-theme.json", import.meta.url), "utf8")).theme
export const realTheme = () => revive(realThemeJson)
