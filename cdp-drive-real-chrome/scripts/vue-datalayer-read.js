/**
 * 数据层直读 —— 绕过「渲染成 -- 还是 0」直接看后端给的原始值。
 *
 * 用途: 表格里某列显示 `--` 有三种完全不同的原因，DOM 上长得一模一样：
 *   ① 前端门禁主动隐藏（如"非视频素材不显示视频指标"）—— 数据层可能有值
 *   ② 后端真的返回 null —— 该维度源库无此指标
 *   ③ 后端返回 0 —— 真的是零，语义上 != 缺失
 *   只读 DOM 无法区分①②③；必须读组件 setupState 里的原始行数据。
 *
 * 用法: 把 __COMP__ 换成目标组件名（如 "CreativeTable"），__ARRAY__ 换成数据数组的
 *       setupState 键（如 "dataList"），__FIELDS__ 换成要看的字段正则。
 *   node cdp.mjs vue-datalayer-read.js
 *
 * 关键: 逐字段输出 NULL / 数字 / 字符串 三态 + 计数分布，别只 dump 第一行。
 * 最后跑通: 2026-10-09
 */
(() => {
  const COMP = "__COMP__";       // 组件名
  const ARRAY = "__ARRAY__";     // 装行数据的 setupState 键
  const FIELDS = __FIELDS__;     // 关注字段的正则字面量，如 /video|pdpv/i

  const root =
    document.querySelector("#app")?.__vueParentComponent ||
    document.querySelector("#app")?.__vue_app__?._instance;
  if (!root) return JSON.stringify({ err: "no-vue-root" });

  let hit = null;
  const seen = new Set();
  (function go(c) {
    if (!c || hit || seen.has(c)) return;
    seen.add(c);
    const name = c.type?.name || c.type?.__name || "";
    if (name === COMP) { hit = c; return; }
    const sub = c.subTree;
    if (sub?.component) go(sub.component);
    const kids = sub?.children;
    if (Array.isArray(kids)) for (const k of kids) if (k?.component) go(k.component);
    else if (kids && typeof kids === "object" && kids.default) {
      const d = kids.default;
      if (Array.isArray(d)) d.forEach((x) => x?.component && go(x.component));
      else if (d?.component) go(d.component);
    }
  })(root);
  if (!hit) {
    // 常见原因：① target 选错标签页（页面上有多个表格组件/当前页没这个组件）
    //          ② 组件名不对 —— 用 vue-walk-snippet.js 先列出真实组件名
    //          ③ 组件在 teleport 的弹层里，不在 #app 子树
    return JSON.stringify({
      err: "not-found", comp: COMP,
      hint: "先确认 target 是对的标签页（cdp.mjs --list），再用 vue-walk-snippet.js 列真实组件名",
      foundNames: (() => {
        const names = new Set();
        const seen2 = new Set();
        (function walk(c) {
          if (!c || seen2.has(c) || names.size > 60) return;
          seen2.add(c);
          const n = c.type?.name || c.type?.__name;
          if (n) names.add(n);
          const s = c.subTree;
          if (s?.component) walk(s.component);
          const k = s?.children;
          if (Array.isArray(k)) for (const x of k) if (x?.component) walk(x.component);
          else if (k && typeof k === "object" && k.default) {
            const d = k.default;
            if (Array.isArray(d)) d.forEach((x) => x?.component && walk(x.component));
            else if (d?.component) walk(d.component);
          }
        })(root);
        return [...names];
      })(),
    });
  }

  const ss = hit.setupState || {};
  const unwrap = (v) => (v && typeof v === "object" && "value" in v ? v.value : v);
  const rows = unwrap(ss[ARRAY]);
  if (!Array.isArray(rows)) {
    const arrays = Object.keys(ss)
      .map((k) => ({ k, v: unwrap(ss[k]) }))
      .filter((x) => Array.isArray(x.v))
      .map((x) => x.k + "(" + x.v.length + ")");
    return JSON.stringify({ err: "array-not-found", key: ARRAY, arrayKeys: arrays,
      hint: "把 __ARRAY__ 改成上面某个键；setupState 里的 ref 需要 .value（本脚本已处理）" });
  }

  const tri = (v) => (v === null ? "NULL" : v === undefined ? "UNDEF" : typeof v);
  const stats = {};
  for (const r of rows) {
    for (const k of Object.keys(r || {})) {
      if (!FIELDS.test(k)) continue;
      const s = (stats[k] = stats[k] || { NULL: 0, UNDEF: 0, number: 0, string: 0, other: 0, samples: [] });
      const t = tri(r[k]);
      if (t === "NULL") s.NULL++;
      else if (t === "UNDEF") s.UNDEF++;
      else if (t === "number") { s.number++; if (s.samples.length < 3) s.samples.push(r[k]); }
      else if (t === "string") s.string++;
      else s.other++;
    }
  }
  return JSON.stringify({
    comp: COMP, array: ARRAY, rowCount: rows.length,
    // 分组键（广告类型之类）→ 该组各字段三态，用来定位"哪种类型缺哪个指标"
    byGroup: rows.slice(0, 200).reduce((acc, r) => {
      const g = r.adTypeCatalogId || r.adType || r.dimension || "?";
      acc[g] = acc[g] || { n: 0, fields: {} };
      acc[g].n++;
      for (const k of Object.keys(r || {})) {
        if (FIELDS.test(k)) acc[g].fields[k] = tri(r[k]);
      }
      return acc;
    }, {}),
    fieldStats: stats,
  }, null, 1);
})();
