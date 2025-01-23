import { Hono } from "hono";
import { federation } from "@fedify/fedify/x/hono";
// import { getLogger } from "@logtape/logtape";
import fedi from "../federation";
import { Layout } from "../components/Layout";
import { serveStatic } from "hono/bun";

// const logger = getLogger("3o14");

const app = new Hono();
app.use('/static/*', serveStatic({ root: './' }))
app.use(federation(fedi, () => undefined));

app.get("/", (c) => {
  return c.html(
    <Layout>
    </Layout>
  );
});

export default app;
