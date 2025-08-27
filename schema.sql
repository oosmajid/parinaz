-- SQL Schema for Parinaz App (Jalali dates stored as TEXT)

-- جدول کاربران
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    telegram_username TEXT,
    telegram_firstname TEXT,

    cycle_length INT NOT NULL DEFAULT 28,
    period_length INT NOT NULL DEFAULT 7,

    -- تاریخ آخرین پریود (جلالی)
    last_period_date TEXT,

    birth_year INT,

    avg_cycle_length NUMERIC(5, 2),
    avg_period_length NUMERIC(5, 2),

    reminder_logs BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_cycle BOOLEAN NOT NULL DEFAULT TRUE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- تاریخچه پریودها
CREATE TABLE period_history (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    start_date TEXT,   -- تاریخ شروع پریود (جلالی)
    duration INT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, start_date)
);

-- همراهان
CREATE TABLE companions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    companion_telegram_id BIGINT NOT NULL,
    name TEXT,
    notify_daily_symptoms BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, companion_telegram_id)
);

-- توکن‌های دعوت همراه
CREATE TABLE companion_invites (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT UNIQUE NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours')
);

-- گزارش‌های روزانه
CREATE TABLE daily_logs (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL,  -- تاریخ جلالی

    weight NUMERIC(5, 2),
    water INT,
    sleep NUMERIC(4, 2),

    sex TEXT,
    libido TEXT,
    moods TEXT[],
    symptoms TEXT[],
    activity TEXT[],
    breasts TEXT[],
    discharge TEXT,
    blood_color TEXT,
    flow TEXT,
    hair TEXT[],
    nails TEXT[],
    skin TEXT[],
    other TEXT[],

    notes TEXT,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, log_date)
);
