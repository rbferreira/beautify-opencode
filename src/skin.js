// beautify-opencode — the skin layer.
//
// Restyles renderables that already exist in the live OpenTUI tree; it never
// adds content. A short-interval scan walks `renderer.root` and patches what it
// recognises:
//
//   * cards       — boxes drawn (or meant to be drawn) with a border become
//                   btop boxes: rounded corners, one muted border colour for
//                   all, no blank padding rows, and the card's own header row
//                   moved INTO the top border:  ╭─┐ ▼ Title ┌──────┐ v1.2 ┌─╮
//                   Clicks on that border row are forwarded to the original
//                   header, so collapse toggles keep working.
//   * box bars    — magic-context's segmented token bar (a row of coloured
//                   boxes) is repainted as btop meter cells (■) or a glossy pill.
//   * text bars   — any short text containing a ██████░░░░ run (Checklist-to-Goal,
//                   magic-context's recomp bar…) is repainted as a btop meter:
//                   ■ cells on a green→yellow→red gradient, dim ■ for the rest.
//
// Everything is heuristic and defensive: a node that does not match exactly is
// left alone, so a host or plugin refactor degrades to "looks stock", never to
// a broken screen. `stop()` restores every patched node.

// Hardcoded segment colours of magic-context's TokenBreakdown (COLORS in
// src/tui/slots/sidebar-content.tsx). Matching on them identifies the bar.
export const MAGIC_CONTEXT_PALETTE = [
  "#c084fc", "#22d3ee", "#60a5fa", "#fbbf24", "#34d399",
  "#a3e635", "#f87171", "#fb923c", "#f472b6",
]

// btop's default meter gradient (cpu_start / cpu_mid / cpu_end).
const BTOP_GRADIENT = [[0x50, 0xf0, 0x95], [0xf2, 0xe2, 0x66], [0xfa, 0x1e, 0x1e]]

// Named logo gradients. "theme" (default) is derived from the active theme
// and falls back to "gelo" when the theme exposes no usable colours.
export const LOGO_GRADIENTS = {
  gelo: [[0xcf, 0xef, 0xff], [0x5a, 0xa9, 0xff]],
  aurora: [[0x7e, 0xe7, 0xd0], [0x7b, 0x8c, 0xff]],
  lavanda: [[0xe3, 0xd8, 0xff], [0x9a, 0x7c, 0xf0]],
  brasa: [[0xff, 0xd5, 0x8a], [0xff, 0x8a, 0x4c]],
  btop: BTOP_GRADIENT,
}

// btop's "Default" theme: the neon look. Every box gets its own saturated
// frame (cpu, mem, net, proc), titles are bright white, hotkeys red, and the
// meters use its ramps on a dark meter_bg.
export const NEON = {
  boxes: [[0x3d, 0x7b, 0x46], [0x8a, 0x88, 0x2e], [0x42, 0x3b, 0xa5], [0x92, 0x35, 0x35]],
  title: [0xee, 0xee, 0xee],
  hotkey: [0xe0, 0x50, 0x50],
  label: [0x90, 0x90, 0x90],
  meterBg: [0x3a, 0x3a, 0x3a],
  free: [[0x3a, 0x55, 0x22], [0xb5, 0xe6, 0x85], [0xdc, 0xff, 0x85]],
}

const DEFAULTS = {
  palette: "neon", // "neon" (btop style, theme colours) | "btop" (btop's exact colours) | "theme" (soft, title-tinted)
  cards: true, // rounded + unified border + compact + title in border
  cardTitles: true,
  boxBars: true,
  textBars: true,
  logo: true,
  logoGradient: "theme", // "theme" | a LOGO_GRADIENTS name | [[r,g,b], …] or ["#hex", …] stops
  logoHue: "accent", // theme ramp used by "theme": accent, interactive, blue, purple, cyan, green…
  meterGradient: "progress", // "progress" (green ramp) | "usage" (green → yellow → red)
  barStyle: "btop", // "btop" | "glossy"
  scanMs: 300,
}

const BOLD = 1

// Terminal cell width of a string: 2 for East Asian wide / emoji, 0 for
// combining marks and variation selectors, 1 otherwise.
function displayWidth(text) {
  let width = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0)
    if ((cp >= 0x300 && cp <= 0x36f) || (cp >= 0xfe00 && cp <= 0xfe0f) || cp === 0x200d) continue
    const wide =
      (cp >= 0x1100 && cp <= 0x115f) ||
      (cp >= 0x2e80 && cp <= 0xa4cf) ||
      (cp >= 0xac00 && cp <= 0xd7a3) ||
      (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) ||
      (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) ||
      (cp >= 0x1f300 && cp <= 0x1faff) ||
      cp >= 0x20000
    width += wide ? 2 : 1
  }
  return width
}

// --- colour helpers (plain [r, g, b] 0..255) --------------------------------

function toRgb(rgba) {
  if (!rgba || typeof rgba.toInts !== "function") return null
  const [r, g, b, a] = rgba.toInts()
  if (a === 0) return null
  return [r, g, b]
}

function hexOf(rgba) {
  const rgb = toRgb(rgba)
  return rgb ? "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("") : null
}

const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
const mix = (a, b, t) => [0, 1, 2].map((i) => clamp(a[i] + (b[i] - a[i]) * t))
const scale = (a, k) => a.map((v) => clamp(v * k))
const WHITE = [255, 255, 255]
const BLACK = [0, 0, 0]

function gradient(stops, t) {
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  return mix(stops[i], stops[i + 1], x - i)
}

// --- tree helpers -------------------------------------------------------------

function children(node) {
  try {
    return typeof node?.getChildren === "function" ? node.getChildren() : []
  } catch {
    return []
  }
}

function walk(node, visit, depth = 0) {
  if (!node || depth > 200) return
  visit(node)
  for (const child of children(node)) walk(child, visit, depth + 1)
}

const isText = (node) => typeof node?.plainText === "string"

function textsIn(node, out = []) {
  if (isText(node)) out.push(node)
  for (const child of children(node)) textsIn(child, out)
  return out
}

function get(node, key) {
  try {
    return node[key]
  } catch {
    return undefined
  }
}

// Paddings and gaps have setters but no getters in OpenTUI; read them back
// from the layout node (host: renderable.getPadding/getGap; 0.5.x: yogaNode).
const EDGES = { paddingLeft: 0, paddingTop: 1, paddingRight: 2, paddingBottom: 3 }
const GUTTERS = { gap: 2, rowGap: 1 }
function style(node, key) {
  const direct = get(node, key)
  if (direct !== undefined) return direct
  try {
    let r
    if (key in EDGES) r = typeof node.getPadding === "function" ? node.getPadding(EDGES[key]) : node.yogaNode?.getPadding?.(EDGES[key])
    else if (key in GUTTERS) r = typeof node.getGap === "function" ? node.getGap(GUTTERS[key]) : node.yogaNode?.getGap?.(GUTTERS[key])
    else return undefined
    const value = r !== null && typeof r === "object" ? r.value : r
    return Number.isFinite(value) ? value : 0 // unset = 0
  } catch {
    return undefined
  }
}

// --- skin ---------------------------------------------------------------------

export function createSkin({ renderer, RGBA, theme, options = {} }) {
  const opts = { ...DEFAULTS, ...options }
  const token = Symbol("beautify-instance") // tags this instance's wrappers
  // Newest instance wins: on hot reload the new instance registers itself and
  // every older one goes inert at once, even before its stop() is called.
  const ACTIVE = Symbol.for("beautify-opencode.active")
  let stopped = false
  const live = () => !stopped && (globalThis[ACTIVE] === token || globalThis[ACTIVE] === undefined)
  const palette = new Set(MAGIC_CONTEXT_PALETTE)
  const cards = new Map() // card -> original props
  const headers = new Map() // card -> hidden header node
  const boxSegments = new Set()
  const textBars = new Set()
  const rows = new Map() // intercepted bar row -> original add/insertBefore
  let timer = null
  let lastScan = 0

  // Runs at the start of every frame, before layout: patches applied here are
  // in the very frame that would otherwise have shown the stock look. Hooked
  // on the real root renderable: newer OpenTUI only runs lifecycle passes of
  // genuine scene nodes (a plain object is silently ignored).
  let previousRootPass = null
  function onFrame() {
    if (!live()) return
    try {
      previousRootPass?.call(this)
    } catch {}
    framePassesSincePaint++
    if (Date.now() - lastScan >= 250) scan()
    else scanContainers()
  }

  // The host's render loop awaits frame callbacks BEFORE it lays out and
  // paints the scene (the lifecycle pass above runs inside the native paint,
  // after layout: too late for a node a plugin inserted since the last frame).
  async function beforeFrame() {
    if (live()) scanContainers()
  }

  function hookFrames() {
    try {
      renderer?.setFrameCallback?.(beforeFrame)
    } catch {}
    const root = renderer?.root
    if (!root) return
    try {
      // Chain someone else's pass, never a previous instance of this plugin.
      const previous = root.onLifecyclePass ?? null
      previousRootPass = previous?.__beautify ? null : previous
      root.onLifecyclePass = onFrame // newer OpenTUI: the setter registers it
      renderer.registerLifecyclePass?.(root) // 0.5.x: explicit registration
    } catch (error) {
      console.error("[beautify-opencode] frame hook failed:", error)
    }
  }

  function unhookFrames() {
    try {
      renderer?.removeFrameCallback?.(beforeFrame)
    } catch {}
    const root = renderer?.root
    if (!root || root.onLifecyclePass !== onFrame) return
    try {
      root.onLifecyclePass = previousRootPass ?? null
      if (!previousRootPass) renderer.unregisterLifecyclePass?.(root)
    } catch {}
  }

  const color = (rgb, a = 255) => RGBA.fromInts(rgb[0], rgb[1], rgb[2], a)
  const TRANSPARENT = RGBA.fromInts(0, 0, 0, 0)

  function themeRgb(...paths) {
    const t = typeof theme === "function" ? theme() : theme
    for (const path of paths) {
      let v = t
      for (const key of path.split(".")) v = v?.[key]
      const rgb = toRgb(v)
      if (rgb) return rgb
    }
    return null
  }

  function panelRgb(node) {
    for (let p = node; p; p = p.parent) {
      if ("backgroundColor" in p) {
        const rgb = toRgb(get(p, "backgroundColor"))
        if (rgb) return rgb
      }
    }
    return themeRgb("background.panel.base", "background.panel", "background.base", "background")
  }

  const panelColor = (node) => {
    const rgb = panelRgb(node)
    return rgb ? color(rgb) : TRANSPARENT
  }

  // The neon (btop-style) colours. palette "neon" takes them from the theme's
  // tonal ramps, so they follow /theme; "btop" uses btop's Default theme as is.
  // Any colour the theme lacks falls back to btop's.
  function neonColors() {
    if (opts.palette === "btop") return NEON
    const pick = (paths, fallback) => themeRgb(...paths) ?? fallback
    return {
      boxes: [
        pick(["hue.green.400"], NEON.boxes[0]),
        pick(["hue.yellow.400", "hue.orange.400"], NEON.boxes[1]),
        pick(["hue.purple.400", "hue.blue.400"], NEON.boxes[2]),
        pick(["hue.red.400"], NEON.boxes[3]),
      ],
      title: pick(["text.base"], NEON.title),
      hotkey: pick(["text.feedback.error.base", "hue.red.200"], NEON.hotkey),
      label: pick(["text.muted"], NEON.label),
      meterBg: pick(["background.raised.max", "hue.gray.500"], NEON.meterBg),
      free: [
        pick(["hue.green.600"], NEON.free[0]),
        pick(["hue.green.200"], NEON.free[1]),
        pick(["hue.green.100"], NEON.free[2]),
      ],
    }
  }
  const isNeon = () => opts.palette === "neon" || opts.palette === "btop"

  // Muted tone shared by every card border (btop: quiet frames, loud titles).
  function borderRgb(fallback) {
    return themeRgb("text.muted", "textMuted", "border.base", "border") ?? fallback ?? [0x70, 0x70, 0x70]
  }

  // ---------------------------------------------------------------- cards ---

  // Sidebar sections promoted to cards although they draw no border at all
  // (host "Context"/"MCP", Checklist-to-Goal…), and the sidebar containers
  // they live in.
  const sections = new WeakSet()
  const containers = new Set()
  const spacers = new Set() // empty gap boxes hidden between sections
  const cardIndex = new Map() // card -> position in its container (neon frame colour)
  const containerGaps = new Map() // container -> original gap / rowGap
  const wrappers = new Map() // section wrapper -> original margins

  // A card its owner meant to have: a single border, or `border={{ type:
  // "single" }}` (magic-context / omo-slim), which OpenTUI ignores (it only
  // honours `true` or a side list) so it renders borderless. Judged on the
  // ORIGINAL props when we already restyled the node (here or in a previous
  // instance), never on a sticky mark: a wrapper boxed by a passing state
  // (a plugin mid-rebuild) must be able to lose its box again.
  function nativeCard(node) {
    if (!("borderStyle" in node) || !("border" in node)) return false
    const orig = cards.get(node) ?? node.__beautify?.original
    if (orig?.section) return false
    if (get(node, "customBorderChars")) return false // host's decorated borders (prompt rail…)
    const border = orig ? orig.border : get(node, "border")
    if (border === true) return (orig ? orig.borderStyle : get(node, "borderStyle")) === "single"
    return !!border && typeof border === "object" && !Array.isArray(border)
  }

  const isCard = (node) => sections.has(node) || nativeCard(node)

  const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("")

  // Original values live on the node itself, so a hot-reloaded instance finds
  // the real originals instead of capturing the previous instance's changes.
  function shared(node, key, capture) {
    const slot = (node.__beautify ??= {})
    if (!(key in slot)) slot[key] = capture()
    return slot[key]
  }

  function setIf(node, key, value) {
    if (style(node, key) === value) return false
    node[key] = value
    return true
  }

  // Our own rounded frame on a node we have touched before (it carries our
  // marks) — whatever earlier build put it there.
  // (Builds before this one restored the border in the wrong order and left
  // "originals" that were really our own frame; those records are ignored.)
  const worn = (node) => {
    const b = node.__beautify
    if (!b || b.original || get(node, "border") !== true) return false
    return get(node, "borderStyle") === "rounded" || "card" in b || "look" in b
  }
  const WORN = { border: false, borderStyle: "single", paddingTop: 0, paddingBottom: 0, paddingLeft: 0, paddingRight: 0 }

  const CARD_KEYS = ["border", "borderStyle", "borderColor", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "marginTop", "marginBottom"]

  function styleCard(node) {
    if (!cards.has(node)) {
      const orig = shared(node, "original", () => {
        // Already wearing our look at first sight (left by an older build):
        // the real original is lost; borderless is the safe guess.
        if (worn(node)) return { ...WORN, section: sections.has(node) }
        const values = Object.fromEntries(CARD_KEYS.map((k) => [k, style(node, k)]))
        const down = node._mouseListeners?.down
        values.downListener = down?.__beautify ? undefined : down
        values.section = sections.has(node) // boxed by us, not by its owner
        return values
      })
      cards.set(node, orig)
      if (!sections.has(node)) noteContainer(node)
    }
    const orig = cards.get(node)
    const overlay = isOverlay(node)
    let changed = false
    // Sections lose only their top side: their own title row becomes the top
    // border, painted over in post-process. Nothing is hidden, so a section
    // whose content is rebuilt (Checklist-to-Goal, every second) never
    // changes height between frames.
    const want = overlay ? SECTION_SIDES : true
    const have = get(node, "border")
    if (!(have === want || (Array.isArray(have) && Array.isArray(want) && have.join() === want.join()))) {
      node.border = want
      changed = true
    }
    changed = setIf(node, "borderStyle", "rounded") || changed
    changed = setIf(node, "paddingTop", 0) || changed
    changed = setIf(node, "paddingBottom", 0) || changed
    if (sections.has(node)) {
      if (!orig.paddingLeft) changed = setIf(node, "paddingLeft", 1) || changed
      if (!orig.paddingRight) changed = setIf(node, "paddingRight", 1) || changed
    }
    if (containers.has(node.parent) || containers.has(node.parent?.parent)) {
      changed = setIf(node, "marginTop", 0) || changed
      changed = setIf(node, "marginBottom", 0) || changed
    }
    if (overlay) changed = releaseHeader(node, orig) || changed
    else if (opts.cardTitles) changed = promoteHeader(node) || changed
    // btop gives every box its own frame colour: tint the muted border with
    // the card's title colour.
    const header = overlay ? sectionTitle(node) : headers.get(node)
    const base = borderRgb(toRgb(orig.borderColor))
    const target =
      isNeon()
        ? neonColors().boxes[(cardIndex.get(node) ?? 0) % NEON.boxes.length]
        : header
          ? mix(base, headerParts(header).tint, 0.45)
          : base
    if (hexOf(get(node, "borderColor")) !== hex(target)) {
      node.borderColor = color(target)
      changed = true
    }
    return changed
  }

  const SECTION_SIDES = ["left", "right", "bottom"]
  const isOverlay = (node) => sections.has(node) && opts.cardTitles

  // A section's title row: the first row of its content, left in place.
  function sectionTitle(card) {
    const first = realKids(contentOf(card))[0]
    if (!first || first.isDestroyed) return null
    return isText(first) || isHeaderLike(first) ? first : null
  }

  const isHeaderLike = (node) => {
    const n = textsIn(node).length
    return n >= 1 && n <= 3
  }

  // Undo what a previous build did to a section's title (hidden it, hooked
  // the card to draw and forward clicks for it): the row now stays visible
  // and gets its clicks natively.
  function releaseHeader(card, orig) {
    let changed = false
    const first = realKids(contentOf(card))[0]
    if (first?.__beautify?.header) {
      delete first.__beautify.header
      if (get(first, "visible") === false) {
        first.visible = true
        changed = true
      }
    }
    if (card.renderAfter?.__beautify) {
      card.renderAfter = undefined
      changed = true
    }
    if (card._mouseListeners?.down?.__beautify) {
      card.onMouseDown = orig.downListener
      changed = true
    }
    headers.delete(card)
    return changed
  }

  // Post-process: the section's top border, drawn over its title row.
  function drawSectionTop(buffer, card, clip) {
    const w = card.width
    if (!(w >= 10) || hiddenChain(card)) return
    const title = sectionTitle(card)
    const parts = !title
      ? { left: "", right: "", tint: WHITE }
      : isText(title)
        ? { left: title.plainText.split("\n")[0].trim(), right: "", tint: toRgb(get(title, "fg")) ?? WHITE }
        : headerParts(title)
    const x0 = card.screenX
    const y = card.screenY
    const bg = panelColor(card.parent)
    const line = get(card, "borderColor") ?? color(borderRgb())
    put(buffer, clip, x0, y, "╭", line, bg)
    for (let x = x0 + 1; x < x0 + w - 1; x++) put(buffer, clip, x, y, "─", line, bg)
    put(buffer, clip, x0 + w - 1, y, "╮", line, bg)
    drawTitle(buffer, card, parts, clip)
  }

  // OpenCode's slot layout leaves hidden 1×1 placeholder nodes around.
  const isSlotStub = (node) => typeof node?.id === "string" && node.id.startsWith("slot-layout")

  // A card header is its first child: a one-row box holding 1–3 text nodes
  // (e.g. [badge(▼ Magic Context)] … [v0.49.35]), or, for sections, a
  // one-line title text such as "Checklist".
  function findHeader(card) {
    const known = headers.get(card)
    // Always the first real child, hidden or not: after a hot reload the header
    // may still be hidden by the previous instance, and skipping it would
    // promote (and hide) the first content row instead.
    const first = realKids(sections.has(card) ? contentOf(card) : card)[0]
    if (!first) return null
    if (first === known) return first
    // Height 0 = created this frame and not laid out yet (rebuilt cards).
    const h = get(first, "height")
    if (h && h !== 1) return null
    if (isText(first)) return sections.has(card) && first.plainText.trim() ? first : null
    const texts = textsIn(first)
    if (texts.length < 1 || texts.length > 3) return null
    return first
  }

  function promoteHeader(card) {
    const header = findHeader(card)
    if (!header) return false
    let changed = false
    if (headers.get(card) !== header) {
      headers.set(card, header)
      card.renderAfter = drawCardTitle
      card.onMouseDown = forwardTitleClick
      changed = true
    }
    shared(header, "header", () => true) // so a successor can tell it was us
    changed = setIf(header, "visible", false) || changed
    return changed
  }

  // The node whose children are a section's rows: the section itself or the
  // end of its single-child wrappers. Checklist-to-Goal renders one box deeper
  // and rebuilds that box every second; the section (and its border) stays on
  // the stable wrapper, and only the hidden title moves with the rebuild.
  // A wrapper is told from a one-row header (MCP collapsed) by its laid-out
  // height; a rebuilt box has no layout yet, so the depth last measured for
  // this section is reused.
  const contentDepth = new WeakMap()
  function contentOf(card) {
    const memo = contentDepth.get(card) ?? 0
    let node = card
    let depth = 0
    let measured = true
    for (; depth < 4; depth++) {
      const kids = realKids(node)
      // Mid-swap (emptied, or old and new content side by side): learn nothing.
      if (kids.length === 0 || (kids.length > 1 && depth < memo)) measured = false
      if (kids.length !== 1 || isText(kids[0])) break
      const h = get(kids[0], "height")
      if (!h) measured = false
      if (h > 1 || (!h && depth < memo)) node = kids[0]
      else break
    }
    if (measured) contentDepth.set(card, depth)
    return node
  }

  // Undo the card look on a node that is no longer a card (or on stop).
  function unstyleCard(node) {
    const orig = cards.get(node) ?? node.__beautify?.original ?? (worn(node) ? WORN : null)
    if (!orig) return false
    try {
      // OpenTUI turns the border ON whenever borderStyle or borderColor is
      // set, so `border` goes last, and a borderless original is `false`.
      for (const key of CARD_KEYS) {
        if (key === "border" || (key === "borderColor" && !orig.borderColor)) continue
        if (orig[key] !== undefined) node[key] = orig[key]
      }
      node.border = orig.border ?? false
      if (node.renderAfter?.__beautify) node.renderAfter = undefined
      if (node._mouseListeners?.down?.__beautify) node.onMouseDown = orig.downListener
      const header = headers.get(node) ?? realKids(contentOf(node))[0]
      if (header && !header.isDestroyed && header.__beautify?.header) {
        header.visible = true
        delete header.__beautify.header
      }
      if (node.__beautify) delete node.__beautify.original
    } catch {}
    cards.delete(node)
    headers.delete(node)
    cardIndex.delete(node)
    return true
  }

  function headerParts(header) {
    const texts = textsIn(header).filter((t) => t.plainText.trim())
    // The last text is a right-hand label (version, count…) when there are 3+
    // texts or it carries a digit; everything else is the title, which plugins
    // split across nodes ("▼" + "MCP", "▼" + "OMO-Slim").
    const last = texts[texts.length - 1]?.plainText.trim() ?? ""
    const hasRight = texts.length >= 3 || (texts.length === 2 && /\d/.test(last))
    const right = hasRight ? last : ""
    const left = (hasRight ? texts.slice(0, -1) : texts).map((t) => t.plainText.trim()).join(" ")
    // Title colour: the badge background if the title sits on one, else its text colour.
    let tint = null
    for (let p = texts[0]?.parent; p && p !== header.parent; p = p.parent) {
      tint = toRgb(get(p, "backgroundColor"))
      if (tint) break
    }
    tint ??= toRgb(get(texts[0], "fg")) ?? WHITE
    return { left, right, tint }
  }

  // Runs after the card painted its border (renderSelf) and before its
  // children, which never overlap the border row. btop style: ─┐title┌──┐v1┌─
  function drawCardTitle(buffer) {
    const header = headers.get(this)
    if (!header || header.isDestroyed) return
    if (this.width < 10) return
    drawTitle(buffer, this, headerParts(header))
  }

  function putText(buffer, clip, text, x, y, fg, bg, attr) {
    let i = 0
    for (const ch of text) put(buffer, clip, x + i++, y, ch, fg, bg, attr)
  }

  // btop-style title blocks on a card's top border row.
  function drawTitle(buffer, card, { left, right, tint }, clip) {
    const w = card.width
    const x0 = card.screenX
    const y = card.screenY
    const bg = panelColor(card.parent)
    const line = get(card, "borderColor") ?? color(borderRgb())
    const neon = isNeon()
    const pal = neon ? neonColors() : null
    const muted = color(neon ? pal.label : borderRgb())

    // Right block first so the title can be truncated against it.
    let rightStart = x0 + w - 2 // cell before the corner
    if (right && w > right.length + 14) {
      rightStart = x0 + w - 2 - (right.length + 2)
      put(buffer, clip, rightStart, y, "┐", line, bg)
      putText(buffer, clip, right, rightStart + 1, y, muted, bg)
      put(buffer, clip, rightStart + right.length + 1, y, "┌", line, bg)
    }
    const room = rightStart - (x0 + 3) - 2
    if (room < 2 || !left) return
    const title = left.length > room ? left.slice(0, room - 1) + "…" : left
    put(buffer, clip, x0 + 2, y, "┐", line, bg)
    // Neon: bright white title with the collapse toggle (the section's "hotkey")
    // in btop's red; theme palette: the card's own title colour.
    const toggle = /^[▼▶▸▾►▽]/.test(title)
    if (neon && toggle) {
      put(buffer, clip, x0 + 3, y, title[0], color(pal.hotkey), bg, BOLD)
      putText(buffer, clip, title.slice(1), x0 + 4, y, color(pal.title), bg, BOLD)
    } else {
      putText(buffer, clip, title, x0 + 3, y, color(neon ? pal.title : tint), bg, BOLD)
    }
    put(buffer, clip, x0 + 3 + title.length, y, "┌", line, bg)
  }

  function forwardTitleClick(event) {
    const card = this
    const original = cards.get(card)?.downListener
    if (original && original !== forwardTitleClick) original.call(card, event)
    const header = headers.get(card)
    if (event?.y !== card.screenY || !header) return
    // The header is hidden, so it never gets hit; call its own handlers directly
    // (not processMouseEvent, which would bubble back here).
    for (const node of [header, ...children(header)]) node._mouseListeners?.down?.call(node, event)
  }

  // ------------------------------------------------------------- sections ---

  // The sidebar container: the nearest narrow ancestor of a plugin card that
  // stacks several sections.
  function noteContainer(card) {
    const limit = Math.max(60, (renderer?.width ?? 200) * 0.5)
    let p = card.parent
    for (let i = 0; p && i < 4; i++, p = p.parent) {
      if (children(p).filter((c) => !isSlotStub(c)).length >= 3 && get(p, "width") <= limit) {
        containers.add(p)
        return
      }
    }
  }

  const realKids = (node) => children(node).filter((k) => !isSlotStub(k))

  // Each direct child of a container is a section: hide empty gap boxes,
  // unwrap single-child slot wrappers, and turn the rest into cards.
  function sectionize(container) {
    let changed = false
    // btop boxes touch: drop the container's own row gap. OpenTUI has no gap
    // getter, so the gap is inferred from the layout (smallest space between
    // consecutive sections) before anything else is touched, and kept for stop().
    if (!containerGaps.has(container)) {
      const laid = realKids(container)
        .filter((k) => get(k, "visible") !== false && k.height > 0)
        .sort((a, b) => a.screenY - b.screenY)
      let gap = Infinity
      for (let i = 1; i < laid.length; i++) {
        const space = laid[i].screenY - (laid[i - 1].screenY + laid[i - 1].height)
        if (space >= 0) gap = Math.min(gap, space)
      }
      if (laid.length >= 2) {
        gap = shared(container, "gap", () => (Number.isFinite(gap) ? gap : 0))
        containerGaps.set(container, gap)
        if (gap > 0) {
          container.gap = 0
          container.rowGap = 0
          changed = true
        }
      }
    }
    let index = 0
    for (const child of realKids(container)) {
      if (child.isDestroyed || isText(child)) continue
      if (realKids(child).length === 0) {
        if (child.__beautify?.spacer) spacers.add(child) // hidden by a previous instance
        if (!spacers.has(child) && get(child, "height") <= 2 && get(child, "visible") !== false) {
          spacers.add(child)
          shared(child, "spacer", () => true)
          child.visible = false
          changed = true
        }
        continue
      }
      // A "spacer" that got content (a slot that was empty for a moment).
      if (spacers.has(child) || child.__beautify?.spacer) {
        spacers.delete(child)
        delete child.__beautify.spacer
        child.visible = true
        changed = true
      }
      // Sections touch, like btop boxes: no margins on the slot wrappers either.
      const margins = shared(child, "margins", () => ({ marginTop: get(child, "marginTop"), marginBottom: get(child, "marginBottom") }))
      for (const key of ["marginTop", "marginBottom"]) {
        if (!margins[key]) continue
        wrappers.set(child, margins) // also when a previous instance zeroed it
        if (get(child, key) !== 0) {
          child[key] = 0
          changed = true
        }
      }
      // Decided afresh on every pass. A plugin's own card (omo-slim, magic-
      // context) is the box, wherever it sits in its slot wrappers; otherwise
      // the section is the stable top-level child, never a rebuilt inner node.
      const native = findNative(child)
      let target = native
      if (native) {
        sections.delete(child)
      } else if (sections.has(child)) {
        target = child
      } else {
        const first = realKids(contentOf(child))[0]
        const h = get(first, "height")
        if (first && !(h && h !== 1)) {
          sections.add(child)
          target = child
          changed = true
        }
      }
      if (target) cardIndex.set(target, index++)
      // Boxes left on other nodes of this section by an earlier decision (or
      // an earlier instance) come off: one box per section, ever.
      changed = unboxOthers(child, target) || changed
    }
    return changed
  }

  // A card its owner drew inside a section, at most a few wrappers deep.
  function findNative(node, depth = 0) {
    if (depth > 4 || isText(node)) return null
    if (nativeCard(node)) return node
    for (const kid of realKids(node)) {
      const found = findNative(kid, depth + 1)
      if (found) return found
    }
    return null
  }

  function unboxOthers(node, keep, depth = 0) {
    if (depth > 4 || isText(node) || node.isDestroyed) return false
    let changed = false
    if (node !== keep && !nativeCard(node) && (cards.has(node) || node.__beautify?.original || worn(node))) changed = unstyleCard(node)
    for (const kid of realKids(node)) changed = unboxOthers(kid, keep, depth + 1) || changed
    return changed
  }

  // ------------------------------------------------------------- box bars ---

  function isBoxBarRow(node) {
    if (get(node, "height") !== 1) return false
    const kids = children(node)
    if (kids.length === 0) return false
    return kids.every(
      (k) => children(k).length === 0 && get(k, "height") <= 1 && "backgroundColor" in k && palette.has(hexOf(k.backgroundColor)),
    )
  }

  // Cell writer honouring an optional clip rect (post-process painting must not
  // leak outside the scrolled sidebar viewport). As a render hook, the second
  // argument is deltaTime, a number: no clip.
  function put(buffer, clip, x, y, ch, fg, bg, attr) {
    if (clip && typeof clip === "object" && (x < clip.x0 || x >= clip.x1 || y < clip.y0 || y >= clip.y1)) return
    buffer.setCell(x, y, ch, fg, bg, attr)
  }

  function drawBoxSegment(buffer, clip) {
    const seg = this
    const row = seg.parent
    const base = toRgb(get(seg, "backgroundColor"))
    if (!row || !base || seg.width <= 0) return
    const panel = panelColor(row.parent)
    const x0 = seg.screenX
    const y = seg.screenY
    const w = seg.width

    if (opts.barStyle !== "glossy") {
      for (let i = 0; i < w; i++) put(buffer, clip, x0 + i, y, "■", color(base), panel)
      return
    }
    const isFirst = children(row).find((k) => k.width > 0) === seg
    for (let i = 0; i < w; i++) {
      const mid = scale(base, 1.06 - 0.14 * (w > 1 ? i / (w - 1) : 0.5))
      const leftCap = isFirst && i === 0 && w >= 2
      const rightCap = i === w - 1 && w >= 2 && !leftCap
      if (leftCap) put(buffer, clip, x0 + i, y, "▐", color(mid), panel)
      else if (rightCap) put(buffer, clip, x0 + i, y, "▌", color(mid), panel)
      else put(buffer, clip, x0 + i, y, "▀", color(mix(mid, WHITE, 0.3)), color(mix(mid, BLACK, 0.18)))
    }
  }

  // ------------------------------------------------------------ text bars ---

  const TEXT_BAR = /[█░]{6,}/

  function isTextBar(node) {
    if (!isText(node)) return false
    const text = node.plainText
    return text.length <= 160 && TEXT_BAR.test(text)
  }

  // Locates █/░ runs in the node's plainText and repaints those cells. (The
  // frame buffer can't be searched: non-ASCII cells hold grapheme-pool ids, not
  // code points.) Columns come from the display width of the text before the
  // run; a wrapped text (more rows than lines) is skipped rather than guessed.
  const RUNS = /[█░]{6,}/g

  function drawTextBar(buffer, clip) {
    const node = this
    const lines = node.plainText.split("\n")
    if (node.height > lines.length) return
    const empty = color(isNeon() ? neonColors().meterBg : mix(panelRgb(node) ?? [0x16, 0x16, 0x16], borderRgb(), 0.45))
    const bg = panelColor(node)
    const right = node.screenX + node.width
    const stops = meterStops()
    lines.forEach((line, row) => {
      const y = node.screenY + row
      for (const match of line.matchAll(RUNS)) {
        const x0 = node.screenX + displayWidth(line.slice(0, match.index))
        const run = [...match[0]]
        const n = run.length
        run.forEach((ch, i) => {
          if (x0 + i >= right) return
          const fg = ch === "█" ? color(gradient(stops, n > 1 ? i / (n - 1) : 0)) : empty
          put(buffer, clip, x0 + i, y, "■", fg, bg)
        })
      }
    })
  }

  // ----------------------------------------------------------------- logo ---

  // The home logo is a grid of 1×1 text cells (█ ▀ ▄ and spaces), shaded only
  // by each cell's fg/bg greys. Recolouring maps every cell onto a horizontal
  // gradient while keeping its original brightness, so the two-tone
  // "open"/"code" and the drop shadows survive — tinted.
  const LOGO_CHARS = new Set([" ", "█", "▀", "▄", "▌", "▐"])
  const logoCells = new Map() // cell -> { fg, bg, applied: [fgHex, bgHex] | null }
  const lum = (rgb) => (rgb ? 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2] : 0)
  let logoKey = null // stops last applied; a change (theme switch) repaints every cell

  const parseStop = (s) => {
    if (typeof s !== "string") return s
    const h = s.replace(/^#/, "")
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16))
  }

  // Gradient from the theme. V2 themes carry tonal ramps (hue.<name>.100…900):
  // a one-hue ramp from a lightened 100 to 200 gives the "gelo" look in the
  // theme's own colour (accent by default; logoHue picks another ramp).
  // Themes without ramps fall back to a lighter→base ramp of an accent colour.
  function themeStops() {
    const hue = opts.logoHue ?? "accent"
    const light = themeRgb(`hue.${hue}.100`)
    const mid = themeRgb(`hue.${hue}.200`)
    if (light && mid) return [mix(light, WHITE, 0.4), mid]
    const base = themeRgb("accent.base", "accent", "primary.base", "primary")
    return base ? [mix(base, WHITE, 0.45), base] : null
  }

  // Meter gradient in the theme's own colours. "progress" (default): a dark →
  // bright green ramp, like btop's "Free" bars, so 100% never reads as danger.
  // "usage": btop's green → yellow → red, from the theme's feedback colours.
  function meterStops() {
    if (isNeon() && opts.meterGradient !== "usage") return neonColors().free
    if (opts.meterGradient !== "usage") {
      const dark = themeRgb("hue.green.500")
      const bright = themeRgb("hue.green.100")
      if (dark && bright) return [dark, bright]
      const ok = themeRgb("text.feedback.success.base", "success")
      if (ok) return [scale(ok, 0.55), ok]
    }
    const ok = themeRgb("text.feedback.success.base", "success")
    const warn = themeRgb("text.feedback.warning.base", "warning")
    const bad = themeRgb("text.feedback.error.base", "error")
    return ok && warn && bad ? [ok, warn, bad] : BTOP_GRADIENT
  }

  function logoStops() {
    const pick = opts.logoGradient
    if (Array.isArray(pick) && pick.length >= 2) return pick.map(parseStop)
    if (typeof pick === "string" && LOGO_GRADIENTS[pick]) return LOGO_GRADIENTS[pick]
    return themeStops() ?? LOGO_GRADIENTS.gelo
  }

  function logoTexts(node) {
    if (isText(node)) return null
    const h = get(node, "height")
    const w = get(node, "width")
    if (!(h >= 3 && h <= 10 && w >= 20 && w <= 120)) return null
    const texts = textsIn(node)
    if (texts.length < 60) return null
    let ink = 0
    for (const t of texts) {
      if (t.width !== 1 || t.height !== 1) return null
      const ch = t.plainText
      if (!LOGO_CHARS.has(ch)) return null
      if (ch !== " ") ink++
    }
    return ink >= 20 ? texts : null
  }

  function skinLogo(box, texts) {
    const stops = logoStops()
    const key = JSON.stringify(stops)
    if (key !== logoKey) {
      // New gradient (theme switched): repaint every cell from its original.
      for (const rec of logoCells.values()) if (rec.applied) rec.reapply = true
      logoKey = key
    }
    // (Re)capture originals for new cells and for cells the host repainted
    // (theme switch), detected by colours that are no longer ours.
    for (const t of texts) {
      const prev = logoCells.get(t)
      if (prev?.reapply) {
        prev.applied = null
        prev.reapply = false
        continue
      }
      const rec = logoCells.get(t)
      const now = [hexOf(get(t, "fg")), hexOf(get(t, "bg"))]
      if (!rec) {
        // First sight: originals from the node (a previous instance may have
        // recoloured it already), else its current colours.
        const orig = shared(t, "logo", () => ({ fg: get(t, "fg"), bg: get(t, "bg") }))
        logoCells.set(t, { fg: orig.fg, bg: orig.bg, applied: null })
      } else if (!rec.applied || rec.applied[0] !== now[0] || rec.applied[1] !== now[1]) {
        // Host repainted it (theme switch): those are the new originals.
        t.__beautify.logo = { fg: get(t, "fg"), bg: get(t, "bg") }
        logoCells.set(t, { ...t.__beautify.logo, applied: null })
      }
    }
    let max = 1
    for (const t of texts) {
      const rec = logoCells.get(t)
      max = Math.max(max, lum(toRgb(rec.fg)), lum(toRgb(rec.bg)))
    }
    const x0 = box.screenX
    const span = Math.max(1, box.width - 1)
    let changed = false
    for (const t of texts) {
      const rec = logoCells.get(t)
      if (rec.applied) continue
      const g = gradient(stops, (t.screenX - x0) / span)
      const fg = toRgb(rec.fg)
      const bg = toRgb(rec.bg)
      if (fg) t.fg = color(scale(g, 0.3 + 0.7 * (lum(fg) / max)))
      if (bg) t.bg = color(scale(g, 0.9 * (lum(bg) / max)))
      rec.applied = [hexOf(get(t, "fg")), hexOf(get(t, "bg"))]
      changed = true
    }
    return changed
  }

  // --------------------------------------------------------- post-process ---

  // Runs on the finished frame buffer, after the whole scene is painted and
  // right before it reaches the terminal. Repainting the known bars here makes
  // a stock frame impossible whatever the host did this frame: rebuilt
  // segments, missed hooks, fresh layout. Clipped to the visible area of the
  // node's ancestors so a scrolled sidebar never leaks.
  function clipOf(node) {
    const clip = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity }
    for (let p = node.parent; p; p = p.parent) {
      const w = p.width
      const h = p.height
      if (!(w > 0 && h > 0)) continue
      clip.x0 = Math.max(clip.x0, p.screenX)
      clip.y0 = Math.max(clip.y0, p.screenY)
      clip.x1 = Math.min(clip.x1, p.screenX + w)
      clip.y1 = Math.min(clip.y1, p.screenY + h)
    }
    return clip
  }

  function hiddenChain(node) {
    for (let p = node; p; p = p.parent) if (get(p, "visible") === false) return true
    return false
  }

  let framePassesSincePaint = 0
  const debugLines = []
  const debugSig = new WeakMap()
  const debugCounters = { paints: 0, paintsWithoutFramePass: 0, framePassesWithoutPaint: 0, unhookedSegmentPaints: 0 }

  function debugRow(row, segs) {
    const unhooked = segs.filter((k) => k.renderAfter !== drawBoxSegment).length
    if (unhooked) debugCounters.unhookedSegmentPaints++
    const sum = segs.reduce((a, k) => a + Math.max(0, k.width), 0)
    const layout = segs.map((k) => `${k.screenX - row.screenX}+${k.width}${hexOf(get(k, "backgroundColor"))?.slice(1, 4) ?? "?"}`).join(",")
    const sig = `row@${row.screenX},${row.screenY} w=${row.width} segs=${segs.length} sumW=${sum} unhooked=${unhooked} [${layout}]`
    if (debugSig.get(row) === sig) return
    debugSig.set(row, sig)
    debugLines.push(`${new Date().toISOString().slice(11, 23)} ${sig}`)
    if (debugLines.length > 400) debugLines.splice(0, debugLines.length - 400)
  }

  function paintBars(buffer) {
    if (!live()) return
    debugCounters.paints++
    if (framePassesSincePaint === 0) debugCounters.paintsWithoutFramePass++
    if (framePassesSincePaint > 1) debugCounters.framePassesWithoutPaint += framePassesSincePaint - 1
    framePassesSincePaint = 0
    try {
      if (opts.boxBars) {
        for (const row of rows.keys()) {
          if (row.isDestroyed || hiddenChain(row)) continue
          const clip = clipOf(row)
          const segs = children(row)
          for (const seg of segs) if (seg.width > 0) drawBoxSegment.call(seg, buffer, clip)
          if (opts.debug) debugRow(row, segs)
        }
      }
      if (opts.debug) {
        for (const container of containers) {
          if (container.isDestroyed) continue
          const sig = "sections " + realKids(container).map((k) => `${k.id}:${get(k, "visible") === false ? "-" : k.height}`).join(" ")
          if (debugSig.get(container) !== sig) {
            debugSig.set(container, sig)
            debugLines.push(`${new Date().toISOString().slice(11, 23)} ${sig}`)
          }
        }
      }
      if (opts.cards && opts.cardTitles) {
        for (const container of containers) {
          if (container.isDestroyed) continue
          for (const card of realKids(container)) if (isOverlay(card) && !card.isDestroyed) drawSectionTop(buffer, card, clipOf(card))
        }
      }
      if (opts.textBars) {
        // Known bars plus any bar text in the sidebar not met yet (a rebuilt
        // checklist's brand-new node): the stock █░ never reaches the screen.
        const bars = new Set(textBars)
        for (const container of containers) if (!container.isDestroyed) for (const t of textsIn(container)) if (isTextBar(t)) bars.add(t)
        for (const node of bars) {
          if (node.isDestroyed || hiddenChain(node) || !isTextBar(node) || !(node.width > 0)) continue
          drawTextBar.call(node, buffer, clipOf(node))
        }
      }
    } catch (error) {
      console.error("[beautify-opencode] post-process failed:", error)
    }
  }

  function debugLog() {
    return [`counters ${JSON.stringify(debugCounters)}`, ...debugLines].join(String.fromCharCode(10))
  }

  // ---------------------------------------------------------------- scan ---

  function own(node, fn, set) {
    if (node.renderAfter === fn) return false
    // Someone else's hook: leave it alone. A previous skin instance's (hot
    // reload) is ours to replace.
    if (node.renderAfter && !node.renderAfter.__beautify) return false
    node.renderAfter = fn
    set.add(node)
    return true
  }

  // magic-context rebuilds its segment boxes on every snapshot (`.map`, not
  // <For>). Waiting for the next scan would show one stock frame each time —
  // the bar visibly "pulses". Intercepting the row's inserts skins a new
  // segment before it is ever drawn.
  function interceptRow(row) {
    if (rows.has(row) && row.add?.__owner === token) return false
    // Unwrap a previous instance's interception instead of stacking on it.
    const unwrap = (fn) => (fn?.__beautify ? fn.__original : fn)
    const original = { add: unwrap(row.add), insertBefore: unwrap(row.insertBefore) }
    rows.set(row, original)
    for (const method of ["add", "insertBefore"]) {
      if (typeof original[method] !== "function") continue
      const wrapped = function (child, ...rest) {
        const result = original[method].call(this, child, ...rest)
        if (live() && child && typeof child === "object") own(child, drawBoxSegment, boxSegments)
        if (live()) queueRescan()
        return result
      }
      wrapped.__beautify = true
      wrapped.__owner = token
      wrapped.__original = original[method]
      row[method] = wrapped
    }
    return true
  }

  // Text renderables override render() and never call renderBefore/renderAfter,
  // so the bar is drawn by wrapping renderSelf. Some OpenTUI builds give each
  // text instance its own renderSelf; wrap whatever is there and remember it.
  const textOriginals = new Map() // node -> { fn, own }

  function ownTextBar(node) {
    const current = node.renderSelf
    if (current?.__beautify && current.__owner === token) return false
    // A previous instance's wrap is replaced, not stacked.
    const original = current?.__beautify ? current.__original : current
    const own = current?.__beautify ? current.__ownOriginal : Object.prototype.hasOwnProperty.call(node, "renderSelf")
    if (typeof original !== "function") return false
    const wrapped = function (buffer, deltaTime) {
      original.call(this, buffer, deltaTime)
      drawTextBar.call(this, buffer)
    }
    wrapped.__beautify = true
    wrapped.__owner = token
    wrapped.__original = original
    wrapped.__ownOriginal = own
    textOriginals.set(node, { fn: original, own })
    node.renderSelf = wrapped
    // Newer OpenTUI paints text natively unless the node republishes a custom
    // renderSelf hook; without this the wrap above is never called.
    try {
      node.refreshHooks?.()
    } catch {}
    textBars.add(node)
    return true
  }

  function prune() {
    for (const node of cards.keys()) if (node.isDestroyed) cards.delete(node), headers.delete(node)
    for (const node of logoCells.keys()) if (node.isDestroyed) logoCells.delete(node)
    for (const node of textBars) if (node.isDestroyed) textBars.delete(node), textOriginals.delete(node)
    for (const set of [boxSegments, containers, spacers, watchedInserts]) for (const node of set) if (node.isDestroyed) set.delete(node)
  }

  function visit(node) {
    if (node.isDestroyed) return false
    let changed = false
    if (opts.cards && containers.has(node)) changed = sectionize(node) || changed
    if (opts.cards && isCard(node)) changed = styleCard(node) || changed
    // A known bar row skins every child, laid out or not: rebuilt segments have
    // height 0 in their first frame and would otherwise show one stock frame.
    if (opts.boxBars && (rows.has(node) || isBoxBarRow(node))) {
      changed = interceptRow(node) || changed
      for (const seg of children(node)) changed = own(seg, drawBoxSegment, boxSegments) || changed
    }
    if (opts.textBars && isTextBar(node)) changed = ownTextBar(node) || changed
    if (opts.logo) {
      const texts = logoTexts(node)
      if (texts) changed = skinLogo(node, texts) || changed
    }
    return changed
  }

  // Full scan: the whole tree. Throttled; finds new cards, containers, logos.
  function scan() {
    const root = renderer?.root
    if (!root || !live()) return false
    lastScan = Date.now()
    let changed = false
    try {
      walk(root, (node) => {
        changed = visit(node) || changed
      })
      prune()
    } catch (error) {
      console.error("[beautify-opencode] scan failed:", error)
    }
    if (changed) renderer.requestRender?.()
    return changed
  }

  // Every frame: only the sidebar containers. Plugins that rebuild their whole
  // card on each poll (omo-slim, Checklist-to-Goal) are re-skinned before the
  // frame is laid out, so no stock frame ever shows.
  function scanContainers() {
    if (!live()) return
    let changed = false
    try {
      for (const container of containers) {
        if (container.isDestroyed) continue
        walk(container, (node) => {
          if (!isText(node)) watchInserts(node)
          changed = visit(node) || changed
        })
      }
    } catch (error) {
      console.error("[beautify-opencode] frame scan failed:", error)
    }
    if (changed) renderer.requestRender?.()
  }

  // Plugins that rebuild their content (Checklist-to-Goal every second) insert
  // the new nodes AFTER the frame pass of the frame that paints them, so for
  // one frame the stock layout showed: the card grew a row and everything
  // below jumped. Every node in the sidebar now reports inserts; a microtask
  // rescans once the plugin finished building (same task), before the next
  // frame is laid out.
  const watchedInserts = new Set()
  let rescanQueued = false

  let rescanning = false
  function rescanNow() {
    if (rescanning) return // our own patches may insert nothing, but stay re-entrancy safe
    rescanning = true
    try {
      scanContainers()
    } finally {
      rescanning = false
    }
  }

  function queueRescan() {
    if (rescanQueued) return
    rescanQueued = true
    queueMicrotask(() => {
      rescanQueued = false
      scanContainers()
    })
  }

  function watchInserts(node) {
    // Trust the node, not our bookkeeping: another instance may have wrapped
    // over ours since (hot reload race).
    if (rows.has(node) || (node.add?.__owner === token && node.insertBefore?.__owner === token && node.remove?.__owner === token)) return
    // remove too: a plugin that swaps content inserts the new subtree before
    // dropping the old one, and the state in between must not be the last
    // thing this frame is laid out from.
    for (const method of ["add", "insertBefore", "remove"]) {
      const current = node[method]
      if (typeof current !== "function" || current.__owner === token) continue
      const base = current.__beautify ? current.__original : current
      const wrapped = function (...args) {
        const result = base.apply(this, args)
        // Synchronously: the host's render loop is promise-driven, so even a
        // microtask can land after the layout of the frame that paints this
        // node. Plugins attach a finished subtree, so it is complete here.
        if (live()) rescanNow()
        return result
      }
      wrapped.__beautify = true
      wrapped.__owner = token
      wrapped.__original = base
      node[method] = wrapped
    }
    watchedInserts.add(node)
  }

  function restore() {
    for (const node of [...cards.keys()]) {
      if (node.isDestroyed) continue
      unstyleCard(node)
      delete node.__beautify
    }
    for (const node of spacers) {
      if (node.isDestroyed) continue
      node.visible = true
      if (node.__beautify) delete node.__beautify.spacer
    }
    for (const [node, gap] of containerGaps) {
      if (node.isDestroyed || !gap) continue
      try {
        node.gap = gap
        node.rowGap = gap
        delete node.__beautify
      } catch {}
    }
    containerGaps.clear()
    cardIndex.clear()
    for (const [node, margins] of wrappers) {
      if (node.isDestroyed) continue
      for (const [key, value] of Object.entries(margins)) node[key] = value
      delete node.__beautify
    }
    wrappers.clear()
    for (const node of boxSegments) if (!node.isDestroyed && node.renderAfter === drawBoxSegment) node.renderAfter = undefined
    for (const [node, orig] of textOriginals) {
      if (node.isDestroyed || node.renderSelf?.__owner !== token) continue // only undo our own wrap
      if (orig.own) node.renderSelf = orig.fn
      else delete node.renderSelf
      try {
        node.refreshHooks?.()
      } catch {}
    }
    for (const [cell, rec] of logoCells) {
      if (cell.isDestroyed || !rec.applied) continue
      try {
        cell.fg = rec.fg
        cell.bg = rec.bg
        delete cell.__beautify
      } catch {}
    }
    logoCells.clear()
    for (const row of [...rows.keys(), ...watchedInserts]) {
      if (row.add?.__owner === token) delete row.add
      if (row.insertBefore?.__owner === token) delete row.insertBefore
      if (row.remove?.__owner === token) delete row.remove
    }
    watchedInserts.clear()
    rows.clear()
    cards.clear()
    headers.clear()
    boxSegments.clear()
    textBars.clear()
    textOriginals.clear()
    containers.clear()
    spacers.clear()
    renderer?.requestRender?.()
  }

  // Debug: a compact JSON picture of the live tree, to design new rules from
  // the real thing instead of guessing.
  function dumpTree() {
    const visit = (node, depth = 0) => {
      if (!node || depth > 60) return null
      const out = {
        t: node.constructor?.name,
        id: node.id,
        x: node.screenX,
        y: node.screenY,
        w: node.width,
        h: node.height,
      }
      if ("border" in node && get(node, "border")) out.border = get(node, "border")
      if ("borderStyle" in node && out.border) out.borderStyle = get(node, "borderStyle")
      if ("backgroundColor" in node) out.bg = hexOf(get(node, "backgroundColor")) ?? undefined
      if (get(node, "visible") === false) out.hidden = true
      if (node.__beautify) {
        out.b = Object.keys(node.__beautify)
        const c = node.__beautify.original
        if (c) out.bcard = { border: c.border, style: c.borderStyle, section: c.section, pl: c.paddingLeft }
      }
      if (sections.has(node)) out.section = true
      if (cards.has(node)) out.card = true
      if (isText(node)) {
        out.text = node.plainText.slice(0, 80)
        out.fg = hexOf(get(node, "fg")) ?? undefined
        out.tbg = hexOf(get(node, "bg")) ?? undefined
      }
      if (node._mouseListeners && Object.keys(node._mouseListeners).length) out.mouse = Object.keys(node._mouseListeners)
      const kids = children(node).map((k) => visit(k, depth + 1)).filter(Boolean)
      if (kids.length) out.kids = kids
      return out
    }
    return visit(renderer?.root)
  }

  // Debug: the resolved theme with colours as hex, to learn its real shape.
  function dumpTheme() {
    const seen = new Set()
    const visit = (v, depth = 0) => {
      if (v == null || depth > 8) return v
      if (typeof v.toInts === "function") return hexOf(v) ?? "transparent"
      if (typeof v !== "object") return typeof v === "function" ? "[fn]" : v
      if (seen.has(v)) return "[cycle]"
      seen.add(v)
      const out = Array.isArray(v) ? [] : {}
      for (const key of Object.keys(v)) out[key] = visit(v[key], depth + 1)
      return out
    }
    return { resolvedLogoStops: logoStops(), theme: visit(typeof theme === "function" ? theme() : theme) }
  }

  // Mark this instance's hooks so a hot-reloaded successor can recognise and
  // replace them instead of treating them as someone else's.
  drawCardTitle.__beautify = forwardTitleClick.__beautify = drawBoxSegment.__beautify = onFrame.__beautify = true

  return {
    scan,
    dumpTree,
    dumpTheme,
    debugLog,
    start() {
      globalThis[ACTIVE] = token
      scan()
      hookFrames()
      try {
        renderer.addPostProcessFn?.(paintBars)
      } catch {}
      timer = setInterval(scan, opts.scanMs) // backstop for idle screens
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
      unhookFrames()
      try {
        renderer.removePostProcessFn?.(paintBars)
      } catch {}
      // A superseded instance leaves the screen to its successor; only the
      // instance still in charge undoes the skin.
      if (globalThis[ACTIVE] === token) {
        restore()
        delete globalThis[ACTIVE]
      }
      stopped = true
    },
  }
}
