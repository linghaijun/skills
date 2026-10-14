// Creative Hub（L1）：creativehub-gen-run.mjs 注入的 100ms 只读采样器（结果区叶子文字 / 百分比 / 分步文字 / 骨架 / 日期行 / Generate 按钮），需先设 window.__gRoot / __gSplit。来源 CP-58118 AC-94 r6。
(() => {
  // r5 只读采样器（100ms）：结果区（window.__gRoot 内、x > window.__gSplit）全部可见叶子文字 + 卡片上方日期行 + 百分比 + 分步文字 + 骨架 + Generate 按钮
  if (window.__gs) clearInterval(window.__gs);
  const t0 = Date.now(); window.__gt0 = t0; window.__gall = []; window.__gchg = []; let last = "";
  const STEP = /Matching|\(\d+\s*\/\s*\d+\)|brand logo|Step \d/i;
  window.__gs = setInterval(() => {
    const root = window.__gRoot(); if (!root) return; const split = window.__gSplit();
    const vis = (e) => { const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0 && b.left > split; };
    const leaves = [...root.querySelectorAll("*")].filter((e) => !e.children.length && vis(e)).map((e) => (e.innerText || "").trim()).filter(Boolean);
    const text = leaves.join(" | ");
    const btn = [...root.querySelectorAll("button")].find((x) => x.getBoundingClientRect().width && /^Generate/.test(x.innerText.trim()));
    const rec = { ms: Date.now() - t0, epochMs: Date.now(), gen: leaves.includes("Generating..."), pct: leaves.filter((t) => /^\d{1,3}%$/.test(t)),
      step: STEP.test(text), skel: [...root.querySelectorAll('[class*="skeleton"],[class*="shimmer"],.el-skeleton')].filter(vis).length,
      names: leaves.filter((t) => /^Creative \d+$/.test(t)), dates: leaves.filter((t) => /^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}:\d{2}$/.test(t)),
      imgs: [...root.querySelectorAll("img")].filter((e) => vis(e) && e.getBoundingClientRect().width > 100).length,
      btnText: btn ? btn.innerText.replace(/\s+/g, " ").trim() : null, btnDisabled: btn ? btn.disabled : null };
    window.__gall.push(rec);
    const key = text + " || BTN " + rec.btnText + " " + rec.btnDisabled + " img " + rec.imgs;
    if (key !== last) { window.__gchg.push({ ms: rec.ms, epochMs: rec.epochMs, fullText: text, btnText: rec.btnText, btnDisabled: rec.btnDisabled, imgs: rec.imgs }); last = key; }
  }, 100);
  return { on: true, t0 };
})()
