// L0 推动渲染：短暂开 Page.startScreencast 迫使合成器出帧，并可把最后一帧落盘。
//
//   CDP_TARGET=<targetId> node pump.mjs [ms=2000] [out.jpg]
//
// 何时用：窗口被别的窗口整个挡住时，CSS 过渡动画走不完、captureScreenshot 卡住（实测挂满超时）。
// 跑一次 pump 让页面出帧，再读状态 / 截图；或直接拿 out.jpg 当兜底帧（注意：screencast 帧比 DOM 晚一拍，
// 作为关键帧证据时要按帧内像素选帧，见 SCRIPTS.md 坑 16f 与 barw.py）。
// 来源：CP-58118 AC-62 / AC-97（2026-10-13）。
import { connect } from "./conn.mjs";
import fs from "node:fs";

const ms = +(process.argv[2] || 2000);
const out = process.argv[3];
const c = await connect();
let n = 0, last = null;
c.on((m) => { if (m.method === "Page.screencastFrame") { n++; last = m.params.data; c.send("Page.screencastFrameAck", { sessionId: m.params.sessionId }).catch(() => {}); } });
await c.send("Page.startScreencast", { format: "jpeg", quality: 85, maxWidth: 4000, maxHeight: 3000 }, 30000);
await c.sleep(ms);
await c.send("Page.stopScreencast", {}, 30000).catch(() => {});
if (out && last) fs.writeFileSync(out, Buffer.from(last, "base64"));
console.log(JSON.stringify({ frames: n, out: out && last ? out : null }));
c.close();
process.exit(0);
