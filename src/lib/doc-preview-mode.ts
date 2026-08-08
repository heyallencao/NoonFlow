export const DOC_PREVIEW_HIGHLIGHT_MAX_BYTES = 256 * 1024;
export const DOC_PREVIEW_EDIT_MAX_BYTES = 2 * 1024 * 1024;
export const FILE_PREVIEW_MAX_BYTES = 256 * 1024;

export type DocPreviewMode = 'highlight' | 'plain' | 'readonly';

export function getDocPreviewMode(size: number): DocPreviewMode {
  if (size <= DOC_PREVIEW_HIGHLIGHT_MAX_BYTES) {
    return 'highlight';
  }

  if (size <= DOC_PREVIEW_EDIT_MAX_BYTES) {
    return 'plain';
  }

  return 'readonly';
}

export function isEditableDocPreviewMode(mode: DocPreviewMode): boolean {
  return mode !== 'readonly';
}
