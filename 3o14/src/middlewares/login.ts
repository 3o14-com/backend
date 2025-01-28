import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { verify } from "hono/jwt";

const secret_key = Bun.env['SECRET_KEY'];
if (secret_key == undefined) throw new Error("SECRET_KEY must be defined");

export const loginRequired = createMiddleware(async (c, next) => {
  const token = getCookie(c, 'token');
  if (token == null) {
    return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.url)}`);
  }

  try {
    const decoded = await verify(token, secret_key);
    c.set('userId', decoded['userId']);
    await next();
  } catch (error) {
    return c.redirect(`/auth/login?next=${encodeURIComponent(c.req.url)}`);
  }
})
