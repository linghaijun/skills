// 读 xhr-rows-capture.js 记下的最后一次列表响应（默认 getAssetCreativeListPaged；window.__capName = "getCreativeList" 可换）
// 输出 [{name, code, total, rows:[{productLine, creativeId, creativeName, adTypeCatalogId, product, productTitle, …}]}]，直接落盘作逐行证据
(() => { const re = new RegExp(window.__capName || "getAssetCreativeListPaged");
  return JSON.stringify((window.__caps || []).filter(c => re.test(c.name || "")).slice(-1)
    .map(c => ({ name: c.name, httpStatus: c.status, code: c.code, total: c.total, rows: c.rows })), null, 1); })()
