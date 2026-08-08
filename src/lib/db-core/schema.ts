import Database from 'better-sqlite3';

import { migrateDb } from './migrations';

export function initializeDbSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      session_type TEXT NOT NULL DEFAULT 'chat' CHECK(session_type IN ('chat', 'terminal')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      model TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '',
      sdk_session_id TEXT NOT NULL DEFAULT '',
      worktree_id TEXT NOT NULL DEFAULT '',
      assistant_runtime TEXT NOT NULL DEFAULT 'claude_code',
      assistant_runtime_version TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      token_usage TEXT,
      client_message_id TEXT,
      status TEXT,
      content_format_version INTEGER,
      completed_at TEXT,
      persisted_revision INTEGER,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL
    );

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

    CREATE TABLE IF NOT EXISTS widget_telemetry_events (
      id TEXT PRIMARY KEY,
      event_name TEXT NOT NULL,
      ok INTEGER NOT NULL DEFAULT 1,
      error_code TEXT NOT NULL DEFAULT '',
      assistant_runtime TEXT NOT NULL DEFAULT '',
      session_id TEXT,
      message_id TEXT NOT NULL DEFAULT '',
      trace_id TEXT NOT NULL DEFAULT '',
      schema_version TEXT NOT NULL DEFAULT '1.0',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
    CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON chat_sessions(updated_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_session_id ON tasks(session_id);
    CREATE INDEX IF NOT EXISTS idx_media_created_at ON media_generations(created_at);
    CREATE INDEX IF NOT EXISTS idx_media_session_id ON media_generations(session_id);
    CREATE INDEX IF NOT EXISTS idx_media_status ON media_generations(status);
    CREATE INDEX IF NOT EXISTS idx_media_jobs_session_id ON media_jobs(session_id);
    CREATE INDEX IF NOT EXISTS idx_media_jobs_status ON media_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_media_job_items_job_id ON media_job_items(job_id);
    CREATE INDEX IF NOT EXISTS idx_media_job_items_status ON media_job_items(status);
    CREATE INDEX IF NOT EXISTS idx_media_context_events_job_id ON media_context_events(job_id);
    CREATE INDEX IF NOT EXISTS idx_context_budget_events_session_id ON context_budget_events(session_id);
    CREATE INDEX IF NOT EXISTS idx_context_budget_events_created_at ON context_budget_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_context_budget_events_source_created_at ON context_budget_events(source, created_at);
    CREATE INDEX IF NOT EXISTS idx_context_budget_events_runtime_created_at ON context_budget_events(assistant_runtime, created_at);
    CREATE INDEX IF NOT EXISTS idx_widget_telemetry_created_at ON widget_telemetry_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_widget_telemetry_event_created_at ON widget_telemetry_events(event_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_widget_telemetry_code_created_at ON widget_telemetry_events(error_code, created_at);
    CREATE INDEX IF NOT EXISTS idx_widget_telemetry_session_created_at ON widget_telemetry_events(session_id, created_at);

    -- Bridge: IM channel bindings
    CREATE TABLE IF NOT EXISTS channel_bindings (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      monolith_session_id TEXT NOT NULL,
      sdk_session_id TEXT NOT NULL DEFAULT '',
      working_directory TEXT NOT NULL DEFAULT '',
      model TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT 'code' CHECK(mode IN ('code', 'plan', 'ask')),
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (monolith_session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      UNIQUE(channel_type, chat_id)
    );
    CREATE INDEX IF NOT EXISTS idx_channel_bindings_session ON channel_bindings(monolith_session_id);
    CREATE INDEX IF NOT EXISTS idx_channel_bindings_lookup ON channel_bindings(channel_type, chat_id);

    -- Bridge: polling offset watermarks per adapter
    CREATE TABLE IF NOT EXISTS channel_offsets (
      channel_type TEXT PRIMARY KEY,
      offset_value TEXT NOT NULL DEFAULT '0',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Bridge: idempotent message dedup
    CREATE TABLE IF NOT EXISTS channel_dedupe (
      dedup_key TEXT PRIMARY KEY,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_channel_dedupe_expires ON channel_dedupe(expires_at);

    -- Bridge: outbound message references (for editing/deleting sent messages)
    CREATE TABLE IF NOT EXISTS channel_outbound_refs (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      monolith_session_id TEXT NOT NULL,
      platform_message_id TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT 'response',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_outbound_refs_session ON channel_outbound_refs(monolith_session_id);

    -- Bridge: audit log
    CREATE TABLE IF NOT EXISTS channel_audit_logs (
      id TEXT PRIMARY KEY,
      channel_type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
      message_id TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_logs_chat ON channel_audit_logs(channel_type, chat_id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON channel_audit_logs(created_at);

    -- Bridge: permission request → IM message links
    CREATE TABLE IF NOT EXISTS channel_permission_links (
      id TEXT PRIMARY KEY,
      permission_request_id TEXT NOT NULL,
      channel_type TEXT NOT NULL,
      chat_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      tool_name TEXT NOT NULL DEFAULT '',
      suggestions TEXT NOT NULL DEFAULT '',
      resolved INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_perm_links_request ON channel_permission_links(permission_request_id);

    -- Worktree management
    CREATE TABLE IF NOT EXISTS worktrees (
      id TEXT PRIMARY KEY,
      workspace_path TEXT NOT NULL,
      worktree_path TEXT NOT NULL UNIQUE,
      branch TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_worktrees_workspace ON worktrees(workspace_path);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS message_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      part_type TEXT NOT NULL CHECK(part_type IN ('text', 'reasoning', 'tool_use', 'tool_result')),
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      part_key TEXT,
      part_index INTEGER,
      revision INTEGER,
      is_final INTEGER,
      updated_at INTEGER,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE,
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_message_parts_session_id ON message_parts(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_parts_message_id ON message_parts(message_id);

    CREATE TABLE IF NOT EXISTS session_runtime_state (
      session_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'idle' CHECK(status IN ('idle', 'running', 'waiting_permission', 'stopping', 'error')),
      pending_permissions TEXT NOT NULL DEFAULT '[]',
      generation_queue TEXT NOT NULL DEFAULT '[]',
      last_event_id TEXT,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );
  `);

  // Run migrations for existing databases
  migrateDb(db);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_message_parts_message_id_part_index ON message_parts(message_id, part_index);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_message_parts_message_id_part_key ON message_parts(message_id, part_key) WHERE part_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_session_role_client_id ON messages(session_id, role, client_message_id) WHERE client_message_id IS NOT NULL;
  `);
}
