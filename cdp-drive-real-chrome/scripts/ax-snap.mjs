// L0 无障碍树快照：把页面压成「[role] name = value」缩进文本，比 innerText / outerHTML 省 token，适合先摸清陌生页面结构
//
//   CDP_TARGET=<id> node ax-snap.mjs                          # 整页（紧凑：去掉 InlineTextBox / generic / 无名节点）
//   CDP_TARGET=<id> node ax-snap.mjs --root ".el-drawer"      # 只看某个 CSS 选择器命中的第一个元素的子树
//   CDP_TARGET=<id> node ax-snap.mjs --ids                    # 每行带 #backendNodeId，可接 DOM.getBoxModel 求坐标再真点击
//   CDP_TARGET=<id> node ax-snap.mjs --out snap.txt           # 落盘，只回行数摘要（大页面别倒进上下文）
//   CDP_TARGET=<id> node ax-snap.mjs --visible                # 🔴 只留真正可见的节点（推荐）：收起的日期面板 / 下拉
//                                                             #    常靠 opacity:0 藏着，AX 树照收（Ads 页一个日历就 100+ 行）
//   其它参数：--full 保留 InlineTextBox 与「和父节点同名的 StaticText」；--depth N 只打印到第 N 层（按显示层数算，根 = 0）
//
// 连接走 conn.mjs（hardCap：所有 CDP 调用 ≤ CDP_SEND_TIMEOUT，子 agent 可直接用）。
// 目标：--target / --port / --match / --index 实参 > CDP_TARGET / CDP_PORT / CDP_MATCH 环境变量。
//
// 移植自 pasky/chrome-cdp-skill 的 `snap`（MIT，2026-10-13）。差异：按 CDP_TARGET 锁标签，不走它的常驻进程；
// 新增 --root / --ids / --depth / --out / --visible，缩进按显示层数，紧凑模式去掉与父节点同名的 StaticText。
// 注意：AX 树反映的是「辅助技术看到的」——display:none、aria-hidden 的节点不出现；自绘组件（canvas、
// 只用 div 拼的下拉 / 虚拟表格）可能只剩 generic 被过滤掉。读表格数值仍用 vtable-read.js / vue-datalayer-read.js。
import { connect, cliTargetOpts } from "./conn.mjs";
import fs from "node:fs";

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const full = flag("--full"), showIds = flag("--ids"), onlyVisible = flag("--visible");
const rootSel = opt("--root"), out = opt("--out");
const maxDepth = opt("--depth") !== undefined ? Number(opt("--depth")) : Infinity;
let hidden = null; // --visible 时：backendNodeId → "gone"（不渲染 / visibility）| "transparent"（opacity=0）
const SKINNED = new Set(["radio", "checkbox", "switch"]);
const norm = (t) => t.replace(/\s+/g, " ").trim();

function shouldShow(node, parentName) {
  const role = node.role?.value || "";
  const name = node.name?.value ?? "";
  const value = node.value?.value;
  if (hidden && node.backendDOMNodeId) {
    const h = hidden.get(node.backendDOMNodeId);
    // Element Plus 的 radio / checkbox / switch 是 opacity:0 的原生 input 叠在样式层下 → 只透明不算隐藏
    if (h === "gone" || (h === "transparent" && !SKINNED.has(role))) return false;
  }
  if (!full && role === "InlineTextBox") return false;
  // 父节点 name 已包含的文字碎片（[button] Apply 下的 Apply、[cell] Ad Type 拆成的 Ad / 空白 / Type）
  if (!full && role === "StaticText" && parentName != null && (!name.trim() || norm(parentName).includes(norm(name)))) return false;
  return role !== "none" && role !== "generic" && !(name === "" && (value === "" || value == null));
}

// 一次 DOMSnapshot 拿全部布局节点的计算样式（不改页面 DOM）。判不可见：
//   不在布局树（display:none 及其后代）/ 自身 visibility≠visible（可继承，取自身即可；文本节点取父元素）/ 自身或祖先 opacity=0
async function collectHidden() {
  const snap = await c.send("DOMSnapshot.captureSnapshot", { computedStyles: ["visibility", "opacity"] });
  const S = snap.strings, res = new Map();
  for (const d of snap.documents) {
    const parent = d.nodes.parentIndex, bid = d.nodes.backendNodeId;
    const style = new Map(); // nodeIndex → [visibility, opacity]
    d.layout.nodeIndex.forEach((ni, k) => style.set(ni, d.layout.styles[k].map((s) => S[s])));
    const memo = new Map();
    const transparent = (i) => { // 自身或祖先 opacity=0
      if (i < 0) return false;
      if (memo.has(i)) return memo.get(i);
      const st = style.get(i);
      const v = (st && Number(st[1]) === 0) || transparent(parent[i]);
      memo.set(i, v); return v;
    };
    for (let i = 0; i < bid.length; i++) {
      let st = style.get(i);
      if (!st) { res.set(bid[i], "gone"); continue; }
      if (!st[0] && parent[i] >= 0) st = style.get(parent[i]) || st;
      if (st[0] && st[0] !== "visible") res.set(bid[i], "gone");
      else if (transparent(i)) res.set(bid[i], "transparent");
    }
  }
  return res;
}

function format(node, depth) {
  const role = node.role?.value || "";
  const name = node.name?.value ?? "";
  const value = node.value?.value;
  let line = `${"  ".repeat(depth)}[${role}]`;
  if (name !== "") line += ` ${name}`;
  if (!(value === "" || value == null)) line += ` = ${JSON.stringify(value)}`;
  if (showIds && node.backendDOMNodeId) line += `  #${node.backendDOMNodeId}`;
  return line;
}

let c;
try {
  c = await connect({ ...cliTargetOpts(), hardCap: true });
  await c.send("Accessibility.enable").catch(() => {});
  const { nodes } = await c.send("Accessibility.getFullAXTree");
  if (onlyVisible) hidden = await collectHidden();
  const byId = new Map(nodes.map((n) => [n.nodeId, n]));
  const kids = new Map();
  for (const n of nodes) {
    if (!n.parentId) continue;
    if (!kids.has(n.parentId)) kids.set(n.parentId, []);
    kids.get(n.parentId).push(n);
  }
  // childIds 给顺序，parentId 反查兜底（部分节点只挂了其中一边）
  const children = (n) => {
    const res = [], seen = new Set();
    for (const id of n.childIds || []) { const ch = byId.get(id); if (ch && !seen.has(ch.nodeId)) { seen.add(ch.nodeId); res.push(ch); } }
    for (const ch of kids.get(n.nodeId) || []) if (!seen.has(ch.nodeId)) { seen.add(ch.nodeId); res.push(ch); }
    return res;
  };

  const lines = [], visited = new Set();
  // depth = 已显示的祖先层数：被过滤的 generic 不占缩进（Pacvue 页面外层套十几层 div，按原始深度缩进会全部顶到同一列）
  // parentName = 最近一个已显示祖先的 name，用来去掉 [button] Apply 下面重复的 [StaticText] Apply
  const visit = (n, depth, parentName = null) => {
    if (!n || visited.has(n.nodeId)) return;
    visited.add(n.nodeId);
    let next = depth, pn = parentName;
    if (shouldShow(n, parentName)) {
      if (depth > maxDepth) return;
      lines.push(format(n, depth));
      next = depth + 1; pn = n.name?.value ?? "";
    }
    for (const ch of children(n)) visit(ch, next, pn);
  };

  if (rootSel) {
    const { root } = await c.send("DOM.getDocument", { depth: 0 });
    const { nodeId } = await c.send("DOM.querySelector", { nodeId: root.nodeId, selector: rootSel });
    if (!nodeId) throw new Error(`--root 未命中：${rootSel}`);
    const { node } = await c.send("DOM.describeNode", { nodeId });
    // 选中元素本身可能被 AX 忽略（纯布局 div）→ 向下找第一个挂在 AX 树上的后代
    const want = new Set([node.backendNodeId]);
    let start = nodes.find((n) => n.backendDOMNodeId === node.backendNodeId);
    if (!start) {
      const { node: deep } = await c.send("DOM.describeNode", { nodeId, depth: -1 });
      const walk = (d) => { want.add(d.backendNodeId); (d.children || []).forEach(walk); (d.shadowRoots || []).forEach(walk); };
      walk(deep);
      const inSub = nodes.filter((n) => want.has(n.backendDOMNodeId));
      const subIds = new Set(inSub.map((n) => n.nodeId));
      inSub.filter((n) => !subIds.has(n.parentId)).forEach((n) => visit(n, 0));
    } else visit(start, 0);
  } else {
    const roots = nodes.filter((n) => !n.parentId || !byId.has(n.parentId));
    for (const r of roots) visit(r, 0);
    if (maxDepth === Infinity) for (const n of nodes) visit(n, 0); // 孤立节点兜底；限深时跳过，否则会把深层节点当根打出来
  }

  if (rootSel && !lines.length) console.error(`ax-snap: --root "${rootSel}" 命中了元素但没有可显示节点 —— querySelector 只取第一个，可能命中了隐藏 / 宽 0 的同名元素，换更具体的选择器`);
  const text = lines.join("\n");
  if (out) {
    fs.writeFileSync(out, text);
    console.log(`saved ${out}  lines=${lines.length}  axNodes=${nodes.length}${hidden ? `  hiddenDom=${hidden.size}` : ""}  url=${c.page.url}`);
  } else console.log(text);
} catch (e) {
  console.error("ax-snap: " + e.message);
  process.exitCode = 1;
} finally {
  c?.close();
}
