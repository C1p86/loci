import type { Monaco, MonacoDiffEditor, OnMount } from '@monaco-editor/react';
import { lazy, Suspense, useRef } from 'react';

// Lazy imports — produce separate monaco chunk per vite.config.ts manualChunks (D-20)
const Editor = lazy(() => import('@monaco-editor/react').then((m) => ({ default: m.Editor })));
const DiffEditor = lazy(() =>
  import('@monaco-editor/react').then((m) => ({ default: m.DiffEditor })),
);

export interface MonacoMarker {
  line: number;
  column?: number;
  message: string;
  severity?: 'error' | 'warning';
}

interface MonacoYamlEditorProps {
  value: string;
  onChange: (v: string) => void;
  markers?: MonacoMarker[];
  readOnly?: boolean;
  /** Called when user presses Ctrl+S / Cmd+S inside the editor */
  onSave?: () => void;
}

type StandaloneEditor = Parameters<OnMount>[0];
type MarkerData = Parameters<Monaco['editor']['setModelMarkers']>[2][number];

/**
 * Lazy-loaded Monaco YAML editor wrapper.
 * T-13-03-04: YAML rendered as code only — never via innerHTML.
 * D-20: Monaco bundle is a separate chunk loaded only on /tasks/:id/edit.
 */
export function MonacoYamlEditor({
  value,
  onChange,
  markers,
  readOnly,
  onSave,
}: MonacoYamlEditorProps) {
  const editorRef = useRef<StandaloneEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);

  function applyMarkers(m: MonacoMarker[] | undefined) {
    if (!editorRef.current || !monacoRef.current) return;
    const model = editorRef.current.getModel();
    if (!model) return;
    const monacoMarkers: MarkerData[] = (m ?? []).map((x) => ({
      severity: x.severity === 'warning' ? 4 /* Warning */ : 8 /* Error */,
      startLineNumber: x.line,
      startColumn: x.column ?? 1,
      endLineNumber: x.line,
      endColumn: x.column ? x.column + 1 : 1000,
      message: x.message,
    }));
    monacoRef.current.editor.setModelMarkers(model, 'xci-yaml', monacoMarkers);
  }

  const handleMount: OnMount = (ed, monaco) => {
    editorRef.current = ed;
    monacoRef.current = monaco;
    if (onSave) {
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, onSave);
    }
    applyMarkers(markers);
  };

  // Re-apply markers whenever the markers prop changes
  if (editorRef.current) applyMarkers(markers);

  return (
    <Suspense fallback={<div className="p-4">Loading editor...</div>}>
      <Editor
        height="600px"
        defaultLanguage="yaml"
        value={value}
        onChange={(v) => onChange(v ?? '')}
        onMount={handleMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          fontSize: 14,
          wordWrap: 'on',
        }}
      />
    </Suspense>
  );
}

type DiffOnMount = (editor: MonacoDiffEditor, monaco: Monaco) => void;

export function MonacoYamlDiffEditor({
  original,
  modified,
}: {
  original: string;
  modified: string;
}) {
  const handleDiffMount: DiffOnMount = (_ed, _monaco) => {
    // read-only diff — no additional setup needed
  };

  return (
    <Suspense fallback={<div className="p-4">Loading diff...</div>}>
      <DiffEditor
        height="500px"
        language="yaml"
        original={original}
        modified={modified}
        onMount={handleDiffMount}
        options={{ readOnly: true, renderSideBySide: true }}
      />
    </Suspense>
  );
}
