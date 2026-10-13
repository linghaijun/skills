// L0 连接库（给「一个脚本里多步操作」用；单次执行/截图用 cdp.mjs CLI 即可）
//
//   import { connect } from "<skill>/scripts/conn.mjs";
//   const c = await connect();                 // 按 CDP_TARGET 锁定标签页
//   const v = await c.ev(`document.title`);   // Runtime.evaluate（awaitPromise + returnByValue）
//   await c.click({x, y});                    // 真鼠标点击（CSS 像素）
//   await c.shot("a.png");                    // 截图
//   c.on(msg => ...)                          // 订阅 CDP 事件（Network.* 等）
//   c.close();
//
// 环境变量：
//   CDP_PORT      默认 9222
//   CDP_TARGET    🔴 并行时必填：本分组登记的 targetId（/json/list 的 id）。不填则取第一个 URL 含 CDP_MATCH 的 page
//   CDP_MATCH     默认 localhost
//   CDP_VIEWPORT  不设 = 不碰视口；"WxH@dpr"（如 2560x1271@1.5）= 每次连接显式设定；"wide" = 3600x1300@1
//
// 本文件内建修掉的坑（都实测踩过，见 references/SCRIPTS.md 坑清单）：
//   1. 每个请求的超时 setTimeout 必须 unref()，否则脚本跑完还要干等到超时（实测每次多等 2 分钟）
//   2. Emulation 覆盖不会随连接断开可靠撤销，别的会话留下的覆盖用 clear 也清不掉
//      → 要么完全不碰视口，要么每次连接都显式设成确定值（CDP_VIEWPORT）
//   3. 后台标签会被节流 → 连接时就开 setFocusEmulationEnabled（必须同一条连接）
export const PORT = Number(process.env.CDP_PORT || 9222);

export async function listPages() {
  const t = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  return t.filter((x) => x.type === "page");
}

export async function connect({ target = process.env.CDP_TARGET, match = process.env.CDP_MATCH || "localhost" } = {}) {
  const pages = await listPages();
  const page = target ? pages.find((p) => p.id === target) : pages.find((p) => String(p.url).includes(match));
  if (!page) throw new Error(`page not found (target=${target || "-"} match=${match}); 先 node tab-open.mjs --list`);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1; const pend = new Map(); const listeners = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method) listeners.forEach((fn) => fn(m));
  });
  const send = (method, params = {}, to = 60000) => new Promise((res, rej) => {
    const i = id++; pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error("timeout " + method)); } }, to).unref();
  });
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  const vp = process.env.CDP_VIEWPORT;
  if (vp) {
    const [w, h, dpr] = vp === "wide" ? [3600, 1300, 1] : vp.split(/[x@]/).map(Number);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr || 1, mobile: false });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const ev = async (expr, to = 60000) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, to);
    if (r.exceptionDetails) throw new Error("PAGE EXCEPTION: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const click = async (p) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 }); };
  const key = async (k, code = k, vk = 0) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); };
  const shot = async (file) => { const fs = await import("node:fs"); const s = await send("Page.captureScreenshot", { format: "png" }, 60000); fs.writeFileSync(file, Buffer.from(s.data, "base64")); return file; };
  return { page, ws, send, ev, on: (fn) => listeners.push(fn), sleep, click, key, shot, close: () => ws.close() };
}
