/**
 * 渲染进程访问 Shell 环境变量的 API
 *
 * 用于让 Claude/Codex 客户端获取完整的 shell 环境变量，
 * 继承用户在 .zshrc、.bash_profile 等配置文件中的设置。
 */

// 缓存 TTL: 60 秒，与主进程保持一致
const CACHE_TTL_MS = 60_000;

let cachedShellEnv: Record<string, string> | null = null;
let cacheTime = 0;
let cachePromise: Promise<Record<string, string>> | null = null;

/**
 * 获取 Shell 环境变量
 *
 * 通过 IPC 调用主进程的 getShellEnvironment()，获取用户登录 shell 的完整环境。
 * 结果会被缓存 60 秒，避免重复 IPC 调用。
 */
export async function getShellEnvironment(): Promise<Record<string, string>> {
  const now = Date.now();

  // 检查缓存是否有效（非空且未过期）
  if (cachedShellEnv && now - cacheTime < CACHE_TTL_MS) {
    return { ...cachedShellEnv };
  }

  // 如果已有正在进行的请求，等待其完成
  if (cachePromise) {
    try {
      return { ...(await cachePromise) };
    } catch {
      // 如果之前的请求失败，清除它并重新尝试
      cachePromise = null;
    }
  }

  cachePromise = (async () => {
    // 检查是否在 Electron 环境中
    if (typeof window !== "undefined" && window.electronAPI?.environment?.getShellEnv) {
      const env = await window.electronAPI.environment.getShellEnv();
      cachedShellEnv = env;
      cacheTime = Date.now();
      return env;
    }
    // 非 Electron 环境（如开发时的 Next.js standalone）
    const env = { ...process.env } as Record<string, string>;
    cachedShellEnv = env;
    cacheTime = Date.now();
    return env;
  })();

  try {
    return { ...(await cachePromise) };
  } finally {
    // 无论成功失败，都清除 in-flight promise，下次调用会重新尝试
    cachePromise = null;
  }
}

/**
 * 清除 Shell 环境变量缓存
 *
 * 当用户修改了 shell 配置文件后，可以调用此函数强制重新获取环境变量。
 */
export function clearShellEnvCache() {
  cachedShellEnv = null;
  cacheTime = 0;
  cachePromise = null;
}
