const { Pool } = require('pg');
const credentials = require('../config/credentials');

const pool = new Pool({
  connectionString: credentials.databaseUrl,
  ssl: credentials.nodeEnv === 'production' ? { rejectUnauthorized: false } : false,
});

/**
 * Initialize database tables if they don't exist.
 */
async function initDb() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // FCM Tokens Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS fcm_tokens (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        token TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, token)
      )
    `);

    // User Google Tokens Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_google_tokens (
        user_id TEXT PRIMARY KEY,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Watched Sheets Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS watched_sheets (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        spreadsheet_id TEXT NOT NULL,
        sheet_title TEXT NOT NULL,
        last_row_count INTEGER DEFAULT 0,
        last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        access_token TEXT,
        refresh_token TEXT,
        token_expiry TIMESTAMP,
        api_key TEXT UNIQUE,
        UNIQUE(user_id, spreadsheet_id, sheet_title)
      )
    `);

    await client.query('COMMIT');
    console.log('✅ Database tables initialized successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Failed to initialize database tables:', err.message);
  } finally {
    client.release();
  }
}

// Auto-init on load
initDb().catch(err => console.error('Database Init Error:', err));

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
};
