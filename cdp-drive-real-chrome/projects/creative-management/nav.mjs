import { connect } from "../../scripts/conn.mjs"; const c = await connect(); await c.send("Page.enable");
await c.send("Page.navigate", { url: process.argv[2] }); await c.sleep(Number(process.env.WAIT || 3000)); console.log("nav", process.argv[2]); c.close();
