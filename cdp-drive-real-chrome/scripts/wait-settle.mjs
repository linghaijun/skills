// L0 一次性等到「页面真的就绪」：网络静默 + DOM 静默 + 无 loading 遮罩（+ 可选行数稳定）。
//
// 为什么有它：以前靠 `await sleep(列表要 20~40s 就设 40s)` 或 wait-idle 只看遮罩，
//   前者白等（机器快时）且在机器慢时依然不够；后者会在「遮罩已消失但旧列表还在屏上」时误判
//   —— PAGE-NOTES 记过：只选 Amazon 后截到 `Total 5116`，加载完其实是 `Total 4145`。
//   本脚本等的判据是「请求停 + DOM 稳 + 遮罩没 +（可选）行数稳定」，所以又快又不会给出错结论。
//
// 用法:
//   CDP_TARGET=<id> node wait-settle.mjs                          # 默认：网络静默 500ms + DOM 静默 400ms + 遮罩消失
//   node wait-settle.mjs --idle 800 --quiet 600 --max 60000
//   node wait-settle.mjs --expect-rows 4145 --rows-sel ".surely-table-cell"   # 额外要求行数稳定/等于预期
//   node wait-settle.mjs --sel ".pacvue-loading-mask"             # 自定义遮罩选择器（默认已含 Pacvue）
//   node wait-settle.mjs --include-overlay                        # 抽屉/弹框里的遮罩也算（默认不算）
//
// 参数:
//   --port/--target/--match/--index   同 conn.mjs（🔴 并行给 --target 或 CDP_TARGET）
//   --idle <ms>     网络静默时长：最后一次 请求开始/结束 之后连续这么久没动静才算停（默认 500）
//   --quiet <ms>    DOM 静默时长：连续这么久没有 mutation（默认 400）
//   --max <ms>      总上限（默认 45000）；超时不抛错，打印 settled:false 并以退出码 1 结束
//   --min <ms>      最小等待（默认 0；用于「点了之后至少等这么久」）
//   --mask <ms>     遮罩消失的最长等待（默认 30000）
//   --rows-sel <css> 行选择器（给了才做行数判定）
//   --expect-rows <n> 预期行数（可选：给了就要求相等，否则只要求连续两次一致）
//   --stable-rows <n> 行数连续一致次数（默认 2）
//
// 退出码：0 就绪；1 超时未就绪；2 参数/连接问题。
//
// 库用法（多步脚本里别自己 sleep，直接 await）:
//   import { waitSettle } from "./wait-settle.mjs";
//   const r = await waitSettle(c, { idle: 500, quiet: 400 });
//   if (!r.settled) throw new Error("页面没就绪: " + r.reason);
import { connect, cliTargetOpts } from "./conn.mjs";

const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

const DEFAULT_SEL = ".el-loading-mask,.pacvue-loading-mask,.ant-spin-spinning,.el-loading-spinner";

/**
 * @param {object} c            conn.mjs 的 connect() 返回值
 * @param {object} o
 * @param {number} o.idle       网络静默 ms
 * @param {number} o.quiet      DOM 静默 ms
 * @param {number} o.max        总上限 ms
 * @param {number} o.min        最小等待 ms
 * @param {number} o.mask       遮罩消失最长等待 ms
 * @param {string} o.sel        遮罩选择器
 * @param {boolean} o.overlay   是否计入抽屉/弹框内的遮罩
 * @param {string} o.rowsSel    行选择器（空则不做行数判定）
 * @param {number} o.expectRows 预期行数（0 = 不校验，只要求稳定）
 * @param {number} o.stableRows 行数稳定次数
 * @returns {Promise<{settled:boolean,reason?:string,elapsed:number,net?:object,mask?:object,rows?:object}>}
 */
export async function waitSettle(c, o = {}) {
  const idle = Number(o.idle ?? 500);
  const quiet = Number(o.quiet ?? 400);
  const max = Number(o.max ?? 45000);
  const min = Number(o.min ?? 0);
  const maskMax = Number(o.mask ?? 30000);
  const sel = o.sel || DEFAULT_SEL;
  const overlay = !!o.overlay;
  const rowsSel = o.rowsSel || "";
  const expectRows = Number(o.expectRows ?? 0);
  const stableRows = Number(o.stableRows ?? 2);
  const t0 = Date.now();
  const out = { settled: false, elapsed: 0 };

  // ① 网络 + DOM 静默（事件驱动，不猜时长）
  const net = await c.settle({ idleMs: idle, quietMs: quiet, max: Math.max(1000, max - (Date.now() - t0)), minWaitMs: 0 });
  out.net = net;
  if (!net.settled) { out.reason = net.reason || "net-unsettled"; out.elapsed = Date.now() - t0; return out; }
  if (Date.now() - t0 >= max) { out.reason = "max-reached-after-net"; out.elapsed = Date.now() - t0; return out; }

  // ② 遮罩消失（页面内轮询，抓「连续两次没有」）
  const busyExpr = `(() => { const S = ${JSON.stringify(sel)}; const es = [...document.querySelectorAll(S)]; return es.some((e) => { const r = e.getBoundingClientRect(); if (!(r.width > 0 && r.height > 0)) return false; if (getComputedStyle(e).display === "none") return false; return ${overlay} || !e.closest(".el-dialog,.el-drawer"); }); })()`;
  const maskT0 = Date.now();
  let masc = { ok: true };
  try {
    await c.waitFor(busyExpr, { total: maskMax, until: (v) => v === false, min: 80, max: 300, label: "mask-gone" });
  } catch (e) {
    masc = { ok: false, reason: "still-busy", elapsed: Date.now() - maskT0, polls: e.polls };
  }
  out.mask = masc;
  if (!masc.ok) { out.reason = "still-busy"; out.elapsed = Date.now() - t0; return out; }

  // ③ 可选：行数稳定（防「遮罩没了但列表还在替换」）
  if (rowsSel) {
    const countExpr = `document.querySelectorAll(${JSON.stringify(rowsSel)}).length`;
    let last = null, same = 0, got = null;
    try {
      const r = await c.waitFor(countExpr, {
        total: Math.max(500, max - (Date.now() - t0)),
        until: (v) => {
          got = v;
          if (expectRows > 0) return v === expectRows;
          if (v === last) same++; else { same = 1; last = v; }
          return same >= stableRows && v > 0;
        },
        min: 60, max: 250, label: "rows-stable",
      });
      out.rows = { count: got, expect: expectRows || null, ok: true, polls: r.polls };
    } catch (e) {
      out.rows = { count: got, expect: expectRows || null, ok: false, polls: e.polls };
      out.reason = expectRows > 0 ? `rows!=${expectRows}` : "rows-unstable";
      out.elapsed = Date.now() - t0;
      return out;
    }
  }

  out.settled = true;
  out.elapsed = Date.now() - t0;
  return out;
}

// ---------- CLI ----------
const isMain = process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("/wait-settle.mjs");
if (isMain) {
  let c;
  try { c = await connect(cliTargetOpts()); } catch (e) { console.error("NO_PAGE_TARGET " + e.message); process.exit(2); }
  const r = await waitSettle(c, {
    idle: Number(flag("--idle", 500)), quiet: Number(flag("--quiet", 400)),
    max: Number(flag("--max", 45000)), min: Number(flag("--min", 0)), mask: Number(flag("--mask", 30000)),
    sel: flag("--sel", ""), overlay: has("--include-overlay"),
    rowsSel: flag("--rows-sel", ""), expectRows: Number(flag("--expect-rows", 0)), stableRows: Number(flag("--stable-rows", 2)),
  });
  console.log(JSON.stringify({
    settled: r.settled, reason: r.reason || null, elapsedMs: r.elapsed,
    net: r.net ? { settled: r.net.settled, elapsed: r.net.elapsed, pending: r.net.pending } : null,
    mask: r.mask || null, rows: r.rows || null,
  }, null, 1));
  c.close();
  process.exit(r.settled ? 0 : 1);
}
