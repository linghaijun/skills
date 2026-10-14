// 离线回归 evidence.mjs（--rects + --src 离线补图路径：不碰浏览器，只测「几何→框→标注图→证据 JSON」）
//   node tests/run-evidence.mjs
import { SKILL, makeReporter, runScript, requirePython } from "./testkit.mjs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const { ok, done } = makeReporter();
const PY = requirePython();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "evidence-"));

// ① 造 400x300 底图
const png = path.join(TMP, "shot.png");
const gen = spawnSync(PY, ["-c", `from PIL import Image; im=Image.new('RGB',(400,300),(240,240,240)); im.save(r'${png}')`], { stdio: "inherit" });
ok("测试底图生成", gen.status === 0 && fs.existsSync(png), png);

// ② 造 stage-shot 形态的 rects
const rects = {
  vw: 1600, vh: 900,
  hdr: [
    { title: "Ad", x: 10, y: 40, w: 100, h: 24 },
    { title: "Ad Type", x: 120, y: 40, w: 90, h: 24 },
    { title: "Spend", x: 220, y: 40, w: 70, h: 24 },
  ],
  rows: [
    { y: 70, cells: [
      { col: "Ad", t: "Ad 1", x: 10, y: 70, w: 100, h: 22 },
      { col: "Ad Type", t: "SP", x: 120, y: 70, w: 90, h: 22 },
      { col: "Spend", t: "12.5", x: 220, y: 70, w: 70, h: 22 },
    ] },
    { y: 96, cells: [
      { col: "Ad", t: "Ad 2", x: 10, y: 96, w: 100, h: 22 },
      { col: "Ad Type", t: "SB", x: 120, y: 96, w: 90, h: 22 },
      { col: "Spend", t: "30", x: 220, y: 96, w: 70, h: 22 },
    ] },
  ],
};
const rectsPath = path.join(TMP, "shot-rects.json");
fs.writeFileSync(rectsPath, JSON.stringify(rects));

// ③ BOM 容忍：PowerShell/导出工具会写 UTF-8 BOM，JSON.parse 见 BOM 会抛
const rectsBom = path.join(TMP, "shot-rects-bom.json");
fs.writeFileSync(rectsBom, "\uFEFF" + JSON.stringify(rects), "utf8");

const EV = "scripts/evidence.mjs";
const base = (out, extra = []) => ["--rects", rectsPath, "--src", png, "--out", out, "--python", PY, ...extra];

// ④ 正常路径
{
  const out = path.join(TMP, "ev-1.png");
  const meta = path.join(TMP, "ev-1.meta.json");
  const r = await runScript(EV, base(out, ["--meta", meta, "--label", "AC-27-01 列表首行",
    "--mark", "1:Ad Type=首行 Ad Type 单元格", "--mark", "2:Spend=第二行花费"]));
  let j = null; try { j = JSON.parse(r.so); } catch {}
  ok("evidence 产出标注图", r.code === 0 && fs.existsSync(out), `code=${r.code} stderr=${r.se.trim().slice(0, 160)}`);
  ok("evidence 产出证据 JSON", fs.existsSync(meta), meta);
  ok("evidence 标记数 = --mark 数", j && j.markCount === 2, j && `markCount=${j.markCount}`);
  ok("evidence 未使用自动选框（autoMarks=false）", j && j.autoMarks === false);
  ok("evidence checks 全通过", j && j.checks.every((c) => c.pass), j && JSON.stringify(j.checks.map((c) => c.name)));
  ok("标注图不是空文件", fs.existsSync(out) && fs.statSync(out).size > 1000, fs.existsSync(out) ? `${fs.statSync(out).size} bytes` : "missing");
}

// ⑤ 带 BOM 的 rects 也要能读
{
  const out = path.join(TMP, "ev-bom.png");
  const r = await runScript(EV, ["--rects", rectsBom, "--src", png, "--out", out, "--python", PY, "--mark", "1:Ad=BOM 用例"]);
  ok("evidence 能读带 BOM 的 rects（PowerShell 写出的 JSON）", r.code === 0 && fs.existsSync(out), `code=${r.code} ${r.se.trim().slice(0, 120)}`);
}

// ⑥ 不给 --mark → 自动框前 2 行前 3 列
{
  const out = path.join(TMP, "ev-2.png");
  const r = await runScript(EV, base(out));
  let j = null; try { j = JSON.parse(r.so); } catch {}
  ok("evidence 不给 --mark 时自动选框", r.code === 0 && j && j.autoMarks === true && j.markCount === 6, j && `marks=${j.markCount}`);
}

// ⑦ 区间框
{
  const out = path.join(TMP, "ev-3.png");
  const r = await runScript(EV, base(out, ["--mark", "1:Ad..1:Spend=整行区间"]));
  let j = null; try { j = JSON.parse(r.so); } catch {}
  const rect = j && j.marks && j.marks[0] && j.marks[0].rect;
  ok("evidence 支持区间框（合并成一个框）", r.code === 0 && j.markCount === 1 && rect && rect[0] === 10 && rect[2] === 290, JSON.stringify(rect));
}

// ⑧ 表头名不存在 → 明确报错
{
  const out = path.join(TMP, "ev-4.png");
  const r = await runScript(EV, base(out, ["--mark", "1:不存在列=xx"]));
  ok("evidence 列名不存在 → exit 2 且提示可用表头", r.code === 2 && /可用/.test(r.se), `code=${r.code} ${r.se.trim().slice(0, 120)}`);
}

// ⑨ 缺 --out
{
  const r = await runScript(EV, ["--rects", rectsPath, "--src", png]);
  ok("evidence 缺 --out → exit 2", r.code === 2, `code=${r.code}`);
}

// ⑩ --rects 但没给 --src
{
  const out = path.join(TMP, "ev-6.png");
  const r = await runScript(EV, ["--rects", rectsPath, "--out", out, "--python", PY]);
  ok("evidence --rects 缺 --src → exit 2 且说明原因", r.code === 2 && /--src/.test(r.se), `code=${r.code} ${r.se.trim().slice(0, 100)}`);
}

// ⑪ python 不可用 → 明确报依赖问题（不能产出一张没框的图）
{
  const out = path.join(TMP, "ev-5.png");
  const r = await runScript(EV, ["--rects", rectsPath, "--src", png, "--out", out, "--python", "definitely-not-a-python-placeholder"]);
  ok("evidence python 不可用 → 非 0 退出且报错", r.code !== 0 && /失败|Python|找不到/.test(r.se + r.so), `code=${r.code} ${(r.se || r.so).trim().slice(0, 120)}`);
}

console.log("产物目录（人工目检用）: " + TMP);
done();
