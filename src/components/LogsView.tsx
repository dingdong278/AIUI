import React, { useState, useEffect, useRef } from "react";
import { Terminal, RefreshCw, BookOpen } from "lucide-react";

export default function LogsView({ running }: any) {
  const [logs, setLogs] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/logs");
      const text = await res.text();
      setLogs(text);
    } catch(e) {
      // Ignore
    }
  };

  useEffect(() => {
    fetchLogs();
    let interval: any;
    if (running) {
      interval = setInterval(fetchLogs, 2000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [running]);

  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  return (
    <div className="h-full flex flex-col max-w-5xl mx-auto border border-stone-800 bg-[#24221f] rounded-xl shadow-2xl overflow-hidden font-mono text-xs">
      <div className="bg-[#1c1a18] border-b border-stone-800 px-4 py-3.5 flex items-center justify-between text-stone-300">
        <div className="flex items-center space-x-2">
          <BookOpen size={14} className="text-amber-600" />
          <span className="font-display font-semibold tracking-wider text-xs text-stone-300">学士渡鸦飞鸽日志 (Citadel Raven Logs)</span>
        </div>
        <button onClick={fetchLogs} className="p-1 hover:text-stone-100 transition-colors cursor-pointer" title="Force Refresh">
          <RefreshCw size={13} className={running ? "animate-spin" : ""} />
        </button>
      </div>
      
      <div className="flex-1 p-5 overflow-y-auto leading-relaxed text-stone-200 whitespace-pre-wrap break-words bg-[#2a2724]">
        {logs ? logs : <span className="text-stone-500 italic">学士圣堂安静闲置，暂无渡鸦密保。开启推演后日志将在此潺潺流出。</span>}
        <div ref={endRef} />
      </div>
    </div>
  );
}
