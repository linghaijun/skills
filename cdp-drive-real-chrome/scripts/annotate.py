# -*- coding: utf-8 -*-
"""截图标注：裁剪 + 放大 + 画框编号 + 顶部说明条。

用途：把整页截图做成「一眼看出判定点」的标注版，作为 AC 判定依据的证据。

用法：
  python annotate.py AC-NN-01-<中文判定点>-原图.png AC-NN-01-<中文判定点>-标注.png \
      --crop 120,300,900,420 \
      --scale 2 \
      --box 40,60,220,36,1 \
      --box 40,140,220,36,2 \
      --title "1 → Status 应为 Archived | 2 → 条数应为 21 | AC-07"

参数：
  --crop x,y,w,h    先裁剪（坐标基于原图像素）。省略则用整图
  --scale N         裁剪后放大 N 倍（默认 2，取值 1~4）
  --box x,y,w,h,编号[,文字说明]
                     画一个红框，框边打「编号 + 文字说明」标签。坐标基于**裁剪后、放大前**的图。
                     可重复多次；编号就是 --title 里引用的那个数字。
                     🔴 文字说明不要省：只有框和序号，复核者还得回到说明带去对编号；
                     文字直接贴在框边才是"一眼看出"。写**看得见的事实或期望**，不要写推断。
                     文字过长会**自动折行**（也可用 \n 手动断行），不会被裁掉；
                     触发折行时脚本会打印告警 —— 看到告警就去亲眼确认产出图还读得通
  --title "文本"     顶部加一条说明带：编号 → 期望 → 对应 AC
  --color R,G,B     框线 / 编号 / 说明带颜色，默认红 255,0,0；禁止黑色、深灰（区分度低，脚本直接拒绝）

证据图默认用法（--rects 模式，原 annotate-rects.py，2026-10-13 并入；annotate-rects.py 保留为薄包装）：
  python annotate.py AC-08-01-第1页广告名称列-原图.png AC-08-01-第1页广告名称列-标注.png --crop 630,480,870,350 --title "AC-08 第 1 页" \
      --rects rects.json --mark "dsp1_cell=ADSP：只有 Ad 名称" --mark "sd1_cell=SD：只有 Creative"
  --rects FILE      页面导出的框坐标（截图像素 = CSS 像素 × dpr）：{"lab":[x0,y0,x1,y1]}，或 cdp.mjs 原始输出；
                    值不是 4 个数字的键（*_text / page / dpr）自动忽略。必须与截图同帧导出（前后各一次、cmp 一致）
  --mark "lab=说明" 按 rects 里的 lab 画框（框外扩 3px），编号接在 --box 之后；框超出 --crop 区直接报错，不静默裁掉
  注意 --crop 在本脚本里是 x,y,w,h（annotate-rects.py 的位置参数是 x0,y0,x1,y1，包装层会换算）

依赖：Pillow（本机 12.3.0）、字体 C:/Windows/Fonts/msyh.ttc（中文）或 arial.ttf
最后跑通：2026-10-01
"""
import argparse
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont

FONTS = ["C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/arial.ttf"]


def load_font(size):
    for f in FONTS:
        if os.path.exists(f):
            try:
                return ImageFont.truetype(f, size)
            except OSError:
                continue
    return ImageFont.load_default()


def parse_ints(s, n, name):
    parts = [p.strip() for p in s.split(",")]
    if len(parts) != n:
        sys.exit(f"--{name} 需要 {n} 个数字，收到 {len(parts)} 个: {s!r}")
    try:
        return [int(p) for p in parts]
    except ValueError:
        sys.exit(f"--{name} 只能是整数: {s!r}")


def load_rects(p):
    """{lab:[x0,y0,x1,y1]}（截图像素），或 cdp.mjs 原始输出 {"result":{"value":"<json>"}}；值不是 4 个数字的键自动忽略。"""
    with open(p, encoding="utf-8") as f:
        data = json.load(f)
    if isinstance(data, dict) and isinstance(data.get("result"), dict) and isinstance(data["result"].get("value"), str):
        data = json.loads(data["result"]["value"])
    return {k: v for k, v in data.items()
            if isinstance(v, list) and len(v) == 4 and all(isinstance(n, (int, float)) for n in v)}


def main():
    ap = argparse.ArgumentParser(description="截图标注：裁剪+放大+画框编号+说明条")
    ap.add_argument("src")
    ap.add_argument("dst")
    ap.add_argument("--crop", help="x,y,w,h（原图像素）")
    ap.add_argument("--scale", type=float, default=2.0, help="放大倍数，默认 2")
    ap.add_argument("--box", action="append", default=[],
                    help="x,y,w,h,编号（裁剪后、放大前坐标），可重复")
    ap.add_argument("--title", help="顶部说明带文本")
    ap.add_argument("--color", default="255,0,0")
    ap.add_argument("--rects", help="页面导出的框坐标 JSON（截图像素）：{lab:[x0,y0,x1,y1]} 或 cdp.mjs 原始输出")
    ap.add_argument("--mark", action="append", default=[],
                    help='"lab=框边说明"，按 --rects 里的 lab 画框（可重复；编号接在 --box 之后）')
    args = ap.parse_args()

    # --rects 模式（原 annotate-rects.py 的能力，2026-10-13 并入）：页面坐标 → 裁剪后坐标，框外扩 3px；框超出裁剪区直接报错，不静默裁掉
    if args.mark and not args.rects:
        sys.exit("--mark 需要配 --rects")
    if args.rects:
        rects = load_rects(args.rects)
        marks = [m.split("=", 1) if "=" in m else [m, ""] for m in args.mark]
        missing = [lab for lab, _ in marks if lab not in rects]
        if missing:
            sys.exit(f"rects 里没有: {missing}；可用: {sorted(rects)[:20]}")
        if args.crop:
            cx0, cy0, cw, ch = parse_ints(args.crop, 4, "crop")
        else:
            with Image.open(args.src) as _im:
                cx0, cy0, cw, ch = 0, 0, _im.width, _im.height
        cx1, cy1 = cx0 + cw, cy0 + ch
        start = len(args.box)
        for i, (lab, txt) in enumerate(marks, start + 1):
            x0, y0, x1, y1 = rects[lab]
            bx, by = x0 - cx0 - 3, y0 - cy0 - 3
            if bx < 0 or by < 0 or x1 > cx1 or y1 > cy1:
                sys.exit(f"{lab} 超出裁剪区 x={cx0},y={cy0},w={cw},h={ch}: {rects[lab]}")
            args.box.append(f"{int(bx)},{int(by)},{int(x1 - x0 + 6)},{int(y1 - y0 + 6)},{i},{txt}")

    if not os.path.exists(args.src):
        sys.exit(f"找不到原图: {args.src}")
    if not 1 <= args.scale <= 4:
        sys.exit("--scale 取值 1~4")
    color = tuple(parse_ints(args.color, 3, "color"))
    if max(color) < 120 or (max(color) - min(color) < 40 and max(color) < 200):
        sys.exit(f"--color {args.color} 太暗或接近黑/灰，标注没有区分度。默认红 255,0,0；"
                 "需要区分多组时可用 蓝 0,112,255 / 橙 255,128,0 / 绿 0,170,60 / 洋红 220,0,180")

    im = Image.open(args.src).convert("RGB")
    if args.crop:
        x, y, w, h = parse_ints(args.crop, 4, "crop")
        if x < 0 or y < 0 or w <= 0 or h <= 0 or x + w > im.width or y + h > im.height:
            sys.exit(f"--crop 超出原图范围（原图 {im.width}x{im.height}）")
        im = im.crop((x, y, x + w, y + h))

    s = args.scale
    if s != 1:
        im = im.resize((int(im.width * s), int(im.height * s)), Image.LANCZOS)

    draw = ImageDraw.Draw(im)
    line_w = max(2, int(3 * s))
    badge_r = max(12, int(13 * s))
    badge_font = load_font(max(14, int(16 * s)))
    warnings = []

    def text_w(txt, font=None):
        b = draw.textbbox((0, 0), txt, font=font or badge_font)
        return b[2] - b[0]

    def wrap(label, max_w, font=None):
        """按像素宽折行：先尊重手写的换行符，再对每段贪心折行（CJK 逐字也适用）。"""
        out = []
        for para in label.split("\n"):
            para = para.strip()
            if not para:
                continue
            if text_w(para, font) <= max_w:
                out.append(para)
                continue
            line = ""
            for ch in para:
                if text_w(line + ch, font) > max_w and line:
                    out.append(line)
                    line = ch.lstrip()
                else:
                    line += ch
            if line:
                out.append(line)
        return out or [""]

    for spec in args.box:
        parts = spec.split(",", 5)
        label = parts[5].strip().strip('"').strip("'") if len(parts) == 6 else ""
        x, y, w, h, no = parse_ints(",".join(parts[:5]), 5, "box")
        bx, by, bw, bh = (int(v * s) for v in (x, y, w, h))
        draw.rectangle([bx, by, bx + bw, by + bh], outline=color, width=line_w)

        # 标签：圆形编号 + 文字说明（过长自动折行），贴在框上沿；顶不下就移到下沿
        padx, pady, gap = int(10 * s), int(6 * s), int(4 * s)
        px = bx
        avail = im.width - px - badge_r * 2 - padx * 2 - gap
        if avail < int(90 * s):              # 框太靠右，标签整体左移，别把文字挤没
            px = max(0, im.width - int(440 * s))
            avail = im.width - px - badge_r * 2 - padx * 2 - gap

        lines = wrap(label, avail) if label else []
        if len(lines) > 1:
            warnings.append("编号 %s 的说明文字过长，已折成 %d 行" % (no, len(lines)))

        lb = draw.textbbox((0, 0), "Ag", font=badge_font)
        line_h = (lb[3] - lb[1]) + int(4 * s)
        tw = max((text_w(x) for x in lines), default=0)
        plate_w = badge_r * 2 + tw + padx * 2 if label else badge_r * 2
        plate_h = max(badge_r * 2, line_h * len(lines) + pady * 2) if label else badge_r * 2

        py = by - plate_h - gap
        if py < 0:
            py = by + bh + gap
        if py + plate_h > im.height:
            py = max(0, by + gap)

        if label:
            draw.rectangle([px, py, px + plate_w, py + plate_h], fill=color)
        cx = px + badge_r
        cy = min(py + badge_r + (pady if label else 0), py + plate_h - badge_r)
        draw.ellipse([cx - badge_r, cy - badge_r, cx + badge_r, cy + badge_r],
                     fill=color, outline=(255, 255, 255), width=max(1, line_w // 2))
        nb = draw.textbbox((0, 0), str(no), font=badge_font)
        draw.text((cx - (nb[2] - nb[0]) / 2, cy - (nb[3] - nb[1]) / 2 - nb[1]),
                  str(no), fill=(255, 255, 255), font=badge_font)
        for i, ln in enumerate(lines):
            draw.text((px + badge_r * 2 + padx, py + pady + i * line_h - lb[1]),
                      ln, fill=(255, 255, 255), font=badge_font)

    if args.title:
        tf = load_font(max(16, int(18 * s)))
        pad = int(10 * s)
        tlines = wrap(args.title, im.width - pad * 2, tf)
        if len(tlines) > 1:
            warnings.append("顶部说明带过长，已折成 %d 行" % len(tlines))
        tb = draw.textbbox((0, 0), "Ag", font=tf)
        lh = (tb[3] - tb[1]) + int(6 * s)
        bar_h = lh * len(tlines) + pad * 2
        out = Image.new("RGB", (im.width, im.height + bar_h), color)  # 说明带与框同色，不用黑色
        out.paste(im, (0, bar_h))
        d2 = ImageDraw.Draw(out)
        for i, ln in enumerate(tlines):
            d2.text((pad, pad + i * lh - tb[1]), ln, fill=(255, 255, 255), font=tf)
        im = out

    im.save(args.dst)
    print(f"已输出 {args.dst}  ({im.width}x{im.height})  框 {len(args.box)} 个"
          + ("  含说明带" if args.title else ""))
    for w in warnings:
        print("  [WARN] " + w)
    if warnings:
        print("  [!] 折行后必须亲自打开产出图确认文字完整、没压住判定内容，再当证据用。")


if __name__ == "__main__":
    main()
