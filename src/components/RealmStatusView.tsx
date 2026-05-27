import React, { useState, useEffect } from "react";
import { Globe, ScrollText, Flag, Swords, Castle, LayoutDashboard, Loader, Play } from "lucide-react";

export default function RealmStatusView() {
  const [reports, setReports] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const fetchData = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/realm/status");
      const d = await res.json();
      setReports(d.reports || []);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleGenerate = async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/realm/generate", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Generation failed");
      setReports(data.reports || []);
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6 font-sans animate-in fade-in duration-500">
      
      <div className="bg-[#fdfcf7] rounded-xl shadow-lg border border-stone-300 overflow-hidden">
        <div className="p-6 border-b border-stone-200 bg-stone-100/50 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-display font-semibold text-stone-900 tracking-tight flex items-center gap-2">
              <Globe className="text-stone-700" size={20} />
              维斯特洛纪事 (Realm Chronicles)
            </h3>
            <p className="text-sm text-stone-500 mt-1 font-serif">史官 AI 观测整个大陆局势，根据近期密报生成局势推测。</p>
          </div>
          <div className="flex items-center gap-2">
            {errorMsg && <span className="text-xs text-red-600 pr-2">{errorMsg}</span>}
            <button
              onClick={handleGenerate}
              disabled={loading}
              className="px-3 py-1.5 bg-stone-800 hover:bg-stone-900 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 border border-stone-900 focus:ring-2 focus:ring-stone-500 disabled:opacity-50 transition-colors"
              title="根据现有事件日志生成最新的大陆史书记录"
            >
              {loading ? <Loader className="animate-spin" size={16} /> : <Play size={16} />} 
              {loading ? "史官撰写中..." : "命史官推演"}
            </button>
          </div>
        </div>

        <div className="p-8 bg-[#faf6eb]/30">
          {loading ? (
             <div className="text-center py-12">
               <ScrollText size={32} className="animate-pulse mx-auto text-stone-400 mb-3" />
               <p className="text-stone-500 font-display">学士正在整理近期的渡鸦情报，书写历史...</p>
             </div>
          ) : reports.length === 0 ? (
             <div className="text-center py-12 text-stone-400">
               没有任何纪事。请点击上方按钮让史官根据现在的存档信息撰写历史。
             </div>
          ) : (
            <div className="space-y-8 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-stone-300 before:to-transparent">
              {reports.map((report, idx) => (
                <div key={idx} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border border-white bg-stone-100 text-stone-600 shadow shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 z-10">
                    {report.type === "war" ? <Swords size={16} /> : report.type === "politics" ? <Flag size={16} /> : <Castle size={16} />}
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] p-5 rounded-2xl border border-stone-300 bg-[#fefdfa] shadow-sm hover:shadow-md transition-shadow">
                    <div className="flex items-center justify-between mb-2">
                       <h4 className="font-display font-bold text-stone-900 text-base">{report.title}</h4>
                       <span className="text-xs font-serif text-amber-800 font-semibold bg-amber-50 px-2 py-0.5 border border-amber-200 rounded">{report.date}</span>
                    </div>
                    <p className="text-sm font-serif text-stone-700 leading-relaxed text-justify">
                      {report.content}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      
    </div>
  );
}
