// Renders a replica of the real sidebar, shaped after a live tree dump
// (container → Context / MCP / Checklist slot / omo-slim slot / magic-context),
// once stock and once skinned, writes both frames to preview.html, and asserts
// the patches landed — including on cards that are rebuilt between frames.
//
//   BUN_BE_BUN=1 <opencode.exe> test/preview.mjs [out.html]

import { writeFileSync } from "node:fs"
import { BoxRenderable, RGBA, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createSkin, MAGIC_CONTEXT_PALETTE } from "../src/skin.js"

const W = 40
const H = 44
const C = { panel: "#141414", text: "#eeeeee", muted: "#808080", mc: "#9d7cd8", green: "#7fd88f" }

const SEGMENTS = [
  [18_000, MAGIC_CONTEXT_PALETTE[0]], [4_000, MAGIC_CONTEXT_PALETTE[1]], [22_000, MAGIC_CONTEXT_PALETTE[2]],
  [3_000, MAGIC_CONTEXT_PALETTE[3]], [6_000, MAGIC_CONTEXT_PALETTE[4]], [31_000, MAGIC_CONTEXT_PALETTE[6]],
  [14_000, MAGIC_CONTEXT_PALETTE[7]], [9_000, MAGIC_CONTEXT_PALETTE[8]],
]

const text = (ctx, content, fg) => new TextRenderable(ctx, { content, fg })
function row(ctx, parts, props = {}) {
  const r = new BoxRenderable(ctx, { width: "100%", flexDirection: "row", justifyContent: "space-between", height: 1, ...props })
  for (const [content, fg] of parts) r.add(text(ctx, content, fg))
  return r
}

// omo-slim: rebuilt wholesale on every poll, border {type:"single"}.
function omoCard(ctx, clicks) {
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
function checklist(ctx) {
  const root = new BoxRenderable(ctx, { width: "100%", flexDirection: "column" })
  root.add(text(ctx, "Checklist", C.text))
  const bar = text(ctx, "███████░░░░░ 3/5 · 60%", C.text)
  bar.renderSelf = Object.getPrototypeOf(bar).renderSelf.bind(bar)
  root.add(bar)
  root.add(text(ctx, "▸ ✓ 1. Pesquisar receitas", C.muted))
  return root
}

function buildSidebar(ctx, clicks) {
  const container = new BoxRenderable(ctx, { width: W, height: H, backgroundColor: C.panel, flexDirection: "column", paddingLeft: 1, paddingRight: 1, gap: 1 })

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
  checklistSlot.add(checklist(ctx))
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

const hex = (rgba) => {
  const [r, g, b, a] = rgba.toInts()
  return a === 0 ? "transparent" : `rgb(${r},${g},${b})`
}
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;")
const frameHtml = (frame) =>
  frame.lines.map((l) => l.spans.map((s) => `<span style="color:${hex(s.fg)};background:${hex(s.bg)}">${esc(s.text)}</span>`).join("") || " ").join("\n")

const theme = () => ({
  text: { muted: RGBA.fromHex("#808080") },
  hue: { green: { 500: RGBA.fromHex("#3d7f4b"), 100: RGBA.fromHex("#96f7a7") } },
})

async function capture(withSkin) {
  const setup = await createTestRenderer({ width: W, height: H })
  const { renderer } = setup
  const clicks = []
  const ui = buildSidebar(renderer, clicks)
  renderer.root.add(ui.container)
  await setup.renderOnce()
  let skin
  const frames = {}
  if (withSkin) {
    skin = createSkin({ renderer, RGBA, theme })
    skin.start()
    for (let i = 0; i < 3; i++) {
      skin.scan()
      await setup.renderOnce()
    }
    await setup.mockMouse.click(ui.mc.screenX + 4, ui.mc.screenY)
    await setup.mockMouse.click(ui.mcp.screenX + 4, ui.mcp.screenY)
    await setup.renderOnce()
    frames.settled = setup.captureCharFrame()

    // Rebuild everything the real plugins rebuild, then draw ONE frame with no
    // explicit scan: only the per-frame pass may fix it up.
    for (const c of [...ui.bar.getChildren()]) ui.bar.remove(c)
    for (const [tokens, c] of SEGMENTS) ui.bar.add(new BoxRenderable(renderer, { flexGrow: tokens, flexBasis: 0, height: 1, backgroundColor: c }))
    for (const c of [...ui.omoSlot.getChildren()]) ui.omoSlot.remove(c)
    ui.omoSlot.add(omoCard(renderer, clicks))
    for (const c of [...ui.checklistSlot.getChildren()]) ui.checklistSlot.remove(c)
    ui.checklistSlot.add(checklist(renderer))
    await setup.renderOnce()
    frames.rebuilt = setup.captureCharFrame()

    // Real plugins swap content by inserting the new subtree BEFORE removing
    // the old one; the state in between must not leave a box behind.
    const oldOmo = ui.omoSlot.getChildren()[0]
    ui.omoSlot.add(omoCard(renderer, clicks))
    ui.omoSlot.remove(oldOmo)
    const oldList = ui.checklistSlot.getChildren()[0]
    ui.checklistSlot.add(checklist(renderer))
    ui.checklistSlot.remove(oldList)
    await setup.renderOnce()
    frames.swapped = setup.captureCharFrame()

    // A box left by an older build on the omo-slim slot wrapper (seen live:
    // double frame) must come off; the section keeps its title in the border.
    ui.omoSlot.__beautify = { ...ui.omoSlot.__beautify, card: { border: false, borderStyle: "single", paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0, marginTop: 1, marginBottom: 0 } }
    ui.omoSlot.border = true
    ui.omoSlot.borderStyle = "rounded"

    // Hot reload, worst case: a new instance starts while the old one never
    // cleaned up. Nothing may be eaten, and one click must toggle exactly once.
    const reloaded = createSkin({ renderer, RGBA, theme })
    reloaded.start()
    for (let i = 0; i < 3; i++) {
      reloaded.scan()
      await setup.renderOnce()
    }
    const before = clicks.filter((c) => c === "mcp").length
    await setup.mockMouse.click(ui.mcp.screenX + 4, ui.mcp.screenY)
    await setup.renderOnce()
    frames.reloadClicks = clicks.filter((c) => c === "mcp").length - before
    frames.reloaded = setup.captureCharFrame()
    skin.stop()
    skin = reloaded

    // In the host, Checklist-to-Goal inserts its rebuilt nodes AFTER the frame
    // pass of the frame that paints them. Simulate it: frame hook off, rebuild,
    // let microtasks run, draw one frame. Only the insert watcher can save it.
    const hook = renderer.root.onLifecyclePass
    renderer.root.onLifecyclePass = null
    for (const c of [...ui.checklistSlot.getChildren()]) ui.checklistSlot.remove(c)
    ui.checklistSlot.add(checklist(renderer))
    await Promise.resolve()
    await setup.renderOnce()
    frames.insertedLate = setup.captureCharFrame()
    renderer.root.onLifecyclePass = hook
  }
  const out = { spans: setup.captureSpans(), chars: setup.captureCharFrame(), clicks, frames }
  if (skin) {
    // stop() must give the stock look back exactly: a box left behind here is
    // what a hot-reloaded successor would mistake for the original.
    skin.stop()
    await setup.renderOnce()
    out.stopped = setup.captureCharFrame()
    out.leftover = []
    for (const node of [ui.container, ...ui.container.getChildren()]) {
      for (const n of [node, ...node.getChildren()]) if (n.border === true && !ui.mc.getChildren().includes(n) && n !== ui.mc) out.leftover.push(n.id)
    }
  }
  renderer.destroy()
  return out
}

const before = await capture(false)
const after = await capture(true)

// --- assertions ----------------------------------------------------------------
const fail = (m) => {
  console.error("FAIL:", m)
  process.exitCode = 1
}
const settled = after.frames.settled
for (const [frame, when] of [[settled, "settled"], [after.frames.rebuilt, "after rebuild"], [after.frames.swapped, "after swap"], [after.frames.reloaded, "after hot reload"]]) {
  for (const title of ["┐Context┌", "┐▼ MCP┌", "┐Checklist┌", "╭─┐▼ OMO-Slim┌", "╭─┐▶ Magic Context┌", "┐v0.49.35┌─╮", "┐v3.0.6┌─╮"]) {
    if (!frame.includes(title)) fail(`${when}: missing ${title}`)
  }
  if (/│[^\n]*[╭╰]/.test(frame)) fail(`${when}: a box inside a box`)
  if (/^│ ?Checklist/m.test(frame)) fail(`${when}: checklist title inside the box`)
  if (/[█░]{6}/.test(frame)) fail(`${when}: a text bar survived`)
  if (/[┌└][─]{2}|[─]{2}[┐┘]$/m.test(frame.replace(/┐[^┌\n]*┌/g, ""))) fail(`${when}: square corners`)
}
if (!after.clicks.includes("mc")) fail("magic-context title click not forwarded")
if (!after.clicks.includes("mcp")) fail("MCP title click not forwarded")
if (!after.frames.reloaded.includes("• context7")) fail("hot reload ate the first MCP row")
if (after.frames.reloadClicks !== 1) fail(`hot reload: one click toggled ${after.frames.reloadClicks} times`)
if (!after.frames.insertedLate.includes("┐Checklist┌")) fail("late insert: checklist title not in border on the first frame")
if (/[█░]{6}/.test(after.frames.insertedLate)) fail("late insert: checklist bar stock on the first frame")
if (after.frames.insertedLate !== after.frames.reloaded) fail("late insert: layout differs from the settled frame (something jumped)")
if (after.leftover.length) fail(`stop() left borders on: ${after.leftover.join(", ")}`)
if (after.stopped !== before.chars) fail("stop() did not give the stock frame back:\n" + after.stopped)
if (!process.exitCode) console.log("OK: sections + plugin cards as btop boxes, bars, clicks, rebuilt cards skinned on the next frame")

console.log("\n--- before ---\n" + before.chars + "\n--- after ---\n" + after.chars)

const out = process.argv[2] ?? "preview.html"
writeFileSync(
  out,
  `<!doctype html><meta charset="utf-8"><title>beautify-opencode preview</title>
<style>body{background:#0a0a0a;color:#ccc;font-family:system-ui;padding:24px}
.wrap{display:flex;gap:32px;flex-wrap:wrap}
pre{font-family:"Cascadia Mono","JetBrains Mono",Consolas,monospace;font-size:17px;line-height:1;margin:0;padding:0}
h2{font-weight:500;font-size:15px;color:#9aa}</style>
<div class="wrap"><div><h2>stock</h2><pre>${frameHtml(before.spans)}</pre></div><div><h2>beautify-opencode</h2><pre>${frameHtml(after.spans)}</pre></div></div>`,
)
console.log("\nwrote", out)
process.exit()
