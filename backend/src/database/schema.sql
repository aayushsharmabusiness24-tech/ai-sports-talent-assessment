CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assessments (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id               INTEGER NOT NULL,
  exercise_type         TEXT    NOT NULL
                        CHECK (exercise_type IN ('pushups','squats','pullups','running')),
  camera_view           TEXT    NOT NULL DEFAULT 'auto',
  video_filename        TEXT,
  status                TEXT    NOT NULL DEFAULT 'processing'
                        CHECK (status IN ('processing','completed','insufficient_data','failed')),
  repetitions           INTEGER,
  incomplete_repetitions INTEGER,
  form_score            REAL,
  feedback_json         TEXT,
  result_json           TEXT,
  error_code            TEXT,
  error_message         TEXT,
  processing_ms         INTEGER,
  created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
  completed_at          TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_assessments_user_created
  ON assessments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assessments_user_exercise
  ON assessments (user_id, exercise_type);