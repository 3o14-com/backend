CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"uri" text NOT NULL,
	"url" text,
	"handle" text NOT NULL,
	"bio" text,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"preferred_name" text,
	"visibility" boolean DEFAULT true NOT NULL,
	"inbox_url" text NOT NULL,
	"shared_inbox_urk" text,
	"outbox_url" text NOT NULL,
	"followers_url" text NOT NULL,
	"following_url" text NOT NULL,
	"following_count" bigint DEFAULT 0,
	"followers_count" bigint DEFAULT 0,
	"posts_count" bigint DEFAULT 0,
	"rsa_private_key" jsonb,
	"rsa_public_key" jsonb NOT NULL,
	"ed25519_private_key" jsonb,
	"ed25519_public_key" jsonb NOT NULL,
	CONSTRAINT "accounts_uri_unique" UNIQUE("uri"),
	CONSTRAINT "accounts_handle_unique" UNIQUE("handle"),
	CONSTRAINT "accounts_inbox_url_unique" UNIQUE("inbox_url"),
	CONSTRAINT "accounts_outbox_url_unique" UNIQUE("outbox_url"),
	CONSTRAINT "accounts_followers_url_unique" UNIQUE("followers_url"),
	CONSTRAINT "accounts_following_url_unique" UNIQUE("following_url")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(254) NOT NULL,
	"username" varchar(254) NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email"),
	CONSTRAINT "users_username_unique" UNIQUE("username"),
	CONSTRAINT "username" CHECK (rtrim(ltrim("users"."username")) = "users"."username" AND "users"."username" <> '' AND length(username) <= 50)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;