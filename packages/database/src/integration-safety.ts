export function requireTestDatabaseUrl(
  testUrl: string | undefined,
  applicationUrl?: string,
): string {
  if (!testUrl) {
    throw new Error("TEST_DATABASE_URL is required for PostgreSQL integration tests");
  }

  let target: URL;
  try {
    target = new URL(testUrl);
  } catch {
    throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL");
  }

  if (!["postgres:", "postgresql:"].includes(target.protocol)) {
    throw new Error("TEST_DATABASE_URL must be a PostgreSQL URL");
  }

  const databaseName = decodeURIComponent(target.pathname.slice(1));
  if (!/(^|[_-])(test|testing|integration|ci)([_-]|$)/i.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL database name must contain a test marker");
  }

  const productionMarker = /(^|[._-])(prod|production|live)([._-]|$)/i;
  if (productionMarker.test(target.hostname) || productionMarker.test(databaseName)) {
    throw new Error("TEST_DATABASE_URL appears to target production");
  }

  if (applicationUrl) {
    let application: URL;
    try {
      application = new URL(applicationUrl);
    } catch {
      throw new Error("DATABASE_URL must be a valid URL when integration tests run");
    }
    if (
      target.hostname === application.hostname &&
      target.port === application.port &&
      target.pathname === application.pathname
    ) {
      throw new Error("TEST_DATABASE_URL must not target the DATABASE_URL database");
    }
  }

  return testUrl;
}
