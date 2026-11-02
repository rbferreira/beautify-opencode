// beautify-opencode — OpenCode V2 TUI entry.
//
// No slots, no new content: the plugin only needs the live renderer, and
// restyles what the host and other plugins already draw (see skin.js).
//
// Debug: create an empty `.debug` file next to package.json and reopen the TUI;
// the live renderable tree is written to `.debug-out/tree.json` every 5 s.

import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { RGBA } from "@opentui/core"
import { createSkin } from "./skin.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))

export default {
  id: "beautify-opencode",
  setup(context) {
    const debug = existsSync(ROOT + ".debug")
    const skin = createSkin({
      renderer: context.renderer,
      RGBA,
      theme: () => context.theme,
      options: { ...(context.options ?? {}), debug },
    })
    skin.start()

    let debugTimer = null
    if (debug) {
      const dump = () => {
        try {
          mkdirSync(ROOT + ".debug-out", { recursive: true })
          writeFileSync(ROOT + ".debug-out/tree.json", JSON.stringify(skin.dumpTree(), null, 1))
          writeFileSync(ROOT + ".debug-out/theme.json", JSON.stringify(skin.dumpTheme(), null, 1))
          writeFileSync(ROOT + ".debug-out/bar.log", skin.debugLog())
        } catch (error) {
          console.error("[beautify-opencode] debug dump failed:", error)
        }
      }
      setTimeout(dump, 1500)
      debugTimer = setInterval(dump, 5000)
    }

    return () => {
      if (debugTimer) clearInterval(debugTimer)
      skin.stop()
    }
  },
}
