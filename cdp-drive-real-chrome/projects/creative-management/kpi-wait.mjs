// 等 KPI 卡片出数（Impressions 不再是 0）且无 loading
//   CDP_TARGET=<id> node kpi-wait.mjs [--total 45000]
// 旧实现：45 × 1s 固定轮询；现在走 waitFor 自适应轮询（值一出数立刻返回），超时可诊断。
import { connect } from "../../scripts/conn.mjs";
import { makeBusyGone, waitBusyGone } from "./wait-lib.mjs";
const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const c = await connect();
const busyGone = makeBusyGone(c, { key: "__kpiTick" });
const KPI = `(()=>{const e=[...document.querySelectorAll('[class*=card]')].find(e=>e.getBoundingClientRect().width>0 && /^Impressions\\s/.test(e.innerText.trim())); return e? e.innerText.replace(/\\s+/g,' ').trim():null})()`;
let v = null;
try {
  const r = await c.waitFor(KPI, { total: Number(flag("--total", 45000)), min: 250, max: 600, label: "kpi-value", until: (x) => !!x && !/ 0$/.test(x) });
  v = r.value;
  await waitBusyGone(c, busyGone, { total: Number(flag("--total", 45000)), minTicks: 2, label: "kpi-idle" });
  console.log("kpi", v, JSON.stringify({ polls: r.polls, elapsedMs: r.elapsed }));
} catch (e) {
  console.log("kpi", v, JSON.stringify({ timeout: true, polls: e.polls, elapsedMs: e.elapsed }));
  process.exitCode = 1;
}
c.close();
