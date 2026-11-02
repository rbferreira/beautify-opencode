# beautify-opencode

A skin for the [OpenCode](https://opencode.ai) TUI that makes what is **already
on screen** look like [btop](https://github.com/aristocratos/btop): rounded
boxes with the title set into the top border, `■` meter bars, a gradient logo.

It **adds nothing**. No new panels, gauges or widgets. It only restyles what
OpenCode and your other plugins already draw, and every colour comes from your
active theme. Switch themes and the skin follows.

```
╭─┐Context┌──────────────────╮      ╭─┐ ▼ Magic Context ┌──┐v0.49┌─╮
│ 42.1K tokens · 21% used    │      │ ■■■■■■■■■■■■■■■■■■■■■■■■■■ │
│ $0.18 spent                │      │ System 12% · Tools 31% …    │
╰────────────────────────────╯      ╰─────────────────────────────╯
╭─┐Checklist┌────────────────╮
│ ■■■■■■■■■■■■■■■■ 60%       │
│ ✓ parse the config         │
╰────────────────────────────╯
```

## What it restyles

- **Cards.** Bordered boxes get rounded corners and a border tinted with
  their own title colour. The header row moves into the top border, btop
  style: `╭─┐ ▼ Title ┌────┐ v1.2 ┌─╮`. Clicks on the border row still reach
  the original header, so collapse toggles keep working.
- **Sidebar sections.** The host's *Context* and *MCP* sections, and plugin
  sections such as Checklist-to-Goal, get boxed the same way, even though they
  draw no border of their own.
- **Bars.** Magic-context's segmented token bar and any `██████░░░░` text
  bar (Checklist-to-Goal, recomp progress…) are repainted as `■` meter cells.
- **Logo.** The home logo gets a vertical gradient built from a theme colour
  ramp.

Everything is matched heuristically and defensively. A node that does not
match exactly is left alone, so if OpenCode or a plugin changes its layout,
the result is "looks stock", never a broken screen. Disabling the plugin
restores every node it touched.

## Installation

Requires OpenCode 2.x (the V2 TUI). Add it to the `plugins` array in
`~/.config/opencode/cli.json`:

```jsonc
{
  "plugins": [
    "beautify-opencode"
  ]
}
```

With options:

```jsonc
{
  "plugins": [
    { "package": "beautify-opencode", "options": { "logoHue": "blue" } }
  ]
}
```

To run it from a local checkout, put the directory path in `package`
(`"C:/path/to/beautify-opencode"`). The TUI hot-reloads the plugin when its
files change.

## Options

| Option          | Default      | What it does |
|-----------------|--------------|--------------|
| `palette`       | `"neon"`     | `"neon"`: btop look with theme colours (box frames cycle through the theme's hues, white titles). `"btop"`: btop's exact default colours. `"theme"`: softer, frames tinted by each card's title. |
| `cards`         | `true`       | Rounded, unified, compact card borders. |
| `cardTitles`    | `true`       | Move each card's header into its top border. |
| `boxBars`       | `true`       | Repaint magic-context's segmented token bar. |
| `textBars`      | `true`       | Repaint `█░` text bars as `■` meters. |
| `barStyle`      | `"btop"`     | `"btop"` (`■` cells) or `"glossy"` (a smooth pill). |
| `meterGradient` | `"progress"` | `"progress"` (green ramp) or `"usage"` (green → yellow → red). |
| `logo`          | `true`       | Gradient on the home logo. |
| `logoGradient`  | `"theme"`    | `"theme"`, a named gradient (`gelo`, `aurora`, `lavanda`, `brasa`, `btop`), or your own stops: `["#cfefff", "#5aa9ff"]`. |
| `logoHue`       | `"accent"`   | Theme ramp used by `logoGradient: "theme"`: `accent`, `interactive`, `blue`, `purple`, `cyan`, `green`… |
| `scanMs`        | `300`        | Backstop scan interval on idle screens. |

## How it works

OpenCode's TUI is an [OpenTUI](https://github.com/sst/opentui) renderable
tree. The plugin keeps no slots of its own. It walks `renderer.root` and
patches the nodes it recognises:

- Style changes (border, padding, margins) are applied in a lifecycle pass
  that runs before each frame's layout, so the stock look never shows for a
  frame.
- Titles and bars are painted in a post-process step after the frame is
  drawn. Sidebar sections keep their title row visible and get a box without
  a top edge; the post-process paints `╭─┐title┌──╮` over that row. Layout is
  never changed, so a section that rebuilds itself every second (as
  Checklist-to-Goal does) cannot make the screen jump.
- Original properties are stored on each node, and `stop()` puts them back.
  On hot reload the newest instance wins and older ones go inert.

## Development

There is no build step: `src/` is plain JavaScript. The tests render a
replica of the sidebar and logo with OpenTUI and write an HTML preview. They
need Bun; OpenCode's own binary can act as Bun:

```sh
BUN_BE_BUN=1 opencode test/preview.mjs preview.html
BUN_BE_BUN=1 opencode test/logo.mjs logo.html
```

Debug: create an empty `.debug` file next to `package.json`. The live tree
and bar diagnostics are then written to `.debug-out/` every 5 seconds.

## License

MIT
