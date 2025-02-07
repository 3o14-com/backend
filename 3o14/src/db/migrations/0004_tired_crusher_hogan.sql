ALTER TABLE "timeline_posts" DROP CONSTRAINT "timeline_posts_account_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "timeline_posts" ADD CONSTRAINT "timeline_posts_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;