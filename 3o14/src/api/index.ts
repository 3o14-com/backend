import { Hono } from "hono";
import { cors } from "hono/cors";

import v1 from "./v1";

const app = new Hono();

app.use(
  cors({
    origin: "*",
    allowMethods: ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"],
    exposeHeaders: ["Link"],
  }),
);

app.route("/v1", v1);

export default app;
