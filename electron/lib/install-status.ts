import type { InstallStatus, InstallStepStatus } from '../bridge.d';

export function initializationStepStatus(initialized: boolean): InstallStepStatus {
  return initialized ? 'success' : 'needs_setup';
}

export function installCompletionStatus(needsSetup: boolean): InstallStatus {
  return needsSetup ? 'needs_setup' : 'success';
}
