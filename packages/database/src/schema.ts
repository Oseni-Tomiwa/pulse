import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
});

export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    name: text("name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [index("services_project_id_idx").on(table.projectId)],
);

export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id").primaryKey(),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    name: text("name").notNull(),
    kind: text("kind").notNull().default("http"),
    url: text("url").notNull(),
    method: text("method").notNull().default("GET"),
    intervalMs: integer("interval_ms").notNull().default(60_000),
    timeoutMs: integer("timeout_ms").notNull().default(10_000),
    failureThreshold: integer("failure_threshold").notNull().default(3),
    recoveryThreshold: integer("recovery_threshold").notNull().default(1),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("monitors_service_id_idx").on(table.serviceId),
    check("monitors_kind_check", sql`${table.kind} = 'http'`),
    check("monitors_method_check", sql`${table.method} in ('GET', 'HEAD')`),
    check("monitors_interval_ms_check", sql`${table.intervalMs} > 0`),
    check("monitors_timeout_ms_check", sql`${table.timeoutMs} > 0`),
    check("monitors_failure_threshold_check", sql`${table.failureThreshold} > 0`),
    check("monitors_recovery_threshold_check", sql`${table.recoveryThreshold} > 0`),
  ],
);

export const healthChecks = pgTable(
  "health_checks",
  {
    id: bigint("id", { mode: "bigint" }).primaryKey().generatedAlwaysAsIdentity(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id),
    healthy: boolean("healthy").notNull(),
    statusCode: integer("status_code"),
    latencyMs: integer("latency_ms").notNull(),
    checkedAt: timestamp("checked_at", { withTimezone: true }).notNull(),
    errorType: text("error_type"),
    errorMessage: text("error_message"),
  },
  (table) => [
    index("health_checks_monitor_checked_id_idx").on(
      table.monitorId,
      table.checkedAt.desc(),
      table.id.desc(),
    ),
    check("health_checks_latency_ms_check", sql`${table.latencyMs} >= 0`),
    check(
      "health_checks_status_code_check",
      sql`${table.statusCode} is null or ${table.statusCode} between 100 and 599`,
    ),
    check(
      "health_checks_error_type_check",
      sql`${table.errorType} is null or ${table.errorType} in ('http_error', 'connection_error', 'timeout', 'dns_error', 'tls_error', 'network_error')`,
    ),
  ],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id),
    status: text("status").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    index("incidents_monitor_started_at_idx").on(
      table.monitorId,
      table.startedAt.desc(),
    ),
    uniqueIndex("incidents_one_open_per_monitor_idx")
      .on(table.monitorId)
      .where(sql`${table.status} = 'open'`),
    check("incidents_status_check", sql`${table.status} in ('open', 'resolved')`),
    check(
      "incidents_resolved_at_check",
      sql`${table.status} = 'open' and ${table.resolvedAt} is null or ${table.status} = 'resolved' and ${table.resolvedAt} >= ${table.startedAt}`,
    ),
  ],
);
