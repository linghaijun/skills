// L0 等页面加载结束：可见的 loading 遮罩连续 N 次都没有（默认 3 次 × 1s，最长 180s）
//
//   CDP_TARGET=<id> node wait-idle.mjs [--sel ".el-loading-mask,.pacvue-loading-mask"] [--stable 3] [--max 180]
//
// 🔴 选择器要写对遮罩本体：Pacvue 是 `.pacvue-loading-mask`（不是 `.pacvue-loading`），
//    漏了它会在列表还在转圈时就判定「加载完」，读到的是上一个日期 / 上一个分组的旧数据（实测 AC-08 首测就是这样作废的）。
// 抽屉 / 弹框里的遮罩默认不算（--include-overlay 才算）。
import { connect } from "./conn.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const SEL = arg("--sel", ".el-loading-mask,.pacvue-loading-mask,.ant-spin-spinning,.el-loading-spinner");
const STABLE = Number(arg("--stable", 3)); const MAX = Number(arg("--max", 180)); const OVERLAY = process.argv.includes("--include-overlay");
const c = await connect(); let ok = 0, i = 0;
for (; i < MAX; i++) {
  const busy = await c.ev(`[...document.querySelectorAll(${JSON.stringify(SEL)})].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).display !== 'none' && (${OVERLAY} || !e.closest('.el-dialog,.el-drawer')); })`);
  ok = busy ? 0 : ok + 1; if (ok >= STABLE) break; await c.sleep(1000);
}
console.log(i >= MAX ? `still busy after ${MAX}s` : `idle after ${i}s`); c.close(); process.exit(i >= MAX ? 1 : 0);
