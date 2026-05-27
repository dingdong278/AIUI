import React, { useState, useEffect } from "react";
import { Play, Square, Settings, Users, Activity, FileText, UserCircle, Shield, Compass, BookOpen, Globe, Blocks, Share2, Sparkles } from "lucide-react";
import ConfigView from "./components/ConfigView";
import PrioritiesView from "./components/PrioritiesView";
import LogsView from "./components/LogsView";
import CharactersView from "./components/CharactersView";
import RealmStatusView from "./components/RealmStatusView";
import PromptBuilderView from "./components/PromptBuilderView";
import RelationsView from "./components/RelationsView";
import MaidenView from "./components/MaidenView";

export default function App() {
  const [activeTab, setActiveTab] = useState("realm"); // Start on Realm Chronicles for overview
  const [status, setStatus] = useState({ running: false, pid: null });

  const fetchStatus = async () => {
    try {
      const res = await fetch("/api/engine/status");
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  const handleStart = async () => {
    try {
      await fetch("/api/engine/start", { method: "POST" });
      fetchStatus();
    } catch (e) {
      console.error(e);
    }
  };

  const handleStop = async () => {
    try {
      await fetch("/api/engine/stop", { method: "POST" });
      fetchStatus();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f1e8] text-stone-800 font-sans flex flex-col md:flex-row antialiased">
      
      {/* Maester Sidebar */}
      <aside className="w-full md:w-64 bg-stone-900 text-stone-300 flex flex-col shadow-2xl z-10 border-r border-stone-950">
        <div className="p-6 border-b border-stone-800 bg-stone-950/40">
          <div className="flex items-center space-x-2.5">
            <div className="w-9 h-9 rounded-lg bg-amber-600/90 shadow-lg flex items-center justify-center border border-amber-500/30">
               <Shield className="text-stone-100" size={18} />
            </div>
            <div>
              <h1 className="text-base font-display font-semibold tracking-wider text-stone-100 uppercase">冰火推演引擎</h1>
              <div className="text-[10px] text-amber-500 font-display tracking-widest font-bold mt-0.5 uppercase">Westeros Chronicle</div>
            </div>
          </div>
          <p className="text-[11px] text-stone-500 mt-2 font-serif italic">Mount & Blade II: ASOIAF Companion</p>
        </div>
        
        <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
          <NavItem active={activeTab === "realm"} onClick={() => setActiveTab("realm")} icon={<Globe size={16} />} label="维斯特洛纪事 (Realm)" />
          <NavItem active={activeTab === "characters"} onClick={() => setActiveTab("characters")} icon={<UserCircle size={16} />} label="领主名册 (Chronicles)" />
          <NavItem active={activeTab === "relations"} onClick={() => setActiveTab("relations")} icon={<Share2 size={16} />} label="权力之网 (Relations)" />
          <NavItem active={activeTab === "priorities"} onClick={() => setActiveTab("priorities")} icon={<Users size={16} />} label="静思名册 (Priorities)" />
          <NavItem active={activeTab === "maiden"} onClick={() => setActiveTab("maiden")} icon={<Sparkles size={16} />} label="圣女谏言 (Maiden)" />
          <NavItem active={activeTab === "promptbuilder"} onClick={() => setActiveTab("promptbuilder")} icon={<Blocks size={16} />} label="法则铸造 (Prompts)" />
          <NavItem active={activeTab === "config"} onClick={() => setActiveTab("config")} icon={<Settings size={16} />} label="圣堂金卷 (Settings)" />
          <NavItem active={activeTab === "logs"} onClick={() => setActiveTab("logs")} icon={<FileText size={16} />} label="渡鸦密报 (Logs)" />
        </nav>

        {/* Engine Status Widget on Sidebar Bottom */}
        <div className="p-5 border-t border-stone-800 bg-stone-950/30">
          <div className="flex items-center justify-between mb-4 px-1">
            <span className="text-xs font-display font-semibold text-stone-500 uppercase tracking-widest">推演局势</span>
            <div className="flex items-center space-x-1.5">
              <div className={`w-2 h-2 rounded-full ${status.running ? "bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.7)]" : "bg-rose-500"}`} />
              <span className="text-xs font-semibold text-stone-300">{status.running ? "推演中 (Active)" : "静候 (Idle)"}</span>
            </div>
          </div>
          
          <div className="flex gap-2">
            <button
              onClick={handleStart}
              disabled={status.running}
              className="flex-1 flex items-center justify-center py-2 px-3 bg-stone-800 hover:bg-stone-700 text-stone-100 disabled:bg-stone-900 disabled:text-stone-600 disabled:border-stone-800 border border-stone-700 rounded-lg text-xs font-semibold transition-all shadow-sm cursor-pointer"
            >
              <Play size={12} className="mr-1.5" /> 启程 (Start)
            </button>
            <button
              onClick={handleStop}
              disabled={!status.running}
              className="flex-1 flex items-center justify-center py-2 px-3 bg-stone-900 hover:bg-stone-800 text-stone-300 border border-stone-850 hover:border-stone-700 disabled:opacity-30 rounded-lg text-xs font-semibold transition-all cursor-pointer"
            >
              <Square size={12} className="mr-1.5" /> 停歇 (Stop)
            </button>
          </div>
        </div>
      </aside>

      {/* Main Parchment Canvas */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden bg-[#faf6eb]/40">
        <header className="bg-[#fcf9f2] border-b border-stone-200 px-8 py-5 flex items-center justify-between sticky top-0 z-10">
          <h2 className="text-lg font-display font-medium text-stone-900 capitalize tracking-wider flex items-center gap-2">
            <Compass size={16} className="text-stone-600" />
            <span>{activeTab === "realm" ? "维斯特洛纪事 (Realm Chronicles)" : activeTab === "characters" ? "领主编年史" : activeTab === "priorities" ? "静思调配名册" : activeTab === "config" ? "旧镇学士配置台" : "飞鸽渡鸦推演文书"}</span>
          </h2>
          {status.running && (
            <span className="text-[11px] font-mono font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 rounded px-2.5 py-1">
              SESSION PID: {status.pid}
            </span>
          )}
        </header>

        <div className="flex-1 overflow-auto p-8 relative">
          <div className="h-full w-full max-w-7xl mx-auto">
            <div className={`h-full w-full ${activeTab === "realm" ? "block" : "hidden"}`}><RealmStatusView /></div>
            <div className={`h-full w-full ${activeTab === "characters" ? "block" : "hidden"}`}><CharactersView /></div>
            <div className={`h-full w-full ${activeTab === "relations" ? "block" : "hidden"}`}><RelationsView /></div>
            <div className={`h-full w-full ${activeTab === "priorities" ? "block" : "hidden"}`}><PrioritiesView /></div>
            <div className={`h-full w-full ${activeTab === "maiden" ? "block" : "hidden"}`}><MaidenView /></div>
            <div className={`h-full w-full ${activeTab === "promptbuilder" ? "block" : "hidden"}`}><PromptBuilderView /></div>
            <div className={`h-full w-full ${activeTab === "config" ? "block" : "hidden"}`}><ConfigView /></div>
            <div className={`h-full w-full ${activeTab === "logs" ? "block" : "hidden"}`}><LogsView running={status.running} /></div>
          </div>
        </div>
      </main>
    </div>
  );
}

function NavItem({ active, onClick, icon, label }: any) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center px-4 py-2.5 rounded-lg text-xs font-display font-medium tracking-wider transition-all duration-200 border cursor-pointer border-transparent ${
        active 
        ? "bg-amber-600 hover:bg-amber-500 text-[#faf6eb] shadow-md shadow-black/20" 
        : "text-stone-400 hover:bg-stone-800 hover:text-stone-100"
      }`}
    >
      <div className={`${active ? "text-white" : "text-stone-500"}`}>
        {icon}
      </div>
      <span className="ml-3 font-semibold uppercase whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>
    </button>
  );
}
