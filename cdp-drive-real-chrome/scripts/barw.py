"""L0 逐帧量进度条填充宽度：判断录屏 / 连拍帧里进度条是否真的画满（按画面内容选帧，不按时间戳）。

用法:
    python -I barw.py --frames "<目录或通配>" --region NAME:x0-x1:y0-y1 [--region ...] \
                      [--color "b>150,r<90,g<140"] [--track 468] [--out result.json]

    --frames  帧文件：目录（取其中 *.png / *.jpg）或通配（如 run/frames/*.jpg），按文件名排序
    --region  要量的进度条区域（帧像素坐标）；每行扫描 x0~x1 内命中颜色的像素数，取 y0~y1 各行的最大值
    --color   填充色判定，逗号分隔的通道条件（r/g/b 与 > / <），默认 Element 蓝 "b>150,r<90,g<140"
    --track   轨道全宽（像素）；给了就额外输出百分比 pct = 填充宽 / 轨道宽
    --out     结果 JSON（默认只打印）

为什么有它（CP-58118，2026-10-13）：
- 进度条「100% 停留」只停 0.5s 时，CSS 过渡还没走完就换图，条只画到 96%（Q89）—— 只看文字「100%」看不出来；
- 录屏帧比 DOM 晚一拍：按时间戳选的 4 张帧里面板 A 标着 100%，实际填充只有 15%~78%（AC-97 第 4 轮退回）。
所以关键帧一律按本脚本量出的填充宽度选，选完再用 Read 打开目检。
"""
import argparse
import glob
import json
import os
import re
import sys

from PIL import Image


def parse_color(spec):
    conds = []
    for part in spec.split(","):
        m = re.fullmatch(r"\s*([rgb])\s*([<>])\s*(\d+)\s*", part)
        if not m:
            sys.exit("--color 写法非法: " + part)
        conds.append(("rgb".index(m.group(1)), m.group(2), int(m.group(3))))
    return lambda p: all((p[i] > v) if op == ">" else (p[i] < v) for i, op, v in conds)


def parse_region(spec):
    m = re.fullmatch(r"([^:]+):(\d+)-(\d+):(\d+)-(\d+)", spec)
    if not m:
        sys.exit("--region 写法非法（应为 NAME:x0-x1:y0-y1）: " + spec)
    return m.group(1), int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5))


def fill_width(im, hit, x0, x1, y0, y1):
    best = 0
    for y in range(y0, y1 + 1):
        best = max(best, sum(1 for x in range(x0, x1) if hit(im.getpixel((x, y)))))
    return best


def main():
    ap = argparse.ArgumentParser(description="逐帧量进度条填充宽度")
    ap.add_argument("--frames", required=True)
    ap.add_argument("--region", action="append", required=True)
    ap.add_argument("--color", default="b>150,r<90,g<140")
    ap.add_argument("--track", type=float, default=None)
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    files = (sorted(glob.glob(os.path.join(a.frames, "*.png")) + glob.glob(os.path.join(a.frames, "*.jpg")))
             if os.path.isdir(a.frames) else sorted(glob.glob(a.frames)))
    if not files:
        sys.exit("没有帧文件: " + a.frames)
    hit = parse_color(a.color)
    regions = [parse_region(r) for r in a.region]
    rows = []
    for f in files:
        im = Image.open(f).convert("RGB")
        row = {"frame": os.path.basename(f)}
        for name, x0, x1, y0, y1 in regions:
            w = fill_width(im, hit, x0, x1, y0, y1)
            row[name + "_px"] = w
            if a.track:
                row[name + "_pct"] = round(100.0 * w / a.track, 1)
        rows.append(row)
    res = {"color": a.color, "trackPx": a.track, "regions": a.region, "rows": rows}
    if a.out:
        with open(a.out, "w", encoding="utf-8") as fp:
            json.dump(res, fp, ensure_ascii=False, indent=1)
    for r in rows:
        print(json.dumps(r, ensure_ascii=False))


if __name__ == "__main__":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    main()
