// 用法: node click.mjs <page-script 返回 {x,y}（CSS 像素）> —— 真实鼠标点击
import { connect } from "../../scripts/conn.mjs"; import fs from "node:fs";
const c = await connect();
const p = await c.ev(fs.readFileSync(process.argv[2], "utf8"));
if (!p || p.x == null) { console.log("no target", JSON.stringify(p)); process.exit(3); }
for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await c.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 });
await c.sleep(Number(process.env.WAIT || 1500));
console.log(JSON.stringify(p)); c.close();
