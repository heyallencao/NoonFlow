// ==========================================
// Database Models
// ==========================================

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  session_type: 'chat' | 'terminal';
  model: string;
  system_prompt: string;
  working_directory: string;
  sdk_session_id: string; // Runtime-managed session/thread ID for resume
  project_name: string;
  status: 'active' | 'archived';
  mode?: 'code' | 'plan' | 'ask';
  needs_approval?: boolean;
  provider_name: string;
  provider_id: string;
  sdk_cwd: string;
  runtime_status: string;
  runtime_updated_at: string;
  runtime_error: string;
  assistant_runtime: AssistantRuntime;
  assistant_runtime_version: string;
}

export interface Worktree {
  id: string;
  workspace_path: string;
  worktree_path: string;
  branch: string;
  head: string;
  name: string;
  is_default: boolean;
  is_prunable: boolean;
  is_locked: boolean;
  is_managed: boolean;
}

export interface WorktreeDeleteStatus {
  checked: boolean;
  has_changes: boolean;
  dirty_files_count: number;
  untracked_files_count: number;
}

export type AssistantRuntime = 'claude_code' | 'codex' | 'pi';

export type SessionType = 'chat' | 'terminal';

export type SessionListType = SessionType | 'all';

// ==========================================
// Project / File Types
// ==========================================

export interface ProjectInfo {
  path: string;
  name: string;
  files_count: number;
  last_modified: string;
}

export interface FileTreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileTreeNode[];
  size?: number;
  extension?: string;
}

export interface FilePreview {
  path: string;
  content: string;
  language: string;
  line_count: number;
  line_count_exact: boolean;
  size: number;
  truncated: boolean;
  binary: boolean;
}

// ==========================================
// Task Types
// ==========================================

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

export interface TaskItem {
  id: string;
  session_id: string;
  title: string;
  status: TaskStatus;
  description: string | null;
  source: 'user' | 'sdk';
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string; // JSON string of MessageContentBlock[] for structured content
  created_at: string;
  token_usage: string | null; // JSON string of TokenUsage
  client_message_id?: string | null;
  db_message_id?: string | null;
  status?: string | null;
  content_format_version?: number | null;
  completed_at?: string | null;
  persisted_revision?: number | null;
}

// Structured message content blocks (stored as JSON in messages.content)
export type MessageContentBlock =
  | { type: 'text'; text: string }
  | { type: 'reasoning'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'code'; language: string; code: string };

// Helper to parse message content - returns blocks or wraps plain text
export function parseMessageContent(content: string): MessageContentBlock[] {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Not JSON, treat as plain text
  }
  return [{ type: 'text', text: content }];
}

export interface Setting {
  id: number;
  key: string;
  value: string;
}

// ==========================================
// API Provider Types
// ==========================================

export interface ApiProvider {
  id: string;
  name: string;
  provider_type: string; // 'anthropic' | 'openrouter' | 'bedrock' | 'vertex' | 'custom'
  base_url: string;
  api_key: string;
  is_active: number; // SQLite boolean: 0 or 1
  sort_order: number;
  extra_env: string; // JSON string of Record<string, string>
  notes: string;
  created_at: string;
  updated_at: string;
}

export interface AssistantModelOption {
  value: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  supportedEffortLevels?: string[];
  defaultEffort?: string;
}

export interface ProviderModelGroup {
  provider_id: string;       // provider DB id, or 'env' for environment variables
  provider_name: string;
  provider_type: string;
  models: AssistantModelOption[];
  default_model?: string;
  error?: string;
}

export interface PiModelOption {
  provider: string;
  id: string;
  value: string;
  label: string;
  contextWindow: number | null;
  maxOutputTokens: number | null;
  reasoning: boolean;
  images: boolean;
}

export interface CreateProviderRequest {
  name: string;
  provider_type?: string;
  base_url?: string;
  api_key?: string;
  extra_env?: string;
  notes?: string;
}

export interface UpdateProviderRequest {
  name?: string;
  provider_type?: string;
  base_url?: string;
  api_key?: string;
  extra_env?: string;
  notes?: string;
  sort_order?: number;
}

export interface ProvidersResponse {
  providers: ApiProvider[];
}

export interface ProviderResponse {
  provider: ApiProvider;
}

// ==========================================
// Token Usage
// ==========================================

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
}

export type RuntimeContextSource = 'native' | 'estimated' | 'unavailable';

export interface RuntimeContextTokenState {
  usedTokens: number;
  contextWindowTokens: number | null;
  percentage: number | null;
}

export type RuntimeCompactionTrigger = 'auto' | 'manual' | 'recovery';

export type RuntimeCompactionState =
  | { status: 'idle' }
  | {
      status: 'compacting';
      trigger: RuntimeCompactionTrigger | null;
      preTokens: number | null;
      postTokens: null;
      postTokensEstimated: false;
      startedAt: number;
      completedAt: null;
      error: null;
    }
  | {
      status: 'completed';
      trigger: RuntimeCompactionTrigger;
      preTokens: number | null;
      postTokens: number | null;
      postTokensEstimated: boolean;
      startedAt: number;
      completedAt: number;
      error: null;
    }
  | {
      status: 'failed';
      trigger: RuntimeCompactionTrigger | null;
      preTokens: number | null;
      postTokens: null;
      postTokensEstimated: false;
      startedAt: number;
      completedAt: number;
      error: string;
    };

export interface RuntimeContextState {
  runtime: AssistantRuntime;
  currentContext: RuntimeContextTokenState | null;
  lastTurnUsage: TokenUsage | null;
  source: RuntimeContextSource;
  compaction: RuntimeCompactionState;
  updatedAt: number;
}

// ==========================================
// API Request Types
// ==========================================

export interface CreateSessionRequest {
  title?: string;
  model?: string;
  system_prompt?: string;
  working_directory?: string;
  mode?: string;
  provider_id?: string;
  assistant_runtime?: AssistantRuntime;
  session_type?: 'chat' | 'terminal';
}

export interface CreateWorktreeRequest {
  workspace_path: string;
  branch: string;
  base_branch?: string;
}

export interface DeleteWorktreeRequest {
  workspace_path: string;
  worktree_path: string;
  confirm: boolean;
  force_dirty?: boolean;
  delete_branch?: boolean;
}

export interface WorktreesResponse {
  worktrees: Worktree[];
  is_git_repo: boolean;
  workspace_path?: string;
  max_managed_worktrees: number;
}

export interface SessionsQueryParams {
  type?: SessionListType;
  cursor?: number;
}

export interface SendMessageRequest {
  session_id: string;
  content: string;
  display_content?: string;
  model?: string;
  mode?: string;
  provider_id?: string;
  assistant_runtime?: AssistantRuntime;
  client_message_id?: string;
}

export interface AssistantRuntimeStatus {
  id: AssistantRuntime;
  label: string;
  enabled: boolean;
  /** The runtime process can be started, even if cwd-scoped configuration still needs to resolve. */
  launchable: boolean;
  /** The runtime has enough globally visible configuration to be advertised or selected as ready. */
  available: boolean;
  installed: boolean;
  configured: boolean;
  supports_plan_mode: boolean;
  supports_permissions: boolean;
  version?: string;
  status_message?: string;
}

export interface AssistantRuntimeListResponse {
  runtimes: AssistantRuntimeStatus[];
  default_assistant_runtime: AssistantRuntime;
}

export interface UpdateMCPConfigRequest {
  mcpServers: Record<string, MCPServerConfig>;
}

export interface AddMCPServerRequest {
  name: string;
  server: MCPServerConfig;
}

export interface UpdateSettingsRequest {
  settings: SettingsMap;
}

// --- File API ---

export interface FileTreeRequest {
  dir: string;
  depth?: number; // default 3
}

export interface FilePreviewRequest {
  path: string;
  maxLines?: number; // default 200
}

// --- Task API ---

export interface CreateTaskRequest {
  session_id: string;
  title: string;
  description?: string;
}

export interface UpdateTaskRequest {
  title?: string;
  status?: TaskStatus;
  description?: string;
}

// --- Skill API ---

export interface SkillDefinition {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
}

// --- Marketplace (ClawHub / Skills.sh compatible) ---

export interface MarketplaceSkill {
  id: string;
  skillId: string;      // e.g. "git-commit"
  name: string;
  installs: number;
  source: string;       // e.g. "owner/repo"
  isInstalled?: boolean;
  installedAt?: string;
  installedSource?: 'agents' | 'claude';
}

export interface SkillLockFile {
  version: number;
  skills: Record<string, SkillLockEntry>;
}

export interface SkillLockEntry {
  source: string;
  sourceType: string;
  sourceUrl: string;
  skillPath?: string;
  skillFolderHash: string;
  installedAt: string;
  updatedAt: string;
}

export interface CreateSkillRequest {
  name: string;
  description: string;
  prompt: string;
}

export interface UpdateSkillRequest {
  description?: string;
  prompt?: string;
  enabled?: boolean;
}

// ==========================================
// API Response Types
// ==========================================

export interface SessionsResponse {
  sessions: ChatSession[];
  deleted_session_ids?: string[];
  next_cursor?: number;
}

export interface SessionResponse {
  session: ChatSession;
}

export interface MessagesResponse {
  messages: Message[];
  hasMore?: boolean;
}

export interface SuccessResponse {
  success: true;
}

export interface ErrorResponse {
  error: string;
}

export interface SettingsResponse {
  settings: SettingsMap;
}

export interface PluginsResponse {
  plugins: PluginInfo[];
}

export interface MCPConfigResponse {
  mcpServers: Record<string, MCPServerConfig>;
}

// --- File API Responses ---

export interface FileTreeResponse {
  tree: FileTreeNode[];
  root: string;
}

export interface FilePreviewResponse {
  preview: FilePreview;
}

// --- Task API Responses ---

export interface TasksResponse {
  tasks: TaskItem[];
}

export interface TaskResponse {
  task: TaskItem;
}

// --- Skill API Responses ---

export interface SkillsResponse {
  skills: SkillDefinition[];
}

export interface SkillResponse {
  skill: SkillDefinition;
}

// ==========================================
// SSE Event Types (streaming chat response)
// ==========================================

export type SSEEventType =
  | 'text'               // text content delta
  | 'reasoning'          // thinking / reasoning delta
  | 'assistant_attempt_start' // checkpoint before one assistant model attempt
  | 'assistant_attempt_reset' // restore the checkpoint before a native retry
  | 'tool_use'           // tool invocation info
  | 'tool_result'        // tool execution result
  | 'tool_output'        // streaming tool output (stderr from SDK process)
  | 'tool_timeout'       // tool execution timed out
  | 'status'             // status update (compacting, etc.)
  | 'result'             // final result with usage stats
  | 'error'              // error occurred
  | 'permission_request' // permission approval needed
  | 'mode_changed'       // SDK permission mode changed (e.g. plan → code)
  | 'task_update'        // SDK TodoWrite task sync
  | 'user_persisted'     // user message persisted to DB
  | 'persisted'          // assistant message persisted to DB
  | 'activity.updated'   // complete ChildActivity upsert payload
  | 'runtime.heartbeat'  // liveness only; never persisted or rendered
  | 'done';              // stream complete

export interface SSEEvent {
  type: SSEEventType;
  data: string;
}

export interface AssistantPersistedEventData {
  session_id: string;
  client_message_id: string;
  message_id: string;
  revision: number;
  created_at: string;
}

export interface UserPersistedEventData {
  session_id: string;
  client_message_id: string;
  message_id: string;
  created_at: string;
}

// ==========================================
// Permission Types
// ==========================================

export interface PermissionSuggestion {
  type: string;
  rules?: Array<{ toolName: string; ruleContent?: string }>;
  behavior?: string;
  destination?: string;
}

export interface PermissionRequestEvent {
  permissionRequestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  suggestions?: PermissionSuggestion[];
  decisionReason?: string;
  blockedPath?: string;
  toolUseId: string;
  description?: string;
}

export interface PermissionResponseRequest {
  permissionRequestId: string;
  decision: {
    behavior: 'allow';
    updatedPermissions?: PermissionSuggestion[];
    updatedInput?: Record<string, unknown>;
  } | {
    behavior: 'deny';
    message?: string;
  };
}

// ==========================================
// Plugin / MCP Types
// ==========================================

export interface PluginInfo {
  name: string;
  description: string;
  enabled: boolean;
}

export interface MCPServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type?: 'stdio' | 'sse' | 'http';
  url?: string;
  headers?: Record<string, string>;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

// Backward-compatible alias
export type MCPServer = MCPServerConfig;

// ==========================================
// Settings Types
// ==========================================

export interface SettingsMap {
  [key: string]: string;
}

// Well-known setting keys
export const SETTING_KEYS = {
  DEFAULT_MODEL: 'default_model',
  DEFAULT_SYSTEM_PROMPT: 'default_system_prompt',
  THEME: 'theme',
  PERMISSION_MODE: 'permission_mode',
  MAX_THINKING_TOKENS: 'max_thinking_tokens',
  CHAT_REASONING_ENABLED: 'chat_reasoning_enabled',
  GENERATIVE_UI_ENABLED: 'generative_ui_enabled',
  DEFAULT_ASSISTANT_RUNTIME: 'default_assistant_runtime',
  ASSISTANT_RUNTIME_ENABLED_CLAUDE: 'assistant_runtime_enabled_claude_code',
  ASSISTANT_RUNTIME_ENABLED_CODEX: 'assistant_runtime_enabled_codex',
  ASSISTANT_RUNTIME_ENABLED_PI: 'assistant_runtime_enabled_pi',
  CODEX_AUTH_TOKEN: 'codex_auth_token',
  CODEX_BASE_URL: 'codex_base_url',
  CODEX_DEFAULT_MODEL: 'codex_default_model',
  CODEX_EXTRA_ENV: 'codex_extra_env',
  PI_DEFAULT_MODEL: 'pi_default_model',
  OVERVIEW_RECOMMENDATION_RULES: 'dashboard_recommendation_rules',
  CONTEXT_WINDOW_OVERRIDES: 'context_window_overrides',
  CONTEXT_USAGE_BAR_ENABLED: 'context_usage_bar_enabled',
} as const;

// ==========================================
// Reference Image Types (for image generation)
// ==========================================

export interface ReferenceImage {
  mimeType: string;
  data?: string;       // base64 (user upload)
  localPath?: string;  // file path (generated result)
}

// ==========================================
// File Attachment Types
// ==========================================

export interface FileAttachment {
  id: string;
  name: string;
  type: string; // MIME type
  size: number;
  data: string; // base64 encoded content
  filePath?: string; // persisted disk path (for messages reloaded from DB)
  sourcePath?: string; // original workspace path when attached from the file tree
}

// Check if a MIME type is an image
export function isImageFile(type: string): boolean {
  return type.startsWith('image/');
}

// Format bytes into human-readable size
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ==========================================
// Claude Client Types
// ==========================================

// ==========================================
// Batch Image Generation Types
// ==========================================

export type MediaJobStatus = 'draft' | 'planning' | 'planned' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed';
export type MediaJobItemStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';

export interface MediaJob {
  id: string;
  session_id: string | null;
  status: MediaJobStatus;
  doc_paths: string;       // JSON array of file paths
  style_prompt: string;
  batch_config: string;    // JSON of BatchConfig
  total_items: number;
  completed_items: number;
  failed_items: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface MediaJobItem {
  id: string;
  job_id: string;
  idx: number;
  prompt: string;
  aspect_ratio: string;
  image_size: string;
  model: string;
  tags: string;            // JSON array of strings
  source_refs: string;     // JSON array of strings
  status: MediaJobItemStatus;
  retry_count: number;
  result_media_generation_id: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface MediaContextEvent {
  id: string;
  session_id: string;
  job_id: string;
  payload: string;         // JSON object
  sync_mode: 'manual' | 'auto_batch';
  synced_at: string | null;
  created_at: string;
}

export interface BatchConfig {
  concurrency: number;     // max parallel image generations (default: 2)
  maxRetries: number;      // max retry attempts per item (default: 2)
  retryDelayMs: number;    // base delay for exponential backoff (default: 2000)
}

export interface PlannerItem {
  prompt: string;
  aspectRatio: string;
  resolution: string;
  tags: string[];
  sourceRefs: string[];
}

export interface PlannerOutput {
  summary: string;
  items: PlannerItem[];
}

export type JobProgressEventType =
  | 'item_started'
  | 'item_completed'
  | 'item_failed'
  | 'item_retry'
  | 'job_completed'
  | 'job_paused'
  | 'job_cancelled';

export interface JobProgressEvent {
  type: JobProgressEventType;
  jobId: string;
  itemId?: string;
  itemIdx?: number;
  progress: {
    total: number;
    completed: number;
    failed: number;
    processing: number;
  };
  error?: string;
  retryCount?: number;
  mediaGenerationId?: string;
  timestamp: string;
}

// --- Batch Image Gen API Types ---

export interface CreateMediaJobRequest {
  sessionId?: string;
  items: Array<{
    prompt: string;
    aspectRatio?: string;
    imageSize?: string;
    model?: string;
    tags?: string[];
    sourceRefs?: string[];
  }>;
  batchConfig?: Partial<BatchConfig>;
  stylePrompt?: string;
  docPaths?: string[];
}

export interface PlanMediaJobRequest {
  docPaths?: string[];
  docContent?: string;
  stylePrompt: string;
  sessionId?: string;
  count?: number;
}

export interface UpdateMediaJobItemsRequest {
  items: Array<{
    id: string;
    prompt?: string;
    aspectRatio?: string;
    imageSize?: string;
    tags?: string[];
  }>;
}

export interface MediaJobResponse {
  job: MediaJob;
  items: MediaJobItem[];
}

export interface MediaJobListResponse {
  jobs: MediaJob[];
}

// ==========================================
// Stream Session Manager Types
// ==========================================

export interface ToolUseInfo {
  id: string;
  name: string;
  input: unknown;
}

export interface ToolResultInfo {
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type StreamingMessageBlock =
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'reasoning'; text: string }
  | { id: string; type: 'tool'; tool_use_id: string };

export type StreamPhase = 'active' | 'completed' | 'error' | 'stopped';

export type ChildActivityStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'stopped';

export interface ChildActivity {
  id: string;
  parentId?: string;
  runtime: AssistantRuntime;
  kind: string;
  title: string;
  status: ChildActivityStatus;
  summary?: string;
  startedAt: number;
  updatedAt: number;
}

export interface SessionStreamSnapshot {
  sessionId: string;
  clientMessageId: string | null;
  phase: StreamPhase;
  streamingContent: string;
  streamingReasoning: string;
  toolUses: ToolUseInfo[];
  toolResults: ToolResultInfo[];
  streamingBlocks: StreamingMessageBlock[];
  streamingToolOutput: string;
  childActivities: ChildActivity[];
  statusText: string | undefined;
  pendingPermission: PermissionRequestEvent | null;
  permissionResolved: 'allow' | 'deny' | null;
  tokenUsage: TokenUsage | null;
  startedAt: number;
  completedAt: number | null;
  error: string | null;
  persistedUserMessageId?: string | null;
  persistedUserCreatedAt?: string | null;
  persistedMessageId?: string | null;
  persistedRevision?: number | null;
  persistedCreatedAt?: string | null;
  /**
   * @deprecated Legacy fallback only. Terminal content is now derived from
   * streamingContent / streamingBlocks / toolResults preserved in the snapshot.
   * Always `null` for new streams; kept for backward compatibility with older
   * snapshots produced by older renderer implementations.
   */
  finalMessageContent: string | null;
}

export interface StreamEvent {
  type: 'snapshot-updated' | 'phase-changed' | 'permission-request' | 'completed';
  sessionId: string;
  snapshot: SessionStreamSnapshot;
}

export type StreamEventListener = (event: StreamEvent) => void;

export interface ContextBudgetRecoveryMetrics {
  officialCompactAttempted?: boolean;
  officialCompactSuccess?: boolean;
  compactRetrySuccess?: boolean;
  recoveryDurationMs?: number | null;
}

export interface ClaudeStreamOptions {
  prompt: string;
  sessionId: string;
  sdkSessionId?: string; // SDK session ID for resuming conversations
  model?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  mcpServers?: Record<string, MCPServerConfig>;
  abortController?: AbortController;
  permissionMode?: string;
  files?: FileAttachment[];
  imageAgentMode?: boolean;
  generativeUI?: boolean;
  toolTimeoutSeconds?: number;
  provider?: ApiProvider;
  /** Recent conversation history from DB — used as fallback context when SDK resume is unavailable or fails */
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Lazily loads and trims emergency DB history only after native resume fails. */
  loadEmergencyConversationHistory?: (
    reason: string,
  ) => Array<{ role: 'user' | 'assistant'; content: string }> | Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  onRuntimeStatusChange?: (status: string) => void;
  onContextBudgetRecovery?: (metrics: ContextBudgetRecoveryMetrics) => void | Promise<void>;
}

export interface PiStreamOptions {
  prompt: string;
  sessionId: string;
  sdkSessionId?: string;
  model?: string;
  systemPrompt?: string;
  workingDirectory?: string;
  abortController?: AbortController;
  permissionMode?: string;
  files?: FileAttachment[];
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
  /** Lazily loads and trims emergency DB history only after native resume fails. */
  loadEmergencyConversationHistory?: (
    reason: string,
  ) => Array<{ role: 'user' | 'assistant'; content: string }> | Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  onSessionIdInvalidated?: () => void;
  onRuntimeStatusChange?: (status: string) => void;
}
