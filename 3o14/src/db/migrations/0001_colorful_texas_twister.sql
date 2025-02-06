ALTER TABLE "featured_tags" RENAME COLUMN "user_id" TO "account_id";--> statement-breakpoint
ALTER TABLE "lists" RENAME COLUMN "user_id" TO "account_id";--> statement-breakpoint
ALTER TABLE "markers" RENAME COLUMN "user_id" TO "account_id";--> statement-breakpoint
ALTER TABLE "featured_tags" DROP CONSTRAINT "featured_tags_user_id_name_unique";--> statement-breakpoint
ALTER TABLE "bookmarks" DROP CONSTRAINT "bookmarks_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "featured_tags" DROP CONSTRAINT "featured_tags_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "lists" DROP CONSTRAINT "lists_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "markers" DROP CONSTRAINT "markers_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "markers" DROP CONSTRAINT "markers_user_id_type_pk";--> statement-breakpoint
ALTER TABLE "markers" ADD CONSTRAINT "markers_account_id_type_pk" PRIMARY KEY("account_id","type");--> statement-breakpoint
ALTER TABLE "bookmarks" ADD CONSTRAINT "bookmarks_user_id_accounts_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_tags" ADD CONSTRAINT "featured_tags_account_id_users_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lists" ADD CONSTRAINT "lists_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "markers" ADD CONSTRAINT "markers_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_tags" ADD CONSTRAINT "featured_tags_account_id_name_unique" UNIQUE("account_id","name");