// Creative Hub 图片生成页（L1 页面层）：给 Reference 区从 Library 选 1 张**已上传**素材（不上传新文件、不写 Library）。
//   import { addRefFromLibrary } from "<skill>/projects/creative-management/creativehub-ref-from-library.mjs";
//   const r = await addRefFromLibrary(c, console.log, c.sleep);   // c 来自 scripts/sconn.mjs 的 connect()
//   → { before, after, drawer, picked, drawerClosed }（before / after = formData.referenceImagePaths 读回）
// 前置：页面已注入 creativehub-lib.js（用 window.__g1.host() 读 formData）。
// 步骤：悬停 Reference 区「+」→ 菜单「Select from Library」→ 抽屉勾第 1 张带图卡片 → OK → 读回 referenceImagePaths。
// 每次点击前用 elementFromPoint 核对落点（playbook §3 第 4 条），对不上抛错。
// 来源：CP-58118 AC-70 第 5 轮（2026-10-13）。
export async function addRefFromLibrary(c, log, sleep) {
  const refs = () => c.ev(`JSON.stringify((window.__g1.host().setupState.formData.referenceImagePaths || []).map(r => r && (r.path || r.url || r)))`);
  const center = (expr) => c.ev(`(() => { const el = (${expr})(); if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const h = document.elementFromPoint(x, y); return { x, y, ok: !!(h && (h === el || el.contains(h) || h.contains(el))) }; })()`);
  const out = { before: JSON.parse(await refs()) };
  const add = await center(`() => document.querySelector("#image_item_container_reference-image .media-thumb-add")`);
  if (!add) throw new Error("no reference add");
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: add.x, y: add.y }); await sleep(900);
  const lib = await center(`() => [...document.querySelectorAll("body *")].filter(e => e.childElementCount === 0 && e.textContent.trim() === "Select from Library" && e.getBoundingClientRect().width > 0).pop()`);
  if (!lib || !lib.ok) throw new Error("no Select from Library menu " + JSON.stringify(lib));
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: lib.x, y: lib.y }); await sleep(200);
  await c.click(lib); log("click Select from Library (reference)"); await sleep(4000);
  const drawerQ = `[...document.querySelectorAll(".el-drawer")].find(d => d.getBoundingClientRect().width > 0)`;
  // 等抽屉里出现可见的勾选框
  let cbN = 0; for (let i = 0; i < 40; i++) { cbN = await c.ev(`(() => { const d = ${drawerQ}; return d ? [...d.querySelectorAll(".el-checkbox__inner")].filter(x => x.getBoundingClientRect().width > 0).length : -1; })()`); if (cbN > 0) break; await sleep(500); }
  out.drawer = JSON.parse(await c.ev(`(() => { const d = ${drawerQ}; return JSON.stringify({ title: d && ((d.querySelector(".el-drawer__title, header") || {}).innerText || "").trim(), checkboxes: ${0} + (d ? [...d.querySelectorAll(".el-checkbox__inner")].filter(x => x.getBoundingClientRect().width > 0).length : -1) }); })()`));
  if (cbN <= 0) throw new Error("drawer has no checkbox " + cbN);
  // 第 1 张卡片的勾选框（卡片内有 img 的那个）
  const cb = await center(`() => { const d = ${drawerQ}; return [...d.querySelectorAll(".el-checkbox__inner")].filter(x => { const r = x.getBoundingClientRect(); if (!r.width) return false; let p = x; for (let i = 0; i < 8 && p; i++) { p = p.parentElement; if (p && p.querySelector("img")) return true; } return false; })[0]; }`);
  out.picked = JSON.parse(await c.ev(`(() => { const d = ${drawerQ}; const x = [...d.querySelectorAll(".el-checkbox__inner")].filter(x => { const r = x.getBoundingClientRect(); if (!r.width) return false; let p = x; for (let i = 0; i < 8 && p; i++) { p = p.parentElement; if (p && p.querySelector("img")) return true; } return false; })[0]; let p = x; for (let i = 0; i < 8; i++) { p = p.parentElement; if (p.querySelector("img")) break; } return JSON.stringify({ img: (p.querySelector("img") || {}).src, text: (p.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 120) }); })()`));
  await c.click(cb); log("check first library image"); await sleep(800);
  const ok = await center(`() => { const d = ${drawerQ}; return [...d.querySelectorAll("button")].find(b => b.offsetParent && /^(OK|Confirm|Add|Save)$/i.test(b.innerText.trim())); }`);
  if (!ok) throw new Error("no OK button");
  await c.click(ok); log("click OK (library drawer)"); await sleep(2500);
  out.after = JSON.parse(await refs());
  out.drawerClosed = await c.ev(`!(${drawerQ})`);
  log("refs " + JSON.stringify(out.before) + " -> " + JSON.stringify(out.after));
  return out;
}
