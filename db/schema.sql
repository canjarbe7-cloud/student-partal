-- Navbat tizimi sxemasi. Fayl qayta-qayta ishga tushirilsa ham xavfsiz (npm run migrate).
-- Tartib muhim: avval ota jadvallar (users, bolimlar, qabul_vaqti).

CREATE TABLE IF NOT EXISTS users (
  id          BIGSERIAL PRIMARY KEY,
  ism         VARCHAR(100) NOT NULL,
  familiya    VARCHAR(100) NOT NULL,
  ochestva    VARCHAR(100),
  login       VARCHAR(100) NOT NULL UNIQUE,
  parol       VARCHAR(255) NOT NULL,            -- bcrypt hash saqlanadi
  role        VARCHAR(20)  NOT NULL,
  phone       VARCHAR(20),
  status      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  DATE NOT NULL DEFAULT CURRENT_DATE,
  updated_at  DATE NOT NULL DEFAULT CURRENT_DATE
);

-- Yangi rollar: mudir, tyutor, xodim (bo'lim xodimi)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin', 'student', 'teacher', 'dekanat', 'mudir', 'tyutor', 'xodim'));

-- Dekanat, kafedra va boshqa bo'limlar; parent_id orqali ierarxiya (kafedra -> fakultet)
CREATE TABLE IF NOT EXISTS bolimlar (
  id         BIGSERIAL PRIMARY KEY,
  nomi       VARCHAR(150) NOT NULL,
  turi       VARCHAR(20)  NOT NULL DEFAULT 'bolim' CHECK (turi IN ('dekanat', 'kafedra', 'bolim')),
  parent_id  BIGINT REFERENCES bolimlar(id) ON DELETE SET NULL,
  xona       VARCHAR(50),
  status     BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (parent_id <> id)
);

-- Xodimning haftalik qabul kunlari (bir xodimda bir nechta bo'lishi mumkin)
-- start_time / end_time: yarim tundan boshlab daqiqalar (540 = 09:00)
-- hafta_kuni: 1 = Dushanba ... 7 = Yakshanba
CREATE TABLE IF NOT EXISTS qabul_vaqti (
  id          BIGSERIAL PRIMARY KEY,
  xodim_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bolim_id    BIGINT REFERENCES bolimlar(id) ON DELETE SET NULL,
  hafta_kuni  SMALLINT NOT NULL CHECK (hafta_kuni BETWEEN 1 AND 7),
  start_time  BIGINT NOT NULL CHECK (start_time BETWEEN 0 AND 1439),
  end_time    BIGINT NOT NULL CHECK (end_time BETWEEN 1 AND 1440),
  slot_min    SMALLINT NOT NULL DEFAULT 15 CHECK (slot_min BETWEEN 5 AND 240),  -- bitta navbat davomiyligi
  max_navbat  SMALLINT CHECK (max_navbat > 0),                                  -- kunlik chegara (bo'sh = slotlar soni)
  status      BOOLEAN NOT NULL DEFAULT TRUE,
  CHECK (end_time > start_time)
);

-- Eski bazani yangilash: week_date -> hafta_kuni, yangi ustunlar
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'qabul_vaqti' AND column_name = 'week_date') THEN
    ALTER TABLE qabul_vaqti RENAME COLUMN week_date TO hafta_kuni;
  END IF;
END $$;

ALTER TABLE qabul_vaqti
  ALTER COLUMN hafta_kuni TYPE SMALLINT,
  ADD COLUMN IF NOT EXISTS xodim_id   BIGINT REFERENCES users(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS bolim_id   BIGINT REFERENCES bolimlar(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slot_min   SMALLINT NOT NULL DEFAULT 15 CHECK (slot_min BETWEEN 5 AND 240),
  ADD COLUMN IF NOT EXISTS max_navbat SMALLINT CHECK (max_navbat > 0),
  ADD COLUMN IF NOT EXISTS status     BOOLEAN NOT NULL DEFAULT TRUE;

-- Endi bir xil vaqtda bir nechta xodim qabul qila oladi
ALTER TABLE qabul_vaqti DROP CONSTRAINT IF EXISTS qabul_vaqti_week_date_start_time_end_time_key;

CREATE TABLE IF NOT EXISTS student_info (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  guruh    VARCHAR(100),                       -- matn yoki raqam: "101-A", "24"
  kurs     BIGINT CHECK (kurs BETWEEN 1 AND 6),
  tg_user  VARCHAR(100)                        -- @username yoki raqamli ID
);

CREATE TABLE IF NOT EXISTS teacher_info (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  tg_user  VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS dekanat_user_info (
  id       BIGSERIAL PRIMARY KEY,
  user_id  BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  lavozim  VARCHAR(100),
  tg_user  VARCHAR(100)
);

-- Eski bazalarda bu ustunlar BIGINT edi -> matn ham, raqam ham sig'adigan qilamiz
ALTER TABLE student_info      ALTER COLUMN guruh   TYPE VARCHAR(100) USING guruh::varchar;
ALTER TABLE student_info      ALTER COLUMN tg_user TYPE VARCHAR(100) USING tg_user::varchar;
ALTER TABLE teacher_info      ALTER COLUMN tg_user TYPE VARCHAR(100) USING tg_user::varchar;
ALTER TABLE dekanat_user_info ALTER COLUMN lavozim TYPE VARCHAR(100) USING lavozim::varchar;
ALTER TABLE dekanat_user_info ALTER COLUMN tg_user TYPE VARCHAR(100) USING tg_user::varchar;

-- teacher_info.qabul_vaqti va dekanat_user_info.qabul_vaqti -> qabul_vaqti.xodim_id ga ko'chadi.
-- Har bir biriktirish uchun xodimning o'z nusxasi yaratiladi.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'teacher_info' AND column_name = 'qabul_vaqti') THEN
    INSERT INTO qabul_vaqti (xodim_id, hafta_kuni, start_time, end_time)
    SELECT t.user_id, q.hafta_kuni, q.start_time, q.end_time
      FROM teacher_info t JOIN qabul_vaqti q ON q.id = t.qabul_vaqti;
    ALTER TABLE teacher_info DROP COLUMN qabul_vaqti;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema = current_schema() AND table_name = 'dekanat_user_info' AND column_name = 'qabul_vaqti') THEN
    INSERT INTO qabul_vaqti (xodim_id, hafta_kuni, start_time, end_time)
    SELECT d.user_id, q.hafta_kuni, q.start_time, q.end_time
      FROM dekanat_user_info d JOIN qabul_vaqti q ON q.id = d.qabul_vaqti;
    ALTER TABLE dekanat_user_info DROP COLUMN qabul_vaqti;
  END IF;
END $$;

-- Hech kimga biriktirilmagan eski umumiy vaqtlar yangi tizimda ma'nosiz
DELETE FROM qabul_vaqti WHERE xodim_id IS NULL;
ALTER TABLE qabul_vaqti ALTER COLUMN xodim_id SET NOT NULL;

-- Tyutorga biriktirilgan guruhlar: talaba faqat o'z tyutoriga yoziladi
CREATE TABLE IF NOT EXISTS tyutor_guruh (
  id         BIGSERIAL PRIMARY KEY,
  tyutor_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  guruh      VARCHAR(100) NOT NULL
);

-- Xodim qaysi bo'limlarda ishlaydi (mudir ham shu yerda)
CREATE TABLE IF NOT EXISTS xodim_bolim (
  id        BIGSERIAL PRIMARY KEY,
  user_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bolim_id  BIGINT NOT NULL REFERENCES bolimlar(id) ON DELETE CASCADE,
  lavozim   VARCHAR(100),                     -- mudir, uslubchi, inspektor...
  asosiy    BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (user_id, bolim_id)
);

-- Qabul bo'lmaydigan sanalar (bayram, kasallik, safar...)
CREATE TABLE IF NOT EXISTS qabul_istisno (
  id        BIGSERIAL PRIMARY KEY,
  xodim_id  BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sana      DATE NOT NULL,
  sabab     VARCHAR(255),
  UNIQUE (xodim_id, sana)
);

-- Bo'limga xos murojaat mavzulari
CREATE TABLE IF NOT EXISTS murojaat_turlari (
  id        BIGSERIAL PRIMARY KEY,
  bolim_id  BIGINT NOT NULL REFERENCES bolimlar(id) ON DELETE CASCADE,
  nomi      VARCHAR(150) NOT NULL,
  UNIQUE (bolim_id, nomi)
);

-- Talabaning navbati. boshlanish / tugash ham daqiqalarda (qabul_vaqti bilan bir xil)
CREATE TABLE IF NOT EXISTS navbatlar (
  id                BIGSERIAL PRIMARY KEY,
  student_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  qabul_vaqti_id    BIGINT NOT NULL REFERENCES qabul_vaqti(id) ON DELETE CASCADE,
  murojaat_turi_id  BIGINT REFERENCES murojaat_turlari(id) ON DELETE SET NULL,
  sana              DATE NOT NULL,
  boshlanish        BIGINT NOT NULL CHECK (boshlanish BETWEEN 0 AND 1439),
  tugash            BIGINT NOT NULL CHECK (tugash BETWEEN 1 AND 1440),
  navbat_raqami     SMALLINT NOT NULL,
  mavzu             TEXT,
  status            VARCHAR(20) NOT NULL DEFAULT 'kutilmoqda'
                    CHECK (status IN ('kutilmoqda', 'tasdiqlandi', 'bajarildi', 'bekor', 'kelmadi')),
  javob_izoh        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (tugash > boshlanish)
);

-- Ikki talaba bitta slotni olmasin; bekor qilingan navbat slotni bo'shatadi
CREATE UNIQUE INDEX IF NOT EXISTS uq_navbat_slot
  ON navbatlar (qabul_vaqti_id, sana, boshlanish) WHERE status <> 'bekor';
-- Bitta talaba bir qabulga bir kunda faqat bir marta yozilsin
CREATE UNIQUE INDEX IF NOT EXISTS uq_navbat_student
  ON navbatlar (student_id, qabul_vaqti_id, sana) WHERE status <> 'bekor';
CREATE UNIQUE INDEX IF NOT EXISTS uq_tyutor_guruh   ON tyutor_guruh (tyutor_id, lower(btrim(guruh)));
CREATE UNIQUE INDEX IF NOT EXISTS uq_xodim_asosiy   ON xodim_bolim (user_id) WHERE asosiy;
CREATE UNIQUE INDEX IF NOT EXISTS uq_qabul_boshlanish ON qabul_vaqti (xodim_id, hafta_kuni, start_time);

CREATE INDEX IF NOT EXISTS idx_users_role         ON users(role);
CREATE INDEX IF NOT EXISTS idx_qabul_bolim        ON qabul_vaqti(bolim_id);
CREATE INDEX IF NOT EXISTS idx_navbat_qabul_sana  ON navbatlar(qabul_vaqti_id, sana);
CREATE INDEX IF NOT EXISTS idx_navbat_student     ON navbatlar(student_id, sana);
CREATE INDEX IF NOT EXISTS idx_tyutor_guruh_nomi  ON tyutor_guruh(lower(btrim(guruh)));
CREATE INDEX IF NOT EXISTS idx_xodim_bolim_bolim  ON xodim_bolim(bolim_id);

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
