type SessionTypeFilter = 'all' | 'chat' | 'terminal';

interface CliBaseOptions {
  asJson: boolean;
  failOnMismatch: boolean;
}

interface CliSingleOptions extends CliBaseOptions {
  mode: 'single';
  sessionId: string;
}

interface CliSampleOptions extends CliBaseOptions {
  mode: 'sample';
  sampleSize: number;
  sinceUpdatedAt?: string;
  sessionType: SessionTypeFilter;
}

type CliOptions = CliSingleOptions | CliSampleOptions;

function printUsage(): void {
  console.error(
    [
      'Usage:',
      '  jiti scripts/chat-replay-validate.ts <sessionId> [--json] [--fail-on-mismatch]',
      '  jiti scripts/chat-replay-validate.ts --sample-size <n> [--since <YYYY-MM-DD HH:mm:ss>] [--session-type <all|chat|terminal>] [--json] [--fail-on-mismatch]',
      '',
      'Options:',
      '  --json              Print the full validation report as JSON',
      '  --fail-on-mismatch  Exit with code 2 when mismatches are found',
      '  --sample-size <n>   Validate up to n recent sessions with messages',
      '  --since <datetime>  Only sample sessions updated at/after this timestamp',
      '  --session-type      Sample scope: all (default), chat, or terminal',
    ].join('\n'),
  );
}

function parseArgs(argv: string[]): CliOptions | null {
  let sessionId: string | null = null;
  let sampleSize: number | null = null;
  let sinceUpdatedAt: string | undefined;
  let sessionType: SessionTypeFilter = 'all';
  let asJson = false;
  let failOnMismatch = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--json') {
      asJson = true;
      continue;
    }

    if (arg === '--fail-on-mismatch') {
      failOnMismatch = true;
      continue;
    }

    if (arg === '--sample-size') {
      const value = argv[i + 1];
      if (!value) {
        return null;
      }
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
      }
      sampleSize = parsed;
      i += 1;
      continue;
    }

    if (arg === '--since') {
      const value = argv[i + 1];
      if (!value) {
        return null;
      }
      sinceUpdatedAt = value;
      i += 1;
      continue;
    }

    if (arg === '--session-type') {
      const value = argv[i + 1];
      if (value !== 'all' && value !== 'chat' && value !== 'terminal') {
        return null;
      }
      sessionType = value;
      i += 1;
      continue;
    }

    if (arg.startsWith('--')) {
      return null;
    }

    if (!sessionId) {
      sessionId = arg;
      continue;
    }

    return null;
  }

  if (sampleSize !== null) {
    if (sessionId) {
      return null;
    }
    return {
      mode: 'sample',
      sampleSize,
      sinceUpdatedAt,
      sessionType,
      asJson,
      failOnMismatch,
    };
  }

  if (!sessionId) {
    return null;
  }

  return {
    mode: 'single',
    sessionId,
    asJson,
    failOnMismatch,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { register } = await import('tsconfig-paths');
  const unregister = register({
    baseUrl: process.cwd(),
    paths: {
      '@/*': ['src/*'],
    },
  });
  const {
    validateSessionReplay,
    validateSampledSessionReplays,
    formatReplayValidationReport,
    formatReplaySampleValidationReport,
  } = await import('../src/lib/chat/replay-validator');
  const { closeDb } = await import('../src/lib/db');

  try {
    if (options.mode === 'single') {
      const report = validateSessionReplay(options.sessionId);

      if (options.asJson) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatReplayValidationReport(report));
      }

      if (options.failOnMismatch && report.mismatchCount > 0) {
        process.exitCode = 2;
      }
    } else {
      const report = validateSampledSessionReplays({
        sampleSize: options.sampleSize,
        sinceUpdatedAt: options.sinceUpdatedAt,
        sessionType: options.sessionType,
      });

      if (options.asJson) {
        console.log(JSON.stringify(report, null, 2));
      } else {
        console.log(formatReplaySampleValidationReport(report));
      }

      if (options.failOnMismatch && report.totalMismatchCount > 0) {
        process.exitCode = 2;
      }
    }
  } finally {
    unregister();
    closeDb();
  }
}

void main();
