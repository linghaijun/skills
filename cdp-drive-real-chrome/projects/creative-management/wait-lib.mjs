// L1 共用：等「加载遮罩消失」的统一写法（本项目 Ads / Creative 页脚本通用）
//
// 为什么有它：以前几乎每个脚本都手写一遍
//     for (let k = 0; k < 180; k++) { await c.sleep(1000); if (!(await busy()) && k > 3) break; }
//   —— 固定 1s 粒度（列表 8.2s 回来也要等到 9s），而且页面永远不 idle 时会**静默跑满 180s 然后继续**，
//   后面的读数全落在中间态。现在统一走 conn.mjs 的 waitFor：自适应轮询（前段 250ms），
//   超时**抛错并带 polls/elapsed**，不会默默往下走。
//
// 用法:
//   import { makeBusyGone, waitBusyGone } from "./wait-lib.mjs";
//   const gone = makeBusyGone(c);              // 默认跳过抽屉/弹框里的遮罩
//   await c.click(apply);
//   await waitBusyGone(gone);                  // 默认 ≈ 旧 k > 2
//   await c.click(apply);
//   await waitBusyGone(gone, { minTicks: 4 }); // ≈ 旧 k > 3
//   const gone2 = makeBusyGone(c, { overlay: true });  // 连抽屉/弹框算（旧 compare-on 行为）
//   const gone3 = makeBusyGone(c, { sel: ".pacvue-loading-mask" });  // 自定义遮罩
//
// 与旧手写循环的等价性（改动时刻意保留）:
//   · 旧循环「先 sleep 1s 再判」→ 最快 1s 才可能通过；这里 initialDelay 250ms + minTicks 拍数复刻
//     「前几拍不许通过」的语义。
//   · 旧循环超时后**继续往下执行**；这里改为抛错。确需「等不到也继续」的，显式 try/catch。

const DEFAULT_MASK = ".el-loading-mask,.pacvue-loading-mask";

/**
 * 造一个「遮罩是否还在」的等待器（表达式里带自增计数，用于复刻「前几拍不许通过」）。
 * @param {object} c         conn.mjs 的 connect() 返回值
 * @param {object} o
 * @param {string} o.sel     遮罩选择器（默认 .el-loading-mask,.pacvue-loading-mask）
 * @param {boolean} o.overlay true = 抽屉/弹框里的遮罩也算在「还在加载」内
 * @param {string} o.key     计数器键名（同页面多个等待器别重名）
 */
export function makeBusyGone(c, { sel = DEFAULT_MASK, overlay = false, key = "__cdpBusyTick" } = {}) {
  const expr = `(() => { const n = (window.${key} = (window.${key} || 0) + 1); const busy = [...document.querySelectorAll(${JSON.stringify(sel)})].some(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&getComputedStyle(e).display!=="none"${overlay ? "" : `&&!e.closest('.el-dialog,.el-drawer')`}}); return { busy, n }; })()`;
  return expr;
}

/**
 * 等遮罩消失（超时抛错）。
 * @param {object} c
 * @param {string} expr      makeBusyGone() 的返回值
 * @param {object} o
 * @param {number} o.total       总上限 ms（默认 180000 ＝ 旧 180×1s）
 * @param {number} o.minTicks    至少几拍才允许通过（默认 3；旧写法多是 k > 2）
 * @param {number} o.initialDelay 首次判定前等待 ms（默认 250）
 * @param {number} o.min/max     轮询粒度 ms（默认 250 / 500）
 * @param {string} o.label       诊断标签
 */
export async function waitBusyGone(c, expr, o = {}) {
  const { total = 180000, minTicks = 3, initialDelay = 250, min = 250, max = 500, label = "busy-gone" } = o;
  return c.waitFor(expr, {
    total, initialDelay, min, max, label,
    until: (v) => !!v && v.busy === false && v.n >= minTicks,
  });
}
