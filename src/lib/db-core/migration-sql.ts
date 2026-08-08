export const ENSURE_TASKS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
`;

export const ENSURE_API_PROVIDERS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS api_providers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'anthropic',
    base_url TEXT NOT NULL DEFAULT '',
    api_key TEXT NOT NULL DEFAULT '',
    is_active INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    extra_env TEXT NOT NULL DEFAULT '{}',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

export const ENSURE_MEDIA_GENERATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS media_generations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'image',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    provider TEXT NOT NULL DEFAULT 'gemini',
    model TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    aspect_ratio TEXT NOT NULL DEFAULT '1:1',
    image_size TEXT NOT NULL DEFAULT '1K',
    local_path TEXT NOT NULL DEFAULT '',
    thumbnail_path TEXT NOT NULL DEFAULT '',
    session_id TEXT,
    message_id TEXT,
    tags TEXT NOT NULL DEFAULT '[]',
    metadata TEXT NOT NULL DEFAULT '{}',
    favorited INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT
  );

  CREATE TABLE IF NOT EXISTS media_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_media_created_at ON media_generations(created_at);
  CREATE INDEX IF NOT EXISTS idx_media_session_id ON media_generations(session_id);
  CREATE INDEX IF NOT EXISTS idx_media_status ON media_generations(status);
`;

export const ENSURE_MEDIA_JOBS_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS media_jobs (
    id TEXT PRIMARY KEY,
    session_id TEXT,
    status TEXT NOT NULL DEFAULT 'draft'
      CHECK(status IN ('draft','planning','planned','running','paused','completed','cancelled','failed')),
    doc_paths TEXT NOT NULL DEFAULT '[]',
    style_prompt TEXT NOT NULL DEFAULT '',
    batch_config TEXT NOT NULL DEFAULT '{}',
    total_items INTEGER NOT NULL DEFAULT 0,
    completed_items INTEGER NOT NULL DEFAULT 0,
    failed_items INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS media_job_items (
    id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    idx INTEGER NOT NULL DEFAULT 0,
    prompt TEXT NOT NULL DEFAULT '',
    aspect_ratio TEXT NOT NULL DEFAULT '1:1',
    image_size TEXT NOT NULL DEFAULT '1K',
    model TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    source_refs TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK(status IN ('pending','processing','completed','failed','cancelled')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    result_media_generation_id TEXT,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (job_id) REFERENCES media_jobs(id) ON DELETE CASCADE,
    FOREIGN KEY (result_media_generation_id) REFERENCES media_generations(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS media_context_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    job_id TEXT NOT NULL,
    payload TEXT NOT NULL DEFAULT '{}',
    sync_mode TEXT NOT NULL DEFAULT 'manual'
      CHECK(sync_mode IN ('manual','auto_batch')),
    synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (job_id) REFERENCES media_jobs(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_media_jobs_session_id ON media_jobs(session_id);
  CREATE INDEX IF NOT EXISTS idx_media_jobs_status ON media_jobs(status);
  CREATE INDEX IF NOT EXISTS idx_media_job_items_job_id ON media_job_items(job_id);
  CREATE INDEX IF NOT EXISTS idx_media_job_items_status ON media_job_items(status);
  CREATE INDEX IF NOT EXISTS idx_media_context_events_job_id ON media_context_events(job_id);
`;

export const ENSURE_CONTEXT_BUDGET_EVENTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS context_budget_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('ui', 'bridge')),
    assistant_runtime TEXT NOT NULL DEFAULT 'claude_code',
    compiled_input_chars INTEGER NOT NULL DEFAULT 0,
    system_chars INTEGER NOT NULL DEFAULT 0,
    history_chars INTEGER NOT NULL DEFAULT 0,
    tool_output_chars INTEGER NOT NULL DEFAULT 0,
    user_chars INTEGER NOT NULL DEFAULT 0,
    metadata_chars INTEGER NOT NULL DEFAULT 0,
    compiled_input_bytes INTEGER NOT NULL DEFAULT 0,
    budget_utilization_pct INTEGER NOT NULL DEFAULT 0,
    warning_limit INTEGER NOT NULL DEFAULT 0,
    soft_limit INTEGER NOT NULL DEFAULT 0,
    hard_limit INTEGER NOT NULL DEFAULT 0,
    warning_limit_hit INTEGER NOT NULL DEFAULT 0,
    soft_limit_hit INTEGER NOT NULL DEFAULT 0,
    hard_limit_hit INTEGER NOT NULL DEFAULT 0,
    native_resume_active INTEGER NOT NULL DEFAULT 0,
    official_compact_attempted INTEGER NOT NULL DEFAULT 0,
    official_compact_success INTEGER NOT NULL DEFAULT 0,
    compact_retry_success INTEGER NOT NULL DEFAULT 0,
    recovery_duration_ms INTEGER,
    local_compaction_attempted INTEGER NOT NULL DEFAULT 0,
    local_compaction_applied INTEGER NOT NULL DEFAULT 0,
    hard_trim_applied INTEGER NOT NULL DEFAULT 0,
    history_messages_before INTEGER NOT NULL DEFAULT 0,
    history_messages_after INTEGER NOT NULL DEFAULT 0,
    budget_stage_before TEXT NOT NULL DEFAULT 'green'
      CHECK(budget_stage_before IN ('green', 'warning', 'soft', 'hard')),
    budget_stage_after TEXT NOT NULL DEFAULT 'green'
      CHECK(budget_stage_after IN ('green', 'warning', 'soft', 'hard')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_context_budget_events_session_id ON context_budget_events(session_id);
  CREATE INDEX IF NOT EXISTS idx_context_budget_events_created_at ON context_budget_events(created_at);
  CREATE INDEX IF NOT EXISTS idx_context_budget_events_source_created_at ON context_budget_events(source, created_at);
  CREATE INDEX IF NOT EXISTS idx_context_budget_events_runtime_created_at ON context_budget_events(assistant_runtime, created_at);
`;

export const ENSURE_RUNTIME_LOCKS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS session_runtime_locks (
    session_id TEXT PRIMARY KEY,
    lock_id TEXT NOT NULL,
    owner TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_runtime_locks_expires_at ON session_runtime_locks(expires_at);
`;

export const ENSURE_PERMISSION_REQUESTS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS permission_requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    sdk_session_id TEXT NOT NULL DEFAULT '',
    tool_name TEXT NOT NULL,
    tool_input TEXT NOT NULL,
    decision_reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('pending','allow','deny','timeout','aborted')),
    updated_permissions TEXT NOT NULL DEFAULT '[]',
    updated_input TEXT,
    message TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT NOT NULL,
    resolved_at TEXT,
    FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS idx_permission_session_status ON permission_requests(session_id, status);
  CREATE INDEX IF NOT EXISTS idx_permission_expires_at ON permission_requests(expires_at);
`;

export const ENSURE_SESSION_CHANGE_LOG_SQL = `
  CREATE TABLE IF NOT EXISTS session_change_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    session_type TEXT NOT NULL CHECK(session_type IN ('chat', 'terminal')),
    change_type TEXT NOT NULL CHECK(change_type IN ('upsert', 'delete')),
    changed_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_session_change_log_type_id ON session_change_log(session_type, id);
  CREATE INDEX IF NOT EXISTS idx_session_change_log_session_id ON session_change_log(session_id);

  CREATE TRIGGER IF NOT EXISTS trg_session_change_log_insert
  AFTER INSERT ON chat_sessions
  BEGIN
    INSERT INTO session_change_log (session_id, session_type, change_type, changed_at)
    VALUES (NEW.id, NEW.session_type, 'upsert', COALESCE(NULLIF(NEW.updated_at, ''), datetime('now')));
  END;

  CREATE TRIGGER IF NOT EXISTS trg_session_change_log_update
  AFTER UPDATE OF title, updated_at, session_type, working_directory, project_name, status, mode, model, provider_id, provider_name
  ON chat_sessions
  BEGIN
    INSERT INTO session_change_log (session_id, session_type, change_type, changed_at)
    VALUES (NEW.id, NEW.session_type, 'upsert', COALESCE(NULLIF(NEW.updated_at, ''), datetime('now')));
  END;

  CREATE TRIGGER IF NOT EXISTS trg_session_change_log_delete
  AFTER DELETE ON chat_sessions
  BEGIN
    INSERT INTO session_change_log (session_id, session_type, change_type, changed_at)
    VALUES (OLD.id, OLD.session_type, 'delete', datetime('now'));
  END;
`;
