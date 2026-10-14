// 离线回归：2026-10-14 从 browser-use / browser-harness 移植的交互能力
//   conn.mjs：ev 报错带行号 + 顶层 return 自动包裹 / 原生弹窗快速失败 + handleDialog / clickEl 遮挡检查 / fill 填值读回
//   CLI：clickables.mjs（列清单、按编号点、遮挡过滤）、real-click.mjs（被挡住退出码 4、--force）
//   node tests/run-interact.mjs
// 假 DOM 没有真实布局与 getEventListeners：这里测的是「判据 + 流程 + 退出码」，listener 识别与真实遮挡以真机为准。
import { startFake, makeReporter, runScript, skillUrl } from "./testkit.mjs";

const { ok, done } = makeReporter();
const { connect } = await import(skillUrl("scripts/conn.mjs"));
const stop = (p) => { try { p.kill(); } catch {} };
const env = (port) => ({ env: { CDP_PORT: String(port), CDP_TARGET: "FAKE-TARGET-1" } });

// ① 无遮挡的 Ads 页
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "100", "--ads-page"]);
  const port = Number(new URL(info.http).port);
  const c = await connect({ port, target: "FAKE-TARGET-1" });

  // ev 报错可读
  const e1 = await c.ev("const a = 1;\nnull.boom").catch((e) => e);
  ok("ev 异常带行号", e1 instanceof Error && /第 2 行/.test(e1.message), e1.message);
  ok("ev 异常带出错那一行代码", /该行：null\.boom/.test(e1.message), e1.message);
  ok("ev 异常仍以 PAGE EXCEPTION 开头（兼容旧判断）", /^PAGE EXCEPTION/.test(e1.message));
  ok("ev 顶层 return 自动包成函数", (await c.ev("const a = 2;\nreturn a * 3")) === 6);
  ok("ev 顶层 return + await 也行", (await c.ev("await new Promise((r) => setTimeout(r, 20));\nreturn 'w'")) === "w");
  const e2 = await c.ev("const a = 1;\nreturn a.b.c").catch((e) => e);
  ok("包裹后再报错：行号仍对应原表达式", e2 instanceof Error && /第 2 行/.test(e2.message), e2.message);

  // fill
  const f1 = await c.fill("input", "abc");
  ok("fill 填值并读回", f1.ok && f1.value === "abc", JSON.stringify(f1));
  const f2 = await c.fill("input", "xyz");
  ok("fill 默认先清空（真键盘全选 + Backspace）", f2.ok && f2.value === "xyz" && f2.before === "abc", JSON.stringify(f2));
  const f3 = await c.fill("input", "1", { clear: false });
  ok("fill clear:false 追加", f3.ok && f3.value === "xyz1", JSON.stringify(f3));
  const f4 = await c.fill(".no-such", "x").catch((e) => e);
  ok("fill 找不到元素抛 not-found", f4 instanceof Error && f4.code === "not-found", f4.message);

  // clickEl
  const m0 = (await c.ev("__mouse.length"));
  const k1 = await c.clickEl(`[...document.querySelectorAll("button")].find((b) => b.textContent === "Search")`);
  const m1 = (await c.ev("__mouse.length"));
  ok("clickEl 未遮挡：发 move + press + release", k1.ok && m1 - m0 === 3, JSON.stringify(k1));
  ok("clickEl 返回命中链", Array.isArray(k1.hit) && /^button/.test(k1.hit[0]), JSON.stringify(k1.hit));
  ok("clickEl 接受 CSS 选择器字符串", (await c.clickEl(`"button"`)).ok);
  const k2 = await c.clickEl(`document.querySelector(".nope")`).catch((e) => e);
  ok("clickEl 目标不存在抛 not-element", k2 instanceof Error && k2.code === "not-element", k2.message);

  // 原生弹窗
  const pending = c.ev(`alert("请先保存")`).catch((e) => e);
  await c.sleep(150);
  const d = c.pendingDialog();
  ok("弹窗出现后 pendingDialog 能读到类型与文案", d && d.type === "alert" && d.message === "请先保存", JSON.stringify(d));
  const pe = await pending;
  ok("触发弹窗的那次 ev 立即被拒（不白等超时）", pe instanceof Error && pe.code === "dialog", pe && pe.message);
  const t0 = Date.now();
  const fe = await c.ev("1+1").catch((e) => e);
  ok("弹窗未处理时后续 ev 快速失败", fe instanceof Error && fe.code === "dialog" && Date.now() - t0 < 200, `${Date.now() - t0}ms`);
  ok("快速失败的错误文案带弹窗内容", /请先保存/.test(fe.message), fe.message);
  const hd = await c.handleDialog(true);
  ok("handleDialog 返回被处理的弹窗", hd && hd.message === "请先保存");
  ok("处理后 ev 恢复正常", (await c.ev("1+1")) === 2);
  ok("处理后 pendingDialog 为空", c.pendingDialog() === null);

  c.close();

  // clickables CLI
  const L = await runScript("scripts/clickables.mjs", [], env(port));
  ok("clickables 列出清单（退出码 0）", L.code === 0 && /\[\d+\] button/.test(L.so), `code=${L.code} ${L.se.slice(0, 160)}`);
  ok("clickables 列出 Search 按钮与输入框", /"Search"/.test(L.so) && /\binput\b/.test(L.so), L.so.slice(0, 300));
  ok("clickables 无 getEventListeners 时提示可能漏 div", /getEventListeners 不可用/.test(L.se));
  const T = await runScript("scripts/clickables.mjs", ["--text", "search", "--json"], env(port));
  let tj = null; try { tj = JSON.parse(T.so); } catch {}
  ok("clickables --text 过滤（不区分大小写）", tj && tj.items.length >= 1 && tj.items.every((x) => /search/i.test(x.text)), T.so.slice(0, 200));
  const K = await runScript("scripts/clickables.mjs", ["--click", "0", "--after", "0"], env(port));
  ok("clickables --click 用上次清单点击", K.code === 0 && /"clicked":0/.test(K.so), `code=${K.code} ${K.so} ${K.se.slice(0, 120)}`);
  const K2 = await runScript("scripts/clickables.mjs", ["--click", "99", "--after", "0"], env(port));
  ok("clickables --click 越界 → 退出码 3", K2.code === 3 && /越界/.test(K2.se), `code=${K2.code} ${K2.se.slice(0, 120)}`);
  const K3 = await runScript("scripts/clickables.mjs", ["--click", "x"], env(port));
  ok("clickables --click 非数字 → 退出码 2", K3.code === 2);
  const R = await runScript("scripts/real-click.mjs", ["--sel", "button", "--text", "Search", "--after", "0"], env(port));
  ok("real-click 未遮挡照常点击", R.code === 0 && /"clicked"/.test(R.so), `code=${R.code} ${R.se.slice(0, 160)}`);

  stop(proc);
}

// ② 最上层盖了遮罩
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "100", "--ads-page", "--cover"]);
  const port = Number(new URL(info.http).port);
  const c = await connect({ port, target: "FAKE-TARGET-1" });
  const m0 = await c.ev("__mouse.length");
  const k = await c.clickEl(`"button"`).catch((e) => e);
  ok("clickEl 被遮挡抛 occluded", k instanceof Error && k.code === "occluded", k.message);
  ok("occluded 错误点名挡住它的元素", /div\.cover/.test(k.message), k.message);
  ok("被遮挡时一次鼠标事件都不发", (await c.ev("__mouse.length")) === m0);
  const kf = await c.clickEl(`"button"`, { force: true });
  ok("force:true 照点并标 forced", kf.forced === true && (await c.ev("__mouse.length")) - m0 === 3, JSON.stringify(kf));
  c.close();

  const R = await runScript("scripts/real-click.mjs", ["--sel", "button", "--text", "Search", "--after", "0"], env(port));
  ok("real-click 被遮挡 → 退出码 4 + 命中链", R.code === 4 && /occluded/.test(R.se) && /cover/.test(R.se), `code=${R.code} ${R.se.slice(0, 200)}`);
  const RF = await runScript("scripts/real-click.mjs", ["--sel", "button", "--text", "Search", "--after", "0", "--force"], env(port));
  ok("real-click --force 照点（forced:true）", RF.code === 0 && /"forced":true/.test(RF.so), `code=${RF.code} ${RF.so.slice(0, 160)}`);
  const L = await runScript("scripts/clickables.mjs", [], env(port));
  ok("clickables 默认不列被挡住的按钮", L.code === 0 && !/"Search"/.test(L.so) && /个被遮挡/.test(L.so), L.so.slice(-200));
  const LA = await runScript("scripts/clickables.mjs", ["--all"], env(port));
  ok("clickables --all 列出并标 covered by", /"Search".*covered by div\.cover/.test(LA.so), LA.so.slice(0, 300));
  stop(proc);
}

done();
