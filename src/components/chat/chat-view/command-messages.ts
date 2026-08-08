import type { Message } from '@/types';

const HELP_COMMAND_CONTENT = `## Available Commands

### Instant Commands
- **/help** — Show this help message
- **/clear** — Clear conversation history
- **/cost** — Show token usage statistics

### Prompt Commands (shown as badge, add context then send)
- **/compact** — Compress conversation context
- **/doctor** — Diagnose project health
- **/init** — Initialize CLAUDE.md for project
- **/review** — Review code quality
- **/terminal-setup** — Configure terminal settings
- **/memory** — Edit project memory file

### Custom Skills
Skills from \`~/.claude/commands/\` and project \`.claude/commands/\` are also available via \`/\`.

**Tips:**
- Type \`/\` to browse commands and skills
- Type \`@\` to mention files
- Use Shift+Enter for new line
- Select a project folder to enable file operations`;

export function buildHelpCommandMessage(sessionId: string): Message {
  return {
    id: `cmd-${Date.now()}`,
    session_id: sessionId,
    role: 'assistant',
    content: HELP_COMMAND_CONTENT,
    created_at: new Date().toISOString(),
    token_usage: null,
  };
}

export function buildCostCommandMessage(sessionId: string, messages: Message[]): Message {
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheCreation = 0;
  let totalCost = 0;
  let turnCount = 0;

  for (const msg of messages) {
    if (!msg.token_usage) {
      continue;
    }

    try {
      const usage = typeof msg.token_usage === 'string'
        ? JSON.parse(msg.token_usage)
        : msg.token_usage;
      totalInput += usage.input_tokens || 0;
      totalOutput += usage.output_tokens || 0;
      totalCacheRead += usage.cache_read_input_tokens || 0;
      totalCacheCreation += usage.cache_creation_input_tokens || 0;
      if (usage.cost_usd) {
        totalCost += usage.cost_usd;
      }
      turnCount += 1;
    } catch {
      // Skip malformed usage payloads.
    }
  }

  const totalTokens = totalInput + totalOutput + totalCacheRead + totalCacheCreation;

  const content = turnCount === 0
    ? '## Token Usage\n\nNo token usage data yet. Send a message first.'
    : `## Token Usage\n\n| Metric | Count |\n|--------|-------|\n| Input tokens | ${totalInput.toLocaleString()} |\n| Output tokens | ${totalOutput.toLocaleString()} |\n| Cache read | ${totalCacheRead.toLocaleString()} |\n| Cache creation | ${totalCacheCreation.toLocaleString()} |\n| **Total tokens** | **${totalTokens.toLocaleString()}** |\n| Turns | ${turnCount} |${totalCost > 0 ? `\n| **Estimated cost** | **$${totalCost.toFixed(4)}** |` : ''}`;

  return {
    id: `cmd-${Date.now()}`,
    session_id: sessionId,
    role: 'assistant',
    content,
    created_at: new Date().toISOString(),
    token_usage: null,
  };
}
