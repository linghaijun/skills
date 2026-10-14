// 素材库抽屉（Select from Library，AssetsFormDrawer）只读回归：打开时序、默认 Tag 预选、请求 tagIds、去掉预选（CP-58118 Q100 入库）
// 只打开抽屉、不选图、不点 OK → 只读，不用写授权。
//
//   node creativehub-library-drawer.mjs --out <证据目录> [--page IG|CG] [--entry source|reference] [--clear] [--wait 4000]
//     --page   IG = Image Generation，CG = Creative Generation（默认 IG）
//     --entry  source = Product Image 来源的 Source Image「Select from Library」（带默认预选 Content Type = Product Only）
//              reference = Prompt 下 Reference「+」→ Select from Library（不带预选，用来回归「别的入口不受影响」）
//     --clear  打开后在 Asset Tag 下拉里取消勾选第一个已选项再 Search，记录请求 tagIds 与 Total 变化
//     --wait   切到 Product Image 后等多久再点（毫秒，默认 4000；预取标签树约 1.7 秒，太短测到的是无缓存路径）
//
// 输出 <out>/library-<page>-<entry>.json：
//   timeline  抽屉打开后每 50ms 的 Asset Tag 文字 / Total（只记变化），t=0 为点击前
//   net       getTagTree / getCreativeAssetPage 的发起时刻（相对 t=0）与请求体 tagIds
//   before / after（--clear）  Asset Tag 文字、Total、最后一次列表请求的 tagIds
//   dropdown  Asset Tag 下拉首屏选项文字（下拉是虚拟滚动，只渲染首屏）
//   rects     同帧截图 <out>/library-<page>-<entry>-raw.png 的 Asset Tag 框（给 annotate.py --rects）
import fs from "node:fs";
import path from "node:path";
import { open } from "./creativehub-drive.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const OUT = arg("out");
if (!OUT) { console.error("缺 --out <证据目录>"); process.exit(1); }
const PAGE = arg("page", "IG").toUpperCase();
const ENTRY = arg("entry", "source");
const WAIT = Number(arg("wait", "4000"));
fs.mkdirSync(OUT, { recursive: true });
const base = `library-${PAGE}-${ENTRY}`;

const c = await open();
await c.ev(`location.href = '/crossretailer/CreativeManagement/AIImageOptimizer'`).catch(() => {});
await c.sleep(9000);
const LEAF = (t) => `[...document.querySelectorAll('div,span,a')].filter(e => e.childElementCount === 0 && (e.innerText||'').trim() === '${t}' && e.getBoundingClientRect().width > 0)`;
const DRAWER = `[...document.querySelectorAll('.el-drawer')].find(d => d.getBoundingClientRect().width > 0 && /Select from Library/.test(d.innerText))`;
// Asset Tag 筛选框：标签文字向上找到宽度 > 300 的容器（PacvueNewFilter 的一格）
const TAGITEM = `(() => { const d = ${DRAWER}; const lab = d && [...d.querySelectorAll('.assets-drawer-filter *')].find(e => e.childElementCount === 0 && (e.innerText||'').trim() === 'Asset Tag'); let el = lab; for (let i = 0; el && i < 6; i++) { if (el.getBoundingClientRect().width > 300) return el; el = el.parentElement; } return lab; })()`;
const total = () => c.ev(`(() => { const d = ${DRAWER}; const m = d && d.innerText.match(/Total\\s+([\\d,]+)\\s+entries/); return m ? m[1] : null; })()`);
const tagText = () => c.ev(`(${TAGITEM})?.innerText.replace(/\\s+/g, ' ')`);
const pageReqs = () => c.netList().filter((r) => /getCreativeAssetPage/.test(r.url));
const lastTagIds = () => { const r = pageReqs().pop(); try { return JSON.parse(r?.postData || "{}").tagIds; } catch (_) { return undefined; } };

await c.clickEl(`${LEAF(PAGE === "CG" ? "Creative Generation" : "Image Generation")}.pop()`);
await c.sleep(3000);
await c.clickEl(`${LEAF("Product Image")}.filter(e => e.getBoundingClientRect().top < 500).pop()`);
await c.sleep(WAIT);
await c.netStart(/getTagTree|getCreativeAssetPage/);

// 页面内采样器：t=0 在点击前，只记变化
await c.ev(`(() => { window.__lq = []; const t0 = performance.now(); window.__lq0 = Date.now();
  const tick = () => { const d = ${DRAWER}; const el = d && (${TAGITEM}); const m = d && d.innerText.match(/Total\\s+([\\d,]+)/);
    const row = { t: Math.round(performance.now() - t0), open: !!d, tag: el ? el.innerText.replace(/\\s+/g, ' ') : null, total: m ? m[1] : null };
    const last = window.__lq[window.__lq.length - 1]; if (!last || JSON.stringify({ ...last, t: 0 }) !== JSON.stringify({ ...row, t: 0 })) window.__lq.push(row);
    if (performance.now() - t0 < 6000) setTimeout(tick, 50); };
  tick(); })()`);

if (ENTRY === "reference") {
  // Reference「+」悬停展开菜单 → 第二项 Select from Library（MediaThumbnailGrid：+ = creativehub-466，菜单项 = creativehub-468）
  const PLUS = `[...document.querySelectorAll('[data-testid=creativehub-466]')].find(e => e.getBoundingClientRect().width > 0)`;
  await c.scrollSetting(PLUS);
  await c.sleep(600);
  await c.hoverEl(PLUS);
  await c.sleep(1000);
  await c.clickEl(`[...document.querySelectorAll('[data-testid=creativehub-468]')].find(e => e.getBoundingClientRect().width > 0)`, { force: true });
} else {
  await c.clickEl(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Select from Library' && b.getBoundingClientRect().width > 0)`);
}
for (let i = 0; i < 30; i++) { await c.sleep(500); if (pageReqs().some((r) => r.status)) break; }
await c.sleep(2500);

const q0 = await c.ev(`window.__lq0`);
const res = {
  page: PAGE, entry: ENTRY, wait: WAIT,
  timeline: await c.ev(`window.__lq`),
  net: c.netList().map((r) => { let tagIds; try { tagIds = JSON.parse(r.postData || "{}").tagIds; } catch (_) {} return { api: r.url.split("/").pop(), start: r.t - q0, status: r.status, tagIds }; }),
  before: { tag: await tagText(), total: await total(), tagIds: lastTagIds() },
};
const fr = await c.frame(OUT, base, { tag: TAGITEM });
res.rects = fr.rects;
res.sameFrame = fr.same;

// 下拉首屏选项（虚拟滚动：排在后面的选项不在 DOM 里）
await c.clickEl(TAGITEM, { force: true });
await c.sleep(1200);
res.dropdown = await c.ev(`[...document.querySelectorAll('.el-popper')].filter(p => p.getBoundingClientRect().width > 0).map(p => p.innerText.replace(/\\s+/g, ' ').slice(0, 200))`);

if (flag("clear")) {
  // 取消勾选：点 Asset Tag 当前显示的第一个已选值在下拉里对应的叶子
  const first = (res.before.tag || "").replace(/^Asset Tag\s*/, "").split(/[,，]/)[0].trim();
  const OPT = `[...document.querySelectorAll('.el-popper *')].filter(e => e.childElementCount === 0 && (e.innerText||'').trim() === ${JSON.stringify(first)} && e.getBoundingClientRect().width > 0).pop()`;
  if (first && (await c.center(OPT))) {
    await c.clickEl(OPT, { force: true });
    await c.sleep(800);
    await c.key("Escape", "Escape", 27).catch(() => {});
    await c.sleep(500);
    if (await c.ev(`!!(${DRAWER})`)) {
      const n0 = pageReqs().length;
      await c.clickEl(`[...(${DRAWER}).querySelectorAll('button')].find(b => b.innerText.trim() === 'Search')`, { force: true });
      for (let i = 0; i < 30; i++) { await c.sleep(500); const l = pageReqs(); if (l.length > n0 && l[l.length - 1].status) break; }
      await c.sleep(2500);
      res.after = { tag: await tagText(), total: await total(), tagIds: lastTagIds() };
      const f2 = await c.frame(OUT, `${base}-cleared`, { tag: TAGITEM });
      res.rectsCleared = f2.rects;
    } else res.after = { error: "Escape 关掉了抽屉" };
  } else res.after = { error: `下拉首屏找不到已选项「${first}」（虚拟滚动？预选应排在最前）` };
}
fs.writeFileSync(path.join(OUT, `${base}.json`), JSON.stringify(res, null, 1));
console.log(JSON.stringify({ before: res.before, after: res.after, firstOpenSample: res.timeline.find((x) => x.open), net: res.net.slice(0, 3) }));
await c.key("Escape", "Escape", 27).catch(() => {});
c.close();
setTimeout(() => process.exit(0), 200);
