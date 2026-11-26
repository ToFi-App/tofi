CREATE TABLE IF NOT EXISTS "transaction_group_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"plaid_transaction_id" text,
	"manual_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_member_xor" CHECK (("transaction_group_members"."plaid_transaction_id" IS NOT NULL) <> ("transaction_group_members"."manual_transaction_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "transaction_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"color" text NOT NULL,
	"icon" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_group_members" ADD CONSTRAINT "transaction_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_group_members" ADD CONSTRAINT "transaction_group_members_group_id_transaction_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."transaction_groups"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_group_members" ADD CONSTRAINT "transaction_group_members_manual_transaction_id_manual_transactions_id_fk" FOREIGN KEY ("manual_transaction_id") REFERENCES "public"."manual_transactions"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "transaction_groups" ADD CONSTRAINT "transaction_groups_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transaction_group_members_plaid_unique" ON "transaction_group_members" USING btree ("user_id","plaid_transaction_id") WHERE "transaction_group_members"."plaid_transaction_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "transaction_group_members_manual_unique" ON "transaction_group_members" USING btree ("user_id","manual_transaction_id") WHERE "transaction_group_members"."manual_transaction_id" IS NOT NULL;--> statement-breakpoint
-- The blanket policy loop in 0001 only covers tables that existed when it ran, so both new tables
-- need their own. Same shape: RLS on, one FOR ALL owner policy on auth.uid().
ALTER TABLE public.transaction_groups ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "transaction_groups_owner" ON public.transaction_groups;--> statement-breakpoint
CREATE POLICY "transaction_groups_owner" ON public.transaction_groups FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);--> statement-breakpoint
ALTER TABLE public.transaction_group_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP POLICY IF EXISTS "transaction_group_members_owner" ON public.transaction_group_members;--> statement-breakpoint
CREATE POLICY "transaction_group_members_owner" ON public.transaction_group_members FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
