// Creative Hub（L1）：遍历 Vue 树找含 assist + generateDisabledTip 的图片生成宿主组件，挂 window.__u2i = setupState（页面是微前端，#app 上可能没有 __vue_app__，按 subTree 递归）。被 creativehub-drive.mjs 的 c.state() 调用。来源 CP-58118 g2。
(() => {
  const root = document.querySelector("#app")?.__vue_app__?._instance || document.querySelector("#app")?.__vueParentComponent;
  if (!root) return { err: "no-root" };
  const hits = [];
  const seen = new Set();
  let n = 0;
  (function go(vn) {
    if (!vn || n++ > 200000) return;
    if (vn.component) {
      const c = vn.component;
      if (seen.has(c)) return;
      seen.add(c);
      if (c.setupState && "assist" in c.setupState && "generateDisabledTip" in c.setupState) hits.push(c);
      go(c.subTree);
      return;
    }
    if (vn.suspense) go(vn.suspense.activeBranch);
    const ch = vn.children;
    if (Array.isArray(ch)) ch.forEach(go);
    else if (ch && typeof ch === "object" && ch.default === undefined) {}
    if (vn.dynamicChildren) {}
  })(root.subTree || root.vnode);
  const vis = hits.filter((c) => {
    const el = c.subTree?.el;
    return el && el.getBoundingClientRect && el.getBoundingClientRect().width > 0;
  });
  const pick = vis[0] || hits[0];
  if (pick) { window.__u2i = pick.setupState; window.__u2iInst = pick; }
  return { hits: hits.length, visible: vis.length, ok: !!pick, file: pick?.type?.__file || "" };
})()
