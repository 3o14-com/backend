import { Hono } from "hono";
import { federation } from "@fedify/fedify/x/hono";
// import { getLogger } from "@logtape/logtape";
import fedi from "../federation";
import { Layout } from "../components/Layout";
import { serveStatic } from "hono/bun";
import LandingPage from "../components/Landing";
import auth from "./auth";
import profile from "./profile";

// const logger = getLogger("3o14");

const app = new Hono();
app.use('/static/*', serveStatic({ root: './' }))
app.use(federation(fedi, () => undefined));
app.route("/auth", auth);
app.route("/profile", profile);

app.get("/", (c) => {
  return c.html(
    <Layout>
      <LandingPage />
    </Layout>
  )
})


export default app;
