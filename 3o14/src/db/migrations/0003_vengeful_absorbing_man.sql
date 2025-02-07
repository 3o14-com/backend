ALTER TABLE "bookmarks" RENAME COLUMN "user_id" TO "account_id";--> statement-breakpoint
ALTER TABLE "bookmarks" DROP CONSTRAINT "bookmarks_user_id_accounts_id_fk";
--> statement-breakpoint
DROP INDEX "bookmarks_post_id_user_id_index";--> statement-breakpoint
ALTER TABLE "bookmarks" DROP CONSTRAINT "bookmarks_post_id_user_id_pk";--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_post_id_account_id_pk" PRIMARY KEY("post_id","account_id");--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bookmarks_post_id_account_id_index" ON "bookmarks" USING btree ("post_id","account_id");