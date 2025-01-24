import { Hono } from "hono";
import { loginRequired } from "../middlewares/login";

const profile = new Hono();
profile.use(loginRequired);

profile.get("/", async (c) => {
  return c.text("profile");
})


export default profile;
