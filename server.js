// server.js

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool, types } = require('pg');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const TelegramBot = require('node-telegram-bot-api');

// --- START: BOT & DB Initialization ---
types.setTypeParser(1082, (dateString) => dateString);

const app = express();
const PORT = 3001;

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
const bot = new TelegramBot(token);

pool.query('SELECT NOW()', (err) => {
  if (err) console.error('Database Connection Error:', err);
  else console.log('Database connection successful.');
});

// app.use(cors());
const corsOptions = {
  origin: '*', // به همه دامنه‌ها اجازه دسترسی می‌دهد
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'], // اجازه استفاده از تمام متدها
  allowedHeaders: ['Content-Type', 'Authorization'], // اجازه هدرهای رایج
};
app.use(cors(corsOptions));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// --- END: BOT & DB Initialization ---


// ... (All your other routes like /onboarding, /user/:telegram_id, etc. should be here)
// ... I'm omitting them for brevity, just make sure the new /report route is added ...
app.post('/api/onboarding', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); 
    const { telegram_id, cycle_length, period_length, last_period_date, birth_year } = req.body;
    if (!telegram_id || !last_period_date) {
      return res.status(400).json({ error: 'شناسه تلگرام و تاریخ آخرین پریود ضروری است.' });
    }
    const values = [telegram_id, cycle_length, period_length, last_period_date, birth_year];
    const userQuery = `
      INSERT INTO users (telegram_id, cycle_length, period_length, last_period_date, birth_year)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (telegram_id) DO NOTHING
      RETURNING *;
    `;
    const result = await client.query(userQuery, values);
    let user;
    let message;
    if (result.rows.length === 0) {
        const existingUserRes = await client.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);
        user = existingUserRes.rows[0];
        message = 'کاربر از قبل وجود داشت';
    } else {
        user = result.rows[0];
        message = 'کاربر با موفقیت ایجاد شد';
        await client.query(
            'INSERT INTO period_history (user_id, start_date, duration) VALUES ($1, $2, $3)',
            [user.id, user.last_period_date, user.period_length]
        );
    }
    await client.query('COMMIT');
    res.status(result.rows.length === 0 ? 200 : 201).json({ message, user });
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
        const companionsQuery = 'SELECT * FROM companions WHERE user_id = $1';
        const companionsResult = await pool.query(companionsQuery, [user.id]);
        const companions = companionsResult.rows;
        res.status(200).json({ user, logs, period_history, companions });
    } catch (error) {
        console.error('خطا در دریافت اطلاعات کاربر:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});
app.post('/api/logs', async (req, res) => {
    try {
        const { user_id, log_date, ...logData } = req.body;
        if (!user_id || !log_date) {
            return res.status(400).json({ error: 'شناسه کاربری و تاریخ گزارش ضروری است.' });
        }
        const allowedColumns = ['weight', 'water', 'sleep', 'sex', 'libido', 'moods', 'symptoms', 'activity', 'breasts', 'discharge', 'blood_color', 'flow', 'hair', 'nails', 'skin', 'other', 'notes'];
        const columns = Object.keys(logData).filter(key => allowedColumns.includes(key));
        const values = columns.map(key => logData[key]);
        if (columns.length === 0 && !logData.notes) {
             await pool.query('DELETE FROM daily_logs WHERE user_id = $1 AND log_date = $2', [user_id, log_date]);
             return res.status(200).json({ message: 'گزارش خالی حذف شد', log: null });
        }
        const query = `
            INSERT INTO daily_logs (user_id, log_date, ${columns.join(', ')})
            VALUES ($1, $2, ${columns.map((_, i) => `$${i + 3}`).join(', ')})
            ON CONFLICT (user_id, log_date) DO UPDATE SET
                ${columns.map((col, i) => `${col} = $${i + 3}`).join(', ')}
            RETURNING *;
        `;
        const result = await pool.query(query, [user_id, log_date, ...values]);
        res.status(200).json({ message: 'گزارش با موفقیت ذخیره شد', log: result.rows[0] });
    } catch (error) {
        console.error('خطا در ذخیره گزارش:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});
app.delete('/api/logs', async (req, res) => {
    try {
        const { user_id, log_date } = req.body;
        if (!user_id || !log_date) {
            return res.status(400).json({ error: 'شناسه کاربری و تاریخ گزارش ضروری است.' });
        }
        const query = 'DELETE FROM daily_logs WHERE user_id = $1 AND log_date = $2';
        await pool.query(query, [user_id, log_date]);
        res.status(200).json({ message: 'گزارش با موفقیت حذف شد.' });
    } catch (error) {
        console.error('خطا در حذف گزارش:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});
app.put('/api/user/:telegram_id', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const { cycle_length, period_length, birth_year, reminder_logs, reminder_cycle, companion_notify_daily_symptoms } = req.body;
        const query = `
            UPDATE users
            SET cycle_length = $1, period_length = $2, birth_year = $3, reminder_logs = $4, reminder_cycle = $5, companion_notify_daily_symptoms = $6
            WHERE telegram_id = $7
            RETURNING *;
        `;
        const values = [cycle_length, period_length, birth_year, reminder_logs, reminder_cycle, companion_notify_daily_symptoms, telegram_id];
        const result = await pool.query(query, values);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر برای به‌روزرسانی یافت نشد.' });
        }
        res.status(200).json({ message: 'تنظیمات با موفقیت به‌روزرسانی شد', user: result.rows[0] });
    } catch (error) {
        console.error('خطا در به‌روزرسانی تنظیمات:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});
app.post('/api/user/:telegram_id/period', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { telegram_id } = req.params;
        const { start_date, duration } = req.body;
        const period = parseInt(duration, 10);
        const userRes = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const userId = userRes.rows[0].id;
        const insertQuery = `
            INSERT INTO period_history (user_id, start_date, duration)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, start_date) DO UPDATE SET duration = $3;
        `;
        await client.query(insertQuery, [userId, start_date, period]);
        const historyRes = await client.query('SELECT start_date, duration FROM period_history WHERE user_id = $1', [userId]);
        const { avgCycleLength, avgPeriodLength } = calculateAverages(historyRes.rows);
        const latestPeriodDate = [...historyRes.rows].sort((a,b) => new Date(b.start_date) - new Date(a.start_date))[0].start_date;
        const updateQuery = `
            UPDATE users
            SET last_period_date = $1, avg_cycle_length = $2, avg_period_length = $3
            WHERE id = $4
            RETURNING *;
        `;
        const updatedUserRes = await client.query(updateQuery, [latestPeriodDate, avgCycleLength, avgPeriodLength, userId]);
        await client.query('COMMIT');
        res.status(200).json({ message: 'اطلاعات پریود ثبت و تحلیل شد', user: updatedUserRes.rows[0] });
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('خطا در ثبت زمان پریود:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    } finally {
        client.release();
    }
});
app.delete('/api/user/:telegram_id/period', async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const { telegram_id } = req.params;
        const { scope } = req.body;
        const userRes = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const userId = userRes.rows[0].id;
        let message = '';
        if (scope === 'last') {
            const lastPeriodRes = await client.query('SELECT id FROM period_history WHERE user_id = $1 ORDER BY start_date DESC LIMIT 1', [userId]);
            if (lastPeriodRes.rows.length > 0) {
                const lastPeriodId = lastPeriodRes.rows[0].id;
                await client.query('DELETE FROM period_history WHERE id = $1', [lastPeriodId]);
                message = 'آخرین سابقه پریود با موفقیت حذف شد.';
            } else {
                 message = 'سابقه پریودی برای حذف وجود نداشت.';
            }
            const historyRes = await client.query('SELECT start_date, duration FROM period_history WHERE user_id = $1', [userId]);
            if (historyRes.rows.length > 0) {
                const { avgCycleLength, avgPeriodLength } = calculateAverages(historyRes.rows);
                const latestPeriodDate = [...historyRes.rows].sort((a, b) => new Date(b.start_date) - new Date(a.start_date))[0].start_date;
                const updateUserQuery = `UPDATE users SET last_period_date = $1, avg_cycle_length = $2, avg_period_length = $3 WHERE id = $4 RETURNING *;`;
                const updatedUserRes = await client.query(updateUserQuery, [latestPeriodDate, avgCycleLength, avgPeriodLength, userId]);
                await client.query('COMMIT');
                return res.status(200).json({ message, user: updatedUserRes.rows[0] });
            } else {
                const updateQuery = `UPDATE users SET last_period_date = NULL, avg_cycle_length = NULL, avg_period_length = NULL WHERE id = $1 RETURNING *;`;
                const updatedUserRes = await client.query(updateQuery, [userId]);
                await client.query('COMMIT');
                return res.status(200).json({ message, user: updatedUserRes.rows[0] });
            }
        } else {
             await client.query('DELETE FROM period_history WHERE user_id = $1', [userId]);
             message = 'تمام سوابق پریود با موفقیت حذف شد.';
            const updateQuery = `UPDATE users SET last_period_date = NULL, avg_cycle_length = NULL, avg_period_length = NULL WHERE id = $1 RETURNING *;`;
            const updatedUserRes = await client.query(updateQuery, [userId]);
            await client.query('COMMIT');
            res.status(200).json({ message, user: updatedUserRes.rows[0] });
        }
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('خطا در حذف سوابق پریود:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    } finally {
        client.release();
    }
});
app.delete('/api/user/:telegram_id', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const result = await pool.query('DELETE FROM users WHERE telegram_id = $1', [telegram_id]);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'کاربر برای حذف یافت نشد.' });
        }
        res.status(200).json({ message: 'حساب کاربری و تمام اطلاعات شما با موفقیت حذف شد.' });
    } catch (error) {
        console.error('خطا در حذف حساب کاربری:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});
app.post('/api/user/:telegram_id/companions', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const { companion_telegram_id } = req.body;
        if (!companion_telegram_id) {
            return res.status(400).json({ error: 'شناسه تلگرام همراه ضروری است.' });
        }
        const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const userId = userRes.rows[0].id;
        const query = `
            INSERT INTO companions (user_id, companion_telegram_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id, companion_telegram_id) DO NOTHING
            RETURNING *;
        `;
        const result = await pool.query(query, [userId, companion_telegram_id]);
        if (result.rows.length === 0) {
            return res.status(200).json({ message: 'این همراه از قبل ثبت شده است.' });
        }
        res.status(201).json({ message: 'همراه جدید با موفقیت ثبت شد.', companion: result.rows[0] });
    } catch (error) {
        console.error('خطا در افزودن همراه:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});
app.delete('/api/user/:telegram_id/companions', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const userRes = await pool.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const userId = userRes.rows[0].id;
        await pool.query('DELETE FROM companions WHERE user_id = $1', [userId]);
        res.status(200).json({ message: 'تمام همراهان با موفقیت حذف شدند.' });
    } catch (error) {
        console.error('خطا در حذف همراهان:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});


// --- START: NEW PDF REPORT ENDPOINT with DEBUG LOGS ---
const arabicReshaper = require('arabic-reshaper');
const bidi = require('bidi-js')();

app.post('/api/user/:telegram_id/report', async (req, res) => {
    const { telegram_id } = req.params;
    const { months } = req.body;

    console.log(`[LOG] Report request received for user: ${telegram_id}, months: ${months}`);
    const filePath = path.join(__dirname, `report-${telegram_id}-${Date.now()}.pdf`);

    try {
        const doc = new PDFDocument({ margin: 50, bufferPages: true, size: 'A4' });
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        const fontPath = path.join(__dirname, 'public/Vazirmatn-Regular.ttf');
        if (fs.existsSync(fontPath)) {
            doc.registerFont('Vazir', fontPath);
            doc.font('Vazir');
        } else {
            console.error(`[ERROR] Font file not found at: ${fontPath}.`);
        }

        // --- FINAL FIX: Using the correct function from the imported module ---
        const processText = (text) => {
            // The main export of 'arabic-reshaper' is the reshape function itself in many versions.
            const reshapedText = arabicReshaper.reshape(text);
            return bidi.reorder(reshapedText);
        };
        // --- END FINAL FIX ---

        doc.fontSize(25).text(processText('گزارش سلامت پریناز'), { align: 'center' });
        doc.fontSize(16).text(processText(`گزارش برای بازه زمانی: ${months} ماه گذشته`), { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(processText('این گزارش به صورت خودکار توسط ربات پریناز تولید شده است.'), { align: 'right' });

        doc.end();

        stream.on('finish', async () => {
            try {
                const stats = fs.statSync(filePath);
                console.log(`[LOG] PDF file created at: ${filePath} with size: ${stats.size} bytes.`);
                if (stats.size < 100) {
                    throw new Error('PDF file was created but is likely empty.');
                }

                const caption = `گزارش شما برای ${months} ماه گذشته آماده است.`;
                await bot.sendDocument(telegram_id, filePath, { caption });
                console.log(`[LOG] Document sent successfully to user: ${telegram_id}`);
                res.status(200).json({ message: 'گزارش شما از طریق ربات ارسال شد.' });

            } catch (botError) {
                console.error('[ERROR] Failed to send document via bot:', botError.message);
                res.status(500).json({ error: 'خطا در ارسال گزارش از طریق ربات.' });
            } finally {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        });

        stream.on('error', (err) => {
            console.error('[ERROR] Stream Error during PDF creation:', err);
            res.status(500).json({ error: 'خطا در ایجاد فایل PDF روی سرور.' });
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        });

    } catch (error) {
        console.error('[ERROR] General error in report generation:', error);
        res.status(500).json({ error: 'خطای داخلی سرور هنگام ساخت گزارش.' });
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    }
});
// --- END: NEW PDF REPORT ENDPOINT ---


app.listen(PORT, () => {
  console.log(`Server is running successfully on port ${PORT}`);
});