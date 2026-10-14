// Creative Hub「图片 Creative 生成」页（UrlToImage / Image Generation）页面侧工具，L1 页面层。
// 注入：CDP_TARGET=<id> node <skill>/scripts/ev.mjs --file creativehub-lib.js   → 之后用 window.__g1.*
//   __g1.state()  读宿主 setupState 摘要（sourceType / styleType / adType / product{asin,title,imgUrl} / PD / Selling Point / Optimize 任务态 / Prompt …）
//   __g1.rects()  判定点几何（CSS px × dpr = 截图像素）：进度条、PD、Selling Point / Concept 网格与选项、Style Type、Generate、Prompt、
//                 来源图区 srcArea / 参考图区 refArea（及每张缩略图 src0.. / ref0..）、tooltip、消息
//   __g1.rec() / __g1.s97()  250ms / 100ms 只读采样（任务态时间线 / 全部可见进度条）
//   window.__aiLog / __g1Sent / __g1Msgs  只读网络钩子与弹窗记录（不改请求、不改响应、不挂补丁）
// 来源：CP-58118 g1 组 lib.js（2026-10-13）；入库时按 g2 回报修正三处：
//   ① Style Type 按钮改为整词匹配 ^(Lifestyle|Studio)$ —— 原 /Lifestyle/ 会误中卖点按钮「Mock hook N · Lifestyle」，宿主定位与 rects 都错
//   ② state().product 补 imgUrl（选品图片字段名是 imgUrl，原候选里没有，取证时得另读一份）
//   ③ rects() 补来源图 / 参考图区域（#image_item_container_source-image / #image_item_container_reference-image）
// 页面改版（类名 / 容器 id 变了）只改这里，并刷新 README「最后验证」。
(() => {
  if (!window.__g1) window.__g1 = {};
  const G = window.__g1;
  // ---- 只读网络钩子（不改请求、不改响应，只记录 ai-task / url parse 的摘要） ----
  if (!window.__g1NetHook) {
    window.__g1NetHook = true;
    window.__aiLog = []; window.__g1Sent = [];
    const want = (u) => /ai-task|url\/parse|product|async\/|url-to-image|image-to-image/i.test(u || "");
    const summarize = (url, reqBody, status, txt) => {
      let req = null, res = null;
      try { req = typeof reqBody === "string" ? JSON.parse(reqBody) : reqBody; } catch (e) { req = String(reqBody).slice(0, 300); }
      try { res = JSON.parse(txt); } catch (e) { res = String(txt).slice(0, 300); }
      const d = res && res.data !== undefined ? res.data : res;
      let rs = {};
      if (d && typeof d === "object") {
        rs = { code: res && res.code, jobId: d.jobId, status: d.status, percent: d.percent, taskType: d.taskType, errorMsg: d.errorMsg };
        const r = d.result;
        if (r) {
          if (r.productDescription) rs.pd = String(r.productDescription).slice(0, 80);
          if (r.sellingPoints) rs.sps = r.sellingPoints.map((s) => s.sellingPointName + "[" + (s.concepts || []).length + "]");
          if (r.capabilities) rs.caps = r.capabilities;
        }
        if (d.parseFailed !== undefined) { rs.parseFailed = d.parseFailed; rs.crawlTitle = d.crawl && d.crawl.title; rs.crawlImgs = d.crawl && d.crawl.images && d.crawl.images.length; }
        if (d.items) { rs.items = d.items.map((it) => [it.code, it.status, it.percent]); rs.primarySlot = d.primarySlot; rs.images = (d.images || []).map((im) => [im.slotIndex, (im.imagePath || '').slice(-24)]); }
        if (d.productDescriptionMaxLength) rs.cfg = { pd: d.productDescriptionMaxLength, sp: d.maxSellingPoints, c: d.maxConcepts };
      }
      let rq = req;
      if (req && typeof req === "object") {
        rq = { ...req };
        if (rq.crawl) rq.crawl = { title: (rq.crawl.title || "").slice(0, 60), brand: rq.crawl.brand, desc: (rq.crawl.description || "").slice(0, 40), images: (rq.crawl.images || []).length };
        if (rq.productDescription) rq.productDescription = String(rq.productDescription).slice(0, 60) + "…(" + String(rq.productDescription).length + ")";
        if (rq.prompt) rq.prompt = String(rq.prompt).slice(0, 60);
      }
      window.__aiLog.push({ t: Date.now(), url: String(url).replace(location.origin, "").slice(0, 140), status, req: rq, res: rs });
    };
    const of = window.fetch;
    window.fetch = async function (input, init) {
      const url = typeof input === "string" ? input : input && input.url;
      window.__g1Sent.push({ t: Date.now(), url: String(url).replace(location.origin, "").slice(0, 120) }); const r = await of.apply(this, arguments);
      if (want(url)) { try { const txt = await r.clone().text(); summarize(url, init && init.body, r.status, txt); } catch (e) {} }
      return r;
    };
    const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) { window.__g1Sent.push({ t: Date.now(), url: String(this.__u).replace(location.origin, "").slice(0, 120) });
      if (want(this.__u)) { this.addEventListener("loadend", () => { try { summarize(this.__u, body, this.status, this.responseText); } catch (e) {} }); }
      return os.apply(this, arguments);
    };
  }
  G.clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  // ---- 找宿主组件（setupState 含 assist） ----
  G.host = () => {
    // 以可见的 Style Type 按钮为锚点向上找（页面是微前端，#app 上没有 __vue_app__）
    const b = [...document.querySelectorAll("button.ai-option")].find((x) => x.offsetParent && /^(Lifestyle|Studio)$/.test(G.clean(x.textContent)));
    let c = b && b.__vueParentComponent;
    while (c) { if (c.setupState && "assist" in c.setupState && "formData" in c.setupState) return c; c = c.parent; }
    return null;
  };
  G.state = () => {
    const h = G.host(); if (!h) return null;
    const s = h.setupState; const a = s.assist; const t = a.tab.value;
    const fd = s.formData;
    return {
      sourceType: s.sourceType, styleType: a.styleType.value,
      adType: fd.adTypeNode ? fd.adTypeNode.productLine + "|" + fd.adTypeNode.adType : null,
      product: s.selectedProduct ? { asin: s.selectedProduct.asin, title: (s.selectedProduct.title || "").slice(0, 50), imgUrl: s.selectedProduct.imgUrl || null } : null,
      pdPresent: a.pdPresent.value, pd: t.pd, pdLen: (t.pd || "").length, pdCommitted: (t.pdCommitted || "").slice(0, 40),
      pdTask: { ...t.pdTask }, hookTask: { ...t.hookTask }, optimizeTask: { ...t.optimizeTask },
      sps: (t.hookResult && t.hookResult.sellingPoints || []).map((x) => x.sellingPointName),
      selection: { ...t.selection },
      prompt: fd.prompt, aiBusy: a.aiBusy.value, pdEmpty: a.pdEmpty.value, pdOver: a.pdOverLength.value,
      cfg: { ...a.aiConfig.value }, canGenerate: s.canGenerate, tip: s.generateDisabledTip
    };
  };
  // ---- 判定点几何（CSS px × dpr = 截图像素） ----
  G.rects = () => {
    const d = devicePixelRatio, out = { dpr: d }; const q = (sel) => [...document.querySelectorAll(sel)].find((e) => e.offsetParent && e.getBoundingClientRect().width > 0) || null;
    const put = (k, el) => { if (!el || !el.offsetParent) return; const r = el.getBoundingClientRect(); if (r.width && r.height) out[k] = [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * d)); };
    const labelBlock = (txt) => { const l = [...document.querySelectorAll("div,span")].find((e) => e.offsetParent && e.childElementCount === 0 && e.textContent.trim() === txt); return l; };
    const bars = [...document.querySelectorAll(".ai-progress")].filter((e) => e.offsetParent);
    bars.forEach((b, i) => put("bar" + i, b));
    put("pdBar", q(".ai-progress.is-boxed"));
    const pdIn = q(".pd-input"); put("pdInput", pdIn);
    const pdL = labelBlock("Product Description"); put("pdLabel", pdL);
    if (pdIn) put("pdField", pdIn.parentElement);
    put("hookGrid", q(".selling-point-grid"));
    put("conceptGrid", q(".ai-option-grid"));
    const spL = labelBlock("Selling Point"); put("spLabel", spL);
    const cL = labelBlock("Concept"); put("conceptLabel", cL);
    if (spL) put("hookArea", spL.parentElement.parentElement);
    const opts = [...document.querySelectorAll(".selling-point-grid button.ai-option")]; opts.forEach((b, i) => put("sp" + i, b));
    const cs = [...document.querySelectorAll(".ai-option-grid button.ai-option")]; cs.forEach((b, i) => put("c" + i, b));
    const sty = [...document.querySelectorAll("button.ai-option")].filter((b) => /^(Lifestyle|Studio)$/.test(G.clean(b.textContent)));
    sty.forEach((b) => put(G.clean(b.textContent).toLowerCase(), b));
    // 来源图 / 参考图区域与每张缩略图
    [["srcArea", "src", "#image_item_container_source-image"], ["refArea", "ref", "#image_item_container_reference-image"]].forEach(([k, p, sel]) => {
      const box = document.querySelector(sel); put(k, box);
      if (box) [...box.querySelectorAll("img")].filter((i) => i.offsetParent && i.getBoundingClientRect().width > 20).forEach((im, i) => put(p + i, im));
    });
    put("generate", q(".generate-btn"));
    const pr = q(".ProseMirror, [contenteditable=true]"); put("prompt", pr);
    if (pr && pr.offsetParent) { const rg = document.createRange(); rg.selectNodeContents(pr); const r = rg.getBoundingClientRect(); const pr0 = pr.getBoundingClientRect(); if (r.height > 2) out.promptText = [pr0.left + 4, r.top - 4, pr0.right - 4, r.bottom + 4].map((v) => Math.round(v * d)); }
    const dtl = labelBlock("Dimension Type"); if (dtl) { const r0 = dtl.closest(".flex-col") || dtl.parentElement.parentElement; put("dimType", r0); } [...document.querySelectorAll(".el-radio")].filter(e=>e.offsetParent).forEach((e,i)=>put("radio"+i,e));
    put("urlInput", q(".url-input")); put("pdCount", q(".pd-count")); put("pdOverTip", q(".pd-over-tip"));
    const atl = labelBlock("Ad Type"); if (atl) { const box = atl.closest(".flex-col"); if (box && box.lastElementChild) put("adType", box.lastElementChild); }
    const pdTa = q(".pd-input textarea"); if (pdTa && pdTa.offsetParent) out.pdDisabled = pdTa.disabled;
    const prodL = labelBlock("Product"); if (prodL) put("productArea", prodL.closest(".flex-col") || prodL.parentElement.parentElement);
    const tips = [...document.querySelectorAll(".el-popper, .el-tooltip__popper")].filter((e) => e.offsetParent && getComputedStyle(e).display !== "none" && e.innerText.trim());
    tips.forEach((t, i) => { put("tip" + i, t); out["tip" + i + "_text"] = t.innerText.trim().slice(0, 200); });
    const msgs = [...document.querySelectorAll(".el-message, .el-notification")].filter((e) => e.offsetParent);
    out.msgs = msgs.map((m) => m.innerText.trim().slice(0, 120));
    return out;
  };
  // ---- 设置区滚动容器：把 Selling Point 标签滚到视口 y≈top 处 ----
  G.scroller = () => { let e = document.querySelector(".selling-point-grid") || document.querySelector("button.ai-option"); while (e && e !== document.body) { const cs = getComputedStyle(e); if (/(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight) return e; e = e.parentElement; } return null; };
  G.scrollTo = (sel, top) => { const s = G.scroller(); const el = [...document.querySelectorAll(sel)].find((x) => x.offsetParent); if (!s || !el) return "noscroll"; s.scrollTop += el.getBoundingClientRect().top - top; return s.scrollTop; };
  // ---- 弹窗计数（只读 MutationObserver）：记录出现过的 el-message / notification / message-box ----
  if (!window.__g1MsgObs) {
    window.__g1Msgs = [];
    window.__g1MsgObs = new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType === 1 && (n.matches?.(".el-message,.el-notification,.el-message-box,.el-overlay-message-box") || n.querySelector?.(".el-message,.el-notification,.el-message-box")))
        window.__g1Msgs.push({ t: Date.now(), text: (n.innerText || "").slice(0, 200), cls: String(n.className).slice(0, 80) });
    })));
    window.__g1MsgObs.observe(document.body, { childList: true, subtree: true });
  }
  // ---- AC-41：读 hookFp / 缓存 key / hookResult 身份 ----
  G.hook = () => { const t = G.host().setupState.assist.tab.value; return { hookFp: t.hookFp, cacheKeys: [...t.hookCache.keys()], hookTask: { ...t.hookTask } }; };
  // ---- AC-97：每 100ms 采样所有可见 AI 进度条（只读） ----
  G.s97 = () => {
    if (G.t97) clearInterval(G.t97);
    window.__s97 = [];
    G.t97 = setInterval(() => {
      try {
        const bars = [...document.querySelectorAll(".ai-progress")].filter((e) => e.offsetParent).map((e) => {
          const card = e.closest("[class*=card], [class*=Card], .result-item, .skeleton") ;
          return [(e.className.match(/is-(\w+)/) || [])[1] || "", (e.querySelector(".ai-progress-text") || {}).textContent || "", (e.querySelector(".ai-progress-percent") || {}).textContent || "", Math.round(e.getBoundingClientRect().left), Math.round(e.getBoundingClientRect().top)];
        });
        let s = null; try { s = G.state(); } catch (e) {}
        const imgs = [...document.querySelectorAll(".result-body img, [class*=result] img")].filter((i) => i.offsetParent && i.getBoundingClientRect().width > 80).length;
        window.__s97.push({ t: Date.now(), bars, pdLen: s ? s.pdLen : null, n: s ? s.sps.length : null, sel: s ? s.selection.sellingPointIndex : null, pdR: s ? s.pdTask.running : null, hkR: s ? s.hookTask.running : null, opR: s ? s.optimizeTask.running : null, src: s ? s.sourceType : null, prompt: s ? (s.prompt || "").slice(0, 30) : null, imgs });
      } catch (e) { window.__s97.push({ t: Date.now(), err: String(e) }); }
    }, 100);
    return "s97";
  };
  // ---- 时间线采样：每 250ms 记一次 PD / Selling Point 任务态（只读） ----
  G.rec = () => {
    if (G.timer) clearInterval(G.timer);
    G.tl = [];
    G.timer = setInterval(() => {
      try {
        const s = G.state(); if (!s) return;
        const domHookBar = [...document.querySelectorAll(".ai-progress")].filter((e) => e.offsetParent).map((e) => e.innerText.replace(/\s+/g, " ").trim());
        const row = { t: Date.now(), pdR: s.pdTask.running, pdP: s.pdTask.percent, hkR: s.hookTask.running, hkP: s.hookTask.percent, n: s.sps.length, sel: s.selection.sellingPointIndex, sty: s.styleType, pdLen: s.pdLen, cg: !!([...document.querySelectorAll(".ai-option-grid")].find((e) => e.offsetParent)), bars: domHookBar.join(" || ") };
        const last = G.tl[G.tl.length - 1];
        const key = (r) => JSON.stringify({ ...r, t: 0 });
        if (!last || key(last) !== key(row)) G.tl.push(row);
      } catch (e) {}
    }, 250);
    return "rec";
  };
  return "ok";
})()
