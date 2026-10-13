// 返回 CreativeTable 实例的 setupState（挂到 window.__ct 供后续脚本用）
(() => { const root = document.querySelector("#app"); let found = null; const seen = new Set();
 const visit = (inst, d) => { if (!inst || found || d > 40 || seen.has(inst)) return; seen.add(inst);
   const name = (inst.type && (inst.type.name || inst.type.__name)) || ""; if (name === "CreativeTable" && Array.isArray(inst.setupState?.dataList)) { found = inst; return; }
   const kids = []; const walk = (vn) => { if (!vn) return; if (vn.component) kids.push(vn.component); const ch = vn.children; if (Array.isArray(ch)) ch.forEach(walk); else if (ch && ch.default) { const dd = ch.default; if (Array.isArray(dd)) dd.forEach(walk); } };
   walk(inst.subTree); kids.forEach((c) => visit(c, d + 1)); };
 visit(root.__vueParentComponent, 0); window.__ct = found && found.setupState; return !!found; })()
