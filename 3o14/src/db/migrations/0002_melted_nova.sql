CREATE TYPE "public"."post_type" AS ENUM('Article', 'Note', 'Question');--> statement-breakpoint
CREATE TYPE "public"."post_visibility" AS ENUM('public', 'unlisted', 'private', 'direct');--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"uri" text NOT NULL,
	"type" "post_type" NOT NULL,
	"account_id" uuid NOT NULL,
	"reply_target_id" uuid,
	"sharing_id" uuid,
	"visibility" "post_visibility" NOT NULL,
	"summary" text,
	"content_html" text,
	"content" text,
	"sensitive" boolean DEFAULT false NOT NULL,
	"url" text,
	"replies_count" bigint DEFAULT 0,
	"shares_count" bigint DEFAULT 0,
	"likes_count" bigint DEFAULT 0,
	"published" timestamp with time zone,
	"updated" timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "posts_uri_unique" UNIQUE("uri"),
	CONSTRAINT "posts_id_actor_id_unique" UNIQUE("id","account_id"),
	CONSTRAINT "posts_account_id_sharing_id_unique" UNIQUE("account_id","sharing_id")
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "visibility" "post_visibility" DEFAULT 'public' NOT NULL;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_reply_target_id_posts_id_fk" FOREIGN KEY ("reply_target_id") REFERENCES "public"."posts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_sharing_id_posts_id_fk" FOREIGN KEY ("sharing_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "posts_sharing_id_index" ON "posts" USING btree ("sharing_id");--> statement-breakpoint
CREATE INDEX "posts_account_id_index" ON "posts" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "posts_account_id_sharing_id_index" ON "posts" USING btree ("account_id","sharing_id");--> statement-breakpoint
CREATE INDEX "posts_reply_target_id_index" ON "posts" USING btree ("reply_target_id");--> statement-breakpoint
CREATE INDEX "posts_visibility_account_id_index" ON "posts" USING btree ("visibility","account_id");--> statement-breakpoint
CREATE INDEX "posts_visibility_account_id_sharing_id_index" ON "posts" USING btree ("visibility","account_id","sharing_id") WHERE "posts"."sharing_id" is not null;--> statement-breakpoint
CREATE INDEX "posts_visibility_account_id_reply_target_id_index" ON "posts" USING btree ("visibility","account_id","reply_target_id") WHERE "posts"."reply_target_id" is not null;