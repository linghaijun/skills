// 多 context 隔离：自检 + 可复用骨架
//
// 用途一（自检）：直接跑，验证当前 Chrome 实例能否用 browserContext 隔离 cookie
//   node ctx-isolate.mjs [--port 9222]
//   预期输出 A=ADMIN / B=VIEWER 互不可见，即隔离生效
//
// 用途二（骨架）：把 mk()/ev() 抄进你的脚本，做多账号并行
//   坑1: 所有调用必须带 sessionId，漏带会打到默认 context
//   坑2: createTarget 后必须轮询 location.href 到目标域，不能 setTimeout 等固定时长
//   坑3: disposeBrowserContext 即丢登录态 —— 需要人工登录的场景请改用多实例(A 方案)
const _i = process.argv.indexOf("--port");
const PORT = Number(_i >= 0 && process.argv[_i+1] ? process.argv[_i+1] : (process.env.CDP_PORT || 9222));
const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
const ws = new WebSocket(v.webSocketDebuggerUrl);
let id = 1; const pend = new Map();
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { const {res, rej} = pend.get(m.id); pend.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); }
});
const send = (method, params={}, sessionId) => new Promise((res, rej) => {
  const i = id++; pend.set(i, {res, rej});
  ws.send(JSON.stringify({id: i, method, params, ...(sessionId ? {sessionId} : {})}));
  setTimeout(() => pend.has(i) && (pend.delete(i), rej(new Error("timeout "+method))), 20000);
});
await new Promise(r => ws.addEventListener("open", r, {once:true}));

let ctxA, ctxB, tA, tB;
const ev = async (s, expr) => {
  const r = await send("Runtime.evaluate", {expression: expr, returnByValue: true, awaitPromise: true}, s);
  if (r.exceptionDetails) return "EXC: " + r.exceptionDetails.text;
  return r.result?.value;
};
try {
  ({browserContextId: ctxA} = await send("Target.createBrowserContext"));
  ({browserContextId: ctxB} = await send("Target.createBrowserContext"));
  const mk = async (ctx) => {
    const {targetId} = await send("Target.createTarget", {url: "about:blank", browserContextId: ctx});
    const {sessionId} = await send("Target.attachToTarget", {targetId, flatten: true});
    await send("Page.enable", {}, sessionId);
    await send("Runtime.enable", {}, sessionId);
    await send("Page.navigate", {url: "https://example.com"}, sessionId);
    for (let i = 0; i < 30; i++) {           // 轮询到真正落在 example.com
      await new Promise(r => setTimeout(r, 500));
      const u = await ev(sessionId, "location.href");
      if (typeof u === "string" && u.includes("example.com")) return {targetId, sessionId, url: u};
    }
    return {targetId, sessionId, url: await ev(sessionId, "location.href")};
  };
  tA = await mk(ctxA); tB = await mk(ctxB);
  console.log("A 落地 URL:", tA.url, "| B 落地 URL:", tB.url);

  console.log("A set:", await ev(tA.sessionId, "document.cookie='acct=ADMIN; path=/'; document.cookie"));
  console.log("B set:", await ev(tB.sessionId, "document.cookie='acct=VIEWER; path=/'; document.cookie"));
  console.log("--- 交叉复核 ---");
  console.log("A 再读:", await ev(tA.sessionId, "document.cookie"));
  console.log("B 再读:", await ev(tB.sessionId, "document.cookie"));
} catch (e) { console.log("失败:", e.message); }
finally {
  for (const t of [tA, tB]) if (t) await send("Target.closeTarget", {targetId: t.targetId}).catch(()=>{});
  for (const c of [ctxA, ctxB]) if (c) await send("Target.disposeBrowserContext", {browserContextId: c}).catch(()=>{});
  console.log("已清理 context 与 target");
  ws.close();
}
