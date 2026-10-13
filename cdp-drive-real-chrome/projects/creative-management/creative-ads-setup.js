// Ads 页布景：复位平台范围 → 切素材类型页签 → 切平台页签 → 点 Search → 等数据 → 返回最终状态。
// 本项目 Ads 页**最高频**的起手式。独立成脚本是因为它内建了三个必踩的坑：
//
//   1. 平台页签是**多选累加器**：上一个需求切过 Instacart，这一个再点 Walmart 会得到两者混合列表。
//      要「只选某平台」必须先 reload 复位为 all 再单点目标。没有可靠的「清空多选」API
//      （再点一次已选项可能是取消、也可能无效）→ reload 是唯一确定的做法。
//   2. **切素材类型页签后平台页签会短暂只剩 All**（组件重建）→ 必须轮询等它出现，不能 sleep 死等。
//   3. **改页签后必须再点 Search**，否则列表数据仍是上一次的 —— 高亮变了、数据没变，最容易误判。
//
// 用法（经 skill 的 cdp.mjs 执行，见本目录 README）:
//   node cdp.mjs creative-ads-setup.js --port 9222 --match localhost:3001
//   → 先跑一次拿 token 提示，或直接用 README 里的 ps1 包装器
//
// 参数（由 run-page.mjs 注入；占位符**不要自己加引号**，它会按类型自动加）:
//   FILE_TYPE   素材类型页签文本 Image|Video|Logo，空字符串 = 不动（不要自己加引号）
//   PLATFORM    平台页签文本 Walmart|Amazon|Instacart|ADSP|Tiktok，空 = 不动（不要自己加引号）
//   DO_RELOAD   true|false，默认 true（复位平台范围）
//   WAIT        点 Search 后等待 ms，默认 25000（本项目列表接口常需 20~42s）
//
// 返回: { steps: [...], firstCells: [...前 10 个单元格文本...], state: { 当前高亮 } }
//   ⚠️ 判定「列表真刷新了」要看 firstCells，不是只看 state 的高亮。
(() => {
  const FT = __FILE_TYPE__;
  const PT = __PLATFORM__;
  const DO_RELOAD = __DO_RELOAD__;
  const WAIT = __WAIT__;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const tx = (e) => (e.textContent || "").trim().replace(/\s+/g, "");
  const isOn = (e) => !/idle/.test(e.className);
  const platOn = (e) => /(^| )active( |$)/.test(e.className);
  const snap = () => ({
    fileTypeTabs: [...document.querySelectorAll(".file-type-tab")].map((e) => tx(e) + (isOn(e) ? "*" : "")),
    platformTabs: [...document.querySelectorAll(".platform-tab__btn")].map((e) => tx(e) + (platOn(e) ? "*" : "")),
  });
  const firstCells = () =>
    [...document.querySelectorAll(".surely-table-cell")]
      .map((c) => ({ k: Math.round(c.getBoundingClientRect().top / 4) * 4, t: (c.textContent || "").trim() }))
      .filter((c) => c.t)
      .sort((a, b) => a.k - b.k)
      .slice(0, 10)
      .map((c) => c.t);

  const out = { steps: [] };
  return (async () => {
    // ── 步骤 0：复位平台范围（否则多选累加，见坑 1）
    if (DO_RELOAD) {
      out.steps.push("reload");
      location.reload();
      return JSON.stringify({ ...out, pending: "reloading" }, null, 1);
    }

    // ── 步骤 1：素材类型页签
    if (FT) {
      let e = null;
      for (let i = 0; i < 30 && !e; i++) {
        e = [...document.querySelectorAll(".file-type-tab")].find((x) => tx(x) === FT);
        if (!e) await sleep(1000);
      }
      if (!e) out.steps.push("miss-file-type:" + FT);
      else if (isOn(e)) out.steps.push("file-type-already:" + FT);
      else {
        e.click();
        out.steps.push("file-type-clicked:" + FT);
      }
      await sleep(4000);
    }

    // ── 步骤 2：平台页签（组件可能刚重建，轮询等它出现，见坑 2）
    if (PT) {
      let e = null;
      for (let i = 0; i < 40 && !e; i++) {
        e = [...document.querySelectorAll(".platform-tab__btn")].find((x) => tx(x) === PT);
        if (!e) await sleep(1000);
      }
      if (!e) out.steps.push("miss-platform:" + PT);
      else {
        e.click();
        out.steps.push("platform-clicked:" + PT);
      }
      await sleep(3000);
    }

    // ── 步骤 3：必须再点 Search（见坑 3）
    const btn = [...document.querySelectorAll("button,.el-button")].find((e) => tx(e) === "Search");
    if (btn) {
      btn.click();
      out.steps.push("search-clicked");
    } else out.steps.push("no-search-button");
    await sleep(WAIT);

    out.state = snap();
    out.firstCells = firstCells();
    return JSON.stringify(out, null, 1);
  })();
})();