import Link from 'next/link';

export default function OverviewPage() {
  return (
    <main className="flex h-full min-h-0 items-center justify-center overflow-y-auto p-6">
      <section className="w-full max-w-xl rounded-2xl border border-border-subtle bg-bg-secondary p-8 shadow-sm">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
          NoonFlow
        </p>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          Claude Code、Codex 与 Pi，本地直接使用
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          从左侧选择一个项目并开始对话。会话历史由 Claude Code、Codex 或 Pi 原生保存，NoonFlow 不再创建自己的会话副本。
        </p>
        <div className="mt-6 flex items-center gap-3">
          <Link
            href="/settings"
            className="rounded-lg border border-border-default px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            检查运行环境
          </Link>
        </div>
      </section>
    </main>
  );
}
