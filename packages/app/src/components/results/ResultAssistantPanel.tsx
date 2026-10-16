import type { MutableRefObject, ReactNode } from 'react';
import { PanelRightClose, PanelRightOpen, Sparkles } from 'lucide-react';
import type { AssistantSnippet } from '@/components/assistant/AssistantChat';
import { AssistantConversation } from '@/components/assistant/AssistantConversation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type {
  ResultAssistantPendingToolCall,
  ResultAssistantSessionView
} from '@/lib/data-sources/types';

export type ResultAssistantSnippet = AssistantSnippet;
export type ResultAssistantMessage = ResultAssistantSessionView['messages'][number];

export function ResultAssistantPanel({
  title,
  description,
  expanded,
  onToggleExpanded,
  onHide,
  messages,
  pendingToolCalls,
  loading,
  expired = false,
  input,
  onInputChange,
  onSend,
  onCancel,
  inputPlaceholder,
  snippets,
  snippetsLabel = 'Result Assistant Snippets',
  onSnippetSelect,
  onApproveToolCall,
  onDenyToolCall,
  inputRef,
  renderMessageFooter,
  className = 'min-w-0 overflow-hidden xl:flex xl:h-full xl:min-h-0 xl:flex-col',
  contentClassName = 'flex h-[70vh] min-h-[520px] flex-col p-0 xl:h-auto xl:min-h-0 xl:flex-1'
}: {
  title: string;
  description: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  onHide: () => void;
  messages: ResultAssistantMessage[];
  pendingToolCalls: ResultAssistantPendingToolCall[];
  loading: boolean;
  expired?: boolean;
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onCancel?: () => void;
  inputPlaceholder: string;
  snippets: readonly ResultAssistantSnippet[];
  snippetsLabel?: string;
  onSnippetSelect: (prompt: string) => void;
  onApproveToolCall?: (callId: string, argumentsOverride?: unknown) => void;
  onDenyToolCall?: (callId: string) => void;
  inputRef: MutableRefObject<HTMLTextAreaElement | null>;
  /** Page-specific actions inside a message bubble, e.g. handoffs. */
  renderMessageFooter?: (message: ResultAssistantMessage) => ReactNode;
  className?: string;
  contentClassName?: string;
}) {
  return (
    <Card className={className}>
      <CardHeader className="border-b px-4 py-3">
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4 text-amber-500" />
              {title}
            </CardTitle>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                onClick={onToggleExpanded}
              >
                {expanded ? (
                  <PanelRightClose className="h-3.5 w-3.5" />
                ) : (
                  <PanelRightOpen className="h-3.5 w-3.5" />
                )}
                {expanded ? 'Compact' : 'Expand'}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={onHide}
              >
                Hide
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </CardHeader>
      <CardContent className={contentClassName}>
        <AssistantConversation
          messages={messages}
          toolCalls={pendingToolCalls}
          busy={loading}
          expired={expired}
          onApprove={onApproveToolCall}
          onDeny={onDenyToolCall}
          renderMessageFooter={renderMessageFooter}
          scrollClassName="bg-muted/15 px-4 py-4"
          composer={{
            input,
            onInputChange,
            onSend,
            onCancel,
            inputPlaceholder,
            snippets,
            snippetsLabel,
            onSnippetSelect,
            loading,
            inputRef
          }}
          composerClassName="border-t bg-background px-4 py-3"
        />
      </CardContent>
    </Card>
  );
}
