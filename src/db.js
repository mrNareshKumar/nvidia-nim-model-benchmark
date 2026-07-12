import pg from 'pg';

export let dbAvailable = false;

let pool;

export async function initDB() {
  if (!process.env.DATABASE_URL) {
    console.log('DATABASE_URL not set — using file-based storage');
    return;
  }
  try {
    pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : false,
    });
    await pool.query('SELECT 1');
    await pool.query(`
      CREATE TABLE IF NOT EXISTS results (
        id TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    dbAvailable = true;
    console.log('PostgreSQL connected');
  } catch (err) {
    console.warn('PostgreSQL unavailable, falling back to file:', err.message);
    try { await pool?.end(); } catch {}
    pool = null;
  }
}

export async function loadResults() {
  if (!pool) return [];
  const { rows } = await pool.query('SELECT data FROM results ORDER BY id');
  return rows.map(r => r.data);
}

export async function upsertResult(result) {
  if (!pool) return;
  await pool.query(
    `INSERT INTO results (id, data, updated_at) VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET data = $2, updated_at = NOW()`,
    [result.id, result]
  );
}

export async function deleteResults(modelIds) {
  if (!pool) return;
  await pool.query('DELETE FROM results WHERE id = ANY($1::text[])', [modelIds]);
}

export async function replaceAll(results) {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query('TRUNCATE results');
    for (const r of results) {
      await client.query(
        'INSERT INTO results (id, data, updated_at) VALUES ($1, $2, NOW())',
        [r.id, r]
      );
    }
  } finally {
    client.release();
  }
}
