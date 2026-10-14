// L0 连接库（给「一个脚本里多步操作」用；单次执行/截图用 cdp.mjs CLI 即可）—— 本 skill 所有新脚本的唯一标准连接层
//
//   import { connect } from "<skill>/scripts/conn.mjs";
//   const c = await connect();                 // 目标解析：--target 实参 > CDP_TARGET > --match / CDP_MATCH（默认 localhost）
//   const v = await c.ev(`document.title`);   // Runtime.evaluate（awaitPromise + returnByValue），默认 ≤30s
//   await c.click({x, y});                    // 真鼠标点击（CSS 像素）
//   await c.shot("a.png");                    // bringToFront → 截图(≤30s) → 重试 1 次 → screencast 兜底
//   const r = await c.waitStable(EXPR);       // 表达式结果连续两次逐字节一致才返回（toast / 滑入动画先停稳再截）
//   const f = await c.snapSame(EXPR, "x.png");// 截图前后各导一次 rects，不一致自动重拍；两份 rects 落盘
//   const off = c.on(msg => ...);  off();     // 订阅 / 取消订阅 CDP 事件（Network.* 等）
//   c.close();
//
// CLI 脚本想保留 --port/--target/--match/--index 旧参数：connect(cliTargetOpts()) 即可（命令行实参优先于环境变量）。
//
// 环境变量：
//   CDP_PORT          默认 9222
//   CDP_TARGET        🔴 并行时必填：本分组登记的 targetId（/json/list 的 id）；找不到直接报错，绝不退回去连别的标签
//   CDP_MATCH         不给 target 时按 URL 子串选第一个匹配的 page，默认 localhost；匹配不到报错（不再退回「第一个 page」）
//   CDP_VIEWPORT      不设 = 不碰视口；"WxH@dpr"（如 2560x1271@1.5）= 每次连接显式设定；"wide" = 3600x1300@1
//   CDP_SEND_TIMEOUT  单个 CDP 调用默认超时，默认 30000 ms（2026-10-13 起由 60s 降到 30s，见 SCRIPTS.md 坑 35）
//
// 本文件内建修掉的坑（都实测踩过，见 references/SCRIPTS.md 坑清单）：
//   1. 每个请求的超时 setTimeout 必须 unref()，否则脚本跑完还要干等到超时（坑 21，实测每次多等 2 分钟）
//   2. Emulation 覆盖不会随连接断开可靠撤销 → 要么不碰视口，要么每次连接显式设定（坑 25，CDP_VIEWPORT）
//   3. 后台标签会被节流 → 连接时就开 setFocusEmulationEnabled（必须同一条连接，坑 3）
//   4. 被遮挡窗口的 captureScreenshot 会挂满超时 → 启动带防后台参数即可直接截；最小化才临时恢复；bringToFront / screencast 只作最后兜底（坑 35、坑 50）
//   5. 兜底用的 screencast 监听用完即移除（原 sconn.mjs 每次截图兜底都新增一个监听、从不移除）
//   6. 默认 match 统一为 localhost，且匹配不到就报错（原 run-page / net-cap / real-click / vtable-scroll 默认空串 = 连第一个 page，并行时会连到别人的窗口）
//
// 显式传入的超时（c.ev(expr, 180000) / c.send(m, p, 90000)）照常生效 —— 页面内本来就要长等的脚本自己给；
// 想强制所有调用 ≤ CDP_SEND_TIMEOUT（子 agent 防看门狗），用 connect({ hardCap: true })，或直接 import sconn.mjs（= 这个开关的别名）。
import fs from "node:fs";

export const PORT = Number(process.env.CDP_PORT || 9222);
export const DEFAULT_MATCH = "localhost";
// 最小化窗口截图前恢复成什么状态：默认 maximized（启动命令带 --start-maximized），可用 CDP_RESTORE_STATE=normal 覆盖
export const RESTORE_STATE = process.env.CDP_RESTORE_STATE || "maximized";
export const SEND_TIMEOUT = Number(process.env.CDP_SEND_TIMEOUT || 30000);

// 从命令行取 --port/--target/--match/--index（只返回实际给了的项），供保留旧 CLI 参数的脚本用
export function cliTargetOpts(argv = process.argv) {
  const get = (n) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] != null && !String(argv[i + 1]).startsWith("--") ? argv[i + 1] : undefined; };
  const o = {};
  if (get("--port") != null) o.port = Number(get("--port"));
  if (get("--target") != null) o.target = get("--target");
  if (get("--match") != null) o.match = get("--match");
  if (get("--index") != null) o.index = Number(get("--index"));
  return o;
}

export async function listPages(port = PORT) {
  const t = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  return t.filter((x) => x.type === "page");
}

// 目标解析（唯一实现）：target（实参 > CDP_TARGET）> match（实参 > CDP_MATCH > localhost）的第 index 个；找不到一律抛错
export function pickPage(pages, { target, match, index = 0 } = {}) {
  const tgt = target || process.env.CDP_TARGET || "";
  if (tgt) {
    const p = pages.find((x) => x.id === tgt || x.targetId === tgt);
    if (!p) throw new Error(`target ${tgt} not found; 先 node tab-open.mjs --list（或 cdp.mjs --list）看有哪些`);
    return p;
  }
  const m = match != null && match !== "" ? match : process.env.CDP_MATCH || DEFAULT_MATCH;
  const pool = pages.filter((x) => String(x.url).includes(m));
  const p = pool[index || 0];
  if (!p) throw new Error(`no page matches "${m}" (index ${index || 0}, ${pool.length} hit); 给 --target / CDP_TARGET 或改 --match / CDP_MATCH`);
  return p;
}

export async function resolvePage(opts = {}) {
  return pickPage(await listPages(opts.port || PORT), opts);
}

export async function connect(opts = {}) {
  const { hardCap = false } = opts;
  const page = await resolvePage(opts);
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 1; const pend = new Map(); const listeners = new Set();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method) for (const fn of [...listeners]) { try { fn(m); } catch (e) { console.error("listener error " + e.message); } }
  });
  const send = (method, params = {}, to = SEND_TIMEOUT) => new Promise((res, rej) => {
    const lim = hardCap ? Math.min(to, SEND_TIMEOUT) : to;
    const i = id++; pend.set(i, { resolve: res, reject: rej });
    ws.send(JSON.stringify({ id: i, method, params }));
    setTimeout(() => { if (pend.has(i)) { pend.delete(i); rej(new Error("timeout " + method + " (" + lim + "ms)")); } }, lim).unref();
  });
  await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => {});
  const vp = process.env.CDP_VIEWPORT;
  if (vp) {
    const [w, h, dpr] = vp === "wide" ? [3600, 1300, 1] : vp.split(/[x@]/).map(Number);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: dpr || 1, mobile: false });
    await new Promise((r) => setTimeout(r, 1200));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const off = (fn) => listeners.delete(fn);
  const ev = async (expr, to = SEND_TIMEOUT) => {
    const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true }, to);
    if (r.exceptionDetails) throw new Error("PAGE EXCEPTION: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails).slice(0, 600));
    return r.result.value;
  };
  const click = async (p) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 }); };
  const key = async (k, code = k, vk = 0) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code, windowsVirtualKeyCode: vk }); };

  // 截图（2026-10-13 实测，「不打扰用户优先」，坑 50）：
  //   1. 先直接 captureScreenshot —— 被挡住 / 后台 / 最小化都能截（4 个防后台参数 + 本连接焦点模拟；最小化实测 18/18 成功，单张 0.1~3s）
  //   2. 两次都失败且窗口是最小化 → 恢复窗口（会抢焦点，无法避免）→ 截图 → 再最小化回去
  //   3. 仍失败 → bringToFront 再截 → 最后才 screencast 取帧（可能是旧帧，作证据前先核对）
  //   ✗ 不用 fromSurface:false：实测返回纯白图且不报错，比失败更危险
  const winState = async () => {
    try { const { windowId, bounds } = await send("Browser.getWindowForTarget", { targetId: page.id }, 5000); return { windowId, state: bounds.windowState }; }
    catch { return { windowId: null, state: "unknown" }; }
  };
  const capture = async (params, to) => (await send("Page.captureScreenshot", { format: "png", ...params }, to)).data;
  const shot = async (file, params = {}) => {
    const cap = Math.min(SEND_TIMEOUT, 10000);
    const save = (b64, how) => { fs.writeFileSync(file, Buffer.from(b64, "base64")); if (how) console.error(`shot via ${how} ${file}`); return file; };
    for (let i = 0; i < 2; i++) {
      try { return save(await capture(params, cap)); }
      catch (e) { console.error("shot fail " + (i + 1) + " " + e.message); }
    }
    const w = await winState();
    if (w.state === "minimized" && w.windowId != null) {
      console.error("⚠ 最小化窗口直接截图失败：临时恢复窗口（会抢焦点）。不想被打扰请把它放到其他窗口后面，别最小化");
      await send("Browser.setWindowBounds", { windowId: w.windowId, bounds: { windowState: RESTORE_STATE } }, 5000).catch(() => {});
      await sleep(600);
      try { return save(await capture(params, cap), "restore-minimized"); }
      catch (e) { console.error("shot after restore fail " + e.message); }
      finally { await send("Browser.setWindowBounds", { windowId: w.windowId, bounds: { windowState: "minimized" } }, 5000).catch(() => {}); }
    }
    try {
      await send("Page.bringToFront", {}, 10000);
      console.error("⚠ 截图降级到 bringToFront（这个 Chrome 可能没带防后台参数，见 SKILL.md §1）");
      return save(await capture(params, cap), "bringToFront");
    } catch (e) { console.error("shot after bringToFront fail " + e.message); }
    let last = null;
    const stop = on((m) => { if (m.method === "Page.screencastFrame") { last = m.params.data; send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {}); } });
    try {
      await send("Page.startScreencast", { format: "png", maxWidth: 4000, maxHeight: 3000 }).catch(() => {});
      await sleep(2500);
      await send("Page.stopScreencast").catch(() => {});
    } finally { stop(); }
    if (!last) throw new Error("shot failed (capture x2 + bringToFront + screencast no frame)");
    return save(last, "screencast（可能是旧帧，作证据前先核对）");
  };

  // 等稳定：表达式结果（JSON 化后）连续两次逐字节一致才返回；ready(v) 可再要求「提示已可见」之类的条件
  const waitStable = async (expr, { tries = 40, interval = 150, ready = () => true } = {}) => {
    let prev = null, v = null;
    for (let i = 0; i < tries; i++) {
      v = await ev(expr);
      const s = JSON.stringify(v);
      if (prev !== null && s === prev && ready(v)) return { stable: true, value: v, polls: i + 1 };
      prev = s;
      await sleep(interval);
    }
    return { stable: false, value: v, polls: tries };
  };

  // 同帧截图：先等稳定，再「rects → 截图 → rects」，不一致重拍（最多 retries 次）；两份 rects 落盘供验收核对（坑 15 / 16e）
  const snapSame = async (rectsExpr, file, { retries = 4, ready } = {}) => {
    await waitStable(rectsExpr, ready ? { ready } : {});
    let before, after, same = false;
    for (let k = 0; k < retries && !same; k++) {
      before = await ev(rectsExpr);
      await shot(file);
      after = await ev(rectsExpr);
      same = JSON.stringify(before) === JSON.stringify(after);
      if (!same) await sleep(300);
    }
    const stem = file.replace(/\.png$/i, "");
    fs.writeFileSync(stem + "-rects-before.json", JSON.stringify(before));
    fs.writeFileSync(stem + "-rects-after.json", JSON.stringify(after));
    return { same, before, after };
  };

  return { page, ws, send, ev, on, off, sleep, click, key, shot, winState, waitStable, snapSame, close: () => { try { ws.close(); } catch {} } };
}
