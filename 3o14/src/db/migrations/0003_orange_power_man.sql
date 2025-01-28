CREATE TYPE "public"."scope" AS ENUM('read', 'read:accounts', 'read:blocks', 'read:follows', 'write', 'write:accounts', 'write:blocks', 'write:follows', 'follow', 'push');--> statement-breakpoint
CREATE TABLE "access_tokens" (
	"code" text PRIMARY KEY NOT NULL,
	"application_id" uuid NOT NULL,
	"user_id" uuid,
	"scopes" "scope"[] NOT NULL,
	"created" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" varchar(256) NOT NULL,
	"redirect_uris" text[] NOT NULL,
	"scopes" "scope"[] NOT NULL,
	"website" text,
	"client_id" text NOT NULL,
	"client_secret" text NOT NULL,
	"created" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "applications_client_id_unique" UNIQUE("client_id")
);
--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_application_id_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."applications"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_tokens" ADD CONSTRAINT "access_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;