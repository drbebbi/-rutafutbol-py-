import { createFileRoute } from "@tanstack/react-router";
import { useChat } from "@tanstack/ai-react";
import { chatWithEdgeAnalyst } from "@/lib/edgeAiChat";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Bot, Send } from "lucide-react";
import React from "react";

export const Route = createFileRoute("/_authed/edge-ai")({
  ssr: false,
  head: () => ({ meta: [{ title: "Edge Analyst — Aposta Edge AI" }] }),
  component: EdgeAnalyst,
});

function EdgeAnalyst() {
  const [input, setInput] = React.useState("");
  const { messages, sendMessage, isLoading } = useChat({
    fetcher: ({ messages }, { signal }) => chatWithEdgeAnalyst({ data: { messages: messages.slice(-40) }, signal }),
  });
  const scrollRef = React.useRef(null);
  React.useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const submit = (e) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input.trim() });
    setInput("");
  };

  return (
    <div className="space-y-4 h-[calc(100vh-8rem)] flex flex-col">
      <div className="flex items-center gap-2">
        <Bot className="w-6 h-6 text-chart-1" />
        <div>
          <h1 className="text-2xl font-heading font-bold">Edge Analyst</h1>
          <p className="text-xs text-muted-foreground">AI assistant grounded in your platform's real data — it never invents odds or matches</p>
        </div>
      </div>

      <Card className="flex-1 flex flex-col overflow-hidden">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-12 space-y-3">
              <Bot className="w-10 h-10 text-muted-foreground/40 mx-auto" />
              <p className="text-sm text-muted-foreground">Ask about today's value signals, a specific match, or model performance.</p>
              <div className="flex flex-wrap gap-2 justify-center">
                {["What are today's top value signals?", "How is the model performing?", "Are the data providers connected?"].map((q) => (
                  <Button key={q} variant="outline" size="sm" onClick={() => sendMessage({ text: q })}>{q}</Button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${m.role === "user" ? "bg-chart-1 text-primary-foreground" : "bg-muted"}`}>
                {m.parts.map((p, i) => p.type === "text" ? <p key={i} className="whitespace-pre-wrap">{p.content}</p> : null)}
              </div>
            </div>
          ))}
          {isLoading && <div className="flex justify-start"><div className="bg-muted rounded-lg px-3 py-2 text-sm text-muted-foreground">Thinking…</div></div>}
        </div>
        <form onSubmit={submit} className="p-3 border-t border-border flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the Edge Analyst…" disabled={isLoading} />
          <Button type="submit" size="icon" disabled={!input.trim() || isLoading}><Send className="w-4 h-4" /></Button>
        </form>
      </Card>
    </div>
  );
}