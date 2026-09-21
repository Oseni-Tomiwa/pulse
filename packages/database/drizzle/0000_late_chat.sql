CREATE TABLE "health_checks" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "health_checks_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"monitor_id" uuid NOT NULL,
	"healthy" boolean NOT NULL,
	"status_code" integer,
	"latency_ms" integer NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"error_type" text,
	"error_message" text,
	CONSTRAINT "health_checks_latency_ms_check" CHECK ("health_checks"."latency_ms" >= 0),
	CONSTRAINT "health_checks_status_code_check" CHECK ("health_checks"."status_code" is null or "health_checks"."status_code" between 100 and 599),
	CONSTRAINT "health_checks_error_type_check" CHECK ("health_checks"."error_type" is null or "health_checks"."error_type" in ('http_error', 'connection_error', 'timeout', 'dns_error', 'tls_error', 'network_error'))
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"monitor_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"resolved_at" timestamp with time zone,
	CONSTRAINT "incidents_status_check" CHECK ("incidents"."status" in ('open', 'resolved')),
	CONSTRAINT "incidents_resolved_at_check" CHECK ("incidents"."status" = 'open' and "incidents"."resolved_at" is null or "incidents"."status" = 'resolved' and "incidents"."resolved_at" >= "incidents"."started_at")
);
--> statement-breakpoint
CREATE TABLE "monitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"service_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'http' NOT NULL,
	"url" text NOT NULL,
	"method" text DEFAULT 'GET' NOT NULL,
	"interval_ms" integer DEFAULT 60000 NOT NULL,
	"timeout_ms" integer DEFAULT 10000 NOT NULL,
	"failure_threshold" integer DEFAULT 3 NOT NULL,
	"recovery_threshold" integer DEFAULT 1 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "monitors_kind_check" CHECK ("monitors"."kind" = 'http'),
	CONSTRAINT "monitors_method_check" CHECK ("monitors"."method" in ('GET', 'HEAD')),
	CONSTRAINT "monitors_interval_ms_check" CHECK ("monitors"."interval_ms" > 0),
	CONSTRAINT "monitors_timeout_ms_check" CHECK ("monitors"."timeout_ms" > 0),
	CONSTRAINT "monitors_failure_threshold_check" CHECK ("monitors"."failure_threshold" > 0),
	CONSTRAINT "monitors_recovery_threshold_check" CHECK ("monitors"."recovery_threshold" > 0)
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "health_checks" ADD CONSTRAINT "health_checks_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_monitor_id_monitors_id_fk" FOREIGN KEY ("monitor_id") REFERENCES "public"."monitors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "monitors" ADD CONSTRAINT "monitors_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "health_checks_monitor_checked_id_idx" ON "health_checks" USING btree ("monitor_id","checked_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incidents_monitor_started_at_idx" ON "incidents" USING btree ("monitor_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "incidents_one_open_per_monitor_idx" ON "incidents" USING btree ("monitor_id") WHERE "incidents"."status" = 'open';--> statement-breakpoint
CREATE INDEX "monitors_service_id_idx" ON "monitors" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "services_project_id_idx" ON "services" USING btree ("project_id");