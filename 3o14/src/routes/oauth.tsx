import { base64 } from "@hexagon/base64";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { Layout } from "../components/Layout";
import { db } from "../db/db";
import { loginRequired } from "../middlewares/login";
import {
  type Account,
  type User,
  type Application,
  type Scope,
  accessTokens,
  applications,
  scopeEnum,
} from "../db/schema";
import { uuid } from "../utils/uuid";
import { SECRET_KEY, type Variables } from "../middlewares/oauth";

const app = new Hono<{ Variables: Variables }>();

const scopesSchema = z
  .string()
  .trim()
  .transform((v, ctx) => {
    const scopes: Scope[] = [];
    for (const scope of v.split(/\s+/g)) {
      if (!scopeEnum.enumValues.includes(scope as Scope)) {
        ctx.addIssue({
          code: z.ZodIssueCode.invalid_enum_value,
          options: scopeEnum.enumValues,
          received: scope,
        });
        return z.NEVER;
      }
      scopes.push(scope as Scope);
    }
    return scopes;
  });

app.get(
  "/authorize",
  zValidator(
    "query",
    z.object({
      response_type: z.enum(["code"]),
      client_id: z.string(),
      redirect_uri: z.string().url(),
      scope: scopesSchema.optional(),
      state: z.string().optional(),
    }),
  ),
  loginRequired,
  async (c) => {
    const data = c.req.valid("query");
    const application = await db.query.applications.findFirst({
      where: eq(applications.clientId, data.client_id),
    });
    if (application == null) return c.json({ error: "invalid_client_id" }, 400);
    const scopes = data.scope ?? ["read"];
    if (scopes.some((s) => !application.scopes.includes(s))) {
      return c.json({ error: "invalid_scope" }, 400);
    }
    if (!application.redirectUris.includes(data.redirect_uri)) {
      return c.json({ error: "invalid_redirect_uri" }, 400);
    }
    const users = await db.query.users.findMany({
      with: { account: true },
    });
    return c.html(
      <AuthorizationPage
        users={users}
        application={application}
        redirectUri={data.redirect_uri}
        scopes={scopes}
        state={data.state}
      />,
    );
  },
);





interface AuthorizationPageProps {
  users: (User & { account: Account })[];
  application: Application;
  redirectUri: string;
  scopes: Scope[];
  state?: string;
}

function AuthorizationPage(props: AuthorizationPageProps) {
  return (
    <Layout>
      <div class="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
        <div class="max-w-xl mx-auto">
          <div class="bg-white shadow rounded-lg overflow-hidden">
            {/* Header */}
            <div class="px-6 py-4 border-b border-gray-200">
              <h2 class="text-xl font-semibold text-gray-900">
                3o14: Authorize {props.application.name}
              </h2>
            </div>

            {/* Content */}
            <div class="px-6 py-4 space-y-6">
              <div>
                <p class="text-gray-700">Do you want to authorize {props.application.name}</p>
                <div class="mt-4">
                  <p class="font-medium text-gray-900 mb-2">It allows the application to:</p>
                  <ul class="space-y-2">
                    {props.scopes.map((scope) => (
                      <li key={scope} class="flex items-center">
                        <code class="px-2 py-1 bg-gray-100 rounded text-sm text-gray-800">
                          {scope}
                        </code>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <form action="/oauth/authorize" method="post" class="space-y-6">
                <div>
                  <p class="font-medium text-gray-900 mb-4">Choose an account to authorize:</p>
                  <div class="space-y-3">
                    {props.users.map((user, i) => (
                      <label key={user.id} class="flex items-start space-x-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer">
                        <input
                          type="radio"
                          name="account_id"
                          value={user.id}
                          checked={i === 0}
                          class="mt-1 h-4 w-4 text-blue-600 border-gray-300 focus:ring-blue-500"
                        />
                        <div class="flex-1">
                          <strong class="text-gray-900">{user.account.preferredName}</strong>
                          <p class="mt-1 text-sm text-gray-500">{user.account.handle}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>

                <input type="hidden" name="application_id" value={props.application.id} />
                <input type="hidden" name="redirect_uri" value={props.redirectUri} />
                <input type="hidden" name="scopes" value={props.scopes.join(" ")} />
                {props.state != null && <input type="hidden" name="state" value={props.state} />}

                <div class="flex items-center justify-end space-x-4">
                  {props.redirectUri !== "urn:ietf:wg:oauth:2.0:oob" && (
                    <button
                      type="submit"
                      name="decision"
                      value="deny"
                      class="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      Deny
                    </button>
                  )}
                  <button
                    type="submit"
                    name="decision"
                    value="allow"
                    class="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    Allow
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </Layout>
  )
}

app.post(
  "/authorize",
  loginRequired,
  zValidator(
    "form",
    z.object({
      account_id: uuid,
      application_id: uuid,
      redirect_uri: z.string().url(),
      scopes: scopesSchema,
      state: z.string().optional(),
      decision: z.enum(["allow", "deny"]),
    }),
  ),
  async (c) => {
    const form = c.req.valid("form");
    const application = await db.query.applications.findFirst({
      where: eq(applications.id, form.application_id),
    });
    if (application == null) return c.notFound();
    if (form.scopes.some((s) => !application.scopes.includes(s))) {
      return c.json({ error: "invalid_scope" }, 400);
    }
    if (!application.redirectUris.includes(form.redirect_uri)) {
      return c.json({ error: "invalid_redirect_uri" }, 400);
    }
    const url = new URL(form.redirect_uri);
    if (form.decision === "deny") {
      url.searchParams.set("error", "access_denied");
      url.searchParams.set(
        "error_description",
        "The resource owner or authorization server denied the request.",
      );
    } else {
      const code = base64.fromArrayBuffer(
        crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer,
        true,
      );
      await db.insert(accessTokens).values({
        userId: form.account_id,
        code,
        applicationId: application.id,
        scopes: form.scopes,
      });
      if (form.redirect_uri === "urn:ietf:wg:oauth:2.0:oob") {
        return c.html(
          <AuthorizationCodePage application={application} code={code} />,
        );
      }
      url.searchParams.set("code", code);
      if (form.state != null) url.searchParams.set("state", form.state);
    }
    return c.redirect(url.href);
  },
);

interface AuthorizationCodePageProps {
  application: Application;
  code: string;
}

function AuthorizationCodePage(props: AuthorizationCodePageProps) {
  return (
    <Layout title={"Hollo: Authorization Code"}>
      <hgroup>
        <h1>Authorization Code</h1>
        <p>Here is your authorization code.</p>
      </hgroup>
      <pre>{props.code}</pre>
      <p>
        Copy this code and paste it into <em>{props.application.name}</em>.
      </p>
    </Layout>
  );
}

const tokenRequestSchema = z.object({
  grant_type: z.enum(["authorization_code", "client_credentials"]),
  code: z.string().optional(),
  client_id: z.string(),
  client_secret: z.string(),
  redirect_uri: z.string().url().optional(),
  scope: scopesSchema.optional(),
});

app.post("/token", cors(), async (c) => {
  let form: z.infer<typeof tokenRequestSchema>;
  const contentType = c.req.header("Content-Type");
  if (
    contentType === "application/json" ||
    contentType?.match(/^application\/json\s*;/)
  ) {
    const json = await c.req.json();
    const result = await tokenRequestSchema.safeParseAsync(json);
    if (!result.success) {
      return c.json({ error: "Invalid request", zod_error: result.error }, 400);
    }
    form = result.data;
  } else {
    const formData = await c.req.parseBody();
    const result = await tokenRequestSchema.safeParseAsync(formData);
    if (!result.success) {
      return c.json({ error: "Invalid request", zod_error: result.error }, 400);
    }
    form = result.data;
  }
  const application = await db.query.applications.findFirst({
    where: eq(applications.clientId, form.client_id),
  });
  if (application == null || application.clientSecret !== form.client_secret) {
    return c.json(
      {
        error: "invalid_client",
        error_description:
          "Client authentication failed due to unknown client, " +
          "no client authentication included, or unsupported authentication " +
          "method.",
      },
      401,
    );
  }
  const scopes = form.scope ?? ["read"];
  if (scopes.some((s) => !application.scopes.includes(s))) {
    return c.json(
      {
        error: "invalid_scope",
        error_description:
          "The requested scope is invalid, unknown, or malformed.",
      },
      400,
    );
  }
  if (form.grant_type === "authorization_code") {
    if (form.code == null) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "The authorization code is required.",
        },
        400,
      );
    }

    if (!form.redirect_uri) {
      return c.json(
        {
          error: "invalid_request",
          error_description:
            "The authorization code grant flow requires a redirect URI.",
        },
        400,
      );
    }

    const token = await db.query.accessTokens.findFirst({
      where: eq(accessTokens.code, form.code),
      with: { application: true },
    });
    if (token == null) {
      return c.json(
        {
          error: "invalid_grant",
          error_description:
            "The provided authorization code is invalid, expired, revoked, " +
            "does not match the redirection URI used in the authorization " +
            "request, or was issued to another client.",
        },
        400,
      );
    }

    // Validate that the redirect URI given is registered with the Application
    // (since we"re not tracking Access Grants which would bind the redirect URI
    // to the code)
    if (!token.application.redirectUris.includes(form.redirect_uri)) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Invalid redirect URI.",
        },
        400,
      );
    }

    const now = (Date.now() / 1000) | 0;
    const message = `${now}^${token.code}`;
    const textEncoder = new TextEncoder();
    const secretKey = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(SECRET_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      secretKey,
      textEncoder.encode(message),
    );
    const accessToken = `${base64.fromArrayBuffer(signature, true)}^${message}`;
    return c.json({
      access_token: accessToken,
      token_type: "Bearer",
      scope: token.scopes.join(" "),
      created_at: now,
    });
  }

  const code = base64.fromArrayBuffer(
    crypto.getRandomValues(new Uint8Array(16)).buffer as ArrayBuffer,
    true,
  );
  const tokens = await db
    .insert(accessTokens)
    .values({
      code,
      applicationId: application.id,
      scopes,
      // grant_type: "client_credentials",
    })
    .returning();
  return c.json({
    access_token: tokens[0].code,
    token_type: "Bearer",
    scope: tokens[0].scopes.join(" "),
    created_at: (+tokens[0].created / 1000) | 0,
  });
});

export async function oauthAuthorizationServer(c: Context) {
  const url = new URL(c.req.url);

  return c.json({
    issuer: new URL("/", url).href,
    authorization_endpoint: new URL("/oauth/authorize", url).href,
    token_endpoint: new URL("/oauth/token", url).href,
    // Not yet supported by Hollo:
    // "revocation_endpoint": "",
    scopes_supported: scopeEnum.enumValues,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "client_credentials"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      // Not supported by Hollo:
      // "client_secret_basic",
    ],
    app_registration_endpoint: new URL("/api/v1/apps", url).href,
  });
}

export default app;
