CREATE TABLE "appraisal_case" (
	"case_id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"meta" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_comparison" (
	"case_id" text PRIMARY KEY NOT NULL,
	"comparison" jsonb NOT NULL,
	"comparison_form" jsonb NOT NULL,
	"computed" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_regional_factors" (
	"case_id" text PRIMARY KEY NOT NULL,
	"regional_factors" jsonb NOT NULL,
	"regional_total" text,
	"remarks" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "case_survey" (
	"case_id" text PRIMARY KEY NOT NULL,
	"survey" jsonb NOT NULL,
	"benchmark" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "case_comparison" ADD CONSTRAINT "case_comparison_case_id_appraisal_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."appraisal_case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_regional_factors" ADD CONSTRAINT "case_regional_factors_case_id_appraisal_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."appraisal_case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "case_survey" ADD CONSTRAINT "case_survey_case_id_appraisal_case_case_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."appraisal_case"("case_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appraisal_case_section_id_idx" ON "appraisal_case" USING btree ("section_id");