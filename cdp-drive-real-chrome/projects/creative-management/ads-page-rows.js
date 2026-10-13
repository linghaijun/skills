// Ads 页当前页行（需先跑 ads-table-attach.js 拿 window.__ct）：creativeId / productLine / adTypeCatalogId / creativeName / product / productTitle
// 含真实客户名称时别直接落盘 —— 交给 export-page-crosscheck.py 只留哈希
(() => { const ct = window.__ct; if (!ct) return "no __ct"; const rows = (ct.dataList && ct.dataList.value) || ct.dataList || [];
 const tot = ([...document.querySelectorAll(".el-pagination__total")].find(e => e.getBoundingClientRect().width > 0) || {}).textContent || null;
 return JSON.stringify({ at: new Date().toISOString(), pageTotal: tot, groupBy: ct.groupByValue && (ct.groupByValue.value ?? ct.groupByValue), n: rows.length,
  rows: rows.map(r => ({ creativeId: r.creativeId, productLine: r.productLine, adTypeCatalogId: r.adTypeCatalogId, displayName: r.displayName, creativeName: r.creativeName, product: r.product || null, productTitle: r.productTitle || null })) }); })()
