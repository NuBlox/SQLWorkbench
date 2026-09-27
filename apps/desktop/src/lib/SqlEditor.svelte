<script lang="ts">
  import { onMount } from "svelte";
  import type * as Monaco from "monaco-editor";

  import { statementAtOffset } from "$lib/sql-text";

  export let value = "";
  export let readOnly = false;
  export let onRunStatement: () => void = () => undefined;

  let host: HTMLDivElement;
  let editor: Monaco.editor.IStandaloneCodeEditor | undefined;
  let loadError = "";
  let internalChange = false;

  onMount(() => {
    let disposed = false;

    void setup().catch((error: unknown) => {
      loadError = error instanceof Error ? error.message : String(error);
    });

    async function setup(): Promise<void> {
      const workerModule = await import("monaco-editor/esm/vs/editor/editor.worker.js?worker");
      const monaco = await import("monaco-editor/esm/vs/editor/editor.api.js");
      await import("monaco-editor/esm/vs/basic-languages/sql/sql.contribution.js");
      if (disposed) return;

      const globals = globalThis as typeof globalThis & {
        MonacoEnvironment?: { getWorker(): Worker };
      };
      globals.MonacoEnvironment = {
        getWorker: () => new workerModule.default(),
      };

      editor = monaco.editor.create(host, {
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
      });

      editor.onDidChangeModelContent(() => {
        if (!editor) return;
        internalChange = true;
        value = editor.getValue();
        queueMicrotask(() => {
          internalChange = false;
        });
      });

      editor.addAction({
        id: "nublox.run-statement",
        label: "Run current statement",
        keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter],
        run: () => onRunStatement(),
      });
    }

    return () => {
      disposed = true;
      editor?.dispose();
      editor = undefined;
    };
  });

  $: if (editor && !internalChange && editor.getValue() !== value) {
    editor.setValue(value);
  }

  $: if (editor) {
    editor.updateOptions({ readOnly });
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
