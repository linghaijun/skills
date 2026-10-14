// Creative Hub（L1 页面层）：点一次 Generate 出图，按关键帧取证（首帧 / 运行中 / 100% 停留 / 成品卡），100ms 只读采样全程。
//
//   CDP_TARGET=<id> node creativehub-gen-run.mjs <outDir> <prefix> [drawer]
//     drawer  在 Creative Generation 抽屉里（否则按整页）；结果区左边界按「Result」标题定位
//   产出：<prefix>-F1-first-frame.png / -F2-running / -F3-100pct-hold / -F4-done（各带 -rects-before/-after.json，同帧才算）、
//         <prefix>-gen-steps.json（步骤与时间）、<prefix>-gen-sampler.json（100ms 采样：百分比序列、是否单调、100% 停留样本数、日期行 …）
//   依赖：同目录 creativehub-gen-sampler.js / creativehub-gen-rects.js；连接用 L0 sconn.mjs（≤30s 超时；截图不抢前台，失败才 bringToFront）
// 🔴 会真点 Generate（消耗出图额度 / 产生生成记录）→ 写操作，每次运行前按 playbook §0 单独取得用户授权；
//    外部 AI 依赖先做「契约核对请求」再出图（playbook §2「外部 AI 依赖」），否则 422 白耗额度。
// 来源：CP-58118 AC-74/76/94/98 第 6 轮 gen6.mjs（2026-10-13），入库时改为相对引用 L0 连接库、去掉写死路径。
import { connect } from "../../scripts/sconn.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs"; import path from "node:path";
const [outDir, prefix, mode] = process.argv.slice(2);
const here = path.dirname(fileURLToPath(import.meta.url));
if (!outDir || !prefix) { console.error("用法: node creativehub-gen-run.mjs <outDir> <prefix> [drawer]"); process.exit(2); }
fs.mkdirSync(outDir, { recursive: true });
const c = await connect();
const log = []; const L = (o) => { const e = { epochMs: Date.now(), ...o }; log.push(e); console.log(JSON.stringify(e).slice(0, 400)); fs.writeFileSync(path.join(outDir, prefix + "-gen-steps.json"), JSON.stringify(log, null, 1)); };
if (mode === "drawer") await c.ev(`window.__gRoot = () => [...document.querySelectorAll('.el-drawer')].find((e) => e.getBoundingClientRect().width); window.__gSplit = () => { const d = window.__gRoot(); const r = d && [...d.querySelectorAll('*')].find((e) => (e.innerText || '').trim() === 'Result' && !e.children.length); return r ? r.getBoundingClientRect().left - 10 : 840; }; 1`);
else await c.ev(`window.__gRoot = () => document; window.__gSplit = () => 840; 1`);
L({ sampler: await c.ev(fs.readFileSync(path.join(here, "creativehub-gen-sampler.js"), "utf8")) });
const RECTS = fs.readFileSync(path.join(here, "creativehub-gen-rects.js"), "utf8");
const setClip = (on) => c.ev(on ? `(() => { const s = window.__gSplit(); const d = window.__gRoot(); const top = d === document ? 120 : Math.max(0, d.getBoundingClientRect().top); window.__gClip = { x: s - 10, y: top, width: Math.min(innerWidth - s + 10, 1100), height: innerHeight - top }; return window.__gClip; })()` : `(window.__gClip = { x: 0, y: 0, width: innerWidth, height: innerHeight }, null)`);
async function snap(name, clipOn) {
  let b, a, ok = false, t = 0; const clip = await setClip(clipOn);
  while (!ok && t < (clipOn ? 1 : 6)) {
    t++; b = await c.ev(RECTS);
    const cp = clipOn ? { format: "png", clip: { ...clip, scale: 1 } } : { format: "png" };
    // 先不抢前台直接截（防后台参数 + 焦点模拟下被挡住也能截）；失败才 bringToFront 再截（坑 50）
    const s = await c.send("Page.captureScreenshot", cp, 15000).catch(async () => { await c.send("Page.bringToFront").catch(() => {}); return c.send("Page.captureScreenshot", cp); });
    a = await c.ev(RECTS); ok = JSON.stringify({ ...b, epochMs: 0 }) === JSON.stringify({ ...a, epochMs: 0 });
    fs.writeFileSync(path.join(outDir, prefix + "-" + name + ".png"), Buffer.from(s.data, "base64"));
  }
  fs.writeFileSync(path.join(outDir, prefix + "-" + name + "-rects-before.json"), JSON.stringify({ clipCss: clip, ...b }, null, 1));
  fs.writeFileSync(path.join(outDir, prefix + "-" + name + "-rects-after.json"), JSON.stringify({ clipCss: clip, ...a }, null, 1));
  L({ snap: name, identical: ok, tries: t, date: a.date_text, pct: a.pct_text, name_: a.name_text });
}
const quota = () => c.ev(`((window.__gRoot() === document ? document.body : window.__gRoot()).innerText.match(/Quota: ?([\\d,]+)/) || [])[1]`);
L({ quotaBefore: await quota() });
const pos = await c.ev(`(() => { const b = [...window.__gRoot().querySelectorAll('button')].find((x) => x.getBoundingClientRect().width && /^Generate/.test(x.innerText.trim())); b.scrollIntoView({ block: 'nearest' }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, t: b.innerText.replace(/\\s+/g, ' '), disabled: b.disabled }; })()`);
L({ generateBtn: pos });
if (pos.disabled) { L({ abort: "disabled" }); process.exit(3); }
const tClick = Date.now(); await c.click(pos); L({ clickGenerate: tClick, clickLocal: new Date(tClick).toString() });
await snap("F1-first-frame", true);
// 帧采样用自适应轮询：旧写法固定 200ms/100ms/40ms 粒度，既可能错过瞬时态又白等
await c.waitFor(`(() => { const a = window.__gall; const r = a[a.length - 1]; return r && r.pct[0] ? parseInt(r.pct[0]) : -1; })()`,
  { total: 300000, min: 40, max: 200, label: "F2-running", until: (p) => p >= 30 && p < 99 })
  .catch(() => L({ missRunning: true }));
await snap("F2-running", false);
let hit = false; const tEnd = Date.now() + 600000;
while (Date.now() < tEnd) {
  hit = await c.ev(`(() => { const a = window.__gall; const r = a[a.length - 1]; return !!(r && r.pct.includes('100%')); })()`);
  if (hit) break;
  const done = await c.ev(`(() => { const a = window.__gall; const r = a[a.length - 1]; return a.length > 20 && !r.gen; })()`);
  if (done) break;
  await c.sleep(40);
}
if (hit) await snap("F3-100pct-hold", true); else L({ miss100: true });
await c.waitFor(`(() => { const a = window.__gall; return !a[a.length - 1].gen; })()`,
  { total: 60000, min: 60, max: 200, label: "gen-done", until: (g) => g === true })
  .catch(() => L({ missDone: true }));
await c.sleep(2500);
await snap("F4-done", false);
L({ quotaAfter: await quota() });
await c.sleep(1500);
const S = await c.ev(`({ t0: window.__gt0, all: window.__gall, chg: window.__gchg })`);
await c.ev(`clearInterval(window.__gs), 'stopped'`);
const run = S.all.filter((r) => r.gen);
const summary = { intervalMs: 100, clickEpochMs: tClick, clickLocal: new Date(tClick).toString(), samplerT0EpochMs: S.t0, sampleCountTotal: S.all.length, sampleCountWhileGenerating: run.length,
  firstGenMs: run[0] && run[0].ms, lastGenMs: run.length ? run[run.length - 1].ms : null, pctSequence: [...new Set(run.map((r) => r.pct[0]))],
  monotonic: run.every((r, i) => i === 0 || parseInt(r.pct[0]) >= parseInt(run[i - 1].pct[0])),
  stepTextSamples: S.all.filter((r) => r.step).length, maxSkel: Math.max(...S.all.map((r) => r.skel)),
  datesSeen: [...new Set(S.all.flatMap((r) => r.dates))], datesWhileGenerating: [...new Set(run.flatMap((r) => r.dates))], datesAfterDone: [...new Set(S.all.filter((r) => !r.gen && r.ms > (run.length ? run[run.length - 1].ms : 0)).flatMap((r) => r.dates))],
  samplesWithDateAfterDone: S.all.filter((r) => !r.gen && r.ms > (run.length ? run[run.length - 1].ms : 0) && r.dates.length).length,
  hold100Samples: run.filter((r) => r.pct.includes("100%")).length, btnTextsSeen: [...new Set(S.all.map((r) => r.btnText))] };
fs.writeFileSync(path.join(outDir, prefix + "-gen-sampler.json"), JSON.stringify({ summary, fullTextChanges: S.chg, samples: S.all }));
L({ summary });
c.close(); process.exit(0);
