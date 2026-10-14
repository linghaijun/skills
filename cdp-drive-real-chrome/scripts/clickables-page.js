// 页面侧代码：由 clickables.mjs 原样注入（前面拼一行 `const __OPT = {...};`），不要直接跑。
// 需要 Runtime.evaluate 带 includeCommandLineAPI:true，才能用 DevTools 的 getEventListeners()
// —— 这是 browser-use（dom/service.py）认出「Vue @click 绑在普通 div 上」的办法；AX 树里没有这些 div（坑 39）。
//
// 判定「可点」的理由（why 字段，可多项）：
//   tag       button / a[href] / input / select / textarea / summary / option / 包着表单控件的 label
//   role:xxx  ARIA 交互角色（button / tab / menuitem / option / checkbox / radio / switch / combobox …）
//   listener  元素自己挂了 click / mousedown / mouseup / pointerdown / pointerup 监听（Vue / React / 原生都算）
//   tabindex  tabindex >= 0
//   editable  contenteditable 根
//   pointer   cursor:pointer（只有这一条理由、且父元素也是 pointer 的视为继承，不列）
// 过滤：checkVisibility（沿祖先链查 display / visibility / opacity，坑 39、42）→ 视口内（--all 放开）→
//       中心点 elementFromPoint 命中自身 / 子孙 / 祖先 / 关联 label 才算没被挡（与 conn.mjs clickEl 同一判据）。
// 结果元素存进 window.__cdpClickables，供 `clickables.mjs --click n` 按编号点。
(() => {
  const O = __OPT;
  const root = O.root ? document.querySelector(O.root) : document.body;
  if (!root) return { err: "root-not-found", root: O.root };
  const W = innerWidth, H = innerHeight;
  const hasGEL = typeof getEventListeners === "function";
  const TAGS = new Set(["BUTTON", "A", "INPUT", "SELECT", "TEXTAREA", "SUMMARY", "OPTION", "LABEL"]);
  const ROLES = new Set(["button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option", "checkbox", "radio",
    "switch", "combobox", "treeitem", "slider", "spinbutton", "textbox", "searchbox"]);
  const EVT = ["click", "mousedown", "mouseup", "pointerdown", "pointerup"];
  const isVis = (e) => (typeof e.checkVisibility === "function" ? e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : true);
  const cls = (e) => (typeof e.className === "string" ? e.className.trim().split(/\s+/).filter(Boolean) : []);
  const desc = (e) => !e ? null : e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") + (cls(e).length ? "." + cls(e).slice(0, 2).join(".") : "");
  const textOf = (e) => {
    const a = e.getAttribute("aria-label") || e.getAttribute("title") || e.getAttribute("placeholder");
    let t = a || ((e.tagName === "INPUT" || e.tagName === "TEXTAREA") ? (e.value || "") : (e.innerText || e.textContent || ""));
    return String(t).trim().split(/\s+/).join(" ").slice(0, 50);
  };
  const cursorOf = (e) => { try { return getComputedStyle(e).cursor; } catch (x) { return ""; } };
  const reasonsOf = (e) => {
    const rs = [];
    const tag = e.tagName;
    if (TAGS.has(tag)) {
      if (tag === "A" && !e.hasAttribute("href")) { /* 无 href 的 a 不算 */ }
      else if (tag === "LABEL" && !e.querySelector("input,select,textarea")) { /* 纯文字 label 不算 */ }
      else rs.push("tag");
    }
    const role = e.getAttribute("role");
    if (role && ROLES.has(role)) rs.push("role:" + role);
    const ti = e.getAttribute("tabindex");
    if (ti !== null && Number(ti) >= 0) rs.push("tabindex");
    if (e.isContentEditable && !(e.parentElement && e.parentElement.isContentEditable)) rs.push("editable");
    if (hasGEL) {
      try { const L = getEventListeners(e); if (EVT.some((k) => L[k] && L[k].length)) rs.push("listener"); } catch (x) {}
    }
    if (cursorOf(e) === "pointer") rs.push("pointer");
    return rs;
  };
  const hitOk = (e, x, y) => {
    const hit = document.elementFromPoint(x, y);
    let ok = !!hit && (hit === e || e.contains(hit) || hit.contains(e));
    if (!ok && hit) {
      const lab = hit.closest ? hit.closest("label") : null;
      if (lab && (lab.contains(e) || (e.id && lab.htmlFor === e.id))) ok = true;
    }
    return { ok, hit };
  };

  const kept = new Set();
  const out = [];
  const els = [];
  let scanned = 0, covered = 0, truncated = false;
  const needle = O.text ? String(O.text).toLowerCase() : "";
  for (const e of root.querySelectorAll("*")) {
    scanned++;
    const r = e.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) continue;
    const inView = r.right > 0 && r.bottom > 0 && r.left < W && r.top < H;
    if (!inView && !O.all) continue;
    const rs = reasonsOf(e);
    if (!rs.length) continue;
    const parent = e.parentElement;
    if (rs.length === 1 && rs[0] === "pointer" && parent && cursorOf(parent) === "pointer") continue; // 继承来的 pointer
    // 大面积容器上的监听（表格 body、抽屉、整页包裹层做委托 / click-outside）不是「一个按钮」
    if (!rs.some((x) => x === "tag" || x.startsWith("role:")) && r.width * r.height > W * H * 0.4) continue;
    if (!isVis(e)) continue;
    // 与最近一个已收录祖先几何完全相同 → 同一个点击目标的内层包裹，不重复列
    let anc = parent, dup = false;
    while (anc) {
      if (kept.has(anc)) { const a = anc.getBoundingClientRect(); dup = Math.abs(a.left - r.left) < 1 && Math.abs(a.top - r.top) < 1 && Math.abs(a.width - r.width) < 1 && Math.abs(a.height - r.height) < 1; break; }
      anc = anc.parentElement;
    }
    if (dup) continue;
    const x1 = Math.max(0, r.left), y1 = Math.max(0, r.top), x2 = Math.min(W, r.right), y2 = Math.min(H, r.bottom);
    let cov = null;
    if (x2 > x1 && y2 > y1) {
      const h = hitOk(e, (x1 + x2) / 2, (y1 + y2) / 2);
      if (!h.ok) cov = desc(h.hit);
    } else cov = "offscreen";
    if (cov && cov !== "offscreen") covered++;
    if (cov && !O.all) continue;
    kept.add(e);
    const text = textOf(e);
    if (needle && !text.toLowerCase().includes(needle)) continue;
    if (out.length >= O.max) { truncated = true; break; }
    els.push(e);
    out.push({
      i: out.length, tag: desc(e), role: e.getAttribute("role") || undefined, text, why: rs.join(","),
      x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height),
      covered: cov || undefined,
    });
  }
  window.__cdpClickables = els;
  return { url: location.href, scanned, listed: out.length, covered, truncated, hasGEL, viewport: { w: W, h: H }, items: out };
})()
