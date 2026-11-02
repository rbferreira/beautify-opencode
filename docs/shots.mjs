// Renders the README screenshots with the real skin on a real OpenTUI
// renderer (the same code path as in OpenCode), using a theme captured from
// a live TUI. Writes docs/shots.html, which paints every frame onto a canvas
// cell by cell (box-drawing glyphs drawn as lines so they always join); the
// PNGs in docs/img/ are screenshots of that page.
//
//   BUN_BE_BUN=1 <opencode.exe> docs/shots.mjs

import { writeFileSync } from "node:fs"
import { BoxRenderable, RGBA } from "@opentui/core"
import { createTestRenderer } from "@opentui/core/testing"
import { createSkin } from "../src/skin.js"
import { buildSidebar, logo, realTheme, realThemeJson, text } from "../test/scene.mjs"

const T = realThemeJson
const BG = T.background.base
const RAISED = T.background.raised.base
const ACCENT = T.hue.accent?.[300] ?? "#fab283"
const MUTED = T.text.muted
const FG = T.text.base

async function capture(width, height, build, { skin: withSkin = true, options = {}, theme = realTheme } = {}) {
  const setup = await createTestRenderer({ width, height })
  const { renderer } = setup
  const root = new BoxRenderable(renderer, { width, height, backgroundColor: BG, flexDirection: "row" })
  build(renderer, root)
  renderer.root.add(root)
  await setup.renderOnce()
  let skin
  if (withSkin) {
    skin = createSkin({ renderer, RGBA, theme, options })
    skin.start()
    for (let i = 0; i < 4; i++) {
      skin.scan()
      await setup.renderOnce()
    }
  }
  const frame = setup.captureSpans()
  skin?.stop()
  renderer.destroy()
  const ints = (c) => {
    const [r, g, b, a] = c.toInts()
    return a === 0 ? null : [r, g, b]
  }
  return frame.lines.map((l) => l.spans.map((s) => [s.text, ints(s.fg), ints(s.bg), s.attributes ?? 0]))
}

// A session screen: transcript on the left, sidebar on the right.
const W = 118
const H = 32
const SIDEBAR = 42
function session(ctx, root) {
  const main = new BoxRenderable(ctx, { flexGrow: 1, flexDirection: "column", paddingLeft: 2, paddingRight: 2, paddingTop: 1 })
  const line = (content, fg = FG, props) => main.add(text(ctx, content, fg, props))
  const gap = () => main.add(new BoxRenderable(ctx, { height: 1 }))
  const user = (content) => {
    const box = new BoxRenderable(ctx, { flexDirection: "row", backgroundColor: RAISED, height: 3, alignItems: "center" })
    box.add(text(ctx, "┃", ACCENT))
    box.add(text(ctx, "  " + content, FG))
    main.add(box)
  }
  user("Add a dark mode toggle to the settings page and remember the choice")
  gap()
  line("I'll add the toggle under Appearance and persist it in localStorage.", FG)
  gap()
  line("  ✓ Read   src/settings/SettingsPage.tsx", MUTED)
  line("  ✓ Edit   src/settings/SettingsPage.tsx   +24 −3", MUTED)
  line("  ✓ Write  src/settings/useTheme.ts", MUTED)
  line("  ✓ Bash   npm test   42 passed", MUTED)
  gap()
  line("Done. The toggle reads the saved value on load, so the page no longer", FG)
  line("flashes light before switching. Tests cover both the default and the", FG)
  line("saved preference.", FG)
  main.add(new BoxRenderable(ctx, { flexGrow: 1 }))
  const prompt = new BoxRenderable(ctx, { flexDirection: "column", backgroundColor: RAISED, paddingLeft: 2, paddingTop: 1, paddingBottom: 1, marginBottom: 1 })
  prompt.add(text(ctx, "Ask anything…", MUTED))
  prompt.add(new BoxRenderable(ctx, { height: 1 }))
  const status = new BoxRenderable(ctx, { flexDirection: "row", gap: 1 })
  status.add(text(ctx, "Build", ACCENT))
  status.add(text(ctx, "claude-opus-5-5", FG))
  status.add(text(ctx, "Anthropic", MUTED))
  prompt.add(status)
  main.add(prompt)
  root.add(main)
  const side = buildSidebar(ctx, [], {
    width: SIDEBAR,
    height: H,
    checklistItems: ["▸ ✓ 1. Toggle in Appearance", "  ✓ 2. Persist the choice", "  ● 3. No light flash on load"],
  })
  side.container.backgroundColor = BG
  root.add(side.container)
}

const sidebarOnly = (h) => (ctx, root) => {
  root.add(buildSidebar(ctx, [], { width: 42, height: h }).container)
}

function home(ctx, root) {
  root.alignItems = "center"
  root.justifyContent = "center"
  root.add(logo(ctx))
}

const shots = {
  hero: { w: W, h: H, frames: [["", await capture(W, H, session, { options: { logoHue: "blue" } })]] },
  compare: {
    w: 42, h: 30,
    frames: [
      ["stock OpenCode", await capture(42, 30, sidebarOnly(30), { skin: false })],
      ["beautify-opencode", await capture(42, 30, sidebarOnly(30))],
    ],
  },
  palettes: {
    w: 42, h: 22,
    frames: [
      ['palette: "neon" (default)', await capture(42, 22, sidebarOnly(22))],
      ['palette: "btop"', await capture(42, 22, sidebarOnly(22), { options: { palette: "btop" } })],
      ['palette: "theme"', await capture(42, 22, sidebarOnly(22), { options: { palette: "theme" } })],
    ],
  },
  logo: {
    w: 45, h: 6,
    frames: [
      ["stock", await capture(45, 6, home, { skin: false })],
      ['logoHue: "accent"', await capture(45, 6, home)],
      ['logoHue: "blue"', await capture(45, 6, home, { options: { logoHue: "blue" } })],
      ['logoGradient: "aurora"', await capture(45, 6, home, { options: { logoGradient: "aurora" } })],
    ],
  },
}

const html = `<!doctype html><meta charset="utf-8"><title>beautify-opencode shots</title>
<style>
  body { margin: 0; background: #0d0f14; font-family: "Segoe UI", system-ui, sans-serif; }
  .shot { display: inline-flex; gap: 28px; padding: 40px; background: radial-gradient(ellipse at 30% 0%, #1d2433 0%, #0d0f14 70%); align-items: flex-start; }
  .win { border-radius: 10px; overflow: hidden; background: ${BG}; box-shadow: 0 20px 50px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.07); }
  .bar { height: 30px; display: flex; align-items: center; gap: 8px; padding: 0 12px; background: #1a1c22; color: #8b8f99; font-size: 12.5px; }
  .dot { width: 11px; height: 11px; border-radius: 50%; }
  .bar span.t { flex: 1; text-align: center; margin-right: 48px; }
  canvas { display: block; }
  #logo { flex-wrap: wrap; width: 842px; }
  .label { color: #aab2c0; font-size: 14px; margin: 0 0 10px 2px; letter-spacing: .2px; }
</style>
<body>
<script>
const SHOTS = ${JSON.stringify(shots)};
const BG = ${JSON.stringify(BG)};
const FONT = '"Cascadia Mono", "JetBrains Mono", Consolas, monospace';
const SIZE = 15, DPR = 2;
const probe = document.createElement("canvas").getContext("2d");
probe.font = SIZE + "px " + FONT;
const CW = Math.ceil(probe.measureText("M").width), CH = 20;
// box glyph -> arms [left, right, up, down]; heavy = thick; round = arc corner
const BOX = {
  "─": [1,1,0,0], "│": [0,0,1,1], "┌": [0,1,0,1], "┐": [1,0,0,1], "└": [0,1,1,0], "┘": [1,0,1,0],
  "╭": [0,1,0,1,"r"], "╮": [1,0,0,1,"r"], "╰": [0,1,1,0,"r"], "╯": [1,0,1,0,"r"],
  "├": [0,1,1,1], "┤": [1,0,1,1], "┬": [1,1,0,1], "┴": [1,1,1,0], "┼": [1,1,1,1],
  "━": [1,1,0,0,"h"], "┃": [0,0,1,1,"h"],
};
const rgb = (c) => c ? "rgb(" + c.join(",") + ")" : null;
function paint(lines, w, h) {
  const cv = document.createElement("canvas");
  cv.width = w * CW * DPR; cv.height = h * CH * DPR;
  cv.style.width = w * CW + "px"; cv.style.height = h * CH + "px";
  const g = cv.getContext("2d");
  g.scale(DPR, DPR);
  g.fillStyle = BG; g.fillRect(0, 0, w * CW, h * CH);
  g.textBaseline = "middle";
  lines.forEach((spans, y) => {
    let x = 0;
    for (const [text, fg, bg, attr] of spans) {
      for (const ch of text) {
        const px = x * CW, py = y * CH, cx = px + CW / 2, cy = py + CH / 2;
        if (bg) { g.fillStyle = rgb(bg); g.fillRect(px, py, CW + 0.5, CH + 0.5); }
        const col = rgb(fg) || "#ddd";
        g.fillStyle = col; g.strokeStyle = col;
        const box = BOX[ch];
        if (box) {
          g.lineWidth = box[4] === "h" ? 2.4 : 1.25;
          g.beginPath();
          if (box[4] === "r") {
            const sx = box[0] ? px : px + CW, sy = box[2] ? py : py + CH;
            const r = Math.min(CW, CH) / 2;
            const hx = box[0] ? -1 : 1, vy = box[2] ? -1 : 1;
            g.moveTo(cx + hx * CW / 2, cy); g.lineTo(cx + hx * r, cy);
            g.arcTo(cx, cy, cx, cy + vy * r, r);
            g.lineTo(cx, cy + vy * CH / 2);
          } else {
            if (box[0]) { g.moveTo(px, cy); g.lineTo(cx, cy); }
            if (box[1]) { g.moveTo(cx, cy); g.lineTo(px + CW, cy); }
            if (box[2]) { g.moveTo(cx, py); g.lineTo(cx, cy); }
            if (box[3]) { g.moveTo(cx, cy); g.lineTo(cx, py + CH); }
          }
          g.stroke();
        } else if (ch === "█") g.fillRect(px, py, CW + 0.5, CH + 0.5);
        else if (ch === "▀") g.fillRect(px, py, CW + 0.5, CH / 2);
        else if (ch === "▄") g.fillRect(px, py + CH / 2, CW + 0.5, CH / 2 + 0.5);
        else if (ch === "░") { g.globalAlpha = 0.3; g.fillRect(px, py, CW, CH); g.globalAlpha = 1; }
        else if (ch === "■") { const s = CW * 0.72; g.fillRect(cx - s / 2, cy - s / 2, s, s); }
        else if (ch !== " ") {
          g.font = (attr & 1 ? "bold " : "") + SIZE + "px " + FONT;
          g.fillText(ch, px, cy + 1);
        }
        x++;
      }
    }
  });
  return cv;
}
const dots = '<span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>';
const only = new URLSearchParams(location.search).get("only");
for (const [id, shot] of Object.entries(SHOTS)) {
  if (only && id !== only) continue;
  const wrap = document.createElement("div");
  wrap.className = "shot"; wrap.id = id;
  for (const [label, lines] of shot.frames) {
    const col = document.createElement("div");
    if (label) col.innerHTML = '<p class="label">' + label + "</p>";
    const win = document.createElement("div");
    win.className = "win";
    win.innerHTML = '<div class="bar">' + dots + '<span class="t">' + (id === "hero" ? "opencode — ~/projects/app" : "opencode") + "</span></div>";
    win.appendChild(paint(lines, shot.w, shot.h));
    col.appendChild(win);
    wrap.appendChild(col);
  }
  document.body.appendChild(wrap);
  document.body.appendChild(document.createElement("br"));
}
</script>`

writeFileSync(new URL("./shots.html", import.meta.url), html)
console.log("wrote docs/shots.html")
process.exit()
