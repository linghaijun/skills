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
//
// 窗口标记（2026-10-14，取自 browser-harness 的标签标记）：--open 默认把分组名写进该标签的 sessionStorage.__cdp_mark，
// 标题变成「[g1] 原标题」—— 并行 4 个窗口时用户和 agent 一眼分清哪个是哪组；之后任何 conn.mjs 连接都会补回前缀（reload / 路由改标题也不丢）。
// 跨域跳转（如登录页）后会丢，登录回来再 `--mark <targetId> --name g1` 一次。--no-mark 关闭；只影响标签标题，不进截图。
import { PORT, listPages, connect, TAB_MARK_JS } from "./conn.mjs";
const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const NO_MARK = process.argv.includes("--no-mark");

// 等标签加载到能写 sessionStorage（http(s) 页面），写入分组名并立即改标题；返回改后的标题，失败返回 null（不影响开窗结果）
async function markTab(targetId, name) {
  let c;
  try {
    c = await connect({ target: targetId, port: PORT });
    await c.waitFor(`document.readyState === "complete" && /^https?:/.test(location.href)`, { total: 20000, min: 100, max: 400 }).catch(() => {});
    await c.ev(`(() => { const old = sessionStorage.getItem("__cdp_mark"); if (old && old !== ${JSON.stringify(name)}) sessionStorage.setItem("__cdp_mark_prev", old); sessionStorage.setItem("__cdp_mark", ${JSON.stringify(name)}); })()`);
    return await c.ev(TAB_MARK_JS);
  } catch (e) { console.error(`mark ${targetId} 失败：${e.message}`); return null; }
  finally { c?.close(); }
}

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
  if (!NO_MARK) for (const o of out) if (o.targetId) o.title = await markTab(o.targetId, o.name);
  console.log(JSON.stringify(out, null, 1));
} else if (arg("--mark")) {
  const ids = arg("--mark").split(","); const names = (arg("--name", "") || "").split(",").filter(Boolean);
  const out = [];
  for (let i = 0; i < ids.length; i++) out.push({ targetId: ids[i], name: names[i] || `g${i + 1}`, title: await markTab(ids[i], names[i] || `g${i + 1}`) });
  console.log(JSON.stringify(out, null, 1));
} else {
  console.log("usage: --list | --open <url> [--n N] [--name a,b] [--no-mark] | --mark id1,id2 --name a,b | --close id1,id2");
}
// 不能 close 完立刻 process.exit：Windows 上会撞 libuv 断言「UV_HANDLE_CLOSING」、退出码 127（2026-10-14 实测，markTab 多开了连接后出现）
ws.close(); setTimeout(() => process.exit(0), 200);
