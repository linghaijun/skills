// 离线回归 wait-settle.mjs（库用法 + CLI 用法）。
//   node tests/run-wait-settle.mjs
import { SKILL, startFake, makeReporter } from "./testkit.mjs";
import { spawn } from "node:child_process";
import path from "node:path";

const { ok, done } = makeReporter();
const S = "file:///" + SKILL.replace(/\\/g, "/");
const { connect, listPages, pickPage } = await import(S + "/scripts/conn.mjs");
const { waitSettle } = await import(S + "/scripts/wait-settle.mjs");
const stop = (p) => { try { p.kill(); } catch {} };
const connTo = async (port) => connect({ port, target: pickPage(await listPages(port), { target: "FAKE-TARGET-1" }).id });

// ---------- 库用法：慢请求 + 无遮罩 ----------
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "1000"]);
  const c = await connTo(Number(new URL(info.http).port));
  const t = Date.now(); const r = await waitSettle(c, { idle: 300, quiet: 250, max: 10000 });
  const el = Date.now() - t;
  ok("wait-settle 库用法：慢请求下 settled=true", r.settled === true, `elapsed=${el}ms reason=${r.reason || "-"}`);
  ok("wait-settle 等够网络时间（≥1s）", el >= 1000, `${el}ms`);
  ok("wait-settle 返回 net/mask 明细", !!r.net && !!r.mask, JSON.stringify({ net: r.net.settled, mask: r.mask.ok }));
  await c.close(); stop(proc);
}

// ---------- 请求永不完成 ----------
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "60000", "--no-response"]);
  const c = await connTo(Number(new URL(info.http).port));
  const r = await waitSettle(c, { idle: 200, quiet: 200, max: 1200 });
  ok("wait-settle 请求挂着 → settled=false 且 reason=net-timeout", r.settled === false && r.reason === "net-timeout", JSON.stringify(r.reason));
  await c.close(); stop(proc);
}

// ---------- 行数判定 ----------
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "200", "--mutate"]);
  const c = await connTo(Number(new URL(info.http).port));
  const r1 = await waitSettle(c, { idle: 200, quiet: 200, max: 8000, rowsSel: ".surely-table-cell", expectRows: 1 });
  ok("wait-settle 行数等于预期 → settled", r1.settled === true && r1.rows && r1.rows.count === 1, JSON.stringify(r1.rows));
  const t = Date.now();
  const r2 = await waitSettle(c, { idle: 150, quiet: 150, max: 1500, rowsSel: ".surely-table-cell", expectRows: 999 });
  ok("wait-settle 行数不符预期 → settled=false 且 reason=rows!=N", r2.settled === false && r2.reason === "rows!=999", JSON.stringify({ reason: r2.reason, rows: r2.rows }));
  ok("wait-settle 行数不符时不会白等到 max 之后", Date.now() - t < 6000, `${Date.now() - t}ms`);
  await c.close(); stop(proc);
}

// ---------- CLI ----------
{
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "300"]);
  const port = Number(new URL(info.http).port);
  const run = (args) => new Promise((res) => {
    const p = spawn(process.execPath, [path.join(SKILL, "scripts", "wait-settle.mjs"), ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CDP_PORT: String(port), CDP_TARGET: "FAKE-TARGET-1" },
    });
    let so = "", se = ""; p.stdout.on("data", (d) => (so += d)); p.stderr.on("data", (d) => (se += d));
    p.on("close", (code) => res({ code, so, se }));
  });
  const a = await run(["--idle", "200", "--quiet", "200", "--max", "8000"]);
  let parsed = null; try { parsed = JSON.parse(a.so); } catch {}
  ok("wait-settle CLI 退出码 0 且输出可解析 JSON", a.code === 0 && parsed && parsed.settled === true, `code=${a.code} stderr=${a.se.trim().slice(0, 80)}`);
  ok("wait-settle CLI 报告 elapsedMs", parsed && typeof parsed.elapsedMs === "number", parsed && `${parsed.elapsedMs}ms`);

  const b = await run(["--idle", "200", "--quiet", "200", "--max", "1000", "--rows-sel", ".surely-table-cell", "--expect-rows", "999"]);
  let parsed2 = null; try { parsed2 = JSON.parse(b.so); } catch {}
  ok("wait-settle CLI 未就绪 → 退出码 1", b.code === 1, `code=${b.code}`);
  ok("wait-settle CLI 未就绪 → settled:false + reason", parsed2 && parsed2.settled === false && !!parsed2.reason, parsed2 && parsed2.reason);
  stop(proc);
}

done();
