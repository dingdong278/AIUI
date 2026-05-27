import React, { useState, useEffect } from "react";
import { Search, Shield, MapPin, Brain, Sparkles, Loader } from "lucide-react";
import CharacterDetail from "./CharacterDetailView";

export default function CharactersView() {
  const [characters, setCharacters] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genStatus, setGenStatus] = useState("");

  const fetchCharacters = async () => {
    try {
      const res = await fetch("/api/characters");
      const data = await res.json();
      setCharacters(data.characters || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCharacters();
  }, []);

  const cleanName = (name: string) => name.replace(/\s*\(.*?\)/g, "").trim();

  // Filter based on search input
  const filtered = characters.filter((c: any) => 
    c.name.toLowerCase().includes(search.toLowerCase()) || 
    c.id.toLowerCase().includes(search.toLowerCase())
  );
  
  const missingPersonality = characters.filter(c => !c.hasPersonality);

  if (selectedId) {
    return (
       <div className="animate-in fade-in slide-in-from-right-4 duration-300 h-full">
          <CharacterDetail 
             id={selectedId} 
             onBack={() => setSelectedId(null)} 
          />
       </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-stone-100 font-sans p-12">
         <div className="animate-pulse flex items-center space-x-2 text-stone-600">
            <Brain size={24} className="animate-bounce" />
            <span className="font-display font-medium">旧镇学士正在扫览领地卷轴...</span>
         </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col space-y-6 animate-in fade-in duration-500 font-sans">
      
      {/* Search Header Container */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-stone-50 px-6 py-5 rounded-2xl shadow-sm border border-stone-200 gap-4">
        <div>
           <h3 className="text-xl font-display font-bold text-stone-900 tracking-tight flex items-center gap-3">
             维斯特洛领主志 (Westeros Dignitaries Roll)
           </h3>
           <p className="text-sm text-stone-500 mt-1">
             在当前推演沙盒中发现了 <span className="font-bold text-stone-700">{characters.length}</span> 位受洗礼的领主与子民。
           </p>
        </div>
        <div className="relative w-full sm:w-80">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Search size={16} className="text-stone-400" />
          </div>
          <input
            type="text"
            className="block w-full pl-10 pr-3 py-2 border border-stone-300 rounded-xl bg-white text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-400 focus:border-stone-400 sm:text-sm transition-all"
            placeholder="搜寻家族名字 (例如 Stark, Ned)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Characters List Grid */}
      <div className="flex-1 overflow-auto p-1">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtered.map((char: any) => (
            <button
              key={char.id}
              onClick={() => setSelectedId(char.id)}
              className="group text-left bg-[#fdfcf7] p-5 rounded-2xl border border-stone-250 shadow-sm hover:shadow-md hover:border-stone-400 transition-all duration-300 relative overflow-hidden cursor-pointer"
            >
              <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-stone-100/60 to-transparent rounded-bl-full opacity-50 group-hover:from-stone-200/50 transition-all" />
              
              <div className="flex items-start space-x-4">
                <div className="w-11 h-11 bg-stone-200 rounded-full flex items-center justify-center flex-shrink-0 group-hover:bg-stone-300 transition-colors">
                  <Shield size={20} className="text-stone-600 group-hover:text-stone-800 transition-colors" />
                </div>
                <div className="flex-1 min-w-0 z-10">
                  <h4 className="text-[16px] font-display font-bold text-stone-900 truncate tracking-wide">
                    {cleanName(char.name)}
                  </h4>
                  <div className="text-[11px] font-mono text-stone-400 truncate mt-1">
                    {char.id}
                  </div>
                </div>
              </div>
              
              <div className="mt-5 grid grid-cols-2 gap-2">
                 <div className="flex items-center space-x-2 bg-stone-100/70 rounded-lg p-2 border border-stone-200/50">
                    <Brain size={12} className="text-stone-500" />
                    <span className="text-xs font-medium text-stone-700 capitalize truncate font-serif">{char.mood || "平静"}</span>
                 </div>
                 <div className="flex items-center space-x-2 bg-stone-100/70 rounded-lg p-2 border border-stone-200/50">
                    <MapPin size={12} className="text-stone-500" />
                    <span className="text-xs font-medium text-stone-700 truncate font-serif">{cleanName(char.location || "临冬城")}</span>
                 </div>
              </div>
              
              {char.status === "pending_prompt" && (
                 <div className="mt-3 bg-amber-50 border border-amber-300 rounded-lg p-2.5 flex items-center justify-between shadow-sm">
                   <div className="flex items-center text-amber-900 animate-pulse">
                     <Shield size={14} className="text-amber-600 mr-1.5" />
                     <span className="text-xs font-bold font-serif">提示词设定变动待确认</span>
                   </div>
                   <span className="text-[10px] bg-amber-600 text-white px-2 py-1 rounded font-medium shadow-sm active:bg-amber-700">处理</span>
                 </div>
              )}
            </button>
          ))}
          {filtered.length === 0 && (
             <div className="col-span-full py-16 text-center text-stone-500 bg-stone-50 rounded-2xl border border-stone-200/70">
                <Shield size={40} className="mx-auto mb-3 opacity-30 text-stone-400 animate-pulse" />
                <p className="font-display">暂无任何领主印记与该名称契合 (No entities matched).</p>
             </div>
          )}
        </div>
      </div>
    </div>
  );
}
