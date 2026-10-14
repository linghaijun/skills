"""L0（薄包装，2026-10-13 起）：旧命令兼容层 —— 能力已并入 `annotate.py --rects/--mark`，本文件只把旧的位置参数转成新参数。

新写法（推荐）：
  python annotate.py <原图.png> <输出.png> --crop x,y,w,h --title "<图顶总说明>" --rects <rects.json> --mark "lab=框边说明" ...

旧写法（仍可用）：
  python annotate-rects.py <原图.png> <rects.json> <输出.png> "x0,y0,x1,y1" "<图顶总说明>" "lab=框边说明" ...
    rects.json：{"lab": [x0, y0, x1, y1], ...}（截图像素），或直接是 cdp.mjs 的原始输出（{"result":{"value":"<json>"}}）
               ——值不是 4 个数字的键（如 *_text / page / dpr）自动忽略
    "x0,y0,x1,y1"：裁剪区（截图像素，注意是两角坐标，不是 x,y,w,h）；框超出裁剪区直接报错，不静默裁掉

  例：python annotate-rects.py p1-raw.png p1-rects.json AC-NN-01-<中文判定点>-标注.png "630,480,1500,830" \
        "AC-08 第 1 页：ADSP / SD 行只有 Ad 名称" "dsp1_cell=ADSP：只有 Ad 名称，无商品图与 ID" "sd1_cell=SD：只有 Creative"

为什么要它：手算裁剪偏移最容易框歪；坐标必须来自页面（× dpr）且与截图同帧（见 SCRIPTS.md「证据图类」坑 14/15/16）。
出图后必须亲自打开看：文字完整、没压住判定点（压住了就删框或拆成两张图，坑 16b）。
"""
import os
import subprocess
import sys
from pathlib import Path

ANN = Path(__file__).with_name("annotate.py")


def main():
    if len(sys.argv) < 7:
        sys.exit(__doc__)
    raw, rj, out, crop, title = sys.argv[1:6]
    cx0, cy0, cx1, cy1 = [int(v) for v in crop.split(",")]
    args = [sys.executable, str(ANN), raw, out, "--crop", f"{cx0},{cy0},{cx1 - cx0},{cy1 - cy0}",
            "--scale", "2", "--title", title, "--rects", rj]
    for m in sys.argv[6:]:
        args += ["--mark", m]
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                         env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    print(res.stdout.strip())
    if res.stderr.strip():
        print(res.stderr.strip())
    sys.exit(res.returncode)


if __name__ == "__main__":
    main()
