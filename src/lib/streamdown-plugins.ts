import { cjk } from "@streamdown/cjk";
import { createCodePlugin } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import type { PluggableList } from "unified";
import remarkGfm from "remark-gfm";

import { remarkPreserveSoftBreaks } from "@/lib/streamdown-remark-breaks";
import { STREAMDOWN_SHIKI_THEME } from "@/lib/streamdown-theme";

export const STREAMDOWN_CODE_PLUGIN = createCodePlugin({
  themes: STREAMDOWN_SHIKI_THEME,
});

export const STREAMDOWN_PLUGINS = {
  cjk,
  code: STREAMDOWN_CODE_PLUGIN,
  math,
  mermaid,
};

export const STREAMDOWN_REMARK_PLUGINS: PluggableList = [
  remarkGfm,
  remarkPreserveSoftBreaks,
];

export function normalizeStreamdownCodeFenceLanguages(markdown: string): string {
  if (!markdown) {
    return markdown;
  }
  // Streamdown/Shiki doesn't include custom widget fence languages.
  // Downgrade them to plain text so malformed widget payloads can still render
  // without noisy console warnings.
  return markdown.replace(
    /^([ \t]*```)[ \t]*(?:show-widget|widget-dashboard|widget-json|widget-ui|widget-table|widget-csv|widget-tsv)\b/igm,
    "$1text",
  );
}

export function mergeStreamdownRemarkPlugins(
  remarkPlugins?: PluggableList,
): PluggableList {
  return [
    ...STREAMDOWN_REMARK_PLUGINS,
    ...(remarkPlugins ?? []),
  ];
}
