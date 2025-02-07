import { Hono } from "hono";
import { Layout } from "../components/Layout";
import {
  RegisterForm,
  type RegisterFormErrors,
} from "../components/RegisterForm";

import { z } from "zod";
import db from "../db/db";
import { eq } from "drizzle-orm";
import { accounts, instances, users } from "../db/schema";
import { LoginForm, type LoginFormErrors } from "../components/LoginForm";
import { hash, verify } from "argon2";
import { sign } from "hono/jwt";

import fedi from "../federation";
import { exportJwk, generateCryptoKeyPair } from "@fedify/fedify";

const RegisterBodySchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email address")
    .max(254, "Email must not exceed 254 characters"),
  username: z
    .string()
    .min(1, "Username is required")
    .max(254, "Username must not exceed 254 characters"),
  preferredName: z
    .string()
    .min(1, "preferred name is required"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters long"),
  passwordConfirm: z
    .string(),
})
  .refine((data) => data.password === data.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Both passwords must be same",
  });

const auth = new Hono();

auth.get("/register", (c) => {
  return c.html(
    <Layout>
      <div class="h-screen flex flex-col items-center justify-center">
        <h2 class="text-3xl">3o14</h2>
        <div class="card card-compact w-96 bg-base-100 shadow-xl">
          <div class="card-body">
            <RegisterForm />
          </div>
        </div>
        <div id="registration-success" class="h-20">
          <div
            role="alert"
            class="alert alert-success w-auto mt-2 invisible"
          />
        </div>
      </div>
    </Layout>,
  );
});

auth.post("/register", async (c) => {
  const data = await c.req.parseBody();
  const result = RegisterBodySchema.safeParse(data);
  if (result.success) {
    const email = result.data.email;
    const username = result.data.username;
    const preferredName = result.data.preferredName;
    const password = result.data.password;

    const existingEmail = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existingEmail) {
      const errors: RegisterFormErrors = {};
      errors["email"] = { message: "email already in use" };
      return c.html(
        <RegisterForm
          email={email}
          username={username}
          password={password}
          confirmPassword={password}
          errors={errors}
        />,
      );
    }

    const existingUsername = await db.query.users.findFirst({
      where: eq(users.username, username),
    });

    if (existingUsername) {
      const errors: RegisterFormErrors = {};
      errors["username"] = { message: "username is not available" };
      return c.html(
        <RegisterForm
          email={email}
          username={username}
          password={password}
          preferredName={preferredName}
          confirmPassword={password}
          errors={errors}
        />,
      );
    }

    try {
      const userId = crypto.randomUUID();
      const accountId = crypto.randomUUID();
      const fedCtx = fedi.createContext(c.req.raw, undefined);
      // const url = new URL(c.req.url);
      const passwordHash = await hash(password);

      const rsaKeyPairs = await generateCryptoKeyPair("RSASSA-PKCS1-v1_5");
      const ed25519KeyPairs = await generateCryptoKeyPair("Ed25519");

      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          email,
          username,
          passwordHash,
        });

        await tx
          .insert(instances)
          .values({
            host: fedCtx.host,
            software: "3o14",
            softwareVersion: null,
          })
          .onConflictDoNothing();

        await tx.insert(accounts).values({
          id: accountId,
          userId,
          uri: fedCtx.getActorUri(username).href,
          handle: `@${username}@${fedCtx.host}`,
          // handle: `@${username}@3o14.com`,
          instanceHost: fedCtx.host,
          name: preferredName,
          // bio,
          url: fedCtx.getActorUri(username).href,
          protected: false,
          inboxUrl: fedCtx.getInboxUri(username).href,
          followersUrl: fedCtx.getFollowersUri(username).href,
          sharedInboxUrl: fedCtx.getInboxUri().href,
          featuredUrl: fedCtx.getFeaturedUri(username).href,
          rsaPublicKey: await exportJwk(rsaKeyPairs.publicKey),
          rsaPrivateKey: await exportJwk(rsaKeyPairs.privateKey),
          ed25519PublicKey: await exportJwk(ed25519KeyPairs.publicKey),
          ed25519PrivateKey: await exportJwk(ed25519KeyPairs.privateKey),
        });
      });
      return c.redirect("/auth/login");
    } catch (error) {
      console.error(error);
    }
  } else {
    const errors: RegisterFormErrors = {};
    for (let error of result.error.errors) {
      errors[error.path[0]] = { message: error.message };
    }
    return c.html(
      <RegisterForm
        email={data.email}
        username={data.username}
        preferredName={data.preferredName}
        password={data.password}
        confirmPassword={data.confirmPassword}
        errors={errors}
      />,
    );
  }
});

auth.get("/login", async (c) => {
  const next = c.req.query("next");
  return c.html(
    <Layout>
      <div class="h-screen flex flex-col items-center justify-center">
        <h2 class="text-3xl">3o14</h2>
        <div class="card card-compact w-96 bg-base-100 shadow-xl">
          <div class="card-body">
            <LoginForm next={next} />
          </div>
        </div>
      </div>
    </Layout>,
  );
});

const LoginBodySchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email address"),
  password: z
    .string(),
});

auth.post("/login", async (c) => {
  const data = await c.req.parseBody();
  const result = LoginBodySchema.safeParse(data);
  const next = data["next"]?.toString();
  if (result.success) {
    const email = result.data.email;
    const password = result.data.password;

    const user = await db.query.users.findFirst({
      where: eq(users.email, email),
    });

    if (user == null || !(await verify(user.passwordHash, password))) {
      const errors: LoginFormErrors = {};
      errors["email"] = { message: "Invalid email or password" };
      c.res.headers.append("HX-Retarget", "closest div");
      c.res.headers.append("HX-Push-Url", "false");
      return c.html(
        <LoginForm
          next={next}
          email={email}
          errors={errors}
        />,
      );
    }

    const secret_key = Bun.env["SECRET_KEY"];
    if (secret_key == undefined) throw new Error("SECRET_KEY must be defined");
    const tokenLifespan = 60 * 60 * 24 * 1; // 1 day
    const token = await sign({
      userId: user.id,
      exp: Math.floor(Date.now() / 1000) + tokenLifespan, // 1 day
    }, secret_key);

    c.header(
      "Set-Cookie",
      `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${tokenLifespan}`,
    );
    return c.redirect(next ?? "/profile");
  } else {
    const errors: LoginFormErrors = {};
    for (let error of result.error.errors) {
      errors[error.path[0]] = { message: error.message };
    }
    c.res.headers.append("HX-Retarget", "closest div");
    c.res.headers.append("HX-Push-Url", "false");
    return c.html(
      <LoginForm
        next={next}
        email={data.email}
        errors={errors}
      />,
    );
  }
});

export default auth;
