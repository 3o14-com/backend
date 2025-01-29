import { Hono } from "hono";
import { scopeRequired, tokenRequired, type Variables } from "../../middlewares/oauth";
import { serializeUser } from "../../entities/accounts";
import db from "../../db/db";

const app = new Hono<{ Variables: Variables }>();


app.get(
  "/verify_credentials",
  tokenRequired,
  scopeRequired(["read:accounts"]),
  async (c) => {
    const user = c.get('token').user;
    if (user == null) {
      return c.json(
        { error: "This method requires an authenticed user" },
        422,
      );
    }
    console.log(serializeUser(user, c.req.url));
    c.res.headers.set('Content-Type', 'application/json')
    return c.json(serializeUser(user, c.req.url))
  }
)


export default app;
