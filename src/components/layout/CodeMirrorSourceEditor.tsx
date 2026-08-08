"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { indentWithTab } from "@codemirror/commands";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import {
  SearchQuery,
  findNext,
  findPrevious,
  highlightSelectionMatches,
  search,
  setSearchQuery,
} from "@codemirror/search";
import { EditorView, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import { minimalSetup } from "codemirror";

export interface CodeMirrorSourceEditorHandle {
  getValue: () => string;
  setValue: (value: string) => void;
  focus: () => void;
  scrollToLine: (lineNumber: number) => void;
  setSearchQuery: (query: string, options?: { jumpToFirstMatch?: boolean }) => void;
  clearSearchQuery: () => void;
  findNextMatch: () => boolean;
  findPreviousMatch: () => boolean;
}

interface CodeMirrorSourceEditorProps {
  value: string;
  valueVersion: number;
  isDark: boolean;
  language: string;
  readOnly: boolean;
  onChange?: (value: string) => void;
  onSaveShortcut?: () => void;
  className?: string;
}

const BASE_EDITOR_THEME = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "transparent",
      fontSize: "14px",
    },
    ".cm-scroller": {
      overflow: "auto",
      position: "relative",
      fontFamily:
        "ui-monospace, SFMono-Regular, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
      lineHeight: "22px",
    },
    ".cm-content": {
      minHeight: "100%",
      paddingTop: "8px",
      paddingBottom: "8px",
      paddingLeft: "16px",
      paddingRight: "16px",
      caretColor: "inherit",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-focused": {
      outline: "none",
    },
    ".cm-gutters": {
      position: "sticky",
      left: "0",
      zIndex: "2",
      border: "none",
      color: "inherit",
      flexShrink: 0,
    },
    ".cm-gutter": {
      minHeight: "100%",
      paddingTop: "8px",
      paddingBottom: "8px",
      backgroundColor: "inherit",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      minWidth: "2.5rem",
      paddingInline: "0.625rem 0.75rem",
      textAlign: "right",
      opacity: 1,
    },
  },
  { dark: false }
);

const LIGHT_THEME = [
  BASE_EDITOR_THEME,
  EditorView.theme({
    "&": {
      color: "#0f172a",
    },
    ".cm-cursor, .cm-dropCursor": {
      borderLeftColor: "#0f172a",
    },
    ".cm-gutters": {
      color: "#64748b",
      backgroundColor: "#f8fafc",
      borderRight: "1px solid rgba(15, 23, 42, 0.1)",
    },
    ".cm-selectionBackground, ::selection": {
      backgroundColor: "rgba(59, 130, 246, 0.22)",
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(15, 23, 42, 0.03)",
    },
    ".cm-activeLineGutter": {
      backgroundColor: "rgba(15, 23, 42, 0.03)",
    },
  }),
  syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
] satisfies Extension;

const DARK_THEME = [
  BASE_EDITOR_THEME,
  oneDark,
  EditorView.theme(
    {
      ".cm-gutters": {
        color: "rgba(203, 213, 225, 0.72)",
        backgroundColor: "#282c34",
        borderRight: "1px solid rgba(148, 163, 184, 0.18)",
      },
      ".cm-selectionBackground, ::selection": {
        backgroundColor: "rgba(96, 165, 250, 0.25)",
      },
    },
    { dark: true }
  ),
] satisfies Extension;

function getThemeExtension(isDark: boolean): Extension {
  return isDark ? DARK_THEME : LIGHT_THEME;
}

function getEditableExtension(readOnly: boolean): Extension {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

function createInteractionExtensions({
  readOnly,
  onChange,
  onSaveShortcut,
}: Pick<CodeMirrorSourceEditorProps, "readOnly" | "onChange" | "onSaveShortcut">): Extension {
  const shortcuts = [
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange?.(update.state.doc.toString());
      }
    }),
    keymap.of([
      {
        key: "Mod-s",
        preventDefault: true,
        run: () => {
          if (!onSaveShortcut) {
            return false;
          }
          onSaveShortcut();
          return true;
        },
      },
    ]),
  ] as Extension[];

  if (!readOnly) {
    shortcuts.unshift(keymap.of([indentWithTab]));
  }

  return shortcuts;
}

async function loadLanguageExtension(language: string): Promise<Extension> {
  switch (language) {
    case "javascript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript();
    }
    case "jsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ jsx: true });
    }
    case "typescript": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true });
    }
    case "tsx": {
      const { javascript } = await import("@codemirror/lang-javascript");
      return javascript({ typescript: true, jsx: true });
    }
    case "json": {
      const { json } = await import("@codemirror/lang-json");
      return json();
    }
    case "markdown": {
      const { markdown } = await import("@codemirror/lang-markdown");
      return markdown();
    }
    case "markup": {
      const { html } = await import("@codemirror/lang-html");
      return html();
    }
    case "css": {
      const { css } = await import("@codemirror/lang-css");
      return css();
    }
    case "python": {
      const { python } = await import("@codemirror/lang-python");
      return python();
    }
    case "sql": {
      const { sql } = await import("@codemirror/lang-sql");
      return sql();
    }
    case "yaml": {
      const { yaml } = await import("@codemirror/lang-yaml");
      return yaml();
    }
    case "xml": {
      const { xml } = await import("@codemirror/lang-xml");
      return xml();
    }
    case "rust": {
      const { rust } = await import("@codemirror/lang-rust");
      return rust();
    }
    case "go": {
      const { go } = await import("@codemirror/lang-go");
      return go();
    }
    case "java": {
      const { java } = await import("@codemirror/lang-java");
      return java();
    }
    case "php": {
      const { php } = await import("@codemirror/lang-php");
      return php();
    }
    case "c":
    case "cpp": {
      const { cpp } = await import("@codemirror/lang-cpp");
      return cpp();
    }
    case "bash":
    case "docker": {
      const [{ shell }, { StreamLanguage }] = await Promise.all([
        import("@codemirror/legacy-modes/mode/shell"),
        import("@codemirror/language"),
      ]);
      return StreamLanguage.define(shell);
    }
    case "toml": {
      const [{ toml }, { StreamLanguage }] = await Promise.all([
        import("@codemirror/legacy-modes/mode/toml"),
        import("@codemirror/language"),
      ]);
      return StreamLanguage.define(toml);
    }
    case "powershell": {
      const [{ powerShell }, { StreamLanguage }] = await Promise.all([
        import("@codemirror/legacy-modes/mode/powershell"),
        import("@codemirror/language"),
      ]);
      return StreamLanguage.define(powerShell);
    }
    case "lua": {
      const [{ lua }, { StreamLanguage }] = await Promise.all([
        import("@codemirror/legacy-modes/mode/lua"),
        import("@codemirror/language"),
      ]);
      return StreamLanguage.define(lua);
    }
    case "r": {
      const [{ r }, { StreamLanguage }] = await Promise.all([
        import("@codemirror/legacy-modes/mode/r"),
        import("@codemirror/language"),
      ]);
      return StreamLanguage.define(r);
    }
    default:
      return [];
  }
}

export const CodeMirrorSourceEditor = forwardRef<
  CodeMirrorSourceEditorHandle,
  CodeMirrorSourceEditorProps
>(function CodeMirrorSourceEditor(
  { value, valueVersion, isDark, language, readOnly, onChange, onSaveShortcut, className },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartmentRef = useRef(new Compartment());
  const editableCompartmentRef = useRef(new Compartment());
  const languageCompartmentRef = useRef(new Compartment());
  const interactionCompartmentRef = useRef(new Compartment());
  const languageRequestIdRef = useRef(0);

  const interactionExtensions = useMemo<Extension>(
    () => createInteractionExtensions({ readOnly, onChange, onSaveShortcut }),
    [onChange, onSaveShortcut, readOnly]
  );
  const [initialConfig] = useState(() => ({
    value,
    isDark,
    readOnly,
    interactionExtensions: createInteractionExtensions({ readOnly, onChange, onSaveShortcut }),
  }));

  function replaceDocument(nextValue: string) {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentValue = view.state.doc.toString();
    if (currentValue === nextValue) {
      return;
    }

    view.dispatch({
      changes: { from: 0, to: currentValue.length, insert: nextValue },
    });
  }

  function scrollToLine(lineNumber: number) {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const totalLines = view.state.doc.lines;
    if (totalLines <= 0) {
      return;
    }

    const normalizedLine = Math.min(Math.max(Math.trunc(lineNumber), 1), totalLines);
    const line = view.state.doc.line(normalizedLine);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
  }

  function applySearchQuery(query: string, options?: { jumpToFirstMatch?: boolean }) {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const normalizedQuery = query.trim();
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: normalizedQuery })),
    });

    if (options?.jumpToFirstMatch && normalizedQuery) {
      findNext(view);
    }
  }

  function clearSearch() {
    const view = viewRef.current;
    if (!view) {
      return;
    }
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: "" })),
    });
  }

  function findNextMatch() {
    const view = viewRef.current;
    if (!view) {
      return false;
    }
    return findNext(view);
  }

  function findPreviousMatch() {
    const view = viewRef.current;
    if (!view) {
      return false;
    }
    return findPrevious(view);
  }

  useImperativeHandle(
    ref,
    () => ({
      getValue: () => viewRef.current?.state.doc.toString() ?? value,
      setValue: replaceDocument,
      focus: () => viewRef.current?.focus(),
      scrollToLine,
      setSearchQuery: applySearchQuery,
      clearSearchQuery: clearSearch,
      findNextMatch,
      findPreviousMatch,
    }),
    [value]
  );

  useEffect(() => {
    if (!containerRef.current || viewRef.current) {
      return;
    }

    const state = EditorState.create({
      doc: initialConfig.value,
      extensions: [
        minimalSetup,
        lineNumbers(),
        highlightActiveLineGutter(),
        search({ top: true }),
        highlightSelectionMatches(),
        EditorView.contentAttributes.of({
          spellcheck: "false",
          autocorrect: "off",
          autocapitalize: "off",
          translate: "no",
          "data-gramm": "false",
        }),
        themeCompartmentRef.current.of(getThemeExtension(initialConfig.isDark)),
        editableCompartmentRef.current.of(getEditableExtension(initialConfig.readOnly)),
        interactionCompartmentRef.current.of(initialConfig.interactionExtensions),
        languageCompartmentRef.current.of([]),
      ],
    });

    viewRef.current = new EditorView({ state, parent: containerRef.current });

    return () => {
      viewRef.current?.destroy();
      viewRef.current = null;
    };
  }, [initialConfig]);

  useEffect(() => {
    if (!viewRef.current) {
      return;
    }

    viewRef.current.dispatch({
      effects: themeCompartmentRef.current.reconfigure(getThemeExtension(isDark)),
    });
  }, [isDark]);

  useEffect(() => {
    if (!viewRef.current) {
      return;
    }

    viewRef.current.dispatch({
      effects: editableCompartmentRef.current.reconfigure(getEditableExtension(readOnly)),
    });
  }, [readOnly]);

  useEffect(() => {
    if (!viewRef.current) {
      return;
    }

    viewRef.current.dispatch({
      effects: interactionCompartmentRef.current.reconfigure(interactionExtensions),
    });
  }, [interactionExtensions]);

  useEffect(() => {
    replaceDocument(value);
  }, [value, valueVersion]);

  useEffect(() => {
    let cancelled = false;
    const requestId = ++languageRequestIdRef.current;

    async function applyLanguage() {
      const extension = await loadLanguageExtension(language);
      if (cancelled || requestId !== languageRequestIdRef.current || !viewRef.current) {
        return;
      }

      viewRef.current.dispatch({
        effects: languageCompartmentRef.current.reconfigure(extension),
      });
    }

    void applyLanguage();

    return () => {
      cancelled = true;
    };
  }, [language]);

  return <div ref={containerRef} className={className ?? "h-full w-full"} />;
});
