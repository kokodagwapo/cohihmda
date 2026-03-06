import pg from "pg";

type TestDbContext = {
  pool: pg.Pool;
  connectionString: string;
};

let context: TestDbContext | null = null;

function getConnectionString(): string {
  const connectionString = process.env.TEST_DATABASE_URL || "";
  if (!connectionString.trim()) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Configure it to run DB-backed integration tests.",
    );
  }
  return connectionString.trim();
}

export async function setupTestDb(): Promise<TestDbContext> {
  if (context) return context;
  const connectionString = getConnectionString();
  const pool = new pg.Pool({
    connectionString,
    max: 4,
    idleTimeoutMillis: 10000,
  });
  await pool.query("SELECT 1");
  context = { pool, connectionString };
  return context;
}

export async function teardownTestDb(): Promise<void> {
  if (!context) return;
  await context.pool.end();
  context = null;
}

export async function withTestTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  if (!context) {
    throw new Error("Test DB not initialized. Call setupTestDb() first.");
  }
  const client = await context.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("ROLLBACK");
    return result;
  } finally {
    client.release();
  }
}
