// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool, types } = require('pg');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const TelegramBot = require('node-telegram-bot-api');
const crypto = require('crypto');

// --- START: BOT & DB Initialization ---
types.setTypeParser(1082, (dateString) => dateString);

const app = express();
const PORT = process.env.PORT || 3001;
const BOT_URL = `https://t.me/${process.env.BOT_USERNAME}`;


const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('FATAL ERROR: BOT_TOKEN is not defined in your .env file.');
    process.exit(1);
}
const bot = new TelegramBot(token, { polling: true });

pool.query('SELECT NOW()', (err) => {
  if (err) console.error('Database Connection Error:', err);
  else console.log('Database connection successful.');
});

const corsOptions = {
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// --- END: BOT & DB Initialization ---

// --- BOT COMMANDS ---
bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match[1];
    const companionUsername = msg.from.username || `کاربر ${msg.from.id}`;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Find the invitation
        const inviteRes = await client.query(
            'SELECT * FROM companion_invites WHERE token = $1 AND is_used = FALSE AND expires_at > NOW()',
            [token]
        );

        if (inviteRes.rows.length === 0) {
            bot.sendMessage(chatId, 'این لینک دعوت معتبر نیست یا منقضی شده است.');
            await client.query('ROLLBACK');
            return;
        }

        const invite = inviteRes.rows[0];
        const primaryUserId = invite.user_id;

        // Get primary user's name
        const primaryUserRes = await client.query('SELECT telegram_username FROM users WHERE id = $1', [primaryUserId]);
        if (primaryUserRes.rows.length === 0) {
            throw new Error('کاربر اصلی پیدا نشد.');
        }
        const primaryUserName = primaryUserRes.rows[0].telegram_username || 'دوست شما';

        // Add to companions table
        const insertCompanionQuery = `
            INSERT INTO companions (user_id, companion_telegram_id, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, companion_telegram_id) DO NOTHING
            RETURNING *;
        `;
        const companionRes = await client.query(insertCompanionQuery, [primaryUserId, chatId, companionUsername]);

        // Mark token as used
        await client.query('UPDATE companion_invites SET is_used = TRUE WHERE id = $1', [invite.id]);
        
        await client.query('COMMIT');

        // Send welcome messages
        bot.sendMessage(chatId, `سلام ${companionUsername}!\nشما به عنوان همراه ${primaryUserName} در پریناز ثبت شدید. از این به بعد، وضعیت چرخه قاعدگی ایشان برای شما ارسال می‌شود تا بتوانید بیشتر مراقبشان باشید.`);
        
        const primaryUserTelegramIdRes = await client.query('SELECT telegram_id FROM users WHERE id = $1', [primaryUserId]);
        if(primaryUserTelegramIdRes.rows.length > 0) {
            const primaryUserTelegramId = primaryUserTelegramIdRes.rows[0].telegram_id;
            bot.sendMessage(primaryUserTelegramId, `همراه جدید شما (${companionUsername}) با موفقیت اضافه شد.`);
        }

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing companion invite:', error);
        bot.sendMessage(chatId, 'خطایی در ثبت شما به عنوان همراه رخ داد. لطفاً دوباره امتحان کنید.');
    } finally {
        client.release();
    }
});


// --- API ROUTES ---

app.post('/api/onboarding', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); 
    const { telegram_id, cycle_length, period_length, last_period_date, birth_year, telegram_username } = req.body;
    if (!telegram_id || !last_period_date) {
      return res.status(400).json({ error: 'شناسه تلگرام و تاریخ آخرین پریود ضروری است.' });
    }
    const values = [telegram_id, cycle_length, period_length, last_period_date, birth_year, telegram_username];
    const userQuery = `
      INSERT INTO users (telegram_id, cycle_length, period_length, last_period_date, birth_year, telegram_username)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (telegram_id) DO UPDATE SET
        cycle_length = EXCLUDED.cycle_length,
        period_length = EXCLUDED.period_length,
        last_period_date = EXCLUDED.last_period_date,
        birth_year = EXCLUDED.birth_year,
        telegram_username = EXCLUDED.telegram_username
      RETURNING *;
    `;
    const result = await client.query(userQuery, values);
    let user = result.rows[0];
    let message = result.rowCount > 0 ? 'کاربر با موفقیت ایجاد یا به‌روزرسانی شد' : 'کاربر از قبل وجود داشت';

    if (result.rowCount > 0) {
       await client.query(
            'INSERT INTO period_history (user_id, start_date, duration) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [user.id, user.last_period_date, user.period_length]
        );
    }
    
    await client.query('COMMIT');
    res.status(201).json({ message, user });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('خطا در ثبت‌نام کاربر:', error);
    res.status(500).json({ error: 'خطای داخلی سرور' });
  } finally {
    client.release();
  }
});

app.get('/api/user/:telegram_id', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const userQuery = 'SELECT * FROM users WHERE telegram_id = $1';
        const userResult = await pool.query(userQuery, [telegram_id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const user = userResult.rows[0];
        const logsQuery = 'SELECT * FROM daily_logs WHERE user_id = $1';
        const logsResult = await pool.query(logsQuery, [user.id]);
        const logs = logsResult.rows.reduce((acc, log) => {
            acc[log.log_date] = log;
            return acc;
        }, {});
        const historyQuery = 'SELECT start_date, duration FROM period_history WHERE user_id = $1';
        const historyResult = await pool.query(historyQuery, [user.id]);
        const period_history = historyResult.rows;

        // Fetch companion details including their username from the users table
        const companionsQuery = `
            SELECT c.*, u.telegram_username 
            FROM companions c 
            LEFT JOIN users u ON c.companion_telegram_id = u.telegram_id
            WHERE c.user_id = $1
        `;
        const companionsResult = await pool.query(companionsQuery, [user.id]);
        const companions = companionsResult.rows.map(c => ({
            id: c.id,
            name: c.telegram_username || c.name, // Prefer username from users table
            notify_daily_symptoms: c.notify_daily_symptoms
        }));

        res.status(200).json({ user, logs, period_history, companions });
    } catch (error) {
        console.error('خطا در دریافت اطلاعات کاربر:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});

app.put('/api/user/:telegram_id', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const { cycle_length, period_length, birth_year, reminder_logs, reminder_cycle, companion_notify_daily_symptoms } = req.body;
        
        // Fetch user to update their global companion setting
        const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const userId = userRes.rows[0].id;
        
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            const query = `
                UPDATE users
                SET cycle_length = $1, period_length = $2, birth_year = $3, reminder_logs = $4, reminder_cycle = $5, companion_notify_daily_symptoms = $6
                WHERE id = $7
                RETURNING *;
            `;
            const values = [cycle_length, period_length, birth_year, reminder_logs, reminder_cycle, companion_notify_daily_symptoms, userId];
            const result = await client.query(query, values);

            await client.query('COMMIT');
            res.status(200).json({ message: 'تنظیمات با موفقیت به‌روزرسانی شد', user: result.rows[0] });
        } catch(e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }

    } catch (error) {
        console.error('خطا در به‌روزرسانی تنظیمات:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});


// ... other routes like logs, period, delete user ...
// ... (omitted for brevity, no changes needed there for this feature)

// --- COMPANION MANAGEMENT ROUTES ---

app.post('/api/user/:telegram_id/generate-invite', async (req, res) => {
    const { telegram_id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const userRes = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const userId = userRes.rows[0].id;

        const token = crypto.randomBytes(16).toString('hex');
        await client.query(
            'INSERT INTO companion_invites (user_id, token) VALUES ($1, $2)',
            [userId, token]
        );
        
        const inviteLink = `${BOT_URL}?start=${token}`;
        
        await bot.sendMessage(telegram_id, `این لینک دعوت را برای همراه خود بفرستید. این لینک یک‌بار مصرف است و تا ۲۴ ساعت آینده اعتبار دارد:\n\n${inviteLink}`);
        
        await client.query('COMMIT');
        res.status(200).json({ message: 'لینک دعوت با موفقیت در تلگرام برای شما ارسال شد.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error generating invite link:', error);
        res.status(500).json({ error: 'خطای داخلی سرور هنگام ایجاد لینک.' });
    } finally {
        client.release();
    }
});

app.put('/api/companion/:companion_id', async (req, res) => {
    try {
        const { companion_id } = req.params;
        const { notify_daily_symptoms } = req.body;
        const query = `
            UPDATE companions SET notify_daily_symptoms = $1 WHERE id = $2 RETURNING *;
        `;
        const result = await pool.query(query, [notify_daily_symptoms, companion_id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'همراه یافت نشد.' });
        }
        res.status(200).json({ message: 'تنظیمات همراه به‌روزرسانی شد.', companion: result.rows[0] });
    } catch (error) {
        console.error('Error updating companion settings:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});


app.delete('/api/companion/:companion_id', async (req, res) => {
    try {
        const { companion_id } = req.params;
        const result = await pool.query('DELETE FROM companions WHERE id = $1', [companion_id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'همراه برای حذف یافت نشد.' });
        }
        res.status(200).json({ message: 'همراه با موفقیت حذف شد.' });
    } catch (error) {
        console.error('Error deleting companion:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});


// Modified PDF report endpoint
app.post('/api/user/:telegram_id/report', async (req, res) => {
    const { telegram_id } = req.params;
    try {
        await bot.sendMessage(telegram_id, 'قابلیت دانلود گزارش pdf هنوز در حال آماده‌سازیه و به زودی آماده می‌شه');
        res.status(200).json({ message: 'پیام با موفقیت ارسال شد.' });
    } catch (error) {
        console.error('[ERROR] Failed to send message via bot:', error.message);
        res.status(500).json({ error: 'خطا در ارسال پیام از طریق ربات.' });
    }
});


app.listen(PORT, () => {
  console.log(`Server is running successfully on port ${PORT}`);
});

// Keep other existing routes for logs, user data etc. as they were
// ... (The full server.js code would include all previous routes)