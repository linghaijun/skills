// L0 等页面加载结束（兼容入口）—— 2026-10-14 起**转发**到 wait-settle.mjs。
//
// 为什么转发：旧实现只看 loading 遮罩（连续 N 次没有），存在「遮罩已消失、旧列表还在屏上」的误判
//   （PAGE-NOTES 实测：只选 Amazon 后截到 Total 5116，真正加载完是 Total 4145），而且靠 1s 粒度轮询白等。
//   新实现等的是「网络静默 + DOM 静默 + 遮罩消失（+ 可选行数稳定）」，更快也更不容易给出错结论。
//
//   CDP_TARGET=<id> node wait-idle.mjs [--sel ".el-loading-mask,.pacvue-loading-mask"] [--include-overlay] [--max 180]
//
// 兼容：CLI 参数与退出码（0 就绪 / 1 超时）沿用旧约定，外部文档里的旧命令照旧可用。
//   --stable <n>（旧的「连续 N 次没遮罩」）不再直接生效 —— 新版把「稳」交给网络/DOM 静默判定；
//   ⚠️ 想要求「行数连续 N 次一致」请直接用 wait-settle.mjs --stable-rows N。
//   ⚠️ 新代码一律写 wait-settle.mjs（本文件只为旧命令不失效而留）。
import { connect, cliTargetOpts } from "./conn.mjs";
import { waitSettle } from "./wait-settle.mjs";

const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);
const OLD_SEL = ".el-loading-mask,.pacvue-loading-mask,.ant-spin-spinning,.el-loading-spinner";

let c;
try { c = await connect(cliTargetOpts()); } catch (e) { console.error("NO_PAGE_TARGET " + e.message); process.exit(2); }

const t0 = Date.now();
const r = await waitSettle(c, {
  sel: flag("--sel", OLD_SEL),
  overlay: has("--include-overlay"),
  max: Number(flag("--max", 180)) * 1000,   // 旧参数单位是秒
});
const secs = Math.round((Date.now() - t0) / 1000);
console.log(r.settled ? `idle after ${secs}s` : `still busy after ${secs}s${r.reason ? " (" + r.reason + ")" : ""}`);
c.close();
process.exit(r.settled ? 0 : 1);
