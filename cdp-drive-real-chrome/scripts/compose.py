# -*- coding: utf-8 -*-
"""多截图合成标注图 —— 裁剪 + 放大 + 红框编号 + 顶部说明带 + 纵向拼接。

用途：`annotate.py` 只能处理单图。当一个判定需要**多个面板**才能说清
（典型：对照组 vs 实验组、切换前 vs 切换后、两个平台各一张），
逐张标注会让复核者来回翻，本脚本一次拼成一张。

用法：
  python compose.py 输出.png "标题" ^
    "面板1.png|120,300,900,420|box:1,40,60,220,36,Views at 50% = 58.1K;box:2,300,60,180,36,Ad Type = SV" ^
    "面板2.png|120,300,900,420|box:3,40,60,220,36,Views at 50% = --"

  面板之间用 ^ 换行（或在 bash 里写成一行）。
  坐标全部基于**原始截图的像素**（不是裁剪后/放大后）——
  裁剪与放大的偏移由脚本自己算，这样可以直接喂 `stage-shot.mjs --rects`
  导出的坐标，不用手动换算。

参数（可选，用环境变量或命令行第 4 个参数传 JSON）：
  --scale 2.0     裁剪后放大倍数
  --gap 14        面板间距(px)
  --panel-label   给每个面板加一行小标题（JSON 数组，与面板数一致）

框边文字不要省：只有框和序号，复核者还得回说明带对编号。
写**看得见的事实或期望**，不要写推断。

依赖：Pillow（带 PIL 的 python: C:/Users/HaijunLing/AppData/Local/Programs/Python/Python314/python.exe）
最后跑通：2026-10-09
"""
import argparse
import json
import sys

from PIL import Image, ImageDraw, ImageFont

FONTS = ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/arial.ttf"]
BG = (255, 255, 255)  # 画布 / 面板间隔用白；标注（说明带、标签条、框）一律不用黑色（区分度低）
FG = (255, 255, 255)
RED = (255, 0, 0)


def load_font(size):
    for f in FONTS:
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            continue
    return ImageFont.load_default()


def parse_panel(spec):
    """'src.png|x,y,w,h|box:1,x,y,w,h,文字;box:2,...' -> (src, crop, boxes)"""
    parts = spec.split("|")
    if len(parts) < 2:
        raise SystemExit("面板格式错误（至少需要 图片|裁剪区）：" + spec[:80])
    src = parts[0]
    crop = [int(v) for v in parts[1].split(",")]
    if len(crop) != 4:
        raise SystemExit("裁剪区必须是 x,y,w,h：" + parts[1])
    boxes = []
    if len(parts) > 2 and parts[2].startswith("box:"):
        for b in parts[2][4:].split(";"):
            if not b.strip():
                continue
            f = b.split(",")
            if len(f) < 5:
                raise SystemExit("box 需要 编号,x,y,w,h[,文字]：" + b)
            boxes.append((f[0], *[int(v) for v in f[1:5]], f[5] if len(f) > 5 else ""))
    return src, crop, boxes


def render_panel(spec, scale, panel_label, title_font_size):
    src, (cx, cy, cw, ch), boxes = parse_panel(spec)
    im = Image.open(src).convert("RGB")
    im = im.crop((cx, cy, cx + cw, cy + ch))
    im = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
    d = ImageDraw.Draw(im)
    fs = max(12, int(15 * scale))
    bf = load_font(fs)

    if panel_label:
        lf = load_font(max(13, int(title_font_size * 0.8)))
        d.rectangle([0, 0, im.width, lf.getbbox("Ag")[3] + 14], fill=RED)  # 面板标签条：不用黑/深灰
        d.text((8, 7 - lf.getbbox("Ag")[1]), panel_label, fill=(235, 235, 245), font=lf)

    for no, bx, by, bw, bh, label in boxes:
        # 面板裁剪偏移 + 放大倍数 → 换算到当前图上的坐标
        X, Y = (bx - cx) * scale, (by - cy) * scale
        W_, H_ = bw * scale, bh * scale
        d.rectangle([X, Y, X + W_, Y + H_], outline=RED, width=max(2, int(2.5 * scale)))
        b = d.textbbox((0, 0), "Ag", font=bf)
        lh = b[3] - b[1] + 6
        tw = d.textbbox((0, 0), label, font=bf)[2] if label else 0
        pad = 8
        pw, ph = 40 + tw + 2 * pad, max(30, lh + 2 * pad)
        px, py = X, Y - ph - 6
        if py < 0:
            py = Y + H_ + 6          # 顶上放不下就挪到框下方
        d.rectangle([px, py, px + pw, py + ph], fill=RED)
        cyc = py + (ph - 30) // 2
        d.ellipse([px + 4, cyc, px + 34, cyc + 30], fill=FG)
        nb = d.textbbox((0, 0), str(no), font=bf)
        d.text((px + 19 - (nb[2] - nb[0]) / 2, cyc + 15 - (nb[3] - nb[1]) / 2 - nb[1]),
               str(no), fill=RED, font=bf)
        if label:
            d.text((px + 40, py + pad - b[1]), label, fill=FG, font=bf)
    return im


def build(out, title, specs, scale=2.0, gap=14, panel_labels=None):
    if not specs:
        raise SystemExit("至少要一个面板")
    labels = panel_labels or []
    title_size = 24
    panels = [render_panel(s, scale, labels[i] if i < len(labels) else None, title_size)
              for i, s in enumerate(specs)]
    W = max(p.width for p in panels)
    H = sum(p.height for p in panels) + gap * (len(panels) - 1)
    tf = load_font(title_size)
    tb = tf.getbbox("Ag")
    bar = (tb[3] - tb[1]) + 26

    canvas = Image.new("RGB", (W, H + bar), BG)
    d = ImageDraw.Draw(canvas)
    d.rectangle([0, 0, W, bar], fill=RED)  # 顶部说明带：红底白字
    d.text((14, 13 - tb[1]), title, fill=FG, font=tf)
    y = bar
    for p in panels:
        canvas.paste(p, (0, y))
        y += p.height + gap
    canvas.save(out)
    print("saved", out, canvas.size, "panels", len(panels))


def main():
    ap = argparse.ArgumentParser(description="多截图合成标注图")
    ap.add_argument("out")
    ap.add_argument("title")
    ap.add_argument("panels", nargs="+", help="每项一个面板 spec")
    ap.add_argument("--scale", type=float, default=2.0)
    ap.add_argument("--gap", type=int, default=14)
    ap.add_argument("--panel-label", default=None, help='JSON 数组，如 ["A. Video 页签","B. Image 页签"]')
    a = ap.parse_args()
    labels = json.loads(a.panel_label) if a.panel_label else None
    build(a.out, a.title, a.panels, a.scale, a.gap, labels)


if __name__ == "__main__":
    main()
