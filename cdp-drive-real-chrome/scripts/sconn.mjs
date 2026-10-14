// L0 防卡死连接 —— 2026-10-13 起是 conn.mjs 的别名：connect() = conn.mjs 的 connect({ ...opts, hardCap: true })。
//
//   import { connect } from "<skill>/scripts/sconn.mjs";
//   const c = await connect();                       // 同 conn.mjs：CDP_TARGET / CDP_PORT / CDP_MATCH / CDP_VIEWPORT / CDP_SEND_TIMEOUT
//   await c.shot("a.png");                           // 直接截图（不抢前台）→ 最小化则临时恢复 → 重试 → bringToFront → screencast（见 conn.mjs）
//   const r = await c.waitStable(RECTS_EXPR);        // 轮询表达式结果，连续两次逐字节一致才返回（toast / 滑入动画先停稳再截）
//   const f = await c.snapSame(RECTS_EXPR, "x.png"); // 截图前后各导一次 rects，返回 { same, before, after }，不一致自动重拍
//
// 与直接用 conn.mjs 的唯一区别：hardCap —— 连显式传入的更长超时也压到 CDP_SEND_TIMEOUT（默认 30s）以内，
// 保证子 agent 里任何一次调用都不会挂过看门狗（10 分钟无输出即被终止）。shot / waitStable / snapSame 的能力已并入 conn.mjs。
//
// 为什么有它（CP-58118，2026-10-13）：两个子 agent 因 Page.captureScreenshot 无超时卡死 10 分钟被看门狗终止；
// AC-62 第 4 轮因提示框滑入中截图、前后 rects 不一致被验收退回。所有 CDP 调用 ≤30s + 重试 + 兜底，是子 agent brief 的必含项
// （workflow playbook §12「brief 必含项」）。开测前另跑 chk401.mjs 确认登录态。
// 旧脚本 `import { connect } from "./sconn.mjs"` 无需改动。
import { connect as base } from "./conn.mjs";
export { PORT, DEFAULT_MATCH, SEND_TIMEOUT, cliTargetOpts, listPages, pickPage, resolvePage } from "./conn.mjs";

export async function connect(opts = {}) {
  return base({ ...opts, hardCap: true });
}
