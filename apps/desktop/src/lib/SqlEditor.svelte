<script lang="ts">
  import { onMount } from "svelte";
  import type * as Monaco from "monaco-editor";
  import {
    createQueryLanguageService,
    type QueryCompletionCatalog,
    type QueryLanguageService,
    type SqlCompletionKind,
  } from "@nublox/workbench-query-engineering";

  import { statementAtOffset } from "$lib/sql-text";

  export let value = "";
  export let readOnly = false;
  export let providerId = "mysql";
  export let completionCatalog: QueryCompletionCatalog | undefined = undefined;
  export let onRunStatement: () => void = () => undefined;

  let host: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let monacoApi: typeof Monaco | undefined;
  let languageService: QueryLanguageService | undefined;
  let languageProviderId = "";
  let loadError = "";
  let internalChange = false;
  let diagnosticsTimer: ReturnType<typeof setTimeout> | undefined;

  onMount(() => {
    let disposed = false;
    let completionDisposable: Monaco.IDisposable | undefined;

    void setup().catch((error: unknown) => {
      loadError = error instanceof Error ? error.message : String(error);
    });

    async function setup(): Promise<void> {
      const monaco = await import("monaco-editor");
      if (disposed) return;
      monacoApi = monaco;

      const createdEditor = monaco.editor.create(host, {
        value,
        language: "sql",
        theme: "vs-dark",
        readOnly,
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: "SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        fontSize: 13,
        lineHeight: 20,
        tabSize: 2,
        insertSpaces: true,
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorBlinking: "smooth",
        renderWhitespace: "selection",
        padding: { top: 12, bottom: 12 },
        suggest: { preview: true, showKeywords: true, showFields: true },
        quickSuggestions: { other: true, comments: false, strings: false },
      });
      editor = createdEditor;
      configureLanguageService();
      scheduleDiagnostics();

      createdEditor.onDidChangeModelContent(() => {
        internalChange = true;
        value = createdEditor.getValue();
        scheduleDiagnostics();
        queueMicrotask(() => {
          internalChange = false;
        });
      });

      completionDisposable = monaco.languages.registerCompletionItemProvider("sql", {
        triggerCharacters: [".", "`"],
        provideCompletionItems(model, position) {
          if (model !== editor?.getModel() || !languageService) return { suggestions: [] };
          const word = model.getWordUntilPosition(position);
          const range = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn,
          };
          const suggestions = languageService.complete(
            model.getValue(),
            { lineNumber: position.lineNumber, column: position.column },
            completionCatalog,
          ).map((item): Monaco.languages.CompletionItem => ({
            label: item.label,
            insertText: item.insertText,
            kind: completionKind(monaco, item.kind),
            ...(item.detail !== undefined ? { detail: item.detail } : {}),
            sortText: item.sortText,
            range,
          }));
          return { suggestions };
        },
      });

      createdEditor.addAction({
        id: "nublox.run-statement",
        label: "Run current statement",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => onRunStatement(),
      });
    }

    return () => {
      disposed = true;
      if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
      const model = editor?.getModel();
      if (model && monacoApi) monacoApi.editor.setModelMarkers(model, "nublox-query-language", []);
      completionDisposable?.dispose();
      editor?.dispose();
      editor = undefined;
      monacoApi = undefined;
    };
  });

  $: if (editor && !internalChange && editor.getValue() !== value) {
    editor.setValue(value);
    scheduleDiagnostics();
  }

  $: if (editor) {
    editor.updateOptions({ readOnly });
  }

  $: if (editor && providerId !== languageProviderId) {
    configureLanguageService();
    scheduleDiagnostics();
  }

  function configureLanguageService(): void {
    languageProviderId = providerId;
    try {
      languageService = createQueryLanguageService(providerId);
    } catch {
      languageService = undefined;
    }
  }

  function scheduleDiagnostics(): void {
    if (diagnosticsTimer) clearTimeout(diagnosticsTimer);
    diagnosticsTimer = setTimeout(() => updateDiagnostics(), 220);
  }

  function updateDiagnostics(): void {
    const model = editor?.getModel();
    if (!model || !monacoApi) return;
    if (!languageService) {
      monacoApi.editor.setModelMarkers(model, "nublox-query-language", []);
      return;
    }
    const diagnostics = languageService.parse(model.getValue()).diagnostics;
    monacoApi.editor.setModelMarkers(model, "nublox-query-language", diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity === "error"
        ? monacoApi!.MarkerSeverity.Error
        : diagnostic.severity === "warning"
          ? monacoApi!.MarkerSeverity.Warning
          : monacoApi!.MarkerSeverity.Info,
      message: diagnostic.message,
      source: "NuBlox SQL",
      startLineNumber: diagnostic.startLineNumber,
      startColumn: diagnostic.startColumn,
      endLineNumber: diagnostic.endLineNumber,
      endColumn: diagnostic.endColumn,
    })));
  }

  function completionKind(monaco: typeof Monaco, kind: SqlCompletionKind): Monaco.languages.CompletionItemKind {
    switch (kind) {
      case "keyword": return monaco.languages.CompletionItemKind.Keyword;
      case "column": return monaco.languages.CompletionItemKind.Field;
      case "table": return monaco.languages.CompletionItemKind.Struct;
      case "view": return monaco.languages.CompletionItemKind.Interface;
      case "catalog":
      case "schema": return monaco.languages.CompletionItemKind.Module;
    }
  }

  export function getSelectionText(): string {
    if (!editor) return "";
    const selection = editor.getSelection();
    const model = editor.getModel();
    if (!selection || !model || selection.isEmpty()) return "";
    return model.getValueInRange(selection);
  }

  export function getCurrentStatement(): string {
    if (!editor) return value.trim();
    const model = editor.getModel();
    const position = editor.getPosition();
    if (!model || !position) return editor.getValue().trim();
    const offset = model.getOffsetAt(position);
    return statementAtOffset(editor.getValue(), offset)?.text ?? "";
  }

  export function getScriptText(): string {
    return editor?.getValue() ?? value;
  }

  export function focus(): void {
    editor?.focus();
  }
</script>

<div class="editor-frame">
  {#if loadError}
    <div class="editor-error">Monaco failed to load: {loadError}</div>
  {/if}
  <div class="monaco-host" bind:this={host}></div>
</div>

<style>
  .editor-frame {
    position: relative;
    min-width: 0;
    min-height: 280px;
    height: 100%;
    overflow: hidden;
    background: #0a1421;
  }

  .monaco-host {
    position: absolute;
    inset: 0;
  }

  .editor-error {
    position: absolute;
    z-index: 5;
    inset: 12px 12px auto;
    border: 1px solid #6d3a42;
    border-radius: 7px;
    padding: 9px 11px;
    background: #28171d;
    color: #e7a2ab;
    font-size: 11px;
  }
</style>
