import type { Variables } from "../../middlewares/oauth";
import apps from "./apps";
import { Hono } from "hono";

const app = new Hono<{ Variables: Variables }>();

app.route("/apps", apps);

export default app;
