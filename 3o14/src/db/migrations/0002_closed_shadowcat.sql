ALTER TABLE "users" ALTER COLUMN "username" SET DATA TYPE varchar(254);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email" varchar(254) NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "preferred_name" varchar(254);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "bio" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "created_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "updated_at" timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_email_unique" UNIQUE("email");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_preferred_name_unique" UNIQUE("preferred_name");