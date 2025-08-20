// server.js

// 1. فراخوانی ابزارهای مورد نیاز
const express = require('express');
const cors = require('cors');
const { Pool, types } = require('pg');

// به درایور می‌گوییم ستون‌های DATE را به عنوان رشته متنی برگرداند
types.setTypeParser(1082, (dateString) => dateString);

// 2. ساخت اپلیکیشن سرور
const app = express();
const PORT = 3001;

// 3. تنظیمات اتصال به دیتابیس
const pool = new Pool({
  user: 'oosmajid',
  host: 'localhost',
  database: 'parinaz_db',
  password: '',
  port: 5432,
});

// تست اتصال به دیتابیس
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('خطا در اتصال به دیتابیس:', err);
  } else {
    console.log('اتصال به دیتابیس PostgreSQL با موفقیت برقرار شد.');
  }
});

// 4. استفاده از ابزارهای کمکی
app.use(cors());
app.use(express.json());

// --- مسیرهای API ---

// مسیر ثبت‌نام کاربر جدید (Onboarding)
app.post('/api/onboarding', async (req, res) => {
  try {
    const { telegram_id, cycle_length, period_length, last_period_date, birth_year } = req.body;
    
    // --- اعتبارسنجی داده‌های ورودی ---
    if (!telegram_id || !last_period_date) {
      return res.status(400).json({ error: 'شناسه تلگرام و تاریخ آخرین پریود ضروری است.' });
    }
    const today = new Date().toLocaleDateString('en-CA'); // Gets 'YYYY-MM-DD' format
    if (last_period_date > today) {
        return res.status(400).json({ error: 'تاریخ آخرین پریود نمی‌تواند در آینده باشد.' });
    }
    
    const cycle = parseInt(cycle_length, 10);
    const period = parseInt(period_length, 10);
    const year = parseInt(birth_year, 10);

    if (isNaN(cycle) || cycle < 21 || cycle > 60) {
        return res.status(400).json({ error: 'طول سیکل باید عددی بین ۲۱ تا ۶۰ باشد.' });
    }
    if (isNaN(period) || period < 2 || period > 12) {
        return res.status(400).json({ error: 'طول دوره پریود باید عددی بین ۲ تا ۱۲ باشد.' });
    }
    // Note: This range for birth year should be updated periodically
    if (isNaN(year) || year < 1350 || year > 1404) { 
        return res.status(400).json({ error: 'سال تولد نامعتبر است.' });
    }

    const query = `
      INSERT INTO users (telegram_id, cycle_length, period_length, last_period_date, birth_year)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (telegram_id) DO NOTHING
      RETURNING *;
    `;
    const values = [telegram_id, cycle, period, last_period_date, year];
    const result = await pool.query(query, values);

    if (result.rows.length === 0) {
        const existingUserRes = await pool.query('SELECT * FROM users WHERE telegram_id = $1', [telegram_id]);
        return res.status(200).json({ message: 'کاربر از قبل وجود داشت', user: existingUserRes.rows[0] });
    }
    res.status(201).json({ message: 'کاربر با موفقیت ایجاد شد', user: result.rows[0] });
  } catch (error) {
    console.error('خطا در ثبت‌نام کاربر:', error);
    res.status(500).json({ error: 'خطای داخلی سرور' });
  }
});

// مسیر دریافت اطلاعات کامل کاربر و گزارش‌های او
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

        res.status(200).json({ user, logs });
    } catch (error) {
        console.error('خطا در دریافت اطلاعات کاربر:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});

// مسیر ذخیره یا به‌روزرسانی گزارش روزانه
app.post('/api/logs', async (req, res) => {
    try {
        const { user_id, log_date, ...logData } = req.body;
        if (!user_id || !log_date) {
            return res.status(400).json({ error: 'شناسه کاربری و تاریخ گزارش ضروری است.' });
        }

        // --- اعتبارسنجی داده‌های گزارش ---
        if (logData.notes && logData.notes.length > 500) {
            return res.status(400).json({ error: 'یادداشت نمی‌تواند بیشتر از ۵۰۰ کاراکتر باشد.' });
        }
        if (logData.weight) {
            const weight = parseFloat(logData.weight);
            if (isNaN(weight) || weight < 30 || weight > 250) {
                return res.status(400).json({ error: 'مقدار وزن باید عددی بین ۳۰ تا ۲۵۰ باشد.' });
            }
        }

        const allowedColumns = ['weight', 'water', 'sleep', 'sex', 'libido', 'moods', 'symptoms', 'activity', 'breasts', 'discharge', 'blood_color', 'flow', 'hair', 'nails', 'skin', 'other', 'notes'];
        const columns = Object.keys(logData).filter(key => allowedColumns.includes(key));
        const values = columns.map(key => logData[key]);
        
        if (columns.length === 0) {
            return res.status(400).json({ error: 'هیچ داده معتبری برای ذخیره ارسال نشده است.' });
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

// مسیر حذف گزارش روزانه
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


// مسیر به‌روزرسانی تنظیمات کاربر
app.put('/api/user/:telegram_id', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const { cycle_length, period_length, last_period_date, birth_year } = req.body;

        // --- اعتبارسنجی داده‌های ورودی ---
        const today = new Date().toLocaleDateString('en-CA'); // Gets 'YYYY-MM-DD' format
        if (last_period_date > today) {
            return res.status(400).json({ error: 'تاریخ آخرین پریود نمی‌تواند در آینده باشد.' });
        }
        
        const cycle = parseInt(cycle_length, 10);
        const period = parseInt(period_length, 10);
        const year = parseInt(birth_year, 10);

        if (isNaN(cycle) || cycle < 21 || cycle > 60) {
            return res.status(400).json({ error: 'طول سیکل باید عددی بین ۲۱ تا ۶۰ باشد.' });
        }
        if (isNaN(period) || period < 2 || period > 12) {
            return res.status(400).json({ error: 'طول دوره پریود باید عددی بین ۲ تا ۱۲ باشد.' });
        }
        // Note: This range for birth year should be updated periodically
        if (isNaN(year) || year < 1350 || year > 1404) {
            return res.status(400).json({ error: 'سال تولد نامعتبر است.' });
        }

        const query = `
            UPDATE users
            SET cycle_length = $1, period_length = $2, last_period_date = $3, birth_year = $4
            WHERE telegram_id = $5
            RETURNING *;
        `;
        const values = [cycle, period, last_period_date, year, telegram_id];
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


// 5. روشن کردن سرور
app.listen(PORT, () => {
  console.log(`سرور با موفقیت روی پورت ${PORT} اجرا شد.`);
});
