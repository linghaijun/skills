// 按一次 Escape（关抽屉 / 下拉 / 弹框），并报告是否还有可见抽屉
import { connect } from "../../scripts/conn.mjs"; const c = await connect();
await c.key("Escape", "Escape", 27); await c.sleep(1200);
console.log(JSON.stringify({ drawerOpen: await c.ev(`!![...document.querySelectorAll('.el-drawer')].find(e=>e.getBoundingClientRect().width>0)`) })); c.close();
