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
const cron = require('node-cron');
const moment = require('moment-timezone');
const jalaliMoment = require('jalali-moment');
// --- START: BOT & DB Initialization ---
types.setTypeParser(1082, (dateString) => dateString);
moment.tz.setDefault('Asia/Tehran');

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

// --- Helper Function for Formatting Names ---
const formatUserName = (firstName, userName) => {
    if (userName) {
        return `${firstName} (@${userName})`;
    }
    return firstName;
};

// --- BOT COMMANDS ---
bot.onText(/\/start$/, async (msg) => {
    const chatId = msg.chat.id;
    const client = await pool.connect();
    try {
        const companionRes = await client.query('SELECT * FROM companions WHERE companion_telegram_id = $1', [chatId]);
        if (companionRes.rows.length > 0) {
            // This user is a companion for someone
            bot.sendMessage(chatId, 'شما به عنوان همراه ثبت شده‌اید. برای مدیریت همراهی‌های خود از دکمه زیر استفاده کنید.', {
                reply_markup: {
                    keyboard: [
                        [{ text: 'لغو همراهی' }]
                    ],
                    resize_keyboard: true,
                    one_time_keyboard: false
                }
            });
        } else {
            // This is a regular user
            bot.sendMessage(chatId, 'سلام! به ربات پریناز خوش آمدید. برای استفاده از امکانات، لطفاً از اپلیکیشن وب استفاده کنید.', {
                reply_markup: {
                    remove_keyboard: true
                }
            });
        }
    } catch (error) {
        console.error('Error in /start handler:', error);
        bot.sendMessage(chatId, 'خطایی رخ داده است.');
    } finally {
        client.release();
    }
});


bot.onText(/\/start (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const token = match[1];
    const companionFirstName = msg.from.first_name || 'همراه';
    const companionUsername = msg.from.username || null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

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

        const primaryUserRes = await client.query('SELECT id, telegram_id, telegram_username, telegram_firstname FROM users WHERE id = $1', [primaryUserId]);
        if (primaryUserRes.rows.length === 0) {
            throw new Error('کاربر اصلی پیدا نشد.');
        }
        
        const primaryUser = primaryUserRes.rows[0];
        
        // Prevent user from adding themselves
        if (primaryUser.telegram_id == chatId) {
            bot.sendMessage(chatId, 'شما نمی‌توانید خودتان را به عنوان همراه اضافه کنید.');
            await client.query('ROLLBACK');
            return;
        }

        const primaryUserDisplayName = formatUserName(primaryUser.telegram_firstname, primaryUser.telegram_username) || 'دوست شما';
        const companionDisplayName = formatUserName(companionFirstName, companionUsername);

        const insertCompanionQuery = `
            INSERT INTO companions (user_id, companion_telegram_id, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (user_id, companion_telegram_id) DO UPDATE SET name = EXCLUDED.name;
        `;
        await client.query(insertCompanionQuery, [primaryUserId, chatId, companionFirstName]);

        await client.query('UPDATE companion_invites SET is_used = TRUE WHERE id = $1', [invite.id]);
        
        await client.query('COMMIT');

        bot.sendMessage(chatId, `سلام ${companionFirstName}!\nشما به عنوان همراه ${primaryUserDisplayName} در پریناز ثبت شدید. از این به بعد، وضعیت چرخه قاعدگی ایشان برای شما ارسال می‌شود تا بتوانید بیشتر مراقبشان باشید.`, {
            reply_markup: {
                keyboard: [[{ text: 'لغو همراهی' }]],
                resize_keyboard: true,
                one_time_keyboard: false
            }
        });
        
        bot.sendMessage(primaryUser.telegram_id, `همراه جدید شما (${companionDisplayName}) با موفقیت اضافه شد.`);

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error processing companion invite:', error);
        bot.sendMessage(chatId, 'خطایی در ثبت شما به عنوان همراه رخ داد. لطفاً دوباره امتحان کنید.');
    } finally {
        client.release();
    }
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    if (msg.text === 'لغو همراهی') {
        const client = await pool.connect();
        try {
            const res = await client.query(`
                SELECT c.user_id, u.telegram_firstname, u.telegram_username 
                FROM companions c
                JOIN users u ON c.user_id = u.id
                WHERE c.companion_telegram_id = $1
            `, [chatId]);

            if (res.rows.length === 0) {
                bot.sendMessage(chatId, 'شما در حال حاضر همراه کسی نیستید.');
                return;
            }

            const inlineKeyboard = res.rows.map(row => ([{
                text: `لغو همراهی با ${formatUserName(row.telegram_firstname, row.telegram_username)}`,
                callback_data: `unfollow_${row.user_id}`
            }]));

            bot.sendMessage(chatId, 'همراهی با کدام کاربر را می‌خواهید لغو کنید؟', {
                reply_markup: {
                    inline_keyboard: inlineKeyboard
                }
            });

        } catch (error) {
            console.error('Error fetching companions for cancellation:', error);
            bot.sendMessage(chatId, 'خطایی در دریافت لیست همراهی شما رخ داد.');
        } finally {
            client.release();
        }
    }
});

bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const data = callbackQuery.data;
    const companionId = callbackQuery.from.id;
    const companionFirstName = callbackQuery.from.first_name;
    const companionUsername = callbackQuery.from.username;

    if (data.startsWith('unfollow_')) {
        const primaryUserId = parseInt(data.split('_')[1], 10);
        const client = await pool.connect();
        try {
            const primaryUserRes = await client.query('SELECT telegram_id, telegram_firstname, telegram_username FROM users WHERE id = $1', [primaryUserId]);
            const companionRes = await client.query('DELETE FROM companions WHERE user_id = $1 AND companion_telegram_id = $2 RETURNING *', [primaryUserId, companionId]);

            if (companionRes.rowCount > 0) {
                bot.answerCallbackQuery(callbackQuery.id, { text: 'همراهی با موفقیت لغو شد.' });
                bot.editMessageText(`همراهی شما با ${formatUserName(primaryUserRes.rows[0].telegram_firstname, primaryUserRes.rows[0].telegram_username)} لغو شد.`, {
                    chat_id: msg.chat.id,
                    message_id: msg.message_id
                });

                if (primaryUserRes.rows.length > 0) {
                    const primaryUserTelegramId = primaryUserRes.rows[0].telegram_id;
                    const companionDisplayName = formatUserName(companionFirstName, companionUsername);
                    bot.sendMessage(primaryUserTelegramId, `${companionDisplayName} دیگر همراه شما نیست.`);
                }
            } else {
                bot.answerCallbackQuery(callbackQuery.id, { text: 'خطایی رخ داد یا شما دیگر همراه این کاربر نبودید.', show_alert: true });
            }
        } catch (error) {
            console.error('Error unfollowing user:', error);
            bot.answerCallbackQuery(callbackQuery.id, { text: 'خطا در لغو همراهی.', show_alert: true });
        } finally {
            client.release();
        }
    }
});


// --- API ROUTES ---

app.post('/api/onboarding', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN'); 
    const { telegram_id, cycle_length, period_length, last_period_date, birth_year, telegram_username, telegram_firstname } = req.body;
    if (!telegram_id || !last_period_date) {
      return res.status(400).json({ error: 'شناسه تلگرام و تاریخ آخرین پریود ضروری است.' });
    }
    const values = [telegram_id, cycle_length, period_length, last_period_date, birth_year, telegram_username, telegram_firstname];
    const userQuery = `
      INSERT INTO users (telegram_id, cycle_length, period_length, last_period_date, birth_year, telegram_username, telegram_firstname)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (telegram_id) DO UPDATE SET
        cycle_length = EXCLUDED.cycle_length,
        period_length = EXCLUDED.period_length,
        last_period_date = EXCLUDED.last_period_date,
        birth_year = EXCLUDED.birth_year,
        telegram_username = EXCLUDED.telegram_username,
        telegram_firstname = EXCLUDED.telegram_firstname
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

        const companionsQuery = `SELECT id, name, notify_daily_symptoms FROM companions WHERE user_id = $1`;
        const companionsResult = await pool.query(companionsQuery, [user.id]);
        const companions = companionsResult.rows;

        res.status(200).json({ user, logs, period_history, companions });
    } catch (error) {
        console.error('خطا در دریافت اطلاعات کاربر:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});

app.put('/api/user/:telegram_id', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const { cycle_length, period_length, birth_year, reminder_logs, reminder_cycle } = req.body;
        
        const query = `
            UPDATE users
            SET cycle_length = $1, period_length = $2, birth_year = $3, reminder_logs = $4, reminder_cycle = $5
            WHERE telegram_id = $6
            RETURNING *;
        `;
        const values = [cycle_length, period_length, birth_year, reminder_logs, reminder_cycle, telegram_id];
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

app.post('/api/user/:telegram_id/update-info', async (req, res) => {
    try {
        const { telegram_id } = req.params;
        const { telegram_username, telegram_firstname } = req.body;

        const query = `
            UPDATE users
            SET telegram_username = $1, telegram_firstname = $2
            WHERE telegram_id = $3 AND (telegram_username IS DISTINCT FROM $1 OR telegram_firstname IS DISTINCT FROM $2)
        `;
        const values = [telegram_username, telegram_firstname, telegram_id];
        await pool.query(query, values);

        res.sendStatus(200); // Send a simple OK, no body needed
    } catch (error) {
        console.error('Error updating user info:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});


// START: Added routes for logs and period
app.post('/api/logs', async (req, res) => {
    const client = await pool.connect();
    try {
        const { user_id, log_date, ...logData } = req.body;

        if (!user_id || !log_date) {
            return res.status(400).json({ error: 'اطلاعات ضروری ارسال نشده است.' });
        }

        const existingLogRes = await client.query(
            'SELECT id FROM daily_logs WHERE user_id = $1 AND log_date = $2',
            [user_id, log_date]
        );

        const hasDataToLog = Object.keys(logData).length > 0;

        if (existingLogRes.rows.length > 0) {
            // Log for this day exists
            if (hasDataToLog) {
                // UPDATE the existing log
                const allPossibleColumns = [
                    'weight', 'water', 'sleep', 'sex', 'libido', 'moods', 'symptoms',
                    'activity', 'breasts', 'discharge', 'blood_color', 'flow',
                    'hair', 'nails', 'skin', 'other', 'notes'
                ];
                const updates = [];
                const values = [];
                let valueCounter = 1;

                allPossibleColumns.forEach(col => {
                    updates.push(`${col} = $${valueCounter}`);
                    values.push(logData.hasOwnProperty(col) ? logData[col] : null);
                    valueCounter++;
                });
                
                values.push(user_id, log_date);

                const query = `
                    UPDATE daily_logs SET ${updates.join(', ')}
                    WHERE user_id = $${valueCounter} AND log_date = $${valueCounter + 1}
                    RETURNING *;
                `;
                const result = await client.query(query, values);
                res.status(200).json({ message: 'گزارش با موفقیت به‌روزرسانی شد', log: result.rows[0] });

            } else {
                // DELETE the existing log because no data was provided
                await client.query('DELETE FROM daily_logs WHERE id = $1', [existingLogRes.rows[0].id]);
                res.status(200).json({ message: 'گزارش با موفقیت حذف شد.', log: null });
            }
        } else {
            // No log for this day, INSERT a new one if there's data
            if (hasDataToLog) {
                const columns = ['user_id', 'log_date', ...Object.keys(logData)];
                const values = [user_id, log_date, ...Object.values(logData)];
                const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');

                const query = `
                    INSERT INTO daily_logs (${columns.join(', ')})
                    VALUES (${placeholders})
                    RETURNING *;
                `;
                const result = await client.query(query, values);
                res.status(200).json({ message: 'گزارش با موفقیت ذخیره شد', log: result.rows[0] });
            } else {
                // No existing log and no new data, do nothing
                 res.status(200).json({ message: 'داده‌ای برای ثبت وجود نداشت.', log: null });
            }
        }
    } catch (error) {
        console.error('خطا در ذخیره گزارش:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    } finally {
        client.release();
    }
});

app.delete('/api/logs', async (req, res) => {
    try {
        const { user_id, log_date } = req.body;
        if (!user_id || !log_date) {
            return res.status(400).json({ error: 'اطلاعات ضروری برای حذف ارسال نشده است.' });
        }
        const result = await pool.query('DELETE FROM daily_logs WHERE user_id = $1 AND log_date = $2', [user_id, log_date]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'گزارشی برای حذف یافت نشد.' });
        }

        res.status(200).json({ message: 'گزارش با موفقیت حذف شد.' });
    } catch (error) {
        console.error('خطا در حذف گزارش:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    }
});

app.post('/api/user/:telegram_id/period', async (req, res) => {
    const { telegram_id } = req.params;
    const { start_date, duration } = req.body;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const userRes = await client.query('SELECT id, telegram_firstname, period_length FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const userId = userRes.rows[0].id;
        const userFirstName = userRes.rows[0].telegram_firstname;

        // Add to history
        await client.query(
            `INSERT INTO period_history (user_id, start_date, duration)
             VALUES ($1, $2, $3)
             ON CONFLICT (user_id, start_date) DO UPDATE SET duration = EXCLUDED.duration`,
            [userId, start_date, duration]
        );

        // Recalculate averages and update last_period_date
        const historyRes = await client.query(
            'SELECT start_date, duration FROM period_history WHERE user_id = $1 ORDER BY start_date DESC',
            [userId]
        );

        const history = historyRes.rows;
        let avg_cycle_length = null;
        let avg_period_length = null;
        const last_period_date = history.length > 0 ? history[0].start_date : start_date;

        if (history.length > 1) {
            let cycleSum = 0;
            let validCycleCount = 0;
            const CYCLE_LENGTH_THRESHOLD = 45;

            for (let i = 0; i < history.length - 1; i++) {
                const current = new Date(history[i].start_date);
                const previous = new Date(history[i + 1].start_date);
                const diffTime = Math.abs(current - previous);
                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

                if (diffDays <= CYCLE_LENGTH_THRESHOLD) {
                    cycleSum += diffDays;
                    validCycleCount++;
                }
            }
            
            if (validCycleCount > 0) {
                avg_cycle_length = cycleSum / validCycleCount;
            }
        }

        if (history.length > 0) {
            const periodSum = history.reduce((sum, record) => sum + record.duration, 0);
            avg_period_length = periodSum / history.length;
        }

        await client.query(
            `UPDATE users SET 
                last_period_date = $1, 
                avg_cycle_length = $2, 
                avg_period_length = $3
             WHERE id = $4`,
            [last_period_date, avg_cycle_length, avg_period_length, userId]
        );
        
        // Notify companions that period has started
        const todayJalali = jalaliMoment().locale("fa").format("YYYY-MM-DD");
        if (start_date === todayJalali) {
            const companionsRes = await client.query('SELECT companion_telegram_id FROM companions WHERE user_id = $1', [userId]);
            companionsRes.rows.forEach(c => {
                const message = getRandomMessage('companion', 'period_started').replace('{FIRST_NAME}', userFirstName);
                bot.sendMessage(c.companion_telegram_id, message);
            });
        }

        await client.query('COMMIT');
        res.status(200).json({ message: 'سابقه پریود با موفقیت ثبت و تحلیل شد.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error saving period data:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    } finally {
        client.release();
    }
});

app.delete('/api/user/:telegram_id', async (req, res) => {
    const { telegram_id } = req.params;
    const client = await pool.connect();

    try {
        const result = await client.query('DELETE FROM users WHERE telegram_id = $1', [telegram_id]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'کاربر برای حذف یافت نشد.' });
        }

        res.status(200).json({ message: 'حساب کاربری با موفقیت حذف شد.' });
    } catch (error) {
        console.error('Error deleting user account:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    } finally {
        client.release();
    }
});

app.delete('/api/user/:telegram_id/period', async (req, res) => {
    const { telegram_id } = req.params;
    const { scope } = req.body; // 'last' or 'all'
    const client = await pool.connect();

    try {
        await client.query('BEGIN');
        const userRes = await client.query('SELECT id FROM users WHERE telegram_id = $1', [telegram_id]);
        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'کاربر یافت نشد.' });
        }
        const userId = userRes.rows[0].id;

        if (scope === 'last') {
            const lastPeriodRes = await client.query(
                'SELECT id FROM period_history WHERE user_id = $1 ORDER BY start_date DESC LIMIT 1',
                [userId]
            );
            if (lastPeriodRes.rows.length > 0) {
                await client.query('DELETE FROM period_history WHERE id = $1', [lastPeriodRes.rows[0].id]);
            }
        } else if (scope === 'all') {
            await client.query('DELETE FROM period_history WHERE user_id = $1', [userId]);
        } else {
            return res.status(400).json({ error: 'دامنه حذف نامعتبر است.' });
        }

        // After deleting, recalculate and update user stats
        const historyRes = await client.query(
            'SELECT start_date, duration FROM period_history WHERE user_id = $1 ORDER BY start_date DESC',
            [userId]
        );
        const history = historyRes.rows;

        if (history.length === 0) {
            await client.query('UPDATE users SET last_period_date = NULL, avg_cycle_length = NULL, avg_period_length = NULL WHERE id = $1', [userId]);
        } else {
            const last_period_date = history[0].start_date;
            let avg_cycle_length = null;
            
            // *** START: MODIFICATION FOR SKIPPED CYCLES ***
            if (history.length > 1) {
                 let cycleSum = 0;
                 let validCycleCount = 0;
                 const CYCLE_LENGTH_THRESHOLD = 45;

                for (let i = 0; i < history.length - 1; i++) {
                    const current = new Date(history[i].start_date);
                    const previous = new Date(history[i + 1].start_date);
                    const diffDays = Math.ceil(Math.abs(current - previous) / (1000 * 60 * 60 * 24));
                    if (diffDays <= CYCLE_LENGTH_THRESHOLD) {
                        cycleSum += diffDays;
                        validCycleCount++;
                    }
                }
                if (validCycleCount > 0) {
                    avg_cycle_length = cycleSum / validCycleCount;
                }
            }
            // *** END: MODIFICATION ***

            const avg_period_length = history.reduce((sum, r) => sum + r.duration, 0) / history.length;
            await client.query('UPDATE users SET last_period_date = $1, avg_cycle_length = $2, avg_period_length = $3 WHERE id = $4', [last_period_date, avg_cycle_length, avg_period_length, userId]);
        }
        
        await client.query('COMMIT');
        res.status(200).json({ message: 'سابقه پریود با موفقیت حذف شد.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error deleting period history:', error);
        res.status(500).json({ error: 'خطای داخلی سرور' });
    } finally {
        client.release();
    }
});
// END: Added routes

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

// --- NOTIFICATION LOGIC ---
const notifications = JSON.parse(fs.readFileSync(path.join(__dirname, 'notifications.json'), 'utf8'));

const getRandomMessage = (category, key) => {
    const messages = notifications[category][key];
    return messages[Math.floor(Math.random() * messages.length)];
};

const scheduleRandomly = (cronExpression, task) => {
    cron.schedule(cronExpression, task, {
        timezone: "Asia/Tehran"
    });
};

// Daily Log Reminder (18:00 - 21:00) - No changes needed here, kept for context
scheduleRandomly(`${Math.floor(Math.random() * 60)} ${Math.floor(Math.random() * 4) + 18} * * *`, async () => {
    // گرفتن تاریخ امروز به فرمت میلادی برای مقایسه با دیتابیس
    const today = jalaliMoment().locale("fa").format("YYYY-MM-DD");
    
    const query = `
        SELECT u.telegram_id FROM users u
        LEFT JOIN daily_logs dl ON u.id = dl.user_id AND dl.log_date = $1
        WHERE u.reminder_logs = TRUE AND dl.id IS NULL;
    `;
    const { rows } = await pool.query(query, [today]);
    rows.forEach(user => {
        bot.sendMessage(user.telegram_id, getRandomMessage('user', 'log_reminder'));
    });
});

// Companion daily summary (21:00 - 22:00) - No changes needed here, kept for context
scheduleRandomly(`${Math.floor(Math.random() * 60)} 21 * * *`, async () => {
    const today = jalaliMoment().locale("fa").format("YYYY-MM-DD");
    const query = `
        SELECT 
            c.companion_telegram_id, 
            u.telegram_firstname,
            dl.moods,
            dl.symptoms
        FROM companions c
        JOIN users u ON c.user_id = u.id
        JOIN daily_logs dl ON u.id = dl.user_id
        WHERE c.notify_daily_symptoms = TRUE AND dl.log_date = $1;
    `;
    const { rows } = await pool.query(query, [today]);
    rows.forEach(row => {
        const moods = row.moods ? row.moods.join(', ') : 'ثبت نشده';
        const symptoms = row.symptoms ? row.symptoms.join(', ') : 'ثبت نشده';
        if(moods !== 'ثبت نشده' || symptoms !== 'ثبت نشده') {
            let message = getRandomMessage('companion', 'daily_log_summary');
            message = message.replace('{FIRST_NAME}', row.telegram_firstname).replace('{MOODS}', moods).replace('{SYMPTOMS}', symptoms);
            bot.sendMessage(row.companion_telegram_id, message);
        }
    });
});


// --- Fully Revised Daily Cycle Notifications ---

const scheduleDailyCycleChecks = () => {
    // این تابع هر روز بین ساعت ۱۰ تا ۱۸ به صورت تصادفی اجرا می‌شود
    const randomHourAndMinute = (start, end) => `${Math.floor(Math.random()*60)} ${Math.floor(Math.random()*(end-start+1))+start} * * *`;
    
    cron.schedule(randomHourAndMinute(10, 18), async () => {
        try {
            const query = `SELECT * FROM users WHERE last_period_date IS NOT NULL AND reminder_cycle = TRUE`;
            const { rows: users } = await pool.query(query);
            const todayJalali = jalaliMoment();

            for (const user of users) {
                const cycleLength = Math.round(user.avg_cycle_length || user.cycle_length);
                const lastPeriodStart = jalaliMoment(user.last_period_date, "YYYY-MM-DD");

                if (!lastPeriodStart.isValid()) {
                    console.error(`Invalid last_period_date for user ${user.telegram_id}: ${user.last_period_date}`);
                    continue;
                }

                const nextPeriodDate = lastPeriodStart.clone().add(cycleLength, 'days');
                const pmsStartDate = nextPeriodDate.clone().subtract(4, 'days');
                const lateDate = nextPeriodDate.clone().add(3, 'days');

                // 1. Pre-period warning (1 day before)
                if (todayJalali.isSame(nextPeriodDate.clone().subtract(1, 'days'), 'day')) {
                    bot.sendMessage(user.telegram_id, getRandomMessage('user', 'pre_period_warning'));
                    const companionsRes = await pool.query('SELECT companion_telegram_id FROM companions WHERE user_id = $1', [user.id]);
                    companionsRes.rows.forEach(c => bot.sendMessage(c.companion_telegram_id, getRandomMessage('companion', 'pre_period_warning').replace('{FIRST_NAME}', user.telegram_firstname)));
                }
                
                // 2. Period day warning (on the predicted day)
                if (todayJalali.isSame(nextPeriodDate, 'day')) {
                     bot.sendMessage(user.telegram_id, getRandomMessage('user', 'period_day_warning'));
                }

                // 3. PMS start (4 days before)
                if (todayJalali.isSame(pmsStartDate, 'day')) {
                    bot.sendMessage(user.telegram_id, getRandomMessage('user', 'pms_start'));
                    const companionsRes = await pool.query('SELECT companion_telegram_id FROM companions WHERE user_id = $1', [user.id]);
                    companionsRes.rows.forEach(c => bot.sendMessage(c.companion_telegram_id, getRandomMessage('companion', 'pms_start').replace('{FIRST_NAME}', user.telegram_firstname)));
                }

                // 4. Period is late by 3 days
                if (todayJalali.isSame(lateDate, 'day')) {
                    bot.sendMessage(user.telegram_id, getRandomMessage('user', 'period_late'));
                    const companionsRes = await pool.query('SELECT companion_telegram_id FROM companions WHERE user_id = $1', [user.id]);
                    companionsRes.rows.forEach(c => bot.sendMessage(c.companion_telegram_id, getRandomMessage('companion', 'period_late').replace('{FIRST_NAME}', user.telegram_firstname)));
                }
            }
        } catch (error) {
            console.error('Error in daily cycle checks:', error);
        }
    }, { timezone: "Asia/Tehran" });
};

scheduleDailyCycleChecks();

// *** END: REVISED NOTIFICATION LOGIC ***

// --- TEST HELPERS (minimal & non-invasive) ---

/**
 * اگر dryRun=true باشه فقط لاگ می‌کنه، وگرنه پیام رو می‌فرسته.
 */
const sendMaybe = async (chatId, text, dryRun = false) => {
  if (dryRun) {
    console.log(`[DRY] -> ${chatId}: ${text}`);
    return;
  }
  try {
    await bot.sendMessage(chatId, text);
  } catch (e) {
    console.error(`[ERROR] sendMessage to ${chatId}:`, e.message);
  }
};

/**
 * اجرای منطق نوتیف چرخه برای یک تاریخ جلالی دلخواه (YYYY-MM-DD)
 * بدون تغییر زمان‌بندی‌های cron اصلی
 */
const runCycleChecksForDate = async (dateJalali = null, dryRun = false) => {
  try {
    const { rows: users } = await pool.query(
      `SELECT * FROM users WHERE last_period_date IS NOT NULL AND reminder_cycle = TRUE`
    );

    // اگر تاریخ ندادیم، امروز جلالی
    const todayJalali = dateJalali
      ? jalaliMoment(dateJalali, "YYYY-MM-DD").locale("fa")
      : jalaliMoment().locale("fa");

    let notifiedCount = 0;

    for (const user of users) {
      // توجه: last_period_date در DB به‌احتمال زیاد به صورت "YYYY-MM-DD" ذخیره می‌شه
      const lastPeriodStart = jalaliMoment(user.last_period_date, "YYYY-MM-DD").locale("fa");
      if (!lastPeriodStart.isValid()) {
        console.error(`Invalid last_period_date for user ${user.telegram_id}: ${user.last_period_date}`);
        continue;
      }

      const cycleLength = Math.round(user.avg_cycle_length || user.cycle_length);
      if (!cycleLength || cycleLength <= 0) continue;

      const nextPeriodDate = lastPeriodStart.clone().add(cycleLength, "days");
      const pmsStartDate   = nextPeriodDate.clone().subtract(4, "days");
      const lateDate       = nextPeriodDate.clone().add(3, "days");

      // 1) یک روز قبل از پریود
      if (todayJalali.isSame(nextPeriodDate.clone().subtract(1, "days"), "day")) {
        await sendMaybe(user.telegram_id, getRandomMessage("user", "pre_period_warning"), dryRun);
        const companionsRes = await pool.query(
          "SELECT companion_telegram_id FROM companions WHERE user_id = $1",
          [user.id]
        );
        for (const c of companionsRes.rows) {
          const msg = getRandomMessage("companion", "pre_period_warning")
            .replace("{FIRST_NAME}", user.telegram_firstname);
          await sendMaybe(c.companion_telegram_id, msg, dryRun);
        }
        notifiedCount++;
      }

      // 2) روز پیش‌بینی پریود
      if (todayJalali.isSame(nextPeriodDate, "day")) {
        await sendMaybe(user.telegram_id, getRandomMessage("user", "period_day_warning"), dryRun);
        notifiedCount++;
      }

      // 3) شروع PMS (۴ روز قبل)
      if (todayJalali.isSame(pmsStartDate, "day")) {
        await sendMaybe(user.telegram_id, getRandomMessage("user", "pms_start"), dryRun);
        const companionsRes = await pool.query(
          "SELECT companion_telegram_id FROM companions WHERE user_id = $1",
          [user.id]
        );
        for (const c of companionsRes.rows) {
          const msg = getRandomMessage("companion", "pms_start")
            .replace("{FIRST_NAME}", user.telegram_firstname);
          await sendMaybe(c.companion_telegram_id, msg, dryRun);
        }
        notifiedCount++;
      }

      // 4) سه روز تأخیر
      if (todayJalali.isSame(lateDate, "day")) {
        await sendMaybe(user.telegram_id, getRandomMessage("user", "period_late"), dryRun);
        const companionsRes = await pool.query(
          "SELECT companion_telegram_id FROM companions WHERE user_id = $1",
          [user.id]
        );
        for (const c of companionsRes.rows) {
          const msg = getRandomMessage("companion", "period_late")
            .replace("{FIRST_NAME}", user.telegram_firstname);
          await sendMaybe(c.companion_telegram_id, msg, dryRun);
        }
        notifiedCount++;
      }
    }

    return { notifiedCount, date: todayJalali.format("YYYY-MM-DD") };
  } catch (err) {
    console.error("[TEST] Error in runCycleChecksForDate:", err);
    throw err;
  }
};

/**
 * اجرای تست ریمایندر لاگ روزانه برای یک تاریخ جلالی دلخواه (همون کوئری کرون اصلی)
 */
const runLogReminderForDate = async (dateJalali = null, dryRun = false) => {
  const date = dateJalali || jalaliMoment().locale("fa").format("YYYY-MM-DD");
  const query = `
    SELECT u.telegram_id
    FROM users u
    LEFT JOIN daily_logs dl ON u.id = dl.user_id AND dl.log_date = $1
    WHERE u.reminder_logs = TRUE AND dl.id IS NULL;
  `;
  const { rows } = await pool.query(query, [date]);
  for (const user of rows) {
    await sendMaybe(user.telegram_id, getRandomMessage("user", "log_reminder"), dryRun);
  }
  return { sent: rows.length, date };
};

/**
 * اجرای تست خلاصه روزانه برای همراه‌ها برای یک تاریخ جلالی دلخواه
 */
const runCompanionSummaryForDate = async (dateJalali = null, dryRun = false) => {
  const date = dateJalali || jalaliMoment().locale("fa").format("YYYY-MM-DD");
  const query = `
    SELECT
      c.companion_telegram_id,
      u.telegram_firstname,
      dl.moods,
      dl.symptoms
    FROM companions c
    JOIN users u ON c.user_id = u.id
    JOIN daily_logs dl ON u.id = dl.user_id
    WHERE c.notify_daily_symptoms = TRUE AND dl.log_date = $1;
  `;
  const { rows } = await pool.query(query, [date]);
  let sent = 0;
  for (const row of rows) {
    const moods = row.moods ? row.moods.join(", ") : "ثبت نشده";
    const symptoms = row.symptoms ? row.symptoms.join(", ") : "ثبت نشده";
    if (moods !== "ثبت نشده" || symptoms !== "ثبت نشده") {
      let message = getRandomMessage("companion", "daily_log_summary");
      message = message
        .replace("{FIRST_NAME}", row.telegram_firstname)
        .replace("{MOODS}", moods)
        .replace("{SYMPTOMS}", symptoms);
      await sendMaybe(row.companion_telegram_id, message, dryRun);
      sent++;
    }
  }
  return { sent, date };
};

// --- TEST ENDPOINTS ---

/**
 * POST /api/test/cycle-check
 * body: { "date": "1403-06-10" (اختیاری، جلالی), "dryRun": true|false }
 */
app.post("/api/test/cycle-check", async (req, res) => {
  try {
    const { date, dryRun } = req.body || {};
    const result = await runCycleChecksForDate(date, !!dryRun);
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/test/log-reminder
 * body: { "date": "1403-06-10" (اختیاری، جلالی), "dryRun": true|false }
 */
app.post("/api/test/log-reminder", async (req, res) => {
  try {
    const { date, dryRun } = req.body || {};
    const result = await runLogReminderForDate(date, !!dryRun);
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * POST /api/test/companion-summary
 * body: { "date": "1403-06-10" (اختیاری، جلالی), "dryRun": true|false }
 */
app.post("/api/test/companion-summary", async (req, res) => {
  try {
    const { date, dryRun } = req.body || {};
    const result = await runCompanionSummaryForDate(date, !!dryRun);
    res.status(200).json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server is running successfully on port ${PORT}`);
});