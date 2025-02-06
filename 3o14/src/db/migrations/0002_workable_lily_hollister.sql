ALTER TABLE "featured_tags" DROP CONSTRAINT "featured_tags_account_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "featured_tags" ADD CONSTRAINT "featured_tags_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;