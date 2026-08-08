import { useCallback } from 'react';

/**
 * Hook that provides a native folder picker when the desktop bridge is available
 * with browser fallback detection.
 */
export function useNativeFolderPicker() {
  const hasNativeFolderDialog = typeof window !== 'undefined' && !!window.electronAPI?.dialog?.openFolder;

  const openNativePicker = useCallback(
    async (options?: { defaultPath?: string; title?: string }): Promise<string | null> => {
      if (!window.electronAPI?.dialog?.openFolder) return null;
      const result = await window.electronAPI.dialog.openFolder(options);
      return result.canceled ? null : result.filePaths[0] ?? null;
    },
    []
  );

  return { hasNativeFolderDialog, openNativePicker };
}
