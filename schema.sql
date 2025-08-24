-- SQL Schema for Parinaz App (Updated)

-- جدول اول: برای نگهداری اطلاعات پایه هر کاربر
-- این جدول اطلاعاتی را ذخیره می‌کند که معمولاً تغییر نمی‌کنند
CREATE TABLE users (
    id SERIAL PRIMARY KEY,                      -- یک شماره شناسایی منحصر به فرد و خودکار برای هر کاربر
    telegram_id BIGINT UNIQUE NOT NULL,         -- شناسه تلگرام کاربر برای شناسایی او در مراجعات بعدی
    
    -- تنظیمات اولیه یا دستی کاربر
    cycle_length INT NOT NULL DEFAULT 28,       -- طول سیکل قاعدگی (پیش‌فرض ۲۸ روز)
    period_length INT NOT NULL DEFAULT 7,       -- طول دوره پریود (پیش‌فرض ۷ روز)
    
    -- آخرین تاریخ پریود ثبت شده برای دسترسی سریع
    last_period_date DATE NULL,
    birth_year INT,                             -- سال تولد کاربر
    
    -- میانگین‌های محاسبه‌شده بر اساس تاریخچه برای پیش‌بینی دقیق‌تر
    avg_cycle_length NUMERIC(5, 2),
    avg_period_length NUMERIC(5, 2),

    -- تنظیمات اعلان‌ها
    reminder_logs BOOLEAN NOT NULL DEFAULT TRUE,
    reminder_cycle BOOLEAN NOT NULL DEFAULT TRUE,
    
    -- تنظیمات اعلان همراه (کلیدی)
    companion_notify_daily_symptoms BOOLEAN NOT NULL DEFAULT FALSE,

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW() -- تاریخ و زمان ایجاد حساب کاربری
);

-- جدول جدید: برای ذخیره تاریخچه پریودها و یادگیری سیستم
CREATE TABLE period_history (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- اتصال به کاربر (اگر کاربر حذف شد، رکوردهای اینجا هم حذف شود)
    start_date DATE,                   -- تاریخ شروع پریود
    duration INT NOT NULL,                      -- مدت زمان این پریود خاص (به روز)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, start_date)                -- هر کاربر نمی‌تواند دو پریود با تاریخ شروع یکسان داشته باشد
);

-- جدول همراهان
CREATE TABLE companions (
    id SERIAL PRIMARY KEY,
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    companion_telegram_id BIGINT NOT NULL,
    name TEXT, -- Optional, for display purposes
    notify_daily_symptoms BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, companion_telegram_id) -- A user can't add the same companion twice
);


-- جدول دوم: برای نگهداری گزارش‌های روزانه هر کاربر
-- این جدول تمام علائم و مقادیری که کاربر هر روز ثبت می‌کند را ذخیره می‌کند
CREATE TABLE daily_logs (
    id SERIAL PRIMARY KEY,                      -- شماره شناسایی منحصر به فرد برای هر گزارش
    user_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- اتصال این گزارش به یک کاربر در جدول users
    log_date DATE NOT NULL,                     -- تاریخی که این گزارش برای آن ثبت شده است
    
    -- اطلاعات متریک (عددی)
    weight NUMERIC(5, 2),                       -- وزن (مثلا 65.50)
    water INT,                                  -- تعداد لیوان آب
    sleep NUMERIC(4, 2),                        -- ساعات خواب (مثلا 7.5)

    -- اطلاعات انتخابی (چیپ‌ها)
    sex TEXT,                                   -- وضعیت رابطه جنسی
    libido TEXT,                                -- وضعیت میل جنسی
    moods TEXT[],                               -- لیستی از حالات روحی (آرایه)
    symptoms TEXT[],                            -- لیستی از علائم فیزیکی (آرایه)
    activity TEXT[],                            -- لیستی از فعالیت‌های فیزیکی (آرایه)
    breasts TEXT[],                             -- لیستی از وضعیت پستان (آرایه)
    discharge TEXT,                             -- وضعیت ترشحات واژن
    blood_color TEXT,                           -- رنگ خون پریود
    flow TEXT,                                  -- شدت خونریزی
    hair TEXT[],                                -- لیستی از وضعیت مو (آرایه)
    nails TEXT[],                               -- لیستی از وضعیت ناخن (آرایه)
    skin TEXT[],                                -- لیستی از وضعیت پوست (آرایه)
    other TEXT[],                               -- لیستی از موارد دیگر (آرایه)
    
    -- توضیحات متنی
    notes TEXT,                                 -- یادداشت‌های متنی کاربر

    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), -- تاریخ و زمان ثبت این گزارش
    UNIQUE (user_id, log_date)                  -- هر کاربر در هر روز فقط می‌تواند یک گزارش داشته باشد
);