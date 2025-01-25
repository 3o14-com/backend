CREATE TABLE "follows" (
	"uri" text NOT NULL,
	"following_id" uuid NOT NULL,
	"follower_id" uuid NOT NULL,
	"created" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "follows_follower_id_following_id_pk" PRIMARY KEY("follower_id","following_id"),
	CONSTRAINT "follows_uri_unique" UNIQUE("uri"),
	CONSTRAINT "check_self_follow" CHECK ("follows"."follower_id" != "follows"."following_id")
);
--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_outbox_url_unique";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_followers_url_unique";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_following_url_unique";--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "followers_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "following_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "rsa_public_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ALTER COLUMN "ed25519_public_key" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_following_id_accounts_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "follows" ADD CONSTRAINT "follows_follower_id_accounts_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "outbox_url";