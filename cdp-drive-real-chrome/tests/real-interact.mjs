// 真机回归（需要一个已按 SKILL §1 拉起的测试 Chrome，默认 9222 / CDP_PORT；先按 §2.4 确认是独立 profile，不是日常浏览器）
// 覆盖 2026-10-14 移植能力里假 Chrome 测不了的部分：真 getEventListeners、真遮挡、孤儿弹窗 + rescue、标签标记跨 reload。
// 自己用 tab-open.mjs 开一个 http://127.0.0.1:<port>/json/version 窗口造测试 DOM，不碰任何业务页面；跑完关掉自己开的窗口。
//   node tests/real-interact.mjs            退出码 0 = 全过（2026-10-14 基线 29 例）
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { SKILL, skillUrl } from "./testkit.mjs";
const { connect, PORT } = await import(skillUrl("scripts/conn.mjs"));
const SK = path.join(SKILL, "scripts") + path.sep;
const tabOpen = (args) => spawnSync(process.execPath, [SK + "tab-open.mjs", ...args], { encoding: "utf8" });
const opened = JSON.parse(tabOpen(["--open", `http://127.0.0.1:${PORT}/json/version`, "--name", "验证t1"]).stdout);
const T = opened[0].targetId;
const res = [];
const ok = (n, c, info = "") => { res.push(!!c); console.log(`${c ? "PASS" : "FAIL"}  ${n}${info ? "  — " + info : ""}`); };

try {
let c = await connect({ target: T });
ok("连接时补窗口标记", /^\[验证t1\]/.test(await c.ev("document.title")), await c.ev("document.title"));

await c.ev(`(() => {
  document.title = "测试页";
  document.body.innerHTML = '<div id="vue" style="width:120px;height:30px;background:#eee">Vue 点我</div>'
    + '<button id="b1" style="position:absolute;left:300px;top:100px;width:100px;height:30px">Search</button>'
    + '<div id="mask" style="position:absolute;left:280px;top:80px;width:200px;height:80px;background:rgba(0,0,0,.2)"></div>'
    + '<div style="opacity:0"><span id="hid" role="button">隐身</span></div>'
    + '<input id="in" style="position:absolute;left:20px;top:200px;width:200px">'
    + '<input id="f" type="file" multiple style="display:none">'
    + '<div id="far" style="position:absolute;left:20px;top:3000px;width:100px;height:30px">很远</div>';
  window.__hits = [];
  document.getElementById("vue").addEventListener("click", () => window.__hits.push("vue"));
  document.getElementById("b1").addEventListener("click", () => window.__hits.push("b1"));
  document.getElementById("far").addEventListener("click", () => window.__hits.push("far"));
  window.__vmodel = "";
  document.getElementById("in").addEventListener("input", (e) => { window.__vmodel = e.target.value; });
  return true;
})()`);
await c.sleep(300);
ok("SPA 改标题后观察器补回前缀", /^\[验证t1\] 测试页$/.test(await c.ev("document.title")), await c.ev("document.title"));

// clickables（真 getEventListeners）
const run = (s, args) => spawnSync(process.execPath, [SK + s, ...args], { env: { ...process.env, CDP_TARGET: T }, encoding: "utf8" });
const L = run("clickables.mjs", ["--json"]);
let lj = null; try { lj = JSON.parse(L.stdout); } catch {}
ok("clickables 退出码 0", L.status === 0, `code=${L.status} ${L.stderr.slice(0, 200)}`);
ok("真 Chrome 里 getEventListeners 可用", lj && lj.hasGEL === true);
const vueItem = lj && lj.items.find((x) => x.tag === "div#vue");
ok("认出挂了 click 监听的普通 div（listener）", vueItem && /listener/.test(vueItem.why), JSON.stringify(vueItem));
ok("opacity:0 祖先下的 role=button 不列", lj && !lj.items.some((x) => x.tag === "span#hid"));
ok("被遮罩盖住的按钮默认不列、计入 covered", lj && !lj.items.some((x) => x.tag === "button#b1") && lj.covered >= 1, `covered=${lj && lj.covered}`);
const LA = run("clickables.mjs", ["--all", "--json"]);
const la = JSON.parse(LA.stdout);
const b1 = la.items.find((x) => x.tag === "button#b1");
ok("--all 列出被遮挡按钮并点名遮挡者", b1 && b1.covered === "div#mask", JSON.stringify(b1));
ok("--all 列出视口外元素（offscreen）", la.items.some((x) => x.tag === "div#far" && x.covered === "offscreen"));
const vi = la.items.findIndex((x) => x.tag === "div#vue");
const K = run("clickables.mjs", ["--click", String(vi), "--after", "100"]);
ok("clickables --click n 真点中 Vue div", K.status === 0 && (await c.ev("__hits")).includes("vue"), `code=${K.status} ${K.stdout} ${K.stderr.slice(0, 120)}`);

// real-click 遮挡
const R = run("real-click.mjs", ["--sel", "button", "--text", "Search", "--after", "100"]);
ok("real-click 被遮罩挡住 → 退出码 4，未触发点击", R.status === 4 && !(await c.ev("__hits")).includes("b1"), `code=${R.status} ${R.stderr.slice(0, 220)}`);
await c.ev(`document.getElementById("mask").remove()`);
const R2 = run("real-click.mjs", ["--sel", "button", "--text", "Search", "--after", "100"]);
ok("遮罩移除后 real-click 正常点中", R2.status === 0 && (await c.ev("__hits")).includes("b1"), `code=${R2.status} ${R2.stdout.slice(0, 160)}`);

// clickEl 自动滚动
const k = await c.clickEl(`document.getElementById("far")`);
ok("clickEl 视口外目标先滚进视口再点", k.scrolled && (await c.ev("__hits")).includes("far"), JSON.stringify(k));
await c.ev("scrollTo(0,0)");

// fill
await c.ev(`document.getElementById("in").value = "旧值"`);
const f = await c.fill("#in", "新值 abc");
ok("fill 清空旧值并填入（含中文）", f.ok && f.value === "新值 abc", JSON.stringify(f));
ok("fill 触发了 input 监听（v-model 能收到）", (await c.ev("__vmodel")) === "新值 abc", await c.ev("__vmodel"));

// setFiles / upload.mjs
const tmp = path.join(os.tmpdir(), "cdp-upload-测试.txt"); fs.writeFileSync(tmp, "hello");
const tmp2 = path.join(os.tmpdir(), "cdp-upload-2.txt"); fs.writeFileSync(tmp2, "hi");
const sf = await c.setFiles(`"#f"`, [tmp]);
ok("setFiles 给隐藏 file input 设文件并读回", sf.n === 1 && sf.names[0] === "cdp-upload-测试.txt", JSON.stringify(sf));
const U = run("upload.mjs", ["--sel", "#f", "--file", `${tmp},${tmp2}`]);
ok("upload.mjs 两个文件读回 n=2", U.status === 0 && /"n": 2/.test(U.stdout), `code=${U.status} ${U.stdout.slice(0, 200)} ${U.stderr.slice(0, 120)}`);

// 原生弹窗
const t0 = Date.now();
const pe = await c.ev(`alert("真弹窗")`).catch((e) => e);
ok("alert 弹出：触发它的 ev 立刻报 dialog（不白等 30s）", pe instanceof Error && pe.code === "dialog" && Date.now() - t0 < 3000, `${Date.now() - t0}ms ${pe && pe.message}`);
const t1 = Date.now();
const fe = await c.ev("1+1").catch((e) => e);
ok("弹窗未处理时后续 ev 快速失败", fe instanceof Error && fe.code === "dialog" && Date.now() - t1 < 300, `${Date.now() - t1}ms`);
await c.close();   // 有未处理弹窗 → 自动取消后断开

let ta = Date.now();
let c2 = await connect({ target: T });
ok("正常 close 自动取消弹窗：新连接不冻结、连得快", !c2.isFrozen() && Date.now() - ta < 3000 && (await c2.ev("1+1")) === 2, `${Date.now() - ta}ms`);

// 孤儿弹窗：弹出后直接断 WebSocket（模拟脚本崩溃，没走 close）
await c2.ev(`setTimeout(() => alert("孤儿"), 50); 1`);
await c2.sleep(400);
ok("（前置）弹窗已被本连接捕获", c2.pendingDialog() && c2.pendingDialog().message === "孤儿");
c2.ws.close();
await new Promise((r) => setTimeout(r, 300));
ta = Date.now();
c2 = await connect({ target: T });
const ct = Date.now() - ta;
ok("孤儿弹窗：新连接探活发现冻结（不再 38s）", c2.isFrozen() && ct < 5000, `${ct}ms`);
const t2 = Date.now();
const ze = await c2.ev("1").catch((e) => e);
ok("冻结时 ev 立即报 frozen", ze instanceof Error && ze.code === "frozen" && Date.now() - t2 < 100, ze && ze.message);
await c2.rescue();
ok("rescue 后页面恢复", !c2.isFrozen() && (await c2.ev("1+1")) === 2);
ok("rescue 后窗口标记仍在（同源导航 sessionStorage 保留）", /^\[验证t1\]/.test(await c2.ev("document.title")), await c2.ev("document.title"));

// confirm 返回值
const cp = c2.ev(`window.__cf = confirm("确定吗"); 1`).catch((e) => e);
await c2.sleep(200);
await c2.handleDialog(false);
await cp;
ok("handleDialog(false) = 点取消（confirm 返回 false）", (await c2.ev("window.__cf")) === false);

// 顶层 return / 报错行号（真 Chrome 的 lineNumber）
ok("真 Chrome 顶层 return 自动包裹", (await c2.ev("const a = 4;\nreturn a + 1")) === 5);
const e1 = await c2.ev("const a = 1;\nnull.boom").catch((e) => e);
ok("真 Chrome 报错带第 2 行 + 该行代码", /第 2 行/.test(e1.message) && /该行：null\.boom/.test(e1.message), e1.message);

// reload 后标记仍在
await c2.send("Page.reload", {});
await c2.sleep(1500);
c2.close();
const c3 = await connect({ target: T });
await c3.sleep(200);
ok("reload 后下一次连接补回标记", /^\[验证t1\]/.test(await c3.ev("document.title")), await c3.ev("document.title"));
c3.close();
} catch (e) {
  ok("未预期异常：" + e.message, false);
} finally {
  tabOpen(["--close", T]);
  for (const f of ["cdp-upload-测试.txt", "cdp-upload-2.txt"]) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
}

console.log(`\n${res.filter(Boolean).length}/${res.length} 通过`);
setTimeout(() => process.exit(res.length && res.every(Boolean) ? 0 : 1), 200);
