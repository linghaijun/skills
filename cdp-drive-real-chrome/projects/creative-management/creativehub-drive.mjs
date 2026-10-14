// Creative Hub 图片生成页（L1 页面层）多步驱动库：在 L0 sconn.mjs 之上加「核对落点的点击 / 悬停 / 同帧截图 / 网络记录 / Ad Type 树选择」。
//
//   import { open, R, pickAdType, evDir, save, netSummary } from "<skill>/projects/creative-management/creativehub-drive.mjs";
//   const c = await open();                         // CDP_TARGET=<id>；不抢前台（坑 50）
//   await c.clickEl(R.genBtn);                      // 先 elementFromPoint 核对落点，对不上抛错（force 才跳过）
//   const f = await c.frame(dir, "AC-NN-r1-01", { editor: R.editor });   // 截图前后各导 rects，f.same 为 true 才算同帧
//   await pickAdType(c, "Others", "Others");        // Ad Type 树：打开 → 搜索 → 点可见叶子（下拉是虚拟滚动，搜索比滚动稳）
//   const s = await c.state();                      // 宿主 setupState 摘要（creativehub-find.js + creativehub-state.js）
//
// 环境变量：REQ_DIR = 需求目录（docs/develop/<Sprint>-<id>-<title>）—— 只有 evDir() / rDir() 需要；不给则这两个函数报错。
// 来源：CP-58118 g2 组 g2.mjs（2026-10-13）；入库时去掉写死的 scratchpad / 需求路径，连接换 sconn.mjs。
import { connect } from "../../scripts/sconn.mjs";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const reqDir = () => {
  const d = process.env.REQ_DIR;
  if (!d || !fs.existsSync(d)) throw new Error("REQ_DIR 未设置或不存在（应指向 docs/develop/<需求目录>）");
  return d;
};
export const evDir = (ac) => {
  const d = path.join(reqDir(), "tests", ac, "evidence", "browser");
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const FIND = fs.readFileSync(path.join(HERE, "creativehub-find.js"), "utf8");
const STATE = fs.readFileSync(path.join(HERE, "creativehub-state.js"), "utf8");

export async function open() {
  const c = await connect();
  // 不再连接即 bringToFront（会抢用户焦点）：Chrome 带防后台参数启动后被挡住也照常渲染；最小化由 c.shot 处理（坑 50）
  c.find = () => c.ev(FIND);
  c.state = async () => {
    await c.ev(FIND);
    return c.ev(STATE);
  };
  // 返回元素中心（核对落点）。expr 为返回元素的表达式
  c.center = async (expr) =>
    c.ev(`(() => { const el = (${expr}); if (!el) return null; el.scrollIntoView({block:'nearest'}); const r = el.getBoundingClientRect();
      const x = r.left + r.width/2, y = r.top + r.height/2; const hit = document.elementFromPoint(x, y);
      return { x, y, ok: !!hit && (hit === el || el.contains(hit) || hit.contains(el)), hit: hit ? hit.tagName + '.' + hit.className : null }; })()`);
  c.clickEl = async (expr, { force = false } = {}) => {
    const p = await c.center(expr);
    if (!p) throw new Error("clickEl: not found " + expr);
    if (!p.ok && !force) throw new Error("clickEl: hit mismatch " + JSON.stringify(p));
    await c.click(p);
    return p;
  };
  c.hoverEl = async (expr) => {
    const p = await c.center(expr);
    if (!p) throw new Error("hoverEl: not found " + expr);
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x - 1, y: p.y - 1 });
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
    return p;
  };
  c.mouseAway = async () => c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1500, y: 900 });
  // 可见 tooltip 文本 + 矩形
  c.tooltips = async () =>
    c.ev(`[...document.querySelectorAll('.el-popper')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width>0 && cs.display!=='none' && cs.visibility!=='hidden' && e.getAttribute('aria-hidden')!=='true'; }).map(e => { const r = e.getBoundingClientRect(); return { text: e.innerText.trim(), rect: [r.left, r.top, r.right, r.bottom] }; })`);
  // rects: { lab: expr返回元素 } → 截图像素坐标
  c.rects = async (map) => {
    const body = Object.entries(map)
      .map(([k, e]) => `try { const el = (${e}); if (el) { const r = el.getBoundingClientRect(); out[${JSON.stringify(k)}] = [r.left*d, r.top*d, r.right*d, r.bottom*d].map(Math.round); } } catch(_){}`)
      .join("\n");
    return c.ev(`(() => { const d = devicePixelRatio; const out = {}; ${body}; return out; })()`);
  };
  // 同帧截图：截图前后各导一次 rects，一致才返回 ok
  c.frame = async (dir, base, map) => {
    const r1 = await c.rects(map);
    await c.shot(path.join(dir, `${base}-raw.png`));
    const r2 = await c.rects(map);
    fs.writeFileSync(path.join(dir, `${base}-rects-before.json`), JSON.stringify(r1));
    fs.writeFileSync(path.join(dir, `${base}-rects-after.json`), JSON.stringify(r2));
    const same = JSON.stringify(r1) === JSON.stringify(r2);
    return { same, rects: r1 };
  };
  // 往 Prompt 编辑器真输入
  c.typePrompt = async (text) => {
    await c.clickEl(`document.querySelector('.prompt-editor')`, { force: true });
    await c.send("Input.insertText", { text });
  };
  c.selectAllDelete = async () => {
    await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
    await c.key("Backspace", "Backspace", 8);
  };
  // 网络记录：全部请求 url/method/status；匹配 bodyRe 的取请求体与响应体
  c.netStart = async (bodyRe = /ai-task|ad-type\/specs/) => {
    const reqs = new Map();
    c.net = reqs;
    await c.send("Network.enable", { maxPostDataSize: 65536 });
    c.on(async (m) => {
      if (m.method === "Network.requestWillBeSent") {
        const r = m.params.request;
        reqs.set(m.params.requestId, { t: Date.now(), url: r.url, method: r.method, postData: r.postData || null, type: m.params.type });
      } else if (m.method === "Network.responseReceived") {
        const e = reqs.get(m.params.requestId);
        if (e) e.status = m.params.response.status;
      } else if (m.method === "Network.loadingFinished") {
        const e = reqs.get(m.params.requestId);
        if (e && bodyRe.test(e.url)) {
          try { const b = await c.send("Network.getResponseBody", { requestId: m.params.requestId }); e.body = b.body.slice(0, c.bodyMax || 20000); } catch (_) {}
        }
      }
    });
  };
  c.netList = () => [...(c.net || new Map()).values()];
  c.scrollSetting = async (expr, block = "center") =>
    c.ev(`(() => { const el = (${expr}); if (el) el.scrollIntoView({ block: '${block}' }); return !!el; })()`);
  c.waitFor = async (fn, { timeout = 60000, every = 500 } = {}) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const s = await c.state();
      if (fn(s)) return s;
      await c.sleep(every);
    }
    throw new Error("waitFor timeout");
  };
  return c;
}

// 常用元素表达式
const lbl = (t) => `[...document.querySelectorAll('div')].find(e => e.childElementCount === 0 && e.innerText.trim() === '${t}')`;
export const R = {
  adType: `(${lbl("Ad Type")} || document.body).parentElement`,
  adTypeSel: `[...document.querySelectorAll('.el-select, .el-tree-select, [class*=select]')].find(e => /Amazon|Walmart|Others|Instacart|Criteo|Target|ADSP|Tiktok/.test(e.innerText) && e.getBoundingClientRect().top > 200 && e.getBoundingClientRect().height < 60)`,
  styleType: `${lbl("Style Type")}.parentElement`,
  spBlock: `document.querySelector('.selling-point-grid')?.parentElement`,
  spGrid: `document.querySelector('.selling-point-grid')`,
  spActive: `document.querySelector('.selling-point-grid .ai-option.is-active')`,
  spCustom: `[...document.querySelectorAll('.selling-point-grid .ai-option')].find(b => b.innerText.trim() === 'Custom')`,
  sp: (name) => `[...document.querySelectorAll('.selling-point-grid .ai-option')].find(b => b.innerText.trim() === '${name}')`,
  conceptBlock: `(${lbl("Concept")})?.parentElement`,
  promptHead: `document.querySelector('.prompt-count')?.parentElement?.parentElement`,
  promptBox: `document.querySelector('.prompt-box')`,
  editor: `document.querySelector('.prompt-editor')`,
  count: `document.querySelector('.prompt-count')`,
  overTip: `document.querySelector('.prompt-over-tip')`,
  optBtn: `document.querySelector('.optimize-btn')`,
  optWrap: `document.querySelector('.optimize-btn')?.parentElement`,
  genBtn: `document.querySelector('.generate-btn')`,
  lockLayer: `document.querySelector('.prompt-locked-overlay')`,
  pdInput: `document.querySelector('.pd-input')`,
  pdBlock: `document.querySelector('.pd-input')?.parentElement`,
  refArea: `document.querySelector('.prompt-reference')`,
  tip: `[...document.querySelectorAll('.el-popper')].filter(e => e.getBoundingClientRect().width>0 && getComputedStyle(e).display!=='none' && e.getAttribute('aria-hidden')!=='true').pop()`,
  msg: `[...document.querySelectorAll('.el-message, .pacvue-message, [class*=message]')].filter(e => e.getBoundingClientRect().width>0 && /Optimize failed|failed/i.test(e.innerText)).pop()`,
  // Prompt 编辑器内以 prefix 开头的那一行（文本节点 Range）
  line: (prefix) => `(() => { const ed = document.querySelector('.prompt-editor'); const w = document.createTreeWalker(ed, NodeFilter.SHOW_TEXT); let n; const NL = String.fromCharCode(10); while ((n = w.nextNode())) { const s = n.textContent; let i = s.startsWith(${JSON.stringify(prefix)}) ? 0 : s.indexOf(NL + ${JSON.stringify(prefix)}); if (i < 0) continue; if (i > 0 || s[0] === NL) i += 1; let j = s.indexOf(NL, i); if (j < 0) j = s.length; const rg = document.createRange(); rg.setStart(n, i); rg.setEnd(n, j); return { getBoundingClientRect: () => { const rs = [...rg.getClientRects()].filter(r => r.width > 0); const l = Math.min(...rs.map(r=>r.left)), t = Math.min(...rs.map(r=>r.top)), r2 = Math.max(...rs.map(r=>r.right)), b = Math.max(...rs.map(r=>r.bottom)); return { left: l, top: t, right: r2, bottom: b }; } }; } return null; })()`
};

export function netSummary(list, re = /ai-task|ad-type\/specs/) {
  return list
    .filter((e) => re.test(e.url))
    .map((e) => {
      let body = null;
      try { const j = JSON.parse(e.body || "null"); body = j; } catch (_) { body = e.body ? String(e.body).slice(0, 300) : null; }
      let post = null;
      try { post = e.postData ? JSON.parse(e.postData) : null; } catch (_) { post = e.postData; }
      return { t: e.t, method: e.method, url: e.url.replace(/^https?:\/\/[^/]+/, ""), status: e.status, req: post, resp: body };
    });
}

export function save(file, obj) {
  fs.writeFileSync(file, typeof obj === "string" ? obj : JSON.stringify(obj, null, 1));
}

export const rDir = (r) => {
  const d = path.join(reqDir(), "tests", "regression", r);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// Ad Type 树选择：打开下拉 → 搜索框输入 → 点可见的叶子文本（最后一个匹配）
export async function pickAdType(c, search, leaf) {
  const isOpen = () => c.ev(`!![...document.querySelectorAll('.el-popper input')].find(i => i.getBoundingClientRect().width > 0)`);
  if (!(await isOpen())) await c.clickEl(`[...document.querySelectorAll('.el-select,.el-tree-select,[class*=select]')].find(e => /Amazon|Walmart|Others|Instacart|Criteo|Target|ADSP|Tiktok|Kroger|Chewy|Sam|Please|ChatGPT/.test(e.innerText) && e.getBoundingClientRect().height < 60 && e.getBoundingClientRect().height > 20 && e.getBoundingClientRect().left < 820)`);
  await c.sleep(800);
  for (let i = 0; i < 10 && !(await isOpen()); i++) await c.sleep(300);
  await c.clickEl(`[...document.querySelectorAll('.el-popper input')].find(i => i.getBoundingClientRect().width > 0)`, { force: true });
  await c.send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", modifiers: 2, windowsVirtualKeyCode: 65 });
  await c.send("Input.insertText", { text: search });
  await c.sleep(1200);
  const tree = await c.ev(`[...document.querySelectorAll('.el-popper')].filter(e => e.getBoundingClientRect().width > 0).map(e => e.innerText).join(' | ')`);
  await c.clickEl(`[...document.querySelectorAll('.el-popper *')].filter(e => e.childElementCount === 0 && e.innerText && e.innerText.trim() === ${JSON.stringify(leaf)} && e.getBoundingClientRect().width > 0).pop()`);
  await c.sleep(2500);
  return tree;
}
