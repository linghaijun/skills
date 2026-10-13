// L0 并行分组开窗：一个分组一个标签页，打印 targetId 供登记（verify_state.py claim --window cdp:<port>/<targetId>）
//
//   node tab-open.mjs --list                          列出本实例全部 page（targetId + URL）
//   node tab-open.mjs --open <url> [--n 3] [--name g1,g2,g3]
//                                                     在同一实例（同一登录态）新开 N 个标签，输出 [{name,targetId,url}]
//   node tab-open.mjs --close <targetId>[,<id2>...]   关掉自己开的标签（只关登记过的，别关别人的）
//   --port 9222（或 CDP_PORT）
//
// 🔴 同一实例的标签共享 cookie 与 localStorage：
//   - 同账号只读 AC 可以并行；
//   - 会「写」持久化偏好的 AC（列配置 / KPI 卡片 / Group by 记忆 / 日期范围等存 localStorage 的）
//     互相会覆盖 → 放进同一组串行，或者换独立 --user-data-dir 的实例（见 SKILL.md §2.5）。
import { PORT, listPages } from "./conn.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };

if (process.argv.includes("--list")) {
  for (const p of await listPages()) console.log(`${p.id}  ${p.url}`);
  process.exit(0);
}
const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl); let id = 1; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } });
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
const send = (method, params = {}) => new Promise((r) => { const i = id++; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

if (arg("--close")) {
  for (const t of arg("--close").split(",")) { const r = await send("Target.closeTarget", { targetId: t }); console.log(t, r.error ? "ERR " + r.error.message : "closed"); }
} else if (arg("--open")) {
  const url = arg("--open"); const n = Number(arg("--n", 1)); const names = (arg("--name", "") || "").split(",").filter(Boolean);
  const out = [];
  for (let i = 0; i < n; i++) {
    // newWindow: true —— 独立窗口而不是同窗口标签：每个窗口都是「可见」的，不会因后台标签被节流
    const r = await send("Target.createTarget", { url, newWindow: true });
    out.push({ name: names[i] || `g${i + 1}`, targetId: r.result && r.result.targetId, url, window: `cdp:${PORT}/${r.result && r.result.targetId}` });
  }
  console.log(JSON.stringify(out, null, 1));
} else {
  console.log("usage: --list | --open <url> [--n N] [--name a,b] | --close id1,id2");
}
ws.close(); process.exit(0);
