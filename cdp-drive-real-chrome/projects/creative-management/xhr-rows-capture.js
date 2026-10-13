// 只读拦截：记录 /creative-local/* 列表接口的业务码、total 与逐行关键字段到 window.__caps（不改请求、不改响应）；下载请求只记状态码与大小
// 用法：页面加载后执行一次（整页刷新会丢，需重装）；读数用 xhr-rows-dump.js
(() => {
  if (window.__xhrRowsCap) return "already armed";
  window.__xhrRowsCap = true;
  window.__errs = [];
  const oe = console.error;
  console.error = function (...a) { try { window.__errs.push(a.map(x => String(x && x.message || x)).join(" ").slice(0, 300)); } catch (e) {} return oe.apply(this, a); };
  window.addEventListener("error", e => window.__errs.push("window.error: " + String(e.message).slice(0, 300)));
  window.__caps = [];
  const pick = (r) => ({ productLine: r.productLine, creativeId: r.creativeId, creativeName: r.creativeName, adType: r.adType, campaignType: r.campaignType,
    displayName: r.displayName, adTypeCatalogId: r.adTypeCatalogId, product: r.product, productTitle: r.productTitle && String(r.productTitle).slice(0, 80), productImgUrl: !!r.productImgUrl, assetId: r.assetId });
  const walk = (rows, out) => { for (const r of rows || []) { if (r && r.creativeId !== undefined) out.push(pick(r)); if (r && r.creativeViews) walk(r.creativeViews, out); } };
  const record = (url, j) => {
    const name = url.split("/creative-local/")[1]?.split("?")[0];
    if (!name) return;
    const list = j?.data?.list || (Array.isArray(j?.data) ? j.data : []);
    const rows = []; walk(list, rows);
    window.__caps.push({ t: Date.now(), name, code: j?.code, total: j?.data?.totalCount ?? j?.data?.total, rows });
  };
  const of = window.fetch;
  window.fetch = async function (...a) {
    const r = await of.apply(this, a);
    const u = (typeof a[0] === "string" ? a[0] : a[0]?.url) || "";
    if (u.includes("/creative-local/") && !u.includes("download")) { r.clone().json().then(j => record(u, j)).catch(() => {}); }
    return r;
  };
  const oo = XMLHttpRequest.prototype.open, os = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__u = u; return oo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      const u = String(this.__u || "");
      if (!u.includes("/creative-local/")) return;
      if (u.includes("download")) { window.__caps.push({ t: Date.now(), name: u.split("/creative-local/")[1], status: this.status, type: this.responseType, size: this.response && (this.response.size || this.response.byteLength) }); return; }
      try { const j = this.responseType === "json" ? this.response : JSON.parse(this.responseText); record(u, j); } catch (e) {}
    });
    return os.apply(this, arguments);
  };
  return "armed";
})()
