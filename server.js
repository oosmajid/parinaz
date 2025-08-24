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

// Initialize Telegram Bot
const token = process.env.BOT_TOKEN;
if (!token) {
    console.error('خطا: توکن ربات تلگرام در فایل .env تعریف نشده است.');
    process.exit(1);
}
const bot = new TelegramBot(token);

pool.query('SELECT NOW()', (err) => {
  if (err) console.error('خطا در اتصال به دیتابیس:', err);
  else console.log('اتصال به دیتابیس PostgreSQL با موفقیت برقرار شد.');
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// --- END: BOT & DB Initialization ---


const calculateAverages = (history) => {
    if (history.length < 2) {
        const avgPeriod = history.length > 0 ? history.reduce((sum, p) => sum + p.duration, 0) / history.length : null;
        return { avgCycleLength: null, avgPeriodLength: avgPeriod };
    }
    const sortedHistory = [...history].sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
    const cycleLengths = [];
    for (let i = 0; i < sortedHistory.length - 1; i++) {
        const startDate = new Date(sortedHistory[i].start_date);
        const prevStartDate = new Date(sortedHistory[i + 1].start_date);
        const diffDays = Math.round((startDate - prevStartDate) / (1000 * 60 * 60 * 24));
        if (diffDays >= 18 && diffDays <= 65) cycleLengths.push(diffDays);
    }
    const periodLengths = sortedHistory.map(p => p.duration);
    const calculateExponentiallyWeightedAverage = (arr) => {
        if (arr.length === 0) return null;
        const decayFactor = 0.75; 
        let weightedSum = 0;
        let totalWeight = 0;
        arr.forEach((value, index) => {
            const weight = Math.pow(decayFactor, index);
            weightedSum += value * weight;
            totalWeight += weight;
        });
        return totalWeight > 0 ? (weightedSum / totalWeight) : null;
    };
    const avgCycleLength = calculateExponentiallyWeightedAverage(cycleLengths);
    const avgPeriodLength = calculateExponentiallyWeightedAverage(periodLengths);
    return { avgCycleLength, avgPeriodLength };
};


// --- API Routes (Existing ones remain the same) ---
// ... (All your existing routes like /onboarding, /user/:telegram_id, /logs, etc.)
// ... just add the new one below them ...

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


// --- START: NEW PDF REPORT ENDPOINT ---
app.post('/api/user/:telegram_id/report', async (req, res) => {
    const { telegram_id } = req.params;
    const { months } = req.body;

    try {
        // 1. Fetch user data (This logic can be expanded later)
        const userResult = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        // const user = userResult.rows[0];

        // 2. Create PDF
        const doc = new PDFDocument({ margin: 50 });
        const filePath = path.join(__dirname, `report-${telegram_id}.pdf`);
        const stream = fs.createWriteStream(filePath);
        doc.pipe(stream);

        // --- Add content to PDF ---
        // Register font
        const fontPath = path.join(__dirname, 'public/fonts/Vazirmatn-Regular.ttf');
        if (fs.existsSync(fontPath)) {
            doc.registerFont('Vazir', fontPath);
            doc.font('Vazir');
        } else {
            console.warn("Warning: Vazir font not found. Using default font.");
        }
        
        // This is a simple PDF. You can expand it later with real data.
        doc.fontSize(25).text('گزارش سلامت پریناز', { align: 'center' });
        doc.fontSize(16).text(`گزارش برای بازه زمانی: ${months} ماه گذشته`, { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text('این گزارش به صورت خودکار توسط ربات پریناز تولید شده است.');

        // Finalize the PDF and end the stream
        doc.end();

        // 3. Wait for the file to be written, then send it
        stream.on('finish', async () => {
            try {
                const caption = `گزارش شما برای ${months} ماه گذشته آماده است.`;
                await bot.sendDocument(telegram_id, filePath, { caption });
                
                // 4. Clean up the temporary file
                fs.unlinkSync(filePath); 

                res.status(200).json({ message: 'گزارش با موفقیت از طریق ربات ارسال شد.' });
            } catch (botError) {
                console.error('خطا در ارسال فایل توسط ربات:', botError);
                // Also clean up the file on error
                if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                res.status(500).json({ error: 'خطا در ارسال گزارش از طریق ربات.' });
            }
        });

    } catch (error) {
        console.error('خطا در ساخت گزارش PDF:', error);
        res.status(500).json({ error: 'خطای داخلی سرور هنگام ساخت گزارش.' });
    }
});
// --- END: NEW PDF REPORT ENDPOINT ---


app.listen(PORT, () => {
  console.log(`سرور با موفقیت روی پورت ${PORT} اجرا شد.`);
});