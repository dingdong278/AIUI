import React, { useState } from "react";
import { Send, Loader, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

export default function MaidenView() {
  const [messages, setMessages] = useState<{ role: string; content: string }[]>([
    { role: "assistant", content: "愿七神的荣光照耀你，迷途的行者。我是侍奉光明的圣女，一直在倾听大陆的风声。你有什么关于旅途或权谋的疑惑？" }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    
    const userMsg = { role: "user", content: input.trim() };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/maiden/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages.filter(m => m.role !== "system") })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      
      setMessages([...newMessages, { role: "assistant", content: data.reply }]);
    } catch (e: any) {
      setMessages([...newMessages, { role: "assistant", content: `(神谕受扰: ${e.message})` }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto h-[calc(100vh-80px)] flex flex-col font-sans animate-in fade-in duration-500 pb-12">
      <div className="flex items-center justify-between border-b border-stone-200 pb-4 mb-4 shrink-0">
        <div>
          <h2 className="text-xl font-display font-bold text-stone-800 flex items-center">
            <Sparkles className="mr-2 text-indigo-500" />
            圣女谏言 (Holy Maiden)
          </h2>
          <p className="text-sm text-stone-500 mt-1 font-serif">她知悉冰火大地的脉络，解答您对局势与个人命运的疑惑。</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto bg-stone-50/50 border border-stone-200 rounded-xl p-4 mb-4 space-y-6">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-5 py-3 shadow-sm ${
              msg.role === "user" 
                ? "bg-indigo-600 text-white rounded-br-none" 
                : "bg-white border border-stone-200 text-stone-800 rounded-bl-none"
            }`}>
              {msg.role === "assistant" && <div className="text-xs font-bold text-indigo-400 mb-1 flex items-center gap-1"><Sparkles size={12}/> 神圣谏言</div>}
              <div className="text-sm font-serif leading-relaxed">
                <ReactMarkdown>{msg.content}</ReactMarkdown>
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-white border border-stone-200 text-stone-500 rounded-2xl rounded-bl-none px-5 py-3 shadow-sm flex items-center gap-2 text-sm">
              <Loader className="animate-spin" size={14} /> 圣女正在聆听世界的低语...
            </div>
          </div>
        )}
      </div>

      <div className="shrink-0 flex items-center gap-2">
        <input 
          type="text" 
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleSend()}
          placeholder="向圣女询问你的困惑，或下一步的发展..."
          className="flex-1 bg-white border border-stone-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button 
          onClick={handleSend}
          disabled={loading || !input.trim()}
          className="bg-indigo-600 hover:bg-indigo-700 text-white p-3 rounded-xl transition-colors disabled:opacity-50"
        >
          <Send size={18} />
        </button>
      </div>

    </div>
  );
}
