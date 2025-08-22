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


// --- الگوریتم هوشمند برای محاسبه میانگین‌ها ---
const calculateAverages = (history) => {
    // اگر کمتر از ۲ رکورد داریم، نمی‌توان طول سیکل را محاسبه کرد
    if (history.length < 2) {
        const avgPeriod = history.length > 0 ? history.reduce((sum, p) => sum + p.duration, 0) / history.length : null;
        return { avgCycleLength: null, avgPeriodLength: avgPeriod };
    }

    // مرتب‌سازی بر اساس تاریخ، از جدید به قدیم
    history.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));

    // محاسبه طول سیکل‌ها (به ترتیب از جدید به قدیم)
    const cycleLengths = [];
    for (let i = 0; i < history.length - 1; i++) {
        const startDate = new Date(history[i].start_date);
        const prevStartDate = new Date(history[i + 1].start_date);
        const diffDays = Math.round((startDate - prevStartDate) / (1000 * 60 * 60 * 24));
        
        // مرحله اول حذف داده پرت: فیلتر کردن سیکل‌های با طول غیرمنطقی
        if (diffDays >= 18 && diffDays <= 65) {
            cycleLengths.push(diffDays);
        }
    }

    const periodLengths = history.map(p => p.duration);

    // تابع محاسبه میانگین وزنی نمایی (مرحله دوم هوشمندسازی)
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


// --- مسیرهای API ---

// مسیر ثبت‌نام کاربر جدید (Onboarding)
app.post('/api/onboarding', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); // شروع تراکنش

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

// مسیر دریافت اطلاعات کامل کاربر، گزارش‌ها و تاریخچه پریود او
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

        // --- CHANGE: اضافه کردن تاریخچه پریود به پاسخ ---
        const historyQuery = 'SELECT start_date, duration FROM period_history WHERE user_id = $1';
        const historyResult = await pool.query(historyQuery, [user.id]);
        const period_history = historyResult.rows;

        res.status(200).json({ user, logs, period_history });
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
    } catch (error)
        {
        console.error('خطا در حذف گزارش:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});

// مسیر به‌روزرسانی تنظیمات کامل کاربر
app.put('/api/user/:telegram_id', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        // --- CHANGE: حذف last_period_date از این مسیر ---
        const { cycle_length, period_length, birth_year } = req.body;

        const cycle = parseInt(cycle_length, 10);
        const period = parseInt(period_length, 10);
        const year = parseInt(birth_year, 10);

        const query = `
            UPDATE users
            SET 
                cycle_length = $1, 
                period_length = $2, 
                birth_year = $3,
                avg_cycle_length = $1::NUMERIC,
                avg_period_length = $2::NUMERIC
            WHERE telegram_id = $4
            RETURNING *;
        `;
        const values = [cycle, period, year, telegram_id];
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

// مسیر ثبت رکورد جدید پریود و یادگیری سیستم
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

        // پیدا کردن جدیدترین تاریخ پریود از تاریخچه برای آپدیت جدول اصلی
        const latestPeriodDate = historyRes.rows.sort((a,b) => new Date(b.start_date) - new Date(a.start_date))[0].start_date;

        const updateQuery = `
            UPDATE users
            SET 
                last_period_date = $1,
                avg_cycle_length = $2,
                avg_period_length = $3
            WHERE id = $4
            RETURNING *;
        `;
        const updatedUserRes = await client.query(updateQuery, [latestPeriodDate, avgCycleLength, avgPeriodLength, userId]);

        await client.query('COMMIT');

        res.status(200).json({ message: 'اطلاعات پریود ثبت و تحلیل شد', user: updatedUserRes.rows[0] });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('خطا در ثبت رکورد پریود:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    } finally {
        client.release();
    }
});


// 5. روشن کردن سرور
app.listen(PORT, () => {
  console.log(`سرور با موفقیت روی پورت ${PORT} اجرا شد.`);
});
