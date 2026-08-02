import { AssistantComposer } from '@/components/assistant/AssistantChat';

export function GlobalCopilotComposer({
  input,
  onInputChange,
  onSend,
  onCancel,
  loading
}: {
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onCancel: () => void;
  loading: boolean;
}) {
  return (
    <div className="w-full min-w-0 border-t p-3">
      <AssistantComposer
        input={input}
        onInputChange={onInputChange}
        onSend={onSend}
        onCancel={onCancel}
        disabled={loading}
        loading={loading}
        inputPlaceholder="Ask MCPLab..."
        snippets={[]}
        snippetsLabel="Suggestions"
        onSnippetSelect={onInputChange}
      />
    </div>
  );
}
