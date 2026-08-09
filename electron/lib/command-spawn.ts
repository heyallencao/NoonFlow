export function shouldUseWindowsCommandShell(
  command: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}

export function nodePackageManagerAction(installedByPackageManager: boolean): "install" | "upgrade" {
  return installedByPackageManager ? "upgrade" : "install";
}
