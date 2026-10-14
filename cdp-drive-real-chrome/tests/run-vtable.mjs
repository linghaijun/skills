// 离线回归 vtable-scroll.mjs
//   可离线确定验证：表头缓存归位、整行 JSON 去重、多行多列完整收集、--max-rows 截断、--hold 是上限。
//   🔴 测不了：虚拟滚动「逐屏」路径（vm 假浏览器的 scrollTop + await 组合会假性提前 break，见 references/SCRIPTS.md 坑 60）。
//   node tests/run-vtable.mjs
import { SKILL, startFake, makeReporter, runScript } from "./testkit.mjs";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const { ok, done } = makeReporter();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vtable-"));
const stop = (p) => { try { p.kill(); } catch {} };
const ROWS = 130;

{
  // --render-all：绕开滚动，一次渲染全部行，专测归位 / 去重 / 表头缓存
  const { proc, info } = await startFake(["--port", "0", "--net-delay", "100", "--table-rows", String(ROWS), "--render-all"]);
  const port = new URL(info.http).port;
  const out = path.join(TMP, "rows.json");
  const run = (extra = []) => {
    // 脚本 flag() 取「第一个匹配」→ 基础参数里不能先塞 --max-rows/--hold，否则 extra 里的会被忽略
    const base = ["--port", port, "--target", "FAKE-TARGET-1", "--out", out];
    if (!extra.includes("--max-rows")) base.push("--max-rows", "300");
    return runScript("scripts/vtable-scroll.mjs", [...base, ...extra]);
  };

  const r = await run();
  let summary = null; try { summary = JSON.parse(r.so); } catch {}
  ok("vtable-scroll 退出码 0", r.code === 0, `code=${r.code} stderr=${r.se.trim().slice(0, 160)}`);
  ok("vtable-scroll 收全量行（不丢行）", summary && summary.total === ROWS, summary && `total=${summary.total} / 期望 ${ROWS}`);
  ok("vtable-scroll 表头归位（2 列都识别）", summary && summary.hdrCount === 2, summary && `hdrCount=${summary.hdrCount}`);

  const rows = JSON.parse(fs.readFileSync(out, "utf8")).rows;
  const names = rows.map((x) => x["Name"]);
  ok("vtable-scroll 行内容去重（无重复行）", new Set(names).size === rows.length, `rows=${rows.length} uniq=${new Set(names).size}`);
  ok("vtable-scroll 每行都归到 Name/Value 两列（表头缓存没串列）", rows.every((x) => x["Name"] && x["Value"]), JSON.stringify(rows.slice(0, 2)));
  ok("vtable-scroll 首行=Row 1、末行=Row 130（顺序正确）", names[0] === "Row 1" && names[names.length - 1] === `Row ${ROWS}`, `${names[0]} … ${names[names.length - 1]}`);
  ok("vtable-scroll 值列一一对应（无错列）", rows.every((x, i) => x["Value"] === String((i + 1) * 10)), JSON.stringify(rows.slice(0, 3)));

  const capped = await run(["--max-rows", "20"]);
  let cs = null; try { cs = JSON.parse(capped.so); } catch {}
  ok("vtable-scroll --max-rows 生效且 truncated=true", cs && cs.total === 20 && cs.truncated === true, cs && `total=${cs.total} truncated=${cs.truncated}`);

  // --hold 是「上限」而非固定等待：给 1500 也不会等满它
  //   注：外部只能量到"没等满 hold"这个不变量——默认与 --hold 1500 都在 300ms 上下（渲染确实发生了，
  //   MutationObserver / 60ms 短兜底先返回），两者差值在噪声内，不做大小比较。
  const slow = await run(["--hold", "1500"]);
  ok("vtable-scroll --hold 是「上限」而非固定等待（给 1500 也不等满）", slow.ms < 1200 && r.ms < 1200, `默认 ${r.ms}ms vs --hold 1500 → ${slow.ms}ms`);
  ok("vtable-scroll 每屏等待有下限兜底（不会 0ms 空转就断言）", r.ms >= 50, `${r.ms}ms`);

  stop(proc);
}

done();
