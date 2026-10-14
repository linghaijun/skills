// Creative Hub（L1）：creativehub-gen-run.mjs 用的结果区几何（截图像素，扣 window.__gClip 原点）。截图前后各导一次，逐字节一致才算同帧。来源 CP-58118 AC-94 r6。
(() => {
  // r5 结果区几何（截图像素，扣除 window.__gClip 原点）：日期行 / 卡头 Creative N / 卡片 / Generating... / 进度条 / 百分比 / 成品图 / 勾选框 / Use Image / Generate 按钮
  const dpr = devicePixelRatio, o = { dpr, epochMs: Date.now() };
  const root = window.__gRoot(); const split = window.__gSplit(); const clip = window.__gClip || { x: 0, y: 0 };
  const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.left > split; };
  const R = (lab, el) => { if (!el) { o[lab + "_missing"] = 1; return; } const b = el.getBoundingClientRect(); o[lab] = [b.left - clip.x, b.top - clip.y, b.right - clip.x, b.bottom - clip.y].map((v) => Math.round(v * dpr)); o[lab + "_text"] = (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 200); };
  const leaf = [...root.querySelectorAll("*")].filter((e) => !e.children.length && vis(e));
  R("date", leaf.find((e) => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test((e.innerText || "").trim())));
  const name = leaf.find((e) => /^Creative \d+$/.test((e.innerText || "").trim())); R("name", name);
  let card = name; while (card && card.parentElement && !(card.getBoundingClientRect().height > 300)) card = card.parentElement; R("card", card);
  R("gen", leaf.find((e) => (e.innerText || "").trim() === "Generating..."));
  R("prog", [...root.querySelectorAll(".pending-progress, .ai-progress-bar")].find(vis));
  R("pct", leaf.find((e) => /^\d{1,3}%$/.test((e.innerText || "").trim())));
  R("img", [...root.querySelectorAll("img")].filter((e) => vis(e) && e.getBoundingClientRect().width > 100)[0]);
  const cb = card && card.querySelector(".el-checkbox"); if (cb) { R("cb", cb); o.cbChecked = /is-checked/.test(cb.className); }
  const use = [...root.querySelectorAll("button")].find((b) => b.getBoundingClientRect().width && /^(Use Image|Confirm)$/.test((b.innerText || "").trim())); R("useBtn", use); if (use) o.useDisabled = use.disabled;
  const btn = [...root.querySelectorAll("button")].find((x) => x.getBoundingClientRect().width && /^Generate/.test(x.innerText.trim())); R("btn", btn); if (btn) o.btnDisabled = btn.disabled;
  o.skel = [...root.querySelectorAll('[class*="skeleton"],[class*="shimmer"],.el-skeleton')].filter(vis).length;
  return o;
})()
