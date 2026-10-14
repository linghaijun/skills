// 离线回归 L1 迁移：真实 L1 脚本走 fake 的 --ads-page，验证 waitBusyGone（替代手写 1s 轮询）
// 真的在等、不超时、不静默往下走；另含静态检查（不该再有固定 1s 轮询）。
//   node tests/run-l1.mjs
import { SKILL, L1, startFake, makeReporter, runScript, skillUrl } from "./testkit.mjs";
import path from "node:path";
import fs from "node:fs";

const { ok, done } = makeReporter();
const { connect, listPages, pickPage } = await import(skillUrl("scripts/conn.mjs"));
const { makeBusyGone, waitBusyGone } = await import(skillUrl("projects/creative-management/wait-lib.mjs"));
const stop = (p) => { try { p.kill(); } catch {} };
const runL1 = (script, args, port) => runScript(path.join("projects", "creative-management", script), args,
  { env: { CDP_PORT: String(port), CDP_TARGET: "FAKE-TARGET-1" } });

// ① 遮罩持续 1500ms：脚本必须等到它消失
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "100", "--ads-page", "--mask-ms", "1500"]);
  const port = Number(new URL(info.http).port);

  const a = await runL1("ads-search.mjs", ["alpha"], port);
  let st = null; try { st = JSON.parse(a.so); } catch {}
  ok("ads-search 迁移后能跑通（退出码 0）", a.code === 0, `code=${a.code} stderr=${a.se.trim().slice(0, 140)}`);
  // 注：fake 不实现 Input.insertText 的文本写入，所以只断言结构与 Total
  ok("ads-search 读到搜索框与 Total（结构正确）", st && typeof st.value === "string" && /Total 4145 entries/.test(st.total || ""), JSON.stringify(st));
  ok("ads-search 等到遮罩消失才返回（≥1500ms）", a.ms >= 1500, `${a.ms}ms`);
  ok("ads-search 没有白等（<1500+1500ms）", a.ms < 3000, `${a.ms}ms`);

  const g = await runL1("group-by.mjs", ["Asset - Ad"], port);
  ok("group-by 迁移后能跑通（已是目标值则早退）", g.code === 0 && /already/.test(g.so), `code=${g.code} out=${g.so.trim().slice(0, 80)}`);

  stop(proc);
}

// ② 遮罩 700ms：应比 ① 明显更快（证明自适应轮询，不是固定等待）
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "100", "--ads-page", "--mask-ms", "700"]);
  const port = Number(new URL(info.http).port);
  const a = await runL1("ads-search.mjs", ["beta"], port);
  ok("遮罩更短时脚本更快返回（自适应轮询生效）", a.code === 0 && a.ms >= 700 && a.ms < 1500, `${a.ms}ms`);
  stop(proc);
}

// ③ 遮罩永不消失 → 必须报错，不静默跑满然后继续
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "100", "--ads-page"]);
  const port = Number(new URL(info.http).port);
  const c = await connect({ port, target: pickPage(await listPages(port), { target: "FAKE-TARGET-1" }).id });
  await c.ev(`(() => { const m = document.querySelector('.pacvue-loading-mask'); m.style.display = 'block'; return true; })()`);
  const expr = makeBusyGone(c);
  let err = null;
  try { await waitBusyGone(c, expr, { total: 1200, minTicks: 2, label: "probe" }); } catch (e) { err = e; }
  ok("遮罩常显时 waitBusyGone 抛超时错误（不静默继续）", !!err && err.timeout === true, err && `${err.message.slice(0, 90)}`);
  ok("超时错误带 polls（可诊断）", !!err && err.polls >= 2, err && `polls=${err.polls}`);
  await c.close(); stop(proc);
}

// ④ 静态检查：迁移过的脚本不该再有固定 1s 轮询
{
  const libFiles = ["ads-search.mjs", "group-by.mjs", "date-range.mjs", "compare.mjs", "sort-check.mjs", "kpi-wait.mjs", "drawer-from-ads.mjs", "creativehub-fields-compare.mjs", "creativehub-gen-run.mjs"];
  for (const f of libFiles) {
    const src = fs.readFileSync(path.join(L1, f), "utf8");
    const handRolled = /for \(let k = 0; k < \d+; k\+\+\) \{ [^}]*c\.sleep\(1000\)/.test(src) || /for \(let i = 0; i < \d+; i\+\+\) \{[^}]*c\.sleep\(1000\)/.test(src);
    const usesLib = /wait-lib\.mjs/.test(src) || /c\.waitFor\(/.test(src);
    ok(`${f} 已改自适应轮询`, !handRolled && usesLib, handRolled ? "仍有固定 1s 轮询" : (usesLib ? "ok" : "未接 wait-lib/waitFor"));
  }
  for (const f of ["creative-ads-setup.js", "creativehub-ref-from-library.mjs"]) {
    const src = fs.readFileSync(path.join(L1, f), "utf8");
    ok(`${f} 已改自适应粒度`, /Math\.min\((500|)\s*,?\s*Math\.max\(100|waitFor\(/.test(src) && !/for \(let i = 0; i < \d+ && !e; i\+\+\)/.test(src));
  }
}

done();
