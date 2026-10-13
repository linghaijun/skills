// L0 截图（按 CDP_TARGET 锁定标签；CDP_VIEWPORT 控制视口）：  CDP_TARGET=<id> node shot.mjs out.png
// 截图与 rects 必须同一状态：先导矩形（cells.mjs / col-rect.mjs），中间不滚动不改视口，再截。
import { connect } from "./conn.mjs";
const out = process.argv[2] || "shot.png"; const c = await connect();
await c.shot(out); console.log("saved", out); c.close();
