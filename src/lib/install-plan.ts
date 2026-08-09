export interface NodeInstallSelection {
  hasNode: boolean;
  nodeSupportsPi: boolean;
  installClaude: boolean;
  installCodex: boolean;
  installPi: boolean;
  initializePi: boolean;
}

export function needsNodeInstallation(selection: NodeInstallSelection): boolean {
  const anyCliInstall = selection.installClaude || selection.installCodex || selection.installPi;
  return (!selection.hasNode && anyCliInstall)
    || (!selection.nodeSupportsPi && (selection.installPi || selection.initializePi));
}
