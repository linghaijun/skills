// Creative Hub 图片生成页（L1 页面层）：Prompt 回填 vs AI 返回段落逐行对照；可选点一次 Generate，对照 AI 返回文案（Headline / CTA / Brand / Logo）与 Creative 卡面。
//
//   CDP_TARGET=<id> OUT_DIR=<证据目录> PRODUCT=<ASIN> ADTYPE_SEARCH=Others ADTYPE_LEAF=Others \
//     [ADTYPE_KEY="Others|Others"] [RESULT_TYPE="^Image\s*\+\s*Headline\s*\+\s*CTA$"] [PREFIX=AC-NN-r1-ihc] [DRY=1] [LOGDETAIL=1] \
//     node creativehub-fields-compare.mjs
//     PRODUCT       Add Product 弹框里要选的商品（按卡片文字包含 ASIN 匹配）
//     ADTYPE_*      Ad Type 树搜索词 / 叶子文字；ADTYPE_KEY = setupState 里 productLine|adType，用于等待布景生效
//     RESULT_TYPE   Result type 单选的文字正则（不给则不点）
//     DRY=1         只做到 Prompt 回填对照，不点 Generate
//     LOGDETAIL=1   出图后只读 GET /ai/generation-log/{jobId}（先页面内无头直发；401/403 才复用内存里的页面请求头，不落盘不打印）—— 见 creativehub-netcap.mjs 的说明
//     EVIDENCE_TYPE 覆盖 -04 摘要里的 evidenceType（默认「mock 出图」= CP-58118 当时后端写死 mock；mock 删除后必须改）
//   产出（OUT_DIR 下）：<PREFIX>-01-Prompt回填对照.json、-01-prompt-raw.png(+rects)、-02-creative-card-raw.png(+rects)、
//                       -03-Creative文案对照.json、-04-出图网络摘要.json、-log.json
// 🔴 不带 DRY 时会真点一次 Generate（写操作，消耗额度）→ 每次运行前单独取得用户授权；提交非 200 / 无 jobId 立即停，不重试。
// 来源：CP-58118 AC-75 第 7 轮 run75.mjs（2026-10-13，Q71 口径「Creative 上的文字完全以 AI 返回为准」）；入库时去掉写死的商品 / Ad Type / 路径。
import { open, save, pickAdType } from "./creativehub-drive.mjs";
import fs from "node:fs";
import path from "node:path";

const ENV = process.env;
for (const k of ["OUT_DIR", "PRODUCT", "ADTYPE_SEARCH", "ADTYPE_LEAF"]) if (!ENV[k]) { console.error("缺环境变量 " + k + "（用法见文件头）"); process.exit(2); }
const RT_TEXT = ENV.RESULT_TYPE ? new RegExp(ENV.RESULT_TYPE, "i") : null;
const PREFIX = ENV.PREFIX || "fields";
const c = await open();
const dir = ENV.OUT_DIR;
fs.mkdirSync(dir, { recursive: true });
const P = (n) => path.join(dir, `${PREFIX}-${n}`);
const LOG = P("log.json");
const log = { prefix: PREFIX, product: ENV.PRODUCT, adType: ENV.ADTYPE_LEAF, resultType: ENV.RESULT_TYPE || null, t0: new Date().toISOString(), steps: [] };
const flush = () => save(LOG, log);
const step = (s, x = {}) => { log.steps.push({ t: new Date().toISOString(), s, ...x }); flush(); };

// ---------- 网络：全部请求记 url/状态，ai-task / creative async / progress 取响应体；页面自身请求头只留内存
const reqs = new Map();
let HDR = null;
const pickHdr = (h) => { const o = {}; for (const [k, v] of Object.entries(h || {})) if (!/^(content-length|content-type|host|origin|referer|accept|accept-encoding|accept-language|connection|cookie|sec-|user-agent)/i.test(k)) o[k] = v; return o; };
c.bodyMax = 400000;
await c.send("Network.enable", { maxPostDataSize: 200000 });
c.on(async (m) => {
  if (m.method === "Network.requestWillBeSent") {
    const r = m.params.request;
    // 只在 LOGDETAIL 时才记（兜底用），且只留鉴权 / 业务类非标准头；只在内存，不落盘、不打印（见下方 generation-log 段）
    if (ENV.LOGDETAIL && !HDR && /creative-local\//.test(r.url) && r.headers && Object.keys(r.headers).some((k) => /authorization|token/i.test(k))) HDR = pickHdr(r.headers);
    reqs.set(m.params.requestId, { t: Date.now(), url: r.url, method: r.method, postData: r.postData || null });
  } else if (m.method === "Network.responseReceived") {
    const e = reqs.get(m.params.requestId); if (e) e.status = m.params.response.status;
  } else if (m.method === "Network.loadingFinished") {
    const e = reqs.get(m.params.requestId);
    if (e && /ai-task|creative\/async|async\/progress/.test(e.url)) {
      try { const b = await c.send("Network.getResponseBody", { requestId: m.params.requestId }); e.body = b.body.slice(0, c.bodyMax); } catch (_) {}
    }
  }
});
const J = (s) => { try { return JSON.parse(s || "null"); } catch (_) { return null; } };
const list = () => [...reqs.values()];

// ---------- 宿主 setupState（UrlToCreative）
const HOSTJS = `(() => { const root = document.querySelector('#app')?.__vue_app__?._instance || document.querySelector('#app')?.__vueParentComponent; let hit = null; const seen = new Set(); let n = 0;
  (function go(vn) { if (!vn || hit || n++ > 200000) return; if (vn.component) { const c = vn.component; if (seen.has(c)) return; seen.add(c); if (/UrlToCreative\\/index\\.vue/.test(c.type?.__file || '') && c.subTree?.el?.getBoundingClientRect?.().width > 0) { hit = c; return; } go(c.subTree); return; } if (vn.suspense) go(vn.suspense.activeBranch); if (Array.isArray(vn.children)) vn.children.forEach(go); })(root.subTree || root.vnode);
  window.__uc = hit?.setupState; return !!hit; })()`;
const hs = () => c.ev(`(() => { const s = window.__uc; if (!s) return null; const un = v => v && typeof v === 'object' && 'value' in v && !Array.isArray(v) ? v.value : v; const a = s.assist; const t = a ? un(a.tab) : null; const fd = un(s.formData);
  return { adType: fd.adTypeNode ? fd.adTypeNode.productLine + '|' + fd.adTypeNode.adType : null, resultType: fd.resultType, prompt: fd.prompt, pdRunning: t?.pdTask?.running, hookRunning: t?.hookTask?.running, hooks: (t?.hookResult?.sellingPoints || []).length, selection: t?.selection ? { sp: t.selection.sellingPointIndex, c: t.selection.conceptIndex } : null, canGenerate: un(s.canGenerate), tip: un(s.generateDisabledTip) }; })()`);
const waitH = async (fn, ms = 180000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { await c.ev(HOSTJS); const s = await hs(); log.lastH = s; if (s && fn(s)) return s; await c.sleep(Math.min(500, Math.max(150, Date.now() - t0))); } flush(); throw new Error("waitH timeout " + JSON.stringify(log.lastH).slice(0, 800)); };
const quota = () => c.ev(`[...document.querySelectorAll('span')].find(s => /^Quota:/.test(s.innerText.trim()) && s.getBoundingClientRect().width > 0)?.innerText.trim()`);

// ---------- 布景（整页 reload 清掉之前的内存补丁）
await c.ev("location.reload()").catch(() => {});
await c.sleep(9000);
step("reloaded", { href: await c.ev("location.href"), patchedDate: await c.ev("String(Date.now).includes('native code') ? 'native' : 'PATCHED'") });
await c.clickEl(`[...document.querySelectorAll('div,span,a')].filter(e => e.childElementCount === 0 && e.innerText && e.innerText.trim() === 'Creative Generation').pop()`);
await c.sleep(4000);
await c.ev(HOSTJS);
step("on-creative-generation", { quota: await quota() });
await c.clickEl(`[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Add Product' && b.getBoundingClientRect().width > 0)`);
const PROD = `[...document.querySelectorAll('div.cursor-pointer')].find(e => e.innerText.includes(${JSON.stringify(ENV.PRODUCT)}) && e.getBoundingClientRect().width > 0)`;
for (let i = 0; i < 40 && !(await c.ev(`!!(${PROD})`)); i++) await c.sleep(500);
await c.clickEl(PROD);
await c.sleep(1500);
await pickAdType(c, ENV.ADTYPE_SEARCH, ENV.ADTYPE_LEAF);
await c.sleep(1500);
log.radios = await c.ev(`[...document.querySelectorAll('.result-type-radio .el-radio')].filter(r => r.getBoundingClientRect().width > 0).map(r => r.innerText.trim())`);
if (RT_TEXT) {
  const RADIO = `[...document.querySelectorAll('.result-type-radio .el-radio')].find(r => ${RT_TEXT}.test(r.innerText.trim()) && r.getBoundingClientRect().width > 0)`;
  await c.clickEl(RADIO);
}
step("result-type-clicked", { radios: log.radios });
let s = await waitH((x) => (!ENV.ADTYPE_KEY || x.adType === ENV.ADTYPE_KEY) && !x.pdRunning && !x.hookRunning && x.hooks > 0 && (x.prompt || "").length > 0);
await c.sleep(1500);
await c.ev(HOSTJS);
s = await hs();
step("hooks-ready", { s });

// ---------- AI 响应：最后一个 SELLING_POINT 成功的 progress
const spSubmit = list().filter((e) => e.method === "POST" && /ai-task\/selling-points/.test(e.url)).pop();
const spProg = list().filter((e) => /ai-task\/progress/.test(e.url) && J(e.body)?.data?.taskType === "SELLING_POINT" && J(e.body)?.data?.status === "SUCCESS").pop();
const spData = J(spProg?.body)?.data;
const spReq = J(spSubmit?.postData);
const selSp = (spData?.result?.sellingPoints || []).find((x) => x.sellingPointIndex === s.selection?.sp) || null;
const selC = (selSp?.concepts || []).find((x) => x.conceptIndex === s.selection?.c) || null;
// 全部 concept 出现过的段名（证明 AI 这一类型整体给了哪些段）
const allLabels = {};
(spData?.result?.sellingPoints || []).forEach((p) => (p.concepts || []).forEach((cc) => (cc.segments || []).forEach((g) => { const k = g.displayLabel ?? g.label ?? ""; allLabels[k] = (allLabels[k] || 0) + 1; })));
const ai = {
  submit: spSubmit ? { url: spSubmit.url.replace(/^https?:\/\/[^/]+/, ""), status: spSubmit.status, req: spReq && { productLine: spReq.productLine, adType: spReq.adType, resultType: spReq.resultType, styleType: spReq.styleType, dimensionType: spReq.dimensionType, specs: spReq.specs, language: spReq.language } } : null,
  progressJobId: spData?.jobId,
  capabilities: spData?.result?.capabilities,
  conceptCount: (spData?.result?.sellingPoints || []).reduce((a, p) => a + (p.concepts || []).length, 0),
  segmentLabelHistogram: allLabels,
  selected: { sellingPointIndex: s.selection?.sp, sellingPointName: selSp?.sellingPointName, conceptIndex: s.selection?.c, conceptName: selC?.conceptName },
  selectedConcept: selC && { prompt: selC.prompt, segments: selC.segments, headline: selC.headline ?? null, ctaText: selC.ctaText ?? null, logo: selC.logo ?? null, backgroundImage: selC.backgroundImage ?? null }
};
log.ai = ai; flush();

// ---------- 编辑器 DOM
const ED = `[...document.querySelectorAll('.prompt-editor')].find(e => e.getBoundingClientRect().width > 0)`;
await c.ev(`(${ED}).scrollIntoView({block:'center'})`); await c.sleep(500);
const editor = await c.ev(`(() => { const ed = ${ED}; const NL = String.fromCharCode(10);
  return { editorText: ed.innerText, lines: ed.innerText.split(NL), strongs: [...ed.querySelectorAll('strong,b')].map(e => ({ text: e.innerText, fontWeight: getComputedStyle(e).fontWeight })), childNodes: [...ed.childNodes].map(n => [n.nodeName, n.textContent]),
    activeOptions: [...document.querySelectorAll('.ai-option.is-active, .is-active')].filter(e => e.getBoundingClientRect().width > 0 && e.innerText && e.innerText.length < 60).map(e => e.innerText.trim()) }; })()`);
log.editor = editor; flush();

// ---------- 对照：AI 段 vs 编辑器
const segs = selC?.segments || [];
const expLines = segs.map((g) => { const lb = g.displayLabel ?? g.label ?? ""; return lb ? `${lb}: ${g.text}` : g.text; });
const actLines = editor.lines.filter((x) => x.trim() !== "");
const actLabels = editor.strongs.map((x) => x.text.replace(/:\s*$/, ""));
const expLabels = segs.map((g) => g.displayLabel ?? g.label ?? "").filter((x) => x);
const WATCH = ["Headline", "CTA Text", "CTA", "Call to Action", "Logo", "Background Image"];
const promptCompare = {
  prefix: PREFIX, resultType: ENV.RESULT_TYPE || null,
  aiSegments: segs.map((g, i) => ({ i, label: g.displayLabel ?? g.label ?? "", text: g.text })),
  editorLines: actLines.map((l, i) => ({ i, line: l, boldLabel: actLabels[i] ?? null })),
  rows: Array.from({ length: Math.max(expLines.length, actLines.length) }, (_, i) => ({ i, aiLine: expLines[i] ?? null, editorLine: actLines[i] ?? null, same: expLines[i] === actLines[i] })),
  labelsAi: expLabels, labelsEditor: actLabels,
  labelsOnlyInEditor: actLabels.filter((x) => !expLabels.includes(x)),
  labelsOnlyInAi: expLabels.filter((x) => !actLabels.includes(x)),
  watchedLabelPresence: WATCH.map((w) => ({ label: w, inAi: expLabels.includes(w), inEditorBold: actLabels.includes(w), inEditorText: new RegExp("(^|\\n)" + w.replace(/ /g, "\\s") + ":").test(editor.editorText) })),
  editorTextEqualsAiPrompt: editor.editorText.replace(/\n+/g, "\n").trim() === String(selC?.prompt || "").replace(/\n+/g, "\n").trim(),
  allSame: expLines.length === actLines.length && expLines.every((x, i) => x === actLines[i]) && JSON.stringify(expLabels) === JSON.stringify(actLabels)
};
save(P("01-Prompt回填对照.json"), { at: new Date().toISOString(), ai, promptCompare });
step("prompt-compared", { allSame: promptCompare.allSame });

// 左侧面板原图（同帧 rects）
const strongRects = {};
for (let i = 0; i < editor.strongs.length; i++) strongRects["label" + i] = `[...(${ED}).querySelectorAll('strong,b')][${i}]`;
log.leftFrame = await c.frame(dir, `${PREFIX}-01-prompt`, {
  editor: ED,
  ...strongRects,
  radio: `[...document.querySelectorAll('.result-type-radio')].find(e => e.getBoundingClientRect().width > 0)`,
  radioChecked: `[...document.querySelectorAll('.result-type-radio .el-radio.is-checked')].find(e => e.getBoundingClientRect().width > 0)`,
  adSel: `[...document.querySelectorAll('.el-select,.el-tree-select,[class*=select]')].find(e => e.getBoundingClientRect().left < 820 && e.innerText.includes(${JSON.stringify(ENV.ADTYPE_LEAF)}) && e.getBoundingClientRect().height < 60 && e.getBoundingClientRect().height > 20)`,
  spActive: `document.querySelector('.selling-point-grid .ai-option.is-active')`
});
flush();
if (ENV.DRY) { console.log("DRY", JSON.stringify({ s, promptCompare }, null, 1)); c.close(); process.exit(0); }

// ---------- 出图（mock，唯一一次）
log.quotaBefore = await quota();
const GEN = `[...document.querySelectorAll('.generate-btn')].find(b => b.getBoundingClientRect().width > 0)`;
await c.ev(`(${GEN}).scrollIntoView({block:'center'})`); await c.sleep(300);
const clickAt = Date.now();
log.genClick = await c.clickEl(GEN);
step("generate-clicked", { quotaBefore: log.quotaBefore });
let sub = null;
for (let i = 0; i < 60 && !sub; i++) { await c.sleep(500); sub = list().find((e) => e.t >= clickAt && e.method === "POST" && /creative\/async\/.*-to-creative/.test(e.url) && e.status && e.body !== undefined); }
const subJ = J(sub?.body);
const jobId = subJ?.data?.jobId;
const subReq = J(sub?.postData);
log.submit = sub ? { url: sub.url.replace(/^https?:\/\/[^/]+/, ""), status: sub.status, jobId, items: subJ?.data?.items, req: subReq && { productLine: subReq.productLine, adType: subReq.adType, resultType: subReq.resultType, styleType: subReq.styleType, sellingPoint: subReq.sellingPoint, concept: subReq.concept, prompt: subReq.prompt, brandNames: subReq.brandNames, language: subReq.language, specs: subReq.specs } } : null;
flush();
if (!sub || sub.status !== 200 || !jobId) {
  await c.shot(P("02-submit-failed-raw.png"));
  log.failBody = sub?.body?.slice(0, 3000); log.quotaAfter = await quota();
  step("STOP-submit-failed");
  console.log("STOP submit failed", JSON.stringify({ status: sub?.status, body: (sub?.body || "").slice(0, 1500) }));
  c.close(); process.exit(0);
}
let final = null;
// 等 AI 任务终态：旧写法 200×2s 固定轮询（粒度粗、且超时后静默继续）；现在自适应轮询 + onPoll 记录进度尾巴
const readProgress = () => {
  const prog = list().filter((e) => e.t >= clickAt && /async\/progress/.test(e.url) && J(e.body)?.data);
  const last = J(prog[prog.length - 1]?.body)?.data;
  log.progressTail = prog.slice(-2).map((e) => { const d = J(e.body).data; return { status: d.status, percent: d.percent }; });
  return last || null;
};
try {
  final = (await c.waitFor("1", { total: 400000, min: 200, max: 600, label: "ai-final", onPoll: () => readProgress(), until: () => { const l = readProgress(); return !!l && (l.status === "SUCCESS" || l.status === "FAILED"); } })).value;
  final = readProgress();
} catch { final = readProgress(); log.finalTimeout = true; }
log.final = final && { status: final.status, percent: final.percent, errorMsg: final.errorMsg, resultKeys: Object.keys(final.result || {}) };
flush();
await c.sleep(3500);
log.quotaAfter = await quota();
const res = final?.result || {};

// ---------- 结果卡：组件 props + DOM 文字
const CARD = `[...document.querySelectorAll('.creative-result-card')].find(b => b.getBoundingClientRect().width > 0)`;
await c.ev(`(${CARD})?.scrollIntoView({block:'start'})`); await c.sleep(1200);
const card = await c.ev(`(() => { const el = ${CARD}; if (!el) return null; let ins = el.__vueParentComponent; while (ins && !/CreativeResultCard/.test(ins.type?.__file || '')) ins = ins.parent;
  const p = ins ? ins.props : {}; const host = el.querySelector('.result-template-host'); let hi = host?.__vueParentComponent; while (hi && !/ResultTemplateHost/.test(hi.type?.__file || '')) hi = hi.parent;
  const leafTexts = [...(host || el).querySelectorAll('*')].filter(e => e.childElementCount === 0 && e.innerText && e.innerText.trim() && e.getBoundingClientRect().width > 0).map(e => ({ cls: String(e.className).slice(0, 60), text: e.innerText.trim() }));
  return { creativeLabel: el.querySelector('.text-sm')?.innerText, createTime: p.createTime, props: { productLine: p.productLine, adType: p.adType, textFields: JSON.parse(JSON.stringify(p.textFields || {})), applicableTextFields: JSON.parse(JSON.stringify(p.applicableTextFields || [])), brandName: p.brandName, logoAssetPath: p.logoAssetPath ?? null }, hostComponent: hi?.type?.__file?.split('/').pop(), templateLeafTexts: leafTexts, logoImg: host?.querySelector('.others-preview__logo img')?.getAttribute('src') || null, logoPlaceholder: host?.querySelector('.others-preview__logo span')?.innerText || null, cardText: el.innerText }; })()`);
log.card = card; flush();
const R = (sel) => `(${CARD})?.querySelector('${sel}')`;
log.resultFrame = await c.frame(dir, `${PREFIX}-02-creative-card`, {
  card: CARD, host: R(".result-template-host"), logo: R(".others-preview__brand"), media: R(".others-preview__media"), skeleton: R(".others-preview__skeleton"), header: `(${CARD})?.querySelector('.flex.items-center.justify-between')`
});
flush();

// ---------- generation-log 详情（只读，只落盘摘要）
// 🔴 鉴权：先在页面内直接发（credentials: include、不带头，令牌不经过 Node）；401/403 才退回复用内存里的页面请求头（不落盘、不打印）
let glog = null;
if (ENV.LOGDETAIL) {
  const url = "/creative-local/ai/generation-log/" + encodeURIComponent(jobId);
  const go = (hdr) => c.ev(`fetch(${JSON.stringify(url)}, { credentials: 'include'${hdr ? ", headers: " + JSON.stringify(hdr) : ""} }).then(r => r.text().then(t => ({ status: r.status, t })))`).catch((e) => ({ error: String(e) }));
  let r = await go(null); let authVia = "page-fetch-no-headers";
  if ((r?.status === 401 || r?.status === 403) && HDR) { r = await go(HDR); authVia = "reused-page-request-headers(memory-only)"; }
  const d = J(r?.t)?.data;
  let rj = null; try { rj = typeof d?.requestJson === "string" ? JSON.parse(d.requestJson) : d?.requestJson; } catch (_) { rj = d?.requestJson; }
  glog = { status: r?.status, authVia, code: J(r?.t)?.code, keys: d ? Object.keys(d) : null, requestJson: rj && { productLine: rj.productLine, adType: rj.adType, resultType: rj.resultType, sellingPoint: rj.sellingPoint, concept: rj.concept, prompt: rj.prompt }, outputs: d?.outputs, inputsCount: (d?.inputs || []).length, responseJson: d?.responseJson ? String(d.responseJson).slice(0, 4000) : null };
}
log.generationLog = glog; flush();

// ---------- 文案对照：AI 返回（progress result.textFields） vs 卡面
const tf = res.textFields || {};
const norm = (k) => String(k).toLowerCase().replace(/[\s-]+/g, "");
const isHeadline = (k) => ["headline"].includes(norm(k));
const isCta = (k) => ["calltoaction", "ctatext", "cta"].includes(norm(k));
const isBrand = (k) => ["brandname"].includes(norm(k));
const shown = (v) => !!v && (card?.cardText || "").includes(String(v));
const textCompare = {
  prefix: PREFIX, jobId,
  aiReturned: { textFields: tf, textFieldCandidates: res.textFieldCandidates ?? null, applicableFields: res.applicableFields ?? null, applicableTextFields: res.applicableTextFields ?? null, logoAssetPath: res.logoAssetPath ?? null, headline: res.headline ?? null },
  cardProps: card?.props,
  cardTemplate: card?.hostComponent, cardLeafTexts: card?.templateLeafTexts,
  rows: [
    { field: "Headline", aiValue: Object.entries(tf).find(([k]) => isHeadline(k))?.[1] ?? null },
    { field: "CTA", aiValue: Object.entries(tf).find(([k]) => isCta(k))?.[1] ?? null },
    { field: "Brand Name", aiValue: Object.entries(tf).find(([k]) => isBrand(k))?.[1] ?? null },
    { field: "Logo", aiValue: res.logoAssetPath ?? null }
  ].map((r) => ({ ...r, shownOnCardText: r.field === "Logo" ? !!card?.logoImg : shown(r.aiValue), cardLogoSrc: r.field === "Logo" ? card?.logoImg : undefined })),
  cardLabelsOrPlaceholders: (card?.templateLeafTexts || []).map((x) => x.text),
  watchedWordsOnCard: ["Headline", "CTA", "Call to Action", "Shop Now", "Learn More", "Your headline here", "Your brand here", "Logo"].map((w) => ({ word: w, onCard: (card?.cardText || "").includes(w) }))
};
save(P("03-Creative文案对照.json"), textCompare);
// 🔴 evidenceType 默认按 CP-58118 当时的事实写「mock 出图」（后端 generate-creative-image 写死 mock，上线前要删 —— 见 PAGE-NOTES「需求临时备注」）。
//    mock 删除后用环境变量 EVIDENCE_TYPE 覆盖（如 "真实出图"），别让过期说明进证据。
save(P("04-出图网络摘要.json"), { evidenceType: ENV.EVIDENCE_TYPE || "mock 出图（CP-58118：后端 generate-creative-image 写死 mock，上线前删；图片内容不作证据）", submit: log.submit, final: log.final, finalResult: { textFields: tf, textFieldCandidates: res.textFieldCandidates ?? null, applicableTextFields: res.applicableTextFields, applicableFields: res.applicableFields ?? null, resultType: res.resultType, parseFailed: res.parseFailed, logoAssetPath: res.logoAssetPath, headline: res.headline, items: final?.items }, quotaBefore: log.quotaBefore, quotaAfter: log.quotaAfter, generationLog: glog });
step("done");
console.log(JSON.stringify({ jobId, final: log.final, quota: [log.quotaBefore, log.quotaAfter], tf, logo: res.logoAssetPath, card: { tpl: card?.hostComponent, leaf: card?.templateLeafTexts, logoImg: card?.logoImg, logoPh: card?.logoPlaceholder }, promptAllSame: promptCompare.allSame, frames: [log.leftFrame?.same, log.resultFrame?.same], glog: glog && { status: glog.status, keys: glog.keys } }, null, 1));
c.close(); process.exit(0);
