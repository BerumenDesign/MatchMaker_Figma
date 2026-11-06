# MatchMaker — bulk-match hardcoded colors to design tokens (Figma plugin)

A personal Figma **desktop development plugin**. Import a website screen, select it, and MatchMaker finds every hardcoded solid fill, stroke and text color (including each color range in mixed-color text). It matches those colors exactly against a local variable collection, an enabled library variable collection, or your local color styles. Then it binds the matches you approve in one undoable batch.

Workflow: **Scan → Review → Apply**. It needs no backend, no network access and no Community publication.

## Install (Figma desktop)

1. `git clone https://github.com/BerumenDesign/MatchMaker_Figma.git`. The built plugin is already in `dist/`, so you don't need to build it.
2. In Figma desktop, open any design file and go to **Plugins → Development → Import plugin from manifest…**
3. Pick `manifest.json` at the repo root.
4. Run it from **Plugins → Development → MatchMaker**.

To change the code:

```bash
npm install
```

```bash
npm run build
```

```bash
npm test
```

`npm run watch` rebuilds on save. After a rebuild, re-run the plugin in Figma; you don't need to re-import it.

## Using it

1. **Scan**: select one or more frames. Choose what to match against:
   - a local color variable collection
   - a library variable collection enabled in this file (click **Load library colors** first; see below)
   - **Local color styles**

   Click **Scan**.
2. **Review**: results are grouped by **color × property (Fill / Text / Stroke) × candidate set**. Because of this, `#FFFFFF` backgrounds and `#FFFFFF` text are reviewed separately. Layers in Light and Dark frames also split when the same hex resolves to different tokens.
   - **Ready**: exactly one exact match. These are preselected.
   - **Needs choice**: several tokens share the value. Nothing is preselected; pick one.
   - **Unmatched**: no token reproduces the color exactly. These are never changed.
   - Each group row shows a swatch, mode badge(s) and affected layer count. **Locate** selects and zooms to each affected layer in turn.
3. **Apply**: every approved property is rechecked right before it is written. Then it is bound to the real variable or style, read back and verified. A report lists applied, skipped (changed since scan) and failed items, and the same scope is rescanned automatically. **One ⌘Z / Ctrl+Z reverts the whole batch.**

### What counts as an exact match
- **Variables:** the token's value is resolved in **each layer's active mode**, including modes inherited from parent frames, and through aliases. It must equal the layer's color **and** transparency in 8-bit RGBA.
  - Figma replaces a paint's opacity with the variable's alpha when you bind it (verified, see below). A translucent color therefore only matches a token with the same alpha. An opaque token never matches a 50% paint.
- **Styles:** the style's **entire paint stack** must equal the layer's stack: every paint, its order, opacity, blend mode and visibility. Applying a style replaces the whole stack.
- **Scopes:** with *Respect variable scopes* on, text colors only match `TEXT_FILL` tokens, frame fills only match `FRAME_FILL` tokens, shape fills only match `SHAPE_FILL` tokens, and strokes only match `STROKE_COLOR` tokens. `ALL_FILLS` and `ALL_SCOPES` tokens match their usual targets.
- **Never touched:** paints already bound to a variable, layers or ranges already linked to a style, gradients, images, hidden paints, and hidden layers (unless *Include hidden layers* is on).

### Library collections — why loading is a separate step
The Plugin API only lists names, keys and types for library variables. It doesn't list values, modes or scopes. The only way to read their values is `importVariableByKeyAsync`, which **writes references to the library's variables into the document**.

**Load library colors** imports only that collection's COLOR variables. It is committed as its own Undo step, so undoing an Apply batch never unloads it. It changes no layers.

Tradeoff: loading also imports references to tokens you may never use, and it takes one request per variable.

## Limitations (Figma Plugin API)
- **Library color styles can't be listed** by plugins, only local color styles. Supporting them would need the REST API plus a token.
- Libraries must already be **enabled in the file's UI**. Plugins can't enable libraries.
- Variables imported from libraries may report their scopes as `ALL_SCOPES` (a known API bug). Scope filtering might therefore not narrow down library candidates.
- `resolvedVariableModes` came back empty in testing. MatchMaker instead builds mode context from ancestors' `explicitVariableModes`, and verifies every candidate per layer with `variable.resolveForConsumer(layer)`.
- Text with a missing font can't be edited. Those items are reported as failed.

## Verification record

### Checks Claude ran (2026-11-05)
- **Unit tests (`npm test`, 15 passing):** 8-bit keys and float noise, alpha rules, stack signatures, scope mapping, grouping by property/mode/candidate set, preselection rules, recheck and readback predicates.
- **API probes in a real Figma file (via the Figma MCP Plugin-API runtime):**
  - Binding an opaque variable to a 50% paint renders **opaque**. A 50%-alpha variable renders 50% whatever the paint opacity. Confirmed by decoding exported pixels.
  - `resolveForConsumer` resolves aliases and inherited Dark mode on unbound layers.
  - `setRangeFills` with a bound paint changes only its range.
  - `setFillStyleIdAsync` preserves a 2-paint stack.
- **End-to-end on the fixture file "MatchMaker – Test Fixture"** (Figma team *FoF Calgary*, page *Fixture*), running the plugin's bundled `scanRoots` / `matchScan` / `applyApprovals`:
  - The fixture contains:
    - duplicate hex matches (`#FFFFFF` text → *Text/Inverse* or *Text/OnBrand*; `#0F172A` → *Text/Primary* or *Text/Heading*; `#2563EB` → *Brand/Primary* or alias *Action/Primary*)
    - mixed-color text (3 ranges)
    - translucent paints (50% scrim, 12% borders, 50% text)
    - an already-bound layer, a style-linked layer and a gradient
    - a Light screen (default mode) and a Dark screen (explicit mode, inherited by nested layers)
    - a 2-paint stack and a wrong-order stack
  - **Variable mode:** 15 groups found.
    - Light `#FFFFFF` text needed a choice; Dark `#FFFFFF` text matched only *Text/OnBrand*.
    - Dark `#0F172A` fills matched only *Surface/Default* (the text-scoped token with the same value was filtered out).
    - `#000000 · 50%` matched *Overlay/Scrim*, not opaque *Utility/Black*.
    - **17 applied, 0 skipped, 0 failed.** Real variable bindings are present on every approved paint and range. The already-bound fill, the style-linked layer, the gradient and the unmatched colors were untouched.
    - **PNG exports of both screens are byte-identical before and after.** The rescan left only the 2 unmatched colors.
  - **Style mode:** *Stack/Tint*, *Legacy/Gray* and *Ink/Primary* were linked (3 applied). The wrong-order stack stayed unmatched. The PNG export is byte-identical.
  - The fixture was then reset to its original unbound state. Snapshot hashes match the pre-apply state.

### Checks you need to do in Figma desktop
The MCP runtime doesn't support `figma.commitUndo` and can't show plugin UI. These checks are therefore **not** verified yet:
- [ ] Import the manifest and run MatchMaker on the fixture file's *Fixture* page. Select *Screen – Light* and *Screen – Dark*, source **Semantic**.
- [ ] The review shows the groups described above. Locate cycles through layers.
- [ ] Apply, then confirm the right panel shows variable chips on fills, strokes and text ranges. In Style mode (select *Styles test*), confirm style links.
- [ ] Press **⌘Z once**. Every approved property returns to its original hardcoded value, and nothing else changes.
- [ ] Library source: in a file with an enabled published library, click **Load library colors** → Scan → Apply. Confirm the bindings show the library variables. Check whether loading changed anything visible in the file, such as the libraries panel or the version history.
