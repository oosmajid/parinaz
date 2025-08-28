require('dotenv').config();
const { Pool } = require('pg');
const jalaliMoment = require('jalali-moment');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Helper function from server.js
const jalaliToGregorian = (jalaliStr) => {
    if (!jalaliStr || typeof jalaliStr !== 'string') return null;
    const m = jalaliMoment(jalaliStr.trim(), 'jYYYY-jM-jD');
    return m.isValid() ? m.format('YYYY-MM-DD') : null;
};

async function migrate() {
    const client = await pool.connect();
    try {
        console.log('Starting migration...');
        
        // 1. Alter tables to add temporary columns
        console.log('Altering tables...');
        await client.query('ALTER TABLE users ADD COLUMN last_period_date_gregorian DATE;');
        await client.query('ALTER TABLE period_history ADD COLUMN start_date_gregorian DATE;');
        await client.query('ALTER TABLE daily_logs ADD COLUMN log_date_gregorian DATE;');

        // 2. Migrate users table
        console.log('Migrating users...');
        const users = await client.query('SELECT id, last_period_date FROM users WHERE last_period_date IS NOT NULL;');
        for (const user of users.rows) {
            const gregorian = jalaliToGregorian(user.last_period_date);
            if (gregorian) {
                await client.query('UPDATE users SET last_period_date_gregorian = $1 WHERE id = $2', [gregorian, user.id]);
            }
        }

        // 3. Migrate period_history table
        console.log('Migrating period_history...');
        const history = await client.query('SELECT id, start_date FROM period_history;');
        for (const record of history.rows) {
            const gregorian = jalaliToGregorian(record.start_date);
            if (gregorian) {
                await client.query('UPDATE period_history SET start_date_gregorian = $1 WHERE id = $2', [gregorian, record.id]);
            }
        }

        // 4. Migrate daily_logs table
        console.log('Migrating daily_logs...');
        const logs = await client.query('SELECT id, log_date FROM daily_logs;');
        for (const log of logs.rows) {
            const gregorian = jalaliToGregorian(log.log_date);
            if (gregorian) {
                await client.query('UPDATE daily_logs SET log_date_gregorian = $1 WHERE id = $2', [gregorian, log.id]);
            }
        }
        
        // 5. Drop old columns and rename new ones
        console.log('Finalizing schema changes...');
        await client.query('ALTER TABLE users DROP COLUMN last_period_date;');
        await client.query('ALTER TABLE users RENAME COLUMN last_period_date_gregorian TO last_period_date;');
        
        await client.query('ALTER TABLE period_history DROP COLUMN start_date;');
        await client.query('ALTER TABLE period_history RENAME COLUMN start_date_gregorian TO start_date;');

        await client.query('ALTER TABLE daily_logs DROP COLUMN log_date;');
        await client.query('ALTER TABLE daily_logs RENAME COLUMN log_date_gregorian TO log_date;');

        console.log('Migration completed successfully!');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();