/**
 * Vue3 组件树探测片段 —— 复制进 Runtime.evaluate 的 IIFE（不要当 Node 模块 require）。
 *
 * 用途: DOM / el-popper 扫不到选项时，从 setupState/props 取业务数据
 * 用法示例（把 __NAME__ 换成目标组件名字符串）:
 *   node cdp.mjs expr.js
 *   // expr.js:
 *   // (() => { ...粘贴下方 FIND... 并把 __NAME__ 换成 "CreativeTable" ... })()
 * 依赖: 页面已加载 Vue3 + 自拉 Chrome CDP（cdp.mjs 已默认开焦点模拟）
 * 最后跑通: 2026-10-09（CP-57189）
 *
 * 注意: setupState 里的 ref 要用 .value；组件名看 type.name / type.__name
 */

// ---- 复制起点 ----
(() => {
  const want = "CreativeTable"; // 改这里
  const root =
    document.querySelector("#app")?.__vueParentComponent ||
    document.querySelector("#app")?.__vue_app__?._instance;
  if (!root) return JSON.stringify({ err: "no-vue-root" });
  let hit = null;
  const seen = new Set();
  let n = 0;
  (function go(comp) {
    if (!comp || hit || n++ > 8000 || seen.has(comp)) return;
    seen.add(comp);
    const name = comp.type?.name || comp.type?.__name || "";
    if (name === want || name.includes(want)) hit = comp;
    const sub = comp.subTree;
    if (sub?.component) go(sub.component);
    const kids = sub?.children;
    if (Array.isArray(kids)) for (const c of kids) if (c?.component) go(c.component);
  })(root);
  if (!hit) return JSON.stringify({ err: "not-found", want });
  const ss = hit.setupState || {};
  const keys = Object.keys(ss);
  const sample = {};
  for (const k of keys.slice(0, 40)) {
    let v = ss[k];
    if (v && typeof v === "object" && "value" in v) v = v.value;
    if (Array.isArray(v)) sample[k] = { type: "array", len: v.length };
    else if (v && typeof v === "object") sample[k] = { type: "object", keys: Object.keys(v).slice(0, 12) };
    else sample[k] = v;
  }
  return JSON.stringify({ name: hit.type?.name || hit.type?.__name, keys, sample }, null, 1);
})();
// ---- 复制终点 ----
