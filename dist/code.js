"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __defProps = Object.defineProperties;
  var __getOwnPropDescs = Object.getOwnPropertyDescriptors;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __spreadProps = (a, b) => __defProps(a, __getOwnPropDescs(b));

  // src/shared/color.ts
  var clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
  var to8 = (x) => Math.round(clamp01(x) * 255);
  var hex2 = (n) => n.toString(16).padStart(2, "0").toUpperCase();
  function rgbaKey(c, a = 1) {
    return "#" + hex2(to8(c.r)) + hex2(to8(c.g)) + hex2(to8(c.b)) + hex2(to8(a));
  }
  function solidPaintKey(p) {
    var _a, _b;
    return rgbaKey((_a = p.color) != null ? _a : { r: 0, g: 0, b: 0 }, (_b = p.opacity) != null ? _b : 1);
  }
  function variableColorKey(v) {
    var _a;
    return rgbaKey(v, (_a = v.a) != null ? _a : 1);
  }
  function isBound(p) {
    return !!(p.boundVariables && p.boundVariables.color);
  }
  function paintSignature(p, resolvedKey) {
    var _a;
    if (p.type !== "SOLID") return `${p.type}:unsupported`;
    const vis = p.visible === false ? "hidden" : "shown";
    return `SOLID:${resolvedKey != null ? resolvedKey : solidPaintKey(p)}:${(_a = p.blendMode) != null ? _a : "NORMAL"}:${vis}`;
  }
  function stackSignature(paints, resolvedKeys) {
    return paints.map((p, i) => paintSignature(p, resolvedKeys == null ? void 0 : resolvedKeys[i])).join("|");
  }

  // src/shared/recheck.ts
  function recheckPaint(paint, expectedKey) {
    if (!paint) return "Paint no longer exists";
    if (paint.type !== "SOLID") return "Paint is no longer a solid color";
    if (paint.visible === false) return "Paint is now hidden";
    if (isBound(paint)) return "Paint is already bound to a variable";
    if (solidPaintKey(paint) !== expectedKey) return "Color changed since scan";
    return null;
  }
  function recheckStack(paints, expectedSig) {
    if (!paints || paints.length === 0) return "Paints no longer exist";
    if (paints.some(isBound)) return "A paint is now bound to a variable";
    if (stackSignature(paints) !== expectedSig) return "Paint stack changed since scan";
    return null;
  }
  function verifyBoundPaint(paint, variableId, expectedKey) {
    var _a, _b;
    if (!paint || paint.type !== "SOLID") return "Paint missing after write";
    if (((_b = (_a = paint.boundVariables) == null ? void 0 : _a.color) == null ? void 0 : _b.id) !== variableId) return "Figma did not keep the variable binding";
    if (solidPaintKey(paint) !== expectedKey) return `Appearance changed (${solidPaintKey(paint)} \u2260 ${expectedKey})`;
    return null;
  }
  function untouchedPaintsEqual(before, after, changed) {
    if (before.length !== after.length) return false;
    for (let i = 0; i < before.length; i++) {
      if (changed.has(i)) continue;
      if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) return false;
    }
    return true;
  }

  // src/shared/match.ts
  function scopeAllows(scopes, property, fillTarget) {
    if (scopes.includes("ALL_SCOPES")) return true;
    if (property === "stroke") return scopes.includes("STROKE_COLOR");
    if (scopes.includes("ALL_FILLS")) return true;
    if (property === "text" || fillTarget === "text") return scopes.includes("TEXT_FILL");
    return scopes.includes(fillTarget === "frame" ? "FRAME_FILL" : "SHAPE_FILL");
  }
  function fillTargetForType(type) {
    if (type === "TEXT") return "text";
    if (["FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION"].includes(type)) return "frame";
    return "shape";
  }
  function statusFor(candidates) {
    if (candidates.length === 0) return "unmatched";
    return candidates.length === 1 ? "ready" : "choose";
  }
  var byName = (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  function groupOccurrences(occurrences, candidatesFor, modeLabelFor, isStack) {
    const map = /* @__PURE__ */ new Map();
    for (const o of occurrences) {
      const cands = candidatesFor(o).slice().sort(byName);
      const key = `${o.property}\u241F${o.colorKey}\u241F${cands.map((c) => c.id).join(",")}`;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          group: {
            id: "",
            property: o.property,
            colorKey: o.colorKey,
            isStack,
            candidates: cands,
            status: statusFor(cands),
            modeLabels: [],
            layerCount: 0,
            occurrenceCount: 0,
            sampleNames: []
          },
          occ: [],
          layers: /* @__PURE__ */ new Set(),
          modes: /* @__PURE__ */ new Set()
        };
        map.set(key, entry);
      }
      entry.occ.push(o);
      if (!entry.layers.has(o.nodeId)) {
        entry.layers.add(o.nodeId);
        if (entry.group.sampleNames.length < 5) entry.group.sampleNames.push(o.nodeName);
      }
      const mode = modeLabelFor(o.contextKey);
      if (mode) entry.modes.add(mode);
    }
    const order = { fill: 0, text: 1, stroke: 2 };
    const entries = [...map.values()].sort(
      (a, b) => b.layers.size - a.layers.size || order[a.group.property] - order[b.group.property] || a.group.colorKey.localeCompare(b.group.colorKey)
    );
    const groups = [];
    const members = /* @__PURE__ */ new Map();
    entries.forEach((e, i) => {
      e.group.id = `g${i}`;
      e.group.layerCount = e.layers.size;
      e.group.occurrenceCount = e.occ.length;
      e.group.modeLabels = [...e.modes].sort();
      groups.push(e.group);
      members.set(e.group.id, e.occ);
    });
    return { groups, members };
  }
  function contextKeyOf(modes) {
    return Object.keys(modes).sort().map((k) => `${k}=${modes[k]}`).join(";");
  }
  function indexByKey(items) {
    const m = /* @__PURE__ */ new Map();
    for (const { key, item } of items) {
      const list = m.get(key);
      if (list) list.push(item);
      else m.set(key, [item]);
    }
    return m;
  }

  // src/plugin/matcher.ts
  function resolveVariableKey(v, node) {
    try {
      const { value, resolvedType } = v.resolveForConsumer(node);
      if (resolvedType !== "COLOR" || typeof value !== "object" || value === null || !("r" in value)) return null;
      return variableColorKey(value);
    } catch (e) {
      return null;
    }
  }
  async function styleSignatureFor(style, node) {
    const parts = [];
    for (const p of style.paints) {
      if (p.type !== "SOLID") return null;
      const bound = p.boundVariables && p.boundVariables.color;
      let key;
      if (bound) {
        const v = await figma.variables.getVariableByIdAsync(bound.id);
        const k = v && resolveVariableKey(v, node);
        if (!k) return null;
        key = k;
      }
      parts.push(paintSignature(p, key));
    }
    return parts.join("|");
  }
  function modeLabeler(source) {
    if (!source.modeCollections.length) return () => void 0;
    const cache = /* @__PURE__ */ new Map();
    return (ctx) => {
      if (cache.has(ctx)) return cache.get(ctx);
      const explicit = {};
      for (const part of ctx ? ctx.split(";") : []) {
        const i = part.indexOf("=");
        explicit[part.slice(0, i)] = part.slice(i + 1);
      }
      const labels = source.modeCollections.map((col) => {
        var _a;
        const modeId = (_a = explicit[col.id]) != null ? _a : col.defaultModeId;
        const m = col.modes.find((x) => x.modeId === modeId);
        return m ? m.name : "?";
      });
      const label = labels.join(" / ");
      cache.set(ctx, label);
      return label;
    };
  }
  async function matchScan(scan, source, options, progress) {
    var _a, _b, _c, _d;
    const candidatesByOcc = /* @__PURE__ */ new Map();
    const cand = (id) => source.candidates.get(id);
    if (source.kind === "local-styles") {
      const indexes = /* @__PURE__ */ new Map();
      for (const [ctx, rep] of scan.contextReps) {
        const entries = [];
        for (const s of source.styles) {
          const sig = await styleSignatureFor(s, rep);
          if (sig) entries.push({ key: sig, item: s });
        }
        indexes.set(ctx, indexByKey(entries));
      }
      let i = 0;
      for (const o of scan.occurrences) {
        const styles = (_b = (_a = indexes.get(o.contextKey)) == null ? void 0 : _a.get(o.colorKey)) != null ? _b : [];
        const verified = [];
        const node = scan.nodes.get(o.nodeId);
        for (const s of styles) {
          if (node === scan.contextReps.get(o.contextKey) || await styleSignatureFor(s, node) === o.colorKey) verified.push(cand(s.id));
        }
        candidatesByOcc.set(o, verified);
        if (++i % 500 === 0) {
          progress(i, scan.occurrences.length);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    } else {
      const indexes = /* @__PURE__ */ new Map();
      for (const [ctx, rep] of scan.contextReps) {
        const entries = [];
        for (const v of source.variables) {
          const key = resolveVariableKey(v, rep);
          if (key) entries.push({ key, item: v });
        }
        indexes.set(ctx, indexByKey(entries));
      }
      let i = 0;
      for (const o of scan.occurrences) {
        const node = scan.nodes.get(o.nodeId);
        const isRep = node === scan.contextReps.get(o.contextKey);
        const vars = (_d = (_c = indexes.get(o.contextKey)) == null ? void 0 : _c.get(o.colorKey)) != null ? _d : [];
        const verified = [];
        for (const v of vars) {
          if (options.respectScopes && !scopeAllows(v.scopes, o.property, o.fillTarget)) continue;
          if (!isRep && resolveVariableKey(v, node) !== o.colorKey) continue;
          verified.push(cand(v.id));
        }
        candidatesByOcc.set(o, verified);
        if (++i % 500 === 0) {
          progress(i, scan.occurrences.length);
          await new Promise((r) => setTimeout(r, 0));
        }
      }
    }
    return groupOccurrences(scan.occurrences, (o) => {
      var _a2;
      return (_a2 = candidatesByOcc.get(o)) != null ? _a2 : [];
    }, modeLabeler(source), source.kind === "local-styles");
  }

  // src/plugin/apply.ts
  var clone = (x) => JSON.parse(JSON.stringify(x));
  async function loadAllFonts(node) {
    const fonts = node.getRangeAllFontNames(0, node.characters.length);
    await Promise.all(fonts.map((f) => figma.loadFontAsync(f)));
  }
  function readPaints(node, occ) {
    if (occ.property === "stroke") {
      return { paints: node.strokes.slice(), styleId: "strokeStyleId" in node ? node.strokeStyleId : "" };
    }
    if (node.type === "TEXT" && occ.range) {
      const [s, e] = occ.range;
      if (e > node.characters.length) return { paints: null, styleId: "", reason: "Text changed since scan" };
      const fills = node.getRangeFills(s, e);
      const sid2 = node.getRangeFillStyleId(s, e);
      if (fills === figma.mixed || sid2 === figma.mixed) return { paints: null, styleId: "", reason: "Text colors changed since scan" };
      return { paints: fills.slice(), styleId: sid2 };
    }
    if (node.fills === figma.mixed) return { paints: null, styleId: "", reason: "Text colors changed since scan" };
    const sid = "fillStyleId" in node ? node.fillStyleId : "";
    if (sid === figma.mixed) return { paints: null, styleId: "", reason: "Text colors changed since scan" };
    return { paints: node.fills.slice(), styleId: sid };
  }
  async function writePaints(node, occ, paints) {
    if (occ.property === "stroke") node.strokes = paints;
    else if (node.type === "TEXT" && occ.range) node.setRangeFills(occ.range[0], occ.range[1], paints);
    else node.fills = paints;
  }
  async function writeStyle(node, occ, styleId) {
    if (occ.property === "stroke") await node.setStrokeStyleIdAsync(styleId);
    else if (node.type === "TEXT" && occ.range) await node.setRangeFillStyleIdAsync(occ.range[0], occ.range[1], styleId);
    else await node.setFillStyleIdAsync(styleId);
  }
  async function applyApprovals(approvals, members, candidates, progress) {
    var _a;
    const lines = [];
    const items = [];
    for (const a of approvals) {
      const cand = candidates.get(a.candidateId);
      const occs = members.get(a.groupId);
      if (!cand || !occs) continue;
      for (const occ of occs) items.push({ occ, groupId: a.groupId, candidate: cand });
    }
    const targets = /* @__PURE__ */ new Map();
    for (const it of items) {
      const k = `${it.occ.nodeId}|${it.occ.property}|${it.occ.range ? it.occ.range.join("-") : "*"}`;
      const list = targets.get(k);
      if (list) list.push(it);
      else targets.set(k, [it]);
    }
    const line = (it, outcome, reason) => lines.push({ groupId: it.groupId, nodeName: it.occ.nodeName, candidateName: it.candidate.name, outcome, reason });
    figma.commitUndo();
    let done = 0;
    for (const group of targets.values()) {
      done++;
      if (done % 50 === 0) {
        progress(done, targets.size);
        await new Promise((r) => setTimeout(r, 0));
      }
      const occ0 = group[0].occ;
      const node = await figma.getNodeByIdAsync(occ0.nodeId);
      if (!node || node.removed) {
        group.forEach((it) => line(it, "skipped", "Layer was deleted"));
        continue;
      }
      if (node.type === "TEXT" && occ0.textLength !== void 0 && node.characters.length !== occ0.textLength) {
        group.forEach((it) => line(it, "skipped", "Text changed since scan"));
        continue;
      }
      const { paints, styleId, reason } = readPaints(node, occ0);
      if (!paints) {
        group.forEach((it) => line(it, "skipped", reason));
        continue;
      }
      if (styleId) {
        group.forEach((it) => line(it, "skipped", "Layer now uses a style"));
        continue;
      }
      try {
        if (node.type === "TEXT") {
          if (node.hasMissingFont) {
            group.forEach((it) => line(it, "failed", "Missing font \u2014 cannot edit this text"));
            continue;
          }
          await loadAllFonts(node);
        }
        if (occ0.paintIndex === -1) {
          const it = group[0];
          const why = recheckStack(paints, occ0.colorKey);
          if (why) {
            line(it, "skipped", why);
            continue;
          }
          const style = await figma.getStyleByIdAsync(it.candidate.id);
          if (!style || style.type !== "PAINT") {
            line(it, "failed", "Style no longer exists");
            continue;
          }
          if (await styleSignatureFor(style, node) !== occ0.colorKey) {
            line(it, "skipped", "Style no longer matches this layer");
            continue;
          }
          const original2 = clone(paints);
          await writeStyle(node, occ0, style.id);
          const after2 = readPaints(node, occ0);
          const afterSig = after2.paints && await styleSignatureFor({ paints: after2.paints }, node);
          if (after2.styleId !== style.id || afterSig !== occ0.colorKey) {
            await writeStyle(node, occ0, "");
            await writePaints(node, occ0, original2);
            line(it, "failed", after2.styleId !== style.id ? "Figma did not keep the style link" : "Appearance changed \u2014 reverted");
          } else line(it, "applied");
          continue;
        }
        const ready = [];
        for (const it of group) {
          const why = recheckPaint(paints[it.occ.paintIndex], it.occ.colorKey);
          if (why) {
            line(it, "skipped", why);
            continue;
          }
          const v = await figma.variables.getVariableByIdAsync(it.candidate.id);
          if (!v) {
            line(it, "failed", "Variable no longer exists");
            continue;
          }
          if (resolveVariableKey(v, node) !== it.occ.colorKey) {
            line(it, "skipped", "Token value no longer matches in this layer\u2019s mode");
            continue;
          }
          ready.push({ it, v });
        }
        if (!ready.length) continue;
        const original = clone(paints);
        const next = clone(paints);
        for (const { it, v } of ready) {
          next[it.occ.paintIndex] = figma.variables.setBoundVariableForPaint(next[it.occ.paintIndex], "color", v);
        }
        await writePaints(node, occ0, next);
        const after = (_a = readPaints(node, occ0).paints) != null ? _a : [];
        const changed = new Set(ready.map((r) => r.it.occ.paintIndex));
        const problems = ready.map(({ it, v }) => ({ it, why: verifyBoundPaint(after[it.occ.paintIndex], v.id, it.occ.colorKey) })).filter((p) => p.why);
        const othersOk = untouchedPaintsEqual(original, after, changed);
        if (problems.length || !othersOk) {
          await writePaints(node, occ0, original);
          for (const { it } of ready) {
            const own = problems.find((p) => p.it === it);
            line(it, "failed", own ? `${own.why} \u2014 reverted` : othersOk ? "Reverted with another paint on this layer" : "Other paints changed \u2014 reverted");
          }
        } else {
          ready.forEach(({ it }) => line(it, "applied"));
        }
      } catch (e) {
        group.forEach((it) => line(it, "failed", e instanceof Error ? e.message : String(e)));
      }
    }
    figma.commitUndo();
    return {
      applied: lines.filter((l) => l.outcome === "applied").length,
      skipped: lines.filter((l) => l.outcome === "skipped").length,
      failed: lines.filter((l) => l.outcome === "failed").length,
      lines
    };
  }

  // src/plugin/scan.ts
  var yieldToUi = () => new Promise((r) => setTimeout(r, 0));
  function inheritedModes(node) {
    const chain = [];
    let p = node.parent;
    while (p && p.type !== "DOCUMENT") {
      if ("explicitVariableModes" in p) chain.push(p.explicitVariableModes);
      p = p.parent;
    }
    const merged = {};
    for (let i = chain.length - 1; i >= 0; i--) Object.assign(merged, chain[i]);
    return merged;
  }
  async function scanRoots(roots, mode, options, progress) {
    const t0 = Date.now();
    const occurrences = [];
    const nodes = /* @__PURE__ */ new Map();
    const contextReps = /* @__PURE__ */ new Map();
    const stats = { layersScanned: 0, hardcoded: 0, alreadyLinked: 0, skippedUnsupported: 0, ms: 0 };
    const visited = /* @__PURE__ */ new Set();
    figma.skipInvisibleInstanceChildren = !options.includeHidden;
    const stack = [];
    for (let i = roots.length - 1; i >= 0; i--) {
      const modes = inheritedModes(roots[i]);
      stack.push({ node: roots[i], modes, ctx: contextKeyOf(modes) });
    }
    function emit(node, ctx, property, paints, range) {
      if (!paints.length) return;
      const base = {
        nodeId: node.id,
        nodeName: node.name,
        property,
        fillTarget: fillTargetForType(node.type),
        contextKey: ctx,
        range,
        textLength: node.type === "TEXT" ? node.characters.length : void 0
      };
      const before = occurrences.length;
      if (mode === "variable") {
        paints.forEach((p, i) => {
          if (p.visible === false) return;
          if (p.type !== "SOLID") {
            stats.skippedUnsupported++;
            return;
          }
          if (isBound(p)) {
            stats.alreadyLinked++;
            return;
          }
          occurrences.push(__spreadProps(__spreadValues({}, base), { paintIndex: i, colorKey: solidPaintKey(p) }));
        });
      } else {
        if (!paints.some((p) => p.visible !== false)) return;
        if (paints.some((p) => p.type !== "SOLID")) {
          stats.skippedUnsupported++;
          return;
        }
        if (paints.some(isBound)) {
          stats.alreadyLinked++;
          return;
        }
        occurrences.push(__spreadProps(__spreadValues({}, base), { paintIndex: -1, colorKey: stackSignature(paints) }));
      }
      if (occurrences.length > before) {
        nodes.set(node.id, node);
        if (!contextReps.has(ctx)) contextReps.set(ctx, node);
      }
    }
    function collect(node, ctx) {
      if (node.type === "TEXT") {
        if (node.characters.length > 0) {
          if (node.fills !== figma.mixed && node.fillStyleId !== figma.mixed) {
            if (node.fillStyleId) stats.alreadyLinked++;
            else emit(node, ctx, "text", node.fills);
          } else {
            for (const seg of node.getStyledTextSegments(["fills", "fillStyleId"])) {
              if (seg.fillStyleId) stats.alreadyLinked++;
              else emit(node, ctx, "text", seg.fills, [seg.start, seg.end]);
            }
          }
        }
      } else if ("fills" in node && node.fills !== figma.mixed) {
        const styleId = "fillStyleId" in node ? node.fillStyleId : "";
        if (styleId) stats.alreadyLinked++;
        else emit(node, ctx, "fill", node.fills);
      }
      if ("strokes" in node && node.strokes.length) {
        const styleId = "strokeStyleId" in node ? node.strokeStyleId : "";
        if (styleId) stats.alreadyLinked++;
        else emit(node, ctx, "stroke", node.strokes);
      }
    }
    while (stack.length) {
      const { node, modes, ctx } = stack.pop();
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      if (!options.includeHidden && !node.visible) continue;
      stats.layersScanned++;
      let nextModes = modes;
      let nextCtx = ctx;
      const explicit = node.explicitVariableModes;
      if (explicit && Object.keys(explicit).length) {
        nextModes = __spreadValues(__spreadValues({}, modes), explicit);
        nextCtx = contextKeyOf(nextModes);
      }
      collect(node, nextCtx);
      if ("children" in node) {
        const kids = node.children;
        for (let i = kids.length - 1; i >= 0; i--) stack.push({ node: kids[i], modes: nextModes, ctx: nextCtx });
      }
      if (stats.layersScanned % 250 === 0) {
        progress(stats.layersScanned);
        await yieldToUi();
      }
    }
    stats.hardcoded = occurrences.length;
    stats.ms = Date.now() - t0;
    return { occurrences, stats, nodes, contextReps };
  }

  // src/plugin/sources.ts
  var STYLES_SOURCE_ID = "local-styles";
  var libraryCache = /* @__PURE__ */ new Map();
  async function listSources() {
    const out = [];
    const [collections, colorVars] = await Promise.all([
      figma.variables.getLocalVariableCollectionsAsync(),
      figma.variables.getLocalVariablesAsync("COLOR")
    ]);
    for (const col of collections) {
      const n = colorVars.filter((v) => v.variableCollectionId === col.id).length;
      if (n === 0) continue;
      out.push({
        id: col.id,
        kind: "local-collection",
        label: col.name,
        detail: `${n} color${n === 1 ? "" : "s"} \xB7 ${col.modes.length} mode${col.modes.length === 1 ? "" : "s"}`
      });
    }
    try {
      const libs = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
      for (const lib of libs) {
        const cached = libraryCache.get(lib.key);
        out.push({
          id: lib.key,
          kind: "library-collection",
          label: lib.name,
          detail: lib.libraryName,
          loaded: !!cached
        });
      }
    } catch (e) {
    }
    const styles = await figma.getLocalPaintStylesAsync();
    if (styles.length) {
      out.push({ id: STYLES_SOURCE_ID, kind: "local-styles", label: "Local color styles", detail: `${styles.length} style${styles.length === 1 ? "" : "s"}` });
    }
    return out;
  }
  async function loadLibrary(key, progress) {
    const libs = await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    const lib = libs.find((l) => l.key === key);
    if (!lib) throw new Error("That library collection is no longer enabled in this file.");
    const descriptors = (await figma.teamLibrary.getVariablesInLibraryCollectionAsync(key)).filter(
      (d) => d.resolvedType === "COLOR"
    );
    figma.commitUndo();
    const variables = [];
    const CHUNK = 20;
    for (let i = 0; i < descriptors.length; i += CHUNK) {
      const chunk = descriptors.slice(i, i + CHUNK);
      const res = await Promise.allSettled(chunk.map((d) => figma.variables.importVariableByKeyAsync(d.key)));
      for (const r of res) if (r.status === "fulfilled") variables.push(r.value);
      progress(Math.min(i + CHUNK, descriptors.length), descriptors.length);
    }
    figma.commitUndo();
    libraryCache.set(key, { name: lib.name, libraryName: lib.libraryName, variables });
    return variables.length;
  }
  async function resolveSource(id) {
    const candidates = /* @__PURE__ */ new Map();
    if (id === STYLES_SOURCE_ID) {
      const styles = (await figma.getLocalPaintStylesAsync()).filter((s) => s.paints.length > 0);
      for (const s of styles) candidates.set(s.id, { id: s.id, name: s.name, group: "Local styles", kind: "style" });
      return { id, kind: "local-styles", label: "Local color styles", variables: [], styles, candidates, modeCollections: [] };
    }
    const cached = libraryCache.get(id);
    if (cached) {
      for (const v of cached.variables) candidates.set(v.id, { id: v.id, name: v.name, group: cached.libraryName, kind: "variable" });
      const modeCollections = [];
      const colIds = [...new Set(cached.variables.map((v) => v.variableCollectionId))];
      for (const cid of colIds) {
        try {
          const col2 = await figma.variables.getVariableCollectionByIdAsync(cid);
          if (col2 && col2.modes.length > 1) modeCollections.push(col2);
        } catch (e) {
        }
      }
      return {
        id,
        kind: "library-collection",
        label: `${cached.name} \u2014 ${cached.libraryName}`,
        variables: cached.variables,
        styles: [],
        candidates,
        modeCollections
      };
    }
    const col = await figma.variables.getVariableCollectionByIdAsync(id);
    if (!col) {
      throw new Error("Library colors are not loaded yet. Click \u201CLoad library colors\u201D first.");
    }
    const variables = (await figma.variables.getLocalVariablesAsync("COLOR")).filter((v) => v.variableCollectionId === col.id);
    for (const v of variables) candidates.set(v.id, { id: v.id, name: v.name, group: col.name, kind: "variable" });
    return {
      id,
      kind: "local-collection",
      label: col.name,
      variables,
      styles: [],
      candidates,
      modeCollections: col.modes.length > 1 ? [col] : []
    };
  }

  // src/plugin/main.ts
  figma.showUI(__html__, { width: 440, height: 680, themeColors: true, title: "MatchMaker" });
  var post = (msg) => figma.ui.postMessage(msg);
  var last = null;
  function selectionRoots() {
    return figma.currentPage.selection.slice();
  }
  async function runScan(sourceId, options, rootIds, isRescan) {
    const source = await resolveSource(sourceId);
    let roots;
    if (rootIds) {
      roots = [];
      for (const id of rootIds) {
        const n = await figma.getNodeByIdAsync(id);
        if (n && !n.removed && n.type !== "PAGE" && n.type !== "DOCUMENT") roots.push(n);
      }
    } else roots = selectionRoots();
    if (!roots.length) throw new Error("Select one or more frames to scan.");
    const scan = await scanRoots(
      roots,
      source.kind === "local-styles" ? "style" : "variable",
      options,
      (done) => post({ type: "progress", label: "Scanning layers", done, total: 0 })
    );
    const { groups, members } = await matchScan(
      scan,
      source,
      options,
      (done, total) => post({ type: "progress", label: "Matching tokens", done, total })
    );
    last = { sourceId, options, rootIds: roots.map((r) => r.id), groups, members, candidates: source.candidates };
    post({ type: "scan-result", groups, stats: scan.stats, sourceLabel: source.label, isRescan });
  }
  async function locate(groupId, index) {
    const occs = last == null ? void 0 : last.members.get(groupId);
    if (!occs || !occs.length) return;
    const ids = [...new Set(occs.map((o) => o.nodeId))];
    const i = (index % ids.length + ids.length) % ids.length;
    const node = await figma.getNodeByIdAsync(ids[i]);
    if (!node || node.removed) throw new Error("That layer no longer exists. Rescan to refresh.");
    let page = node;
    while (page && page.type !== "PAGE") page = page.parent;
    if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
    post({ type: "located", groupId, index: i, total: ids.length, name: node.name });
  }
  figma.on("selectionchange", () => post({ type: "selection", count: figma.currentPage.selection.length }));
  figma.ui.onmessage = async (msg) => {
    try {
      switch (msg.type) {
        case "init":
          post({ type: "sources", sources: await listSources(), selectionCount: figma.currentPage.selection.length });
          break;
        case "load-library": {
          const count = await loadLibrary(
            msg.sourceId,
            (done, total) => post({ type: "progress", label: "Loading library colors", done, total })
          );
          post({ type: "library-loaded", sourceId: msg.sourceId, count });
          post({ type: "sources", sources: await listSources(), selectionCount: figma.currentPage.selection.length });
          break;
        }
        case "scan":
          await runScan(msg.sourceId, msg.options, null, false);
          break;
        case "locate":
          await locate(msg.groupId, msg.index);
          break;
        case "apply": {
          if (!last) throw new Error("Scan first.");
          const report = await applyApprovals(
            msg.approvals,
            last.members,
            last.candidates,
            (done, total) => post({ type: "progress", label: "Applying", done, total })
          );
          post({ type: "apply-result", report });
          await runScan(last.sourceId, last.options, last.rootIds, true);
          break;
        }
        case "resize":
          figma.ui.resize(440, Math.max(420, Math.min(1e3, Math.round(msg.height))));
          break;
      }
    } catch (e) {
      post({ type: "error", message: e instanceof Error ? e.message : String(e) });
    }
  };
})();
