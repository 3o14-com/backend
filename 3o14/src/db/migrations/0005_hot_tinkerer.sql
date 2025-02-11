ALTER TABLE "users" ADD COLUMN "rsa_private_key" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "rsa_public_key" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ed25519_private_key" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ed25519_public_key" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "rsa_private_key";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "rsa_public_key";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "ed25519_private_key";--> statement-breakpoint
ALTER TABLE "accounts" DROP COLUMN "ed25519_public_key";