// 离线回归：把 fake-chrome 拉起来，验证 conn.mjs 的新助手（waitFor / evAll / settle）语义。
//   node tests/run-tests.mjs
// 退出码 0 = 全过。
import { SKILL, startFake, makeReporter } from "./testkit.mjs";

const { ok, done } = makeReporter();
// 注意：conn.mjs 的 PORT 是「模块加载时」读 CDP_PORT 的，所以显式传 port，不能靠"先 import 再设环境变量"。
const { connect, listPages, pickPage } = await import("file:///" + SKILL.replace(/\\/g, "/") + "/scripts/conn.mjs");
const TARGET_ID = "FAKE-TARGET-1";
const connTo = async (port) => connect({ port, target: pickPage(await listPages(port), { target: TARGET_ID }).id });
const stop = (p) => { try { p.kill(); } catch {} };

// ---------- 用例 1：网络延迟 1200ms 的实例 ----------
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "1200"]);
  const c = await connTo(Number(new URL(info.http).port));

  ok("ev 基本求值", (await c.ev("1+1")) === 2);
  ok("ev 支持 async IIFE", (await c.ev("(async()=>{await new Promise(r=>setTimeout(r,30));return 'x'})()")) === "x");

  const many = await c.evAll(["1+1", "document.location.hostname", "(() => { throw new Error('boom') })()", "'ok'"]);
  ok("evAll 一次往返读多个表达式", many[0] === 2 && many[1] === "localhost" && many[3] === "ok", JSON.stringify(many));
  ok("evAll 单项抛错 → null，不整体失败", many[2] === null, JSON.stringify(many[2]));

  const t1 = Date.now();
  const w1 = await c.waitFor("document.body.children.length", { total: 5000, expect: (v) => typeof v === "number" });
  ok("waitFor 立即满足时快速返回", w1.ok && Date.now() - t1 < 400, `elapsed=${Date.now() - t1}ms polls=${w1.polls}`);

  let threw = null;
  try { await c.waitFor("null", { total: 500, min: 50, max: 80 }); } catch (e) { threw = e; }
  ok("waitFor 超时抛错", !!threw && threw.timeout === true, threw && `${threw.elapsed}ms polls=${threw.polls}`);
  ok("waitFor 超时错误带 polls/elapsed/value", !!threw && threw.polls > 1 && "value" in threw, threw && JSON.stringify({ polls: threw.polls, elapsed: threw.elapsed }));

  let emptyThrew = null;
  try { await c.waitFor("[].slice(0,0)", { total: 400, min: 50, max: 80 }); } catch (e) { emptyThrew = e; }
  ok("waitFor 默认判据把空数组当「还没好」", !!emptyThrew);

  const w2 = await c.waitFor("Date.now()", { total: 2000, min: 50, max: 80, until: () => false }).catch((e) => e);
  ok("waitFor until=false 会等到超时", !!w2 && w2.timeout === true, w2 && `polls=${w2.polls}`);
  const w4 = await c.waitFor("123", { total: 400, min: 50, max: 80, until: (v) => v === 999 }).catch((e) => e);
  ok("waitFor 给了 until 就不被默认 truthy 判据短路", !!w4 && w4.timeout === true, w4 && `polls=${w4.polls}`);
  const t3 = Date.now();
  await c.waitFor("Date.now()", { total: 3000, min: 50, max: 80, until: () => Date.now() - t3 > 150 });
  ok("waitFor until 达成立刻返回", Date.now() - t3 >= 150 && Date.now() - t3 < 1000, `${Date.now() - t3}ms`);
  let seen = 0;
  await c.waitFor("null", { total: 400, min: 40, max: 60, onPoll: () => seen++ }).catch(() => {});
  ok("waitFor 支持 onPoll 回调", seen >= 2, `onPoll=${seen}`);
  const w3 = await c.waitFor("null", { total: 1, min: 10, max: 10 }).catch((e) => e);
  ok("waitFor 预算极小也不误报成功", !!w3 && w3.timeout === true, w3 && `polls=${w3.polls}`);
  ok("waitFor 支持 initialDelay（先等固定时长再轮询）", (await c.waitFor("1", { total: 3000, initialDelay: 200 })).polls >= 1);

  const t2 = Date.now();
  const s1 = await c.settle({ idleMs: 300, quietMs: 250, max: 10000 });
  const el1 = Date.now() - t2;
  ok("settle 等到慢请求结束（≥ 网络延迟）", s1.settled === true && el1 >= 1150, `settled=${s1.settled} elapsed=${el1}ms`);
  ok("settle 不提前太久返回", el1 < 1200 + 3000, `elapsed=${el1}ms`);
  ok("settle 返回 dom 静默信息", s1.dom && s1.dom.quiet === true, JSON.stringify(s1.dom));

  await c.close(); stop(proc);
}

// ---------- 用例 2：完全无响应（模拟后端挂着）----------
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "60000", "--no-response"]);
  const c = await connTo(Number(new URL(info.http).port));
  const t = Date.now();
  const s = await c.settle({ idleMs: 300, quietMs: 250, max: 1200 });
  ok("settle 请求永不完成 → settled:false 且标注 net-timeout", s.settled === false && s.reason === "net-timeout", JSON.stringify(s));
  ok("settle 超时不抛错（调用方决定后续）", Date.now() - t < 4000, `${Date.now() - t}ms`);
  await c.close(); stop(proc);
}

// ---------- 用例 3：响应后 DOM 又变一次 ----------
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "400", "--mutate"]);
  const c = await connTo(Number(new URL(info.http).port));
  const t = Date.now();
  const s = await c.settle({ idleMs: 200, quietMs: 400, max: 8000 });
  const el = Date.now() - t;
  ok("settle 会等响应后的 DOM 变动稳定下来", s.settled === true && el >= 700, `elapsed=${el}ms settled=${s.settled}`);
  await c.close(); stop(proc);
}

done();
