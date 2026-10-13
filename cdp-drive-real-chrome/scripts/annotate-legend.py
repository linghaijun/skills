# L0 证据标注图（图例版）：框上只画编号，标题与每条说明放在图片下方的图例条，不遮挡页面内容
#
#   python annotate-legend.py raw.png rects.json out.png "标题" "lab1=说明1" "lab2=说明2" ...
#
# rects.json：{ "lab": [x0, y0, x1, y1], ... }，**截图像素**坐标（= CSS 像素 × devicePixelRatio）。
#   必须从页面导出（getBoundingClientRect × dpr），且与截图**同一状态**（同滚动位置、同视口）—— 肉眼量必错。
#   L1 的 cells.mjs / colrect.mjs 会直接产出这种 rects.json。
#
# 为什么不把说明文字画在框旁边：实测框多了以后文字压住相邻单元格（恰恰是判定点），
#   且框靠近图边时文字被裁掉。编号 + 图例条两个问题都没有。
# 原图不改，输出另存（验收 C7：原件未被篡改，标注图以 -annotated 结尾）。
# Windows 控制台打印中文报 UnicodeEncodeError → 运行前设 PYTHONIOENCODING=utf-8。
# 微软雅黑没有「↔ ⇄ ✓」等符号字形，会渲染成方块 → 文案里用「对应 / 与 / OK」。
# 一个框只框一个判定点：图例说「4 列」而框只框到 1 列，验收员会判「看不出」（C2）。
import json, sys
from PIL import Image, ImageDraw, ImageFont

raw, rj, out, title = sys.argv[1:5]
marks = [a.split('=', 1) for a in sys.argv[5:]]
r = json.load(open(rj, encoding='utf-8'))
im = Image.open(raw).convert('RGB'); W, H = im.size
FONT = 'C:/Windows/Fonts/msyh.ttc'; FONT_B = 'C:/Windows/Fonts/msyhbd.ttc'
f = ImageFont.truetype(FONT, 40); fb = ImageFont.truetype(FONT_B, 44)
RED = (220, 30, 30)
d = ImageDraw.Draw(im)
missing = [lab for lab, _ in marks if lab not in r]
if missing:
    sys.exit('rects.json 里没有这些标签: %s（可用: %s）' % (missing, list(r)))
for i, (lab, _) in enumerate(marks):
    x0, y0, x1, y1 = r[lab]
    d.rectangle([x0 - 4, y0 - 4, x1 + 4, y1 + 4], outline=RED, width=6)
    cx, cy = max(x0 - 4, 30), max(y0 - 4, 30)
    d.ellipse([cx - 26, cy - 26, cx + 26, cy + 26], fill=RED)
    d.text((cx, cy), str(i + 1), fill=(255, 255, 255), font=fb, anchor='mm')
lh = 60; legend_h = 40 + lh * (len(marks) + 1)
canvas = Image.new('RGB', (W, H + legend_h), (255, 255, 250)); canvas.paste(im, (0, 0))
d = ImageDraw.Draw(canvas); d.line([0, H, W, H], fill=RED, width=4)
y = H + 20; d.text((30, y), title, fill=RED, font=fb); y += lh
for i, (_, txt) in enumerate(marks):
    d.ellipse([30, y + 4, 78, y + 52], fill=RED)
    d.text((54, y + 28), str(i + 1), fill=(255, 255, 255), font=fb, anchor='mm')
    d.text((96, y + 4), txt, fill=(30, 30, 30), font=f); y += lh
canvas.save(out); print('saved', out)
