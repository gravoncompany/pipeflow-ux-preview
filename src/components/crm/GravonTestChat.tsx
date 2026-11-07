import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart, type UIMessage } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Trash2, ShieldCheck, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
  ConversationEmptyState,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
  MessageActions,
  MessageAction,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputTextarea,
  PromptInputFooter,
  PromptInputSubmit,
} from "@/components/ai-elements/prompt-input";
import { Shimmer } from "@/components/ai-elements/shimmer";
import {
  Tool,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import { supabase } from "@/integrations/supabase/client";
import { PIPEFLOW_LOGO_URL } from "@/components/brand/PipeflowLogo";
import { PipeflowSymbol } from "@/components/brand/PipeflowLogo";
import { GRAVON_STORAGE_KEY, testMessageSchema } from "@/lib/gravon-ai";

export function GravonTestChat({
  configured,
  compact = false,
}: {
  configured: boolean;
  compact?: boolean;
}) {
  const [hydrated, setHydrated] = useState(false);
  const [initial, setInitial] = useState<UIMessage[]>([]);
  const [instructions, setInstructions] = useState("");
  const [personality, setPersonality] = useState("");
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(GRAVON_STORAGE_KEY) || "null");
      if (stored) {
        const messages: UIMessage[] = [];
        for (const value of Array.isArray(stored.messages) ? stored.messages : []) {
          const result = testMessageSchema.safeParse(value);
          if (result.success) messages.push(result.data);
        }
        setInitial(messages);
        setInstructions(
          typeof stored.instructions === "string" ? stored.instructions.slice(0, 4000) : "",
        );
        setPersonality(
          typeof stored.personality === "string" ? stored.personality.slice(0, 1000) : "",
        );
      }
    } catch {
      toast.error("Não foi possível restaurar o histórico deste navegador.");
    }
    setHydrated(true);
  }, []);
  if (!hydrated) return <p className="p-8 text-muted-foreground">Carregando...</p>;
  return (
    <ChatSession
      initial={initial}
      configured={configured}
      initialInstructions={instructions}
      initialPersonality={personality}
      compact={compact}
    />
  );
}

function ChatSession({
  initial,
  configured,
  initialInstructions,
  initialPersonality,
  compact,
}: {
  initial: UIMessage[];
  configured: boolean;
  initialInstructions: string;
  initialPersonality: string;
  compact: boolean;
}) {
  const [instructions, setInstructions] = useState(initialInstructions);
  const [personality, setPersonality] = useState(initialPersonality);
  const [saved, setSaved] = useState({
    instructions: initialInstructions,
    personality: initialPersonality,
  });
  const [busy, setBusy] = useState(false);
  const [messages, setMessages] = useState<UIMessage[]>(initial);
  useEffect(() => {
    try {
      localStorage.setItem(
        GRAVON_STORAGE_KEY,
        JSON.stringify({ messages: textOnlyMessages(messages), ...saved }),
      );
    } catch {
      toast.error("Não foi possível salvar o histórico neste navegador.");
    }
  }, [messages, saved]);

  return (
    <div
      className={
        compact
          ? "flex min-h-0 flex-1 flex-col"
          : "grid min-h-0 flex-1 grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]"
      }
    >
      {!compact && (
        <aside className="space-y-5 overflow-y-auto border-b pb-5 lg:border-b-0 lg:border-r lg:pr-6">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="size-4 text-primary" />
            WhatsApp automático desligado
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-personality">Personalidade</Label>
            <Textarea
              id="ai-personality"
              value={personality}
              maxLength={1000}
              onChange={(e) => setPersonality(e.target.value)}
              placeholder="Ex.: profissional, cordial e objetiva"
              rows={3}
              disabled={busy}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ai-instructions">Instruções de teste</Label>
            <Textarea
              id="ai-instructions"
              value={instructions}
              maxLength={4000}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Orientações para as respostas"
              rows={7}
              disabled={busy}
            />
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              setSaved({ instructions, personality });
              toast.success("Preferências salvas neste navegador.");
            }}
          >
            <Save />
            Salvar preferências
          </Button>
          <p className="text-xs text-muted-foreground">
            OpenAI · {configured ? "Chave configurada" : "Chave não configurada"}
          </p>
        </aside>
      )}
      <GravonChatPane
        chatId="gravon-internal-test"
        initial={initial}
        configured={configured}
        compact={compact}
        preferences={() => saved}
        title={compact ? "Conversa privada" : "Conversa de testes"}
        emptyText={compact ? "Olá! Como posso ajudar?" : "Conversa interna · WhatsApp desligado"}
        onMessages={setMessages}
        onBusy={setBusy}
        className={
          compact
            ? "flex min-h-0 min-w-0 flex-1 flex-col"
            : "flex min-h-[460px] min-w-0 flex-col lg:min-h-0"
        }
      />
    </div>
  );
}

/** Text parts only: tool calls are never restored from browser storage. */
export function textOnlyMessages(messages: UIMessage[]) {
  return messages
    .map((m) => ({ id: m.id, role: m.role, parts: m.parts.filter((p) => p.type === "text") }))
    .filter((m) => m.parts.length);
}

/** Reads the browser-saved test preferences so every Gravon chat answers the same way. */
export function storedGravonPreferences() {
  try {
    const stored = JSON.parse(localStorage.getItem(GRAVON_STORAGE_KEY) || "null");
    return {
      instructions: typeof stored?.instructions === "string" ? stored.instructions.slice(0, 4000) : "",
      personality: typeof stored?.personality === "string" ? stored.personality.slice(0, 1000) : "",
    };
  } catch {
    return { instructions: "", personality: "" };
  }
}

/** One Gravon AI conversation: same transport, model and tools as the internal chat. */
export function GravonChatPane({
  chatId,
  initial,
  configured,
  compact = false,
  preferences,
  title,
  emptyText,
  onMessages,
  onBusy,
  onClear,
  className,
  wide = false,
}: {
  chatId: string;
  initial: UIMessage[];
  configured: boolean;
  compact?: boolean;
  preferences: () => { instructions: string; personality: string };
  title?: string;
  emptyText: string;
  onMessages: (messages: UIMessage[]) => void;
  onBusy?: (busy: boolean) => void;
  /** When set, replaces the default "clear messages" behaviour of the trash button. */
  onClear?: () => void;
  className?: string;
  wide?: boolean;
}) {
  const [text, setText] = useState("");
  const prefs = useRef(preferences);
  prefs.current = preferences;
  const textarea = useRef<HTMLTextAreaElement>(null);
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/gravon-ai",
        body: () => prefs.current(),
        headers: async () => {
          const { data } = await supabase.auth.getSession();
          const headers = new Headers();
          if (data.session) headers.set("Authorization", `Bearer ${data.session.access_token}`);
          return headers;
        },
      }),
    [],
  );
  const { messages, setMessages, sendMessage, status, stop, error, clearError } = useChat({
    id: chatId,
    messages: initial,
    transport,
    onError: (e) => toast.error(e.message),
  });
  const busy = status === "submitted" || status === "streaming";
  const report = useRef(onMessages);
  report.current = onMessages;
  const reportBusy = useRef(onBusy);
  reportBusy.current = onBusy;
  useEffect(() => {
    report.current(messages);
  }, [messages]);
  useEffect(() => {
    reportBusy.current?.(busy);
  }, [busy]);
  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );
  useEffect(() => {
    if (
      !busy &&
      (document.activeElement === document.body || document.activeElement === textarea.current)
    )
      textarea.current?.focus();
  }, [busy]);

  return (
    <section className={className}>
      {title !== undefined && (
        <div className="flex items-center justify-between gap-3 border-b pb-3">
          <h2 className="truncate font-semibold">{title}</h2>
          <Button
            variant="ghost"
            size="icon"
            title={onClear ? "Apagar conversa" : "Limpar conversa"}
            aria-label={onClear ? "Apagar conversa" : "Limpar conversa"}
            disabled={busy || (!onClear && !messages.length)}
            onClick={() => {
              if (onClear) return onClear();
              if (window.confirm("Apagar o histórico desta conversa?")) {
                setMessages([]);
                clearError();
                textarea.current?.focus();
              }
            }}
          >
            <Trash2 />
          </Button>
        </div>
      )}
        <Conversation className="min-h-0" aria-label="Conversa Pipeflow IA">
          <ConversationContent className={`mx-auto w-full ${wide ? "max-w-3xl px-2" : "max-w-3xl"} gap-6 py-6`}>
            {messages.length === 0 && (
              <ConversationEmptyState>
                {compact
                  ? <span className="flex size-20 items-center justify-center rounded-full bg-background ring-1 ring-border"><PipeflowSymbol alt="Pipeflow IA" className="size-14" /></span>
                  : <img src={PIPEFLOW_LOGO_URL} alt="Pipeflow IA" className="size-16 object-contain" />}
                <h3 className="text-xl font-semibold">Pipeflow IA</h3>
                <p className="text-sm text-muted-foreground">
                  {emptyText}
                </p>
              </ConversationEmptyState>
            )}
            {messages.map((m) => (
              <Message key={m.id} from={m.role}>
                <span className="text-xs font-medium text-muted-foreground">
                  {m.role === "user" ? "Você" : "Pipeflow IA"}
                </span>
                <MessageContent
                  className={
                    m.role === "user"
                      ? "group-[.is-user]:bg-primary group-[.is-user]:text-primary-foreground"
                      : ""
                  }
                >
                  {m.parts.map((part, i) =>
                    part.type === "text" ? (
                      <MessageResponse key={i}>{part.text}</MessageResponse>
                    ) : isToolUIPart(part) && part.type !== "dynamic-tool" ? (
                      <Tool key={i} defaultOpen={false}>
                        <ToolHeader
                          type={part.type}
                          state={part.state}
                          title={
                            part.type === "tool-criar_conhecimento"
                              ? "Salvar conhecimento"
                              : part.type === "tool-atualizar_conhecimento"
                                ? "Atualizar conhecimento"
                                : "Consultar conhecimento"
                          }
                        />
                        <ToolContent>
                          <ToolInput input={part.input} />
                          <ToolOutput output={part.output} errorText={part.errorText} />
                        </ToolContent>
                      </Tool>
                    ) : null,
                  )}
                </MessageContent>
                {m.role === "assistant" && (
                  <MessageActions>
                    <MessageAction
                      tooltip="Copiar resposta"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(
                            m.parts
                              .filter((p) => p.type === "text")
                              .map((p) => p.text)
                              .join("\n"),
                          )
                          .then(() => toast.success("Resposta copiada."));
                      }}
                    >
                      <Copy className="size-4" />
                    </MessageAction>
                  </MessageActions>
                )}
              </Message>
            ))}
            {status === "submitted" && <Shimmer>Pipeflow IA está pensando...</Shimmer>}
          </ConversationContent>
          <ConversationScrollButton aria-label="Última mensagem" />
        </Conversation>
        {error && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {error.message}
          </p>
        )}
        <PromptInput
          maxFiles={0}
          onSubmit={() => {
            if (busy || !configured || !text.trim()) return;
            clearError();
            void sendMessage({ text: text.trim() });
            setText("");
            textarea.current?.focus();
          }}
        >
          <PromptInputTextarea
            ref={textarea}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={16000}
            placeholder="Converse com a Pipeflow IA..."
            aria-label="Mensagem para Pipeflow IA"
          />
          <PromptInputFooter className="justify-end">
            <PromptInputSubmit
              status={status}
              onStop={() => {
                void stop();
                textarea.current?.focus();
              }}
              disabled={!busy && (!configured || !text.trim())}
              aria-label={busy ? "Parar resposta" : "Enviar para Pipeflow IA"}
              title={busy ? "Parar resposta" : "Enviar para Pipeflow IA"}
            />
          </PromptInputFooter>
        </PromptInput>
      </section>
  );
}
