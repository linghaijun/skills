"""L0：页面导出的框坐标（截图像素）→ 裁剪坐标 → 交给 annotate.py 出「框边写字」标注图。

为什么要它：手算裁剪偏移最容易框歪；坐标必须来自页面（× dpr）且与截图同帧（见 SCRIPTS.md「证据图类」）。

用法：
  python annotate-rects.py <原图.png> <rects.json> <输出.png> "x0,y0,x1,y1" "<图顶总说明>" "lab=框边说明" ...
    rects.json：{"lab": [x0, y0, x1, y1], ...}（截图像素），或直接是 cdp.mjs 的原始输出（{"result":{"value":"<json>"}}）
               ——值不是 4 个数字的键（如 *_text / page / dpr）自动忽略
    "x0,y0,x1,y1"：裁剪区（截图像素）；框超出裁剪区直接报错，不静默裁掉

  例：python annotate-rects.py p1-raw.png p1-rects.json p1-annotated.png "630,480,1500,830" \
        "AC-08 第 1 页：ADSP / SD 行只有 Ad 名称" "dsp1_cell=ADSP：只有 Ad 名称，无商品图与 ID" "sd1_cell=SD：只有 Creative"

出图后必须亲自打开看：文字完整、没压住判定点（压住了就删框或拆成两张图）。
"""
import json
import subprocess
import sys
from pathlib import Path

ANN = Path(__file__).with_name("annotate.py")


def load_rects(p):
    data = json.load(open(p, encoding="utf-8"))
    if isinstance(data, dict) and isinstance(data.get("result"), dict) and isinstance(data["result"].get("value"), str):
        data = json.loads(data["result"]["value"])
    return {k: v for k, v in data.items()
            if isinstance(v, list) and len(v) == 4 and all(isinstance(n, (int, float)) for n in v)}


def main():
    if len(sys.argv) < 7:
        sys.exit(__doc__)
    raw, rj, out, crop, title = sys.argv[1:6]
    marks = [a.split("=", 1) for a in sys.argv[6:]]
    rects = load_rects(rj)
    missing = [lab for lab, _ in marks if lab not in rects]
    if missing:
        sys.exit(f"rects 里没有: {missing}；可用: {sorted(rects)[:20]}")
    cx0, cy0, cx1, cy1 = [int(v) for v in crop.split(",")]
    args = [sys.executable, str(ANN), raw, out, "--crop", f"{cx0},{cy0},{cx1 - cx0},{cy1 - cy0}",
            "--scale", "2", "--title", title]
    for i, (lab, txt) in enumerate(marks, 1):
        x0, y0, x1, y1 = rects[lab]
        bx, by = x0 - cx0 - 3, y0 - cy0 - 3
        if bx < 0 or by < 0 or x1 > cx1 or y1 > cy1:
            sys.exit(f"{lab} 超出裁剪区 {crop}: {rects[lab]}")
        args += ["--box", f"{int(bx)},{int(by)},{int(x1 - x0 + 6)},{int(y1 - y0 + 6)},{i},{txt}"]
    res = subprocess.run(args, capture_output=True, text=True, encoding="utf-8",
                         env={**__import__("os").environ, "PYTHONIOENCODING": "utf-8"})
    print(res.stdout.strip())
    if res.stderr.strip():
        print(res.stderr.strip())
    sys.exit(res.returncode)


if __name__ == "__main__":
    main()
