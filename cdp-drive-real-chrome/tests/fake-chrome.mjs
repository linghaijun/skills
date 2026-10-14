// Offline test harness: a fake Chrome CDP server used to regression-test
// cdp-drive-real-chrome's connection library and wait semantics without a real browser.
//
// Minimal surface implemented:
//   GET  /json/list                 -> one page target (webSocketDebuggerUrl points at this process)
//   WS   Runtime.evaluate           -> evaluated in a minimal DOM shim (supports await / async IIFE)
//   WS   Page.captureScreenshot     -> returns a 1x1 PNG
//   WS   Network.enable + events    -> controllable "slow request": requestWillBeSent, then loadingFinished after N ms
//   WS   Browser.getWindowForTarget / Page.bringToFront / Emulation.* -> no-ops
//
// Key point: the slow request is a real event (not a page-side setTimeout), so it can verify that
// an event-driven settle keeps waiting until loadingFinished and does not return before DOM quiet.
//
// Usage:
//   node fake-chrome.mjs --port <port> --net-delay <ms> [--mutate] [--no-response]
//   -> prints one JSON line on stdout: {"ws":"<target ws url>","http":"<http base>"}
import http from "node:http";
import crypto from "node:crypto";
import vm from "node:vm";

// ---------- minimal WebSocket server (RFC6455 text frames; enough for CDP, no third-party dep) ----------
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
function attachWs(server, onConnection) {
  server.on("upgrade", (req, socket) => {
    const key = req.headers["sec-websocket-key"];
    const accept = crypto.createHash("sha1").update(key + GUID).digest("base64");
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\nConnection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
    );
    let buf = Buffer.alloc(0);
    const handlers = { message: [], close: [] };
    const api = {
      send(text) {
        const payload = Buffer.from(text, "utf8");
        const len = payload.length;
        let header;
        if (len < 126) { header = Buffer.from([0x81, len]); }
        else if (len < 65536) { header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(len, 2); }
        else { header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(len), 2); }
        try { socket.write(Buffer.concat([header, payload])); } catch {}
      },
      on(evt, fn) { (handlers[evt] ||= []).push(fn); },
      close() { try { socket.end(); } catch {} },
    };
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const opcode = buf[0] & 0x0f;
        const masked = (buf[1] & 0x80) !== 0;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        const maskLen = masked ? 4 : 0;
        if (buf.length < off + maskLen + len) return;
        let payload = buf.subarray(off + maskLen, off + maskLen + len);
        if (masked) {
          const mask = buf.subarray(off, off + 4);
          payload = Buffer.from(payload.map((b, i) => b ^ mask[i % 4]));
        }
        buf = buf.subarray(off + maskLen + len);
        if (opcode === 0x8) { handlers.close.forEach((f) => f()); try { socket.end(); } catch {} return; }
        if (opcode === 0x1) handlers.message.forEach((f) => f(payload.toString("utf8")));
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => handlers.close.forEach((f) => f()));
    onConnection(api);
  });
}

const flag = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const has = (n) => process.argv.includes(n);

const PORT = Number(flag("--port", 0));
const NET_DELAY = Number(flag("--net-delay", 1000));
const MUTATE = has("--mutate");
const NO_RESPONSE = has("--no-response");
const SET_TEXT = flag("--set-text", "");   // after the response, set document.body text (simulates Total appearing)
const TABLE_ROWS = Number(flag("--table-rows", 0));
const ROW_H = Number(flag("--row-h", 40));
const RENDER_ALL = process.argv.includes("--render-all");   // render every row at once (bypass scrolling)

// ---------- minimal DOM shim ----------
const domState = { active: null };   // document.activeElement（focus() 写入；Input.insertText / dispatchKeyEvent 作用于它）
function makeDom() {
  const mk = (tag, opts = {}) => {
    const el = {
      tagName: String(tag).toUpperCase(),
      _cls: new Set(String(opts.className || "").split(/\s+/).filter(Boolean)),
      id: opts.id || "",
      children: [],
      parentElement: null,
      attributes: {},
      style: {},
      _text: opts.text || "",
      _rect: opts.rect || null,
      get className() { return [...this._cls].join(" "); },
      set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); },
      get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
      set textContent(v) { this._text = String(v); this.children = []; },
      get innerText() { return this.textContent; },
      get scrollHeight() { return this._scrollHeight ?? 0; },
      set scrollHeight(v) { this._scrollHeight = v; },
      get clientHeight() { return this._clientHeight ?? 0; },
      set clientHeight(v) { this._clientHeight = v; },
      get scrollTop() { return this._scrollTop ?? 0; },
      set scrollTop(v) { this._scrollTop = v; },
      appendChild(c) { c.parentElement = this; this.children.push(c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); return c; },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      addEventListener() {}, removeEventListener() {},
      getBoundingClientRect() {
        const r = this._rect || { x: 0, y: 0, width: 0, height: 0 };
        return { x: r.x, y: r.y, left: r.x, top: r.y, width: r.width, height: r.height, right: r.x + r.width, bottom: r.y + r.height };
      },
      querySelectorAll(sel) { return walk(this).filter((e) => matches(e, sel)); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      scrollIntoView() {}, focus() { domState.active = this; }, blur() {}, select() { this._selAll = true; }, click() {},
      matches(sel) { return matches(this, sel); },
      hasAttribute(k) { return k in this.attributes; },
      dispatchEvent() { return true; },
      get isConnected() { return true; },
      getClientRects() { return [this.getBoundingClientRect()]; },
      closest(sel) { let c = this; while (c) { if (matches(c, sel)) return c; c = c.parentElement; } return null; },
      contains(e) { return e === this || walk(this).includes(e); },
    };
    return el;
  };
  const walk = (root) => root.children.flatMap((c) => [c, ...walk(c)]);
  // selector support: .cls / #id / tag / comma-separated / [class*=x]
  const one = (e, sel) => {
    sel = sel.trim();
    if (sel === "*") return true;
    if (sel.startsWith(".")) return e._cls.has(sel.slice(1));
    if (sel.startsWith("#")) return e.id === sel.slice(1);
    if (sel.startsWith("[class*=")) return e.className.includes(sel.slice(9, -2));
    return e.tagName === sel.toUpperCase();
  };
  const matches = (e, sel) => sel.split(",").some((s) => one(e, s));

  const html = mk("html");
  const body = mk("body");
  html.appendChild(body);
  const document = {
    body, documentElement: html,
    _byId: new Map(), _els: [body],
    createElement: (t) => mk(t),
    querySelectorAll(sel) { return [body, ...walk(body)].filter((e) => matches(e, sel)); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    getElementById(id) { return this.querySelector("#" + id); },
    addEventListener() {}, removeEventListener() {},
    title: "fake",
    readyState: "complete",
    get activeElement() { return domState.active || body; },
    // 最上层 = 文档顺序里最后一个包含该点、且 display 不是 none 的元素（够测遮挡判定）
    elementFromPoint(x, y) {
      let top = null;
      for (const e of [body, ...walk(body)]) {
        const r = e._rect; if (!r || e.style.display === "none") continue;
        if (x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height) top = e;
      }
      return top;
    },
  };
  return { document, body, walk, matches };
}

function makeSandbox(dom) {
  const { document } = dom;
  const sandbox = {
    document,
    window: {},
    navigator: { userAgent: "fake-chrome" },
    location: { href: "http://localhost:3001/crossretailer/CreativeManagement/Creative", hostname: "localhost" },
    console: { log() {}, warn() {}, error() {} },
    getComputedStyle: (e) => ({ display: e.style.display || "block", overflowY: e.style.overflowY || "visible", opacity: e.style.opacity || "1" }),
    innerWidth: 1600, innerHeight: 900, devicePixelRatio: 1,
    scrollTo() {}, scrollBy() {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: (fn) => setTimeout(() => fn(Date.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    MutationObserver: class { constructor(cb) { this.cb = cb; } observe() { observers.push(this); } disconnect() { const i = observers.indexOf(this); if (i >= 0) observers.splice(i, 1); } },
    ResizeObserver: class { observe() {} disconnect() {} },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({}) }),
    JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Set, Map, Promise, Error, parseInt, parseFloat, isNaN,
    Event: class { constructor(type, o = {}) { this.type = type; this.bubbles = !!o.bubbles; } },
    __mouse: [],   // 收到的 Input.dispatchMouseEvent 类型序列（测试读它判断「点没点」）
    __dom: dom,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  document.location = sandbox.location;
  document.defaultView = sandbox;
  return sandbox;
}

const observers = [];
function notifyMutation() { for (const o of [...observers]) { try { o.cb([{ type: "childList" }], o); } catch {} } }

// ---------- CDP server ----------
const dom = makeDom();
const sandbox = makeSandbox(dom);
const ctx = vm.createContext(sandbox);

// Optional: preset initial page state (for scripts that read the DOM, e.g. verify-export)
//   --total-text "Total4145entries,50/page"   preset .page-total text (inside the first child element, like the real page)
//   --total-sel  ".page-total"                custom selector for that element
const TOTAL_TEXT = flag("--total-text", "");
const TOTAL_SEL = flag("--total-sel", ".page-total");
if (TOTAL_TEXT) {
  const outer = dom.document.createElement("span");
  outer.className = TOTAL_SEL.replace(/^\./, "");
  const inner = dom.document.createElement("span");
  inner.textContent = TOTAL_TEXT;
  outer.appendChild(inner);
  dom.body.appendChild(outer);
}

// Optional: minimal "Ads page" DOM for regression-testing the shared L1 wait logic.
//   --ads-page          add search input / Search button / loading mask / group-by label / Total
//   --mask-ms 1200      show the loading mask for this long, then hide it (verifies waitBusyGone really waits)
if (process.argv.includes("--ads-page")) {
  const mask = dom.document.createElement("div");
  mask.className = "pacvue-loading-mask";
  mask.style.display = "none";
  mask._rect = { x: 0, y: 0, width: 800, height: 600 };
  dom.body.appendChild(mask);
  const maskMs = Number(flag("--mask-ms", 0));
  if (maskMs > 0) {
    mask.style.display = "block";
    setTimeout(() => { mask.style.display = "none"; notifyMutation(); }, maskMs);
  }

  const input = dom.document.createElement("input");
  input.placeholder = "Search Ad/Creative Name";
  input.value = "";
  input.offsetParent = dom.body;          // page scripts filter by i.offsetParent
  input._rect = { x: 100, y: 50, width: 220, height: 32 };
  dom.body.appendChild(input);

  const btn = dom.document.createElement("button");
  btn.textContent = "Search";
  btn.offsetParent = dom.body;
  btn._rect = { x: 340, y: 50, width: 80, height: 32 };
  dom.body.appendChild(btn);

  const gb = dom.document.createElement("span");
  gb.textContent = "Asset - Ad";
  gb.childElementCount = 0;               // page scripts require a leaf node
  gb._rect = { x: 100, y: 10, width: 120, height: 24 };
  dom.body.appendChild(gb);

  const total = dom.document.createElement("span");
  total.className = "page-total";
  total.textContent = "Total 4145 entries";
  total._rect = { x: 700, y: 10, width: 160, height: 20 };
  dom.body.appendChild(total);
}

// Optional: a virtual-scrolling table page, for vtable-scroll.mjs regression
//   --table-rows 130   total data rows (only ~25 visible rows are rendered unless --render-all)
//   --row-h 40         row height
if (TABLE_ROWS > 0) {
  const data = Array.from({ length: TABLE_ROWS }, (_, i) => ({ name: `Row ${i + 1}`, val: String((i + 1) * 10) }));
  for (const [title, x] of [["Name", 10], ["Value", 140]]) {
    const h = dom.document.createElement("div");
    h.className = "surely-table-header-cell";
    h.textContent = title;
    h._rect = { x, y: 0, width: 120, height: 30 };
    dom.body.appendChild(h);
  }
  const bodyEl = dom.document.createElement("div");
  bodyEl.className = "surely-table-body";
  bodyEl.style.overflowY = "scroll";
  bodyEl._scrollHeight = ROW_H * TABLE_ROWS;
  bodyEl._clientHeight = 720;
  bodyEl._scrollTop = 0;
  dom.body.appendChild(bodyEl);

  const VISIBLE = RENDER_ALL ? TABLE_ROWS : 25;
  const render = () => {
    bodyEl.children = [];
    const start = Math.max(0, Math.floor(bodyEl._scrollTop / ROW_H));
    for (let i = start; i < Math.min(TABLE_ROWS, start + VISIBLE); i++) {
      const y = i * ROW_H - bodyEl._scrollTop;
      for (const [cls, text, x] of [["surely-table-cell", data[i].name, 10], ["surely-table-cell", data[i].val, 140]]) {
        const c = dom.document.createElement("div");
        c.className = cls; c.textContent = text;
        c._rect = { x, y, width: 120, height: ROW_H };
        bodyEl.appendChild(c);
      }
    }
    notifyMutation();
  };
  render();
  Object.defineProperty(bodyEl, "scrollTop", {
    get() { return this._scrollTop; },
    set(v) {
      if (process.env.VT_TRACE) {
        const st = new Error("scrollTop set").stack.split("\n").slice(1, 8).map((s) => s.trim()).join(" | ");
        process.stderr.write(`[VT] set ${v} (was ${this._scrollTop}) :: ${st}\n`);
      }
      this._scrollTop = Math.max(0, Math.min(v, ROW_H * TABLE_ROWS - this._clientHeight));
      render();
    },
  });
}

// Optional: --cover  在最上层盖一个全屏 div.cover（模拟 loading 遮罩 / 弹层），用来测点击前的遮挡检查
if (process.argv.includes("--cover")) {
  const cover = dom.document.createElement("div");
  cover.className = "cover el-loading-mask";
  cover._rect = { x: 0, y: 0, width: 1600, height: 900 };
  dom.body.appendChild(cover);
}

const targets = [];
let pendingNet = null;
let heldEval = null;   // 原生弹窗期间被冻结的 Runtime.evaluate（Page.handleJavaScriptDialog 后才回）

const server = http.createServer((req, res) => {
  if (req.url.startsWith("/json/list")) {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify([{
      id: "FAKE-TARGET-1",
      type: "page",
      title: "fake",
      url: sandbox.location.href,
      webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/FAKE-TARGET-1`,
    }]));
  }
  if (req.url.startsWith("/json/version")) {
    res.setHeader("content-type", "application/json");
    return res.end(JSON.stringify({ Browser: "FakeChrome/1.0", webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/browser/x` }));
  }
  res.statusCode = 404; res.end("not found");
});

attachWs(server, (ws) => {
  const sendEvt = (method, params = {}) => ws.send(JSON.stringify({ method, params }));
  ws.on("message", async (raw) => {
    let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { id, method, params = {} } = msg;
    const reply = (result) => ws.send(JSON.stringify({ id, result }));
    const fail = (error) => ws.send(JSON.stringify({ id, error }));
    try {
      switch (method) {
        case "Runtime.enable": case "Page.enable": case "Log.enable":
        case "Emulation.setFocusEmulationEnabled": case "Emulation.setDeviceMetricsOverride":
        case "Emulation.clearDeviceMetricsOverride": case "Page.bringToFront": case "Page.setDownloadBehavior":
        case "Page.startScreencast": case "Page.stopScreencast":
          return reply({});
        case "Browser.getWindowForTarget":
          return reply({ windowId: 1, bounds: { windowState: "normal", left: 0, top: 0, width: 1600, height: 900 } });
        case "Page.captureScreenshot":
          return reply({ data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==" });
        case "Network.enable":
          reply({});
          // controllable slow request: requestWillBeSent -> (NET_DELAY) -> loadingFinished
          if (pendingNet) clearTimeout(pendingNet);
          sendEvt("Network.requestWillBeSent", {
            requestId: "REQ-1", type: "XHR", wallTime: Date.now() / 1000,
            request: { url: "http://localhost:3001/creative-local/getCollectionCreativeList", method: "POST", postData: "{}" },
          });
          pendingNet = setTimeout(() => {
            if (!NO_RESPONSE) {
              sendEvt("Network.responseReceived", {
                requestId: "REQ-1", type: "XHR",
                response: { url: "http://localhost:3001/creative-local/getCollectionCreativeList", status: 200, mimeType: "application/json", headers: {} },
              });
              sendEvt("Network.loadingFinished", { requestId: "REQ-1", encodedDataLength: 42, timestamp: Date.now() / 1000 });
            }
            if (MUTATE) {
              // after the response, mutate the DOM once more (simulates "list replaced")
              const td = dom.document.createElement("td");
              td.className = "surely-table-cell";
              td.textContent = "AFTER-" + Date.now();
              td._rect = { x: 10, y: 10, width: 80, height: 20 };
              dom.body.appendChild(td);
              notifyMutation();
            }
            if (SET_TEXT) { dom.body.textContent = SET_TEXT; notifyMutation(); }
          }, NET_DELAY);
          return;
        case "Input.dispatchMouseEvent":
          sandbox.__mouse.push(params.type);
          return reply({});
        case "Input.dispatchKeyEvent": {
          const ae = domState.active;
          if (ae && (params.type === "rawKeyDown" || params.type === "keyDown")) {
            if ((params.commands || []).some((x) => String(x).toLowerCase() === "selectall")) ae._selAll = true;
            else if (params.key === "Backspace") { ae.value = ae._selAll ? "" : String(ae.value || "").slice(0, -1); ae._selAll = false; }
          }
          return reply({});
        }
        case "Input.insertText": {
          const ae = domState.active;
          if (ae) { ae.value = (ae._selAll ? "" : String(ae.value || "")) + params.text; ae._selAll = false; }
          return reply({});
        }
        case "Page.handleJavaScriptDialog":
          reply({});
          sendEvt("Page.javascriptDialogClosed", { result: !!params.accept, userInput: params.promptText || "" });
          if (heldEval) { const h = heldEval; heldEval = null; h(); }
          return;
        case "Runtime.evaluate": {
          const expr = params.expression;
          // 模拟原生弹窗：表达式里有 alert("…") → 发 javascriptDialogOpening，并把这次求值冻住到弹窗被处理
          const am = /alert\(["']([^"']*)["']\)/.exec(expr);
          if (am) {
            sendEvt("Page.javascriptDialogOpening", { url: sandbox.location.href, message: am[1], type: "alert", hasBrowserHandler: false, defaultPrompt: "" });
            heldEval = () => reply({ result: { type: "undefined" } });
            return;
          }
          try {
            let v = await vm.runInContext(expr, ctx, { timeout: 30000 });
            if (params.awaitPromise && v && typeof v.then === "function") v = await v;
            const value = v === undefined ? null : v;
            return reply({ result: { type: typeof value, value } });
          } catch (e) {
            // 与真 Chrome 一样给 0 起的 lineNumber（从 vm 的 evalmachine.<anonymous>:N 里取；语法错误时取不到就不给）
            const lm = /evalmachine\.<anonymous>:(\d+)/.exec(String(e && e.stack));
            return reply({ result: { type: "undefined" }, exceptionDetails: { text: String(e && e.message), ...(lm ? { lineNumber: Number(lm[1]) - 1, columnNumber: 0 } : {}), exception: { description: String((e && e.stack) || e) } } });
          }
        }
        default:
          return reply({});
      }
    } catch (e) { fail({ code: -1, message: String(e) }); }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  const p = server.address().port;
  process.stdout.write(JSON.stringify({ ws: `ws://127.0.0.1:${p}/devtools/page/FAKE-TARGET-1`, http: `http://127.0.0.1:${p}` }) + "\n");
});
