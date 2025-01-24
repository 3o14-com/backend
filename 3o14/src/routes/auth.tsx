import { Hono } from "hono";
import { Layout } from "../components/Layout";
import { RegisterForm, type RegisterFormErrors } from "../components/RegisterForm";

import { z } from "zod";
import db from "../db/db";
import { eq } from "drizzle-orm";
import { users } from "../db/schema";
import { LoginForm, type LoginFormErrors } from "../components/LoginForm";
import { zValidator } from "@hono/zod-validator";
import { hash, verify } from "argon2";
import { sign } from "hono/jwt";

const RegisterBodySchema = z.object({
  email: z
    .string()
    .email('Please enter a valid email address')
    .max(254, 'Email must not exceed 254 characters'),
  username: z
    .string()
    .min(1, 'Username is required')
    .max(254, 'Email must not exceed 254 characters'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long'),
  passwordConfirm: z
    .string()
})
  .refine((data) => data.password === data.passwordConfirm, {
    path: ["passwordConfirm"],
    message: "Both passwords must be same",
  })

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
    </Layout>
  );
});

auth.post("/register", async (c) => {
  const data = await c.req.parseBody();
  const result = RegisterBodySchema.safeParse(data);
  if (result.success) {
    const email = result.data.email;
    const username = result.data.username;
    const password = result.data.password;

    const existingEmail = await db.query.users.findFirst({
      where: eq(users.email, email),
    });
    if (existingEmail) {
      const errors: RegisterFormErrors = {};
      errors['email'] = { message: "email already in use" };
      return c.html(
        <RegisterForm
          email={email}
          username={username}
          password={password}
          confirmPassword={password}
          errors={errors}
        />
      );
    }

    const existingUsername = await db.query.users.findFirst({
      where: eq(users.username, username),
    })

    if (existingUsername) {
      const errors: RegisterFormErrors = {};
      errors['username'] = { message: "username is not available" };
      return c.html(
        <RegisterForm
          email={email}
          username={username}
          password={password}
          confirmPassword={password}
          errors={errors}
        />
      );
    }

    try {
      const userId = crypto.randomUUID();
      await db.transaction(async (tx) => {
        await tx.insert(users).values({
          id: userId,
          email,
          username,
          password_hash: await hash(password),
        })
      })
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
        password={data.password}
        confirmPassword={data.confirmPassword}
        errors={errors}
      />
    );
  }
})



auth.get("/login", async (c) => {
  return c.html(
    <Layout>
      <div class="h-screen flex flex-col items-center justify-center">
        <h2 class="text-3xl">3o14</h2>
        <div class="card card-compact w-96 bg-base-100 shadow-xl">
          <div class="card-body">
            <LoginForm />
          </div>
        </div>
      </div>
    </Layout>
  );
});

const LoginBodySchema = z.object({
  email: z
    .string()
    .email('Please enter a valid email address'),
  password: z
    .string()
});

auth.post("/login", zValidator('form', LoginBodySchema), async (c) => {
  const validated = c.req.valid('form');
  const email = validated.email;
  const password = validated.password;

  const user = await db.query.users.findFirst({
    where: eq(users.email, email),
  });

  if (user == null || !(await verify(user.password_hash, password))) {
    const errors: LoginFormErrors = {};
    errors['email'] = { message: "Invalid email or password" };
    return c.html(
      <LoginForm
        email={email}
        errors={errors}
      />,
      400
    )
  }

  const secret_key = Bun.env['SECRET_KEY'];
  if (secret_key == undefined) throw new Error("SECRET_KEY must be defined");
  const tokenLifespan = 60 * 60 * 24 * 1; // 1 day
  const token = await sign({
    userId: user.id,
    exp: Math.floor(Date.now() / 1000) + tokenLifespan, // 1 day
  },
    secret_key);

  c.header("Set-Cookie", `token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${tokenLifespan}`);
  return c.redirect("/profile");
})

export default auth;
