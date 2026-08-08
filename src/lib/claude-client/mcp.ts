import type {
  McpHttpServerConfig,
  McpSSEServerConfig,
  McpServerConfig,
  McpStdioServerConfig,
} from '@anthropic-ai/claude-agent-sdk';

import type { MCPServerConfig } from '@/types';

/**
 * Convert our MCPServerConfig to the SDK's McpServerConfig format.
 * Supports stdio, sse, and http transport types.
 */
export function toSdkMcpConfig(
  servers: Record<string, MCPServerConfig>
): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};

  for (const [name, config] of Object.entries(servers)) {
    const transport = config.type || 'stdio';

    switch (transport) {
      case 'sse': {
        if (!config.url) {
          console.warn(`[mcp] SSE server "${name}" is missing url, skipping`);
          continue;
        }

        const sseConfig: McpSSEServerConfig = {
          type: 'sse',
          url: config.url,
        };

        if (config.headers && Object.keys(config.headers).length > 0) {
          sseConfig.headers = config.headers;
        }

        result[name] = sseConfig;
        break;
      }

      case 'http': {
        if (!config.url) {
          console.warn(`[mcp] HTTP server "${name}" is missing url, skipping`);
          continue;
        }

        const httpConfig: McpHttpServerConfig = {
          type: 'http',
          url: config.url,
        };

        if (config.headers && Object.keys(config.headers).length > 0) {
          httpConfig.headers = config.headers;
        }

        result[name] = httpConfig;
        break;
      }

      case 'stdio':
      default: {
        if (!config.command) {
          console.warn(`[mcp] stdio server "${name}" is missing command, skipping`);
          continue;
        }

        const stdioConfig: McpStdioServerConfig = {
          command: config.command,
          args: config.args,
          env: config.env,
        };
        result[name] = stdioConfig;
      }
    }
  }

  return result;
}
