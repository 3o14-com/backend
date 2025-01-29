import type { Variables } from "../../middlewares/oauth";
import apps from "./apps";
import accounts from "./accounts";
import { Hono } from "hono";

const app = new Hono<{ Variables: Variables }>();


app.route("/apps", apps);
app.route("/accounts", accounts)

export default app;
