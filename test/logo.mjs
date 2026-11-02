// Replica of OpenCode's home logo (a grid of 1×1 text cells, two-tone grey,
// shadows in the cell backgrounds), rendered stock and skinned to logo.html.
//
//   BUN_BE_BUN=1 <opencode.exe> test/logo.mjs [out.html]

import { readFileSync, writeFileSync } from "node:fs"
import { BoxRenderable, RGBA, TextRenderable } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createSkin } from "../src/skin.js"
import { buildLogo, realTheme, realThemeJson, revive } from "./scene.mjs"

const hex = (rgba) => {
  const [r, g, b, a] = rgba.toInts()
  return a === 0 ? "transparent" : `rgb(${r},${g},${b})`
}
const html = (frame) =>
  frame.lines.map((l) => l.spans.map((s) => `<span style="color:${hex(s.fg)};background:${hex(s.bg)}">${s.text}</span>`).join("")).join("\n")

async function capture(withSkin, options, themeFn = () => ({}), switchTo) {
  const setup = await createTestRenderer({ width: 45, height: 6 })
  setup.renderer.root.add(buildLogo(setup.renderer))
  await setup.renderOnce()
  let skin
  if (withSkin) {
    let current = themeFn
    skin = createSkin({ renderer: setup.renderer, RGBA, theme: () => current(), options })
    skin.scan()
    await setup.renderOnce()
    if (switchTo) {
      current = switchTo
      skin.scan()
      await setup.renderOnce()
    }
  }
  const out = setup.captureSpans()
  skin?.stop()
  setup.renderer.destroy()
  return out
}

const real = realThemeJson
const mine = realTheme
const greenAccent = () => revive({ ...real, hue: { ...real.hue, accent: real.hue.green } })
const VARIANTS = [
  ["seu tema · accent (padrão)", { logoGradient: "theme" }, mine],
  ["seu tema · blue (gelo do tema)", { logoGradient: "theme", logoHue: "blue" }, mine],
  ["seu tema · interactive", { logoGradient: "theme", logoHue: "interactive" }, mine],
  ["tema sem cores → gelo", { logoGradient: "theme" }, () => ({})],
  ["troca de tema ao vivo (accent roxo → verde)", { logoGradient: "theme" }, mine, greenAccent],
  ["gelo", { logoGradient: "gelo" }],
]
const before = await capture(false)
const shots = []
for (const [name, options, themeFn, switchTo] of VARIANTS) shots.push([name, await capture(true, options, themeFn, switchTo)])
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1 }
const colours = (f) => new Set(f.lines.flatMap((l) => l.spans.map((s) => hex(s.fg)))).size
if (shots.some(([, f]) => colours(f) <= colours(before))) {
  console.error("FAIL: logo not recoloured")
  process.exitCode = 1
} else console.log("OK: logo recoloured in", shots.length, "variants")
const sig = (f) => f.lines.map((l) => l.spans.map((s) => hex(s.fg)).join()).join()
const byName = Object.fromEntries(shots)
if (sig(byName["tema sem cores → gelo"]) !== sig(byName["gelo"])) fail("theme without colours did not fall back to gelo")
if (sig(byName["troca de tema ao vivo (accent roxo → verde)"]) === sig(byName["seu tema · accent (padrão)"])) fail("theme switch did not repaint the logo")
if (!process.exitCode) console.log("OK: theme mode, gelo fallback, live theme switch")

writeFileSync(
  process.argv[2] ?? "logo.html",
  `<!doctype html><meta charset="utf-8"><style>body{background:#0a0a0a;padding:24px;color:#999;font-family:system-ui;display:grid;grid-template-columns:repeat(2,max-content);gap:8px 48px}
p{margin:0}pre{font-family:"Cascadia Mono",Consolas,monospace;font-size:22px;line-height:1;margin:0 0 20px}</style>
<div><p>stock</p><pre>${html(before)}</pre></div>` + shots.map(([n, f]) => `<div><p>${n}</p><pre>${html(f)}</pre></div>`).join(""),
)
process.exit()
