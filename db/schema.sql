-- Sxemadagi 5 ta jadval. Tartib muhim: avval ota jadvallar (users, qabul_vaqti).

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  ism         VARCHAR(100) NOT NULL,
  familiya    VARCHAR(100) NOT NULL,
  ochestva    VARCHAR(100),
  login       VARCHAR(100) NOT NULL UNIQUE,
  parol       VARCHAR(255) NOT NULL,            -- bcrypt hash saqlanadi
  role        VARCHAR(20)  NOT NULL
              CHECK (role IN ('admin', 'student', 'teacher', 'dekanat')),
  phone       VARCHAR(20),
  status      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at  DATE NOT NULL DEFAULT CURRENT_DATE
);

-- start_time / end_time: yarim tundan boshlab daqiqalar (540 = 09:00)
-- week_date: 1 = Dushanba ... 7 = Yakshanba
CREATE TABLE IF NOT EXISTS qabul_vaqti (
  id          BIGSERIAL PRIMARY KEY,
  start_time  BIGINT NOT NULL CHECK (start_time BETWEEN 0 AND 1439),
  end_time    BIGINT NOT NULL CHECK (end_time BETWEEN 1 AND 1440),
  week_date   BIGINT NOT NULL CHECK (week_date BETWEEN 1 AND 7),
  CHECK (end_time > start_time),
  UNIQUE (week_date, start_time, end_time)
);

CREATE TABLE IF NOT EXISTS student_info (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  guruh    BIGINT,
  kurs     BIGINT CHECK (kurs BETWEEN 1 AND 6),
  tg_user  BIGINT
);

CREATE TABLE IF NOT EXISTS teacher_info (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tg_user      BIGINT,
  qabul_vaqti  BIGINT REFERENCES qabul_vaqti(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS dekanat_user_info (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  lavozim      BIGINT,
  tg_user      BIGINT,
  qabul_vaqti  BIGINT REFERENCES qabul_vaqti(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_users_role          ON users(role);
CREATE INDEX IF NOT EXISTS idx_teacher_qabul       ON teacher_info(qabul_vaqti);
CREATE INDEX IF NOT EXISTS idx_dekanat_qabul       ON dekanat_user_info(qabul_vaqti);

-- updated_at ni har UPDATE'da avtomatik yangilash
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := CURRENT_DATE;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
