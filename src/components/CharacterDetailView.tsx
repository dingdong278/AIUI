import React, { useState, useEffect } from "react";
import { ArrowLeft, Save, Code, History, Brain, Heart, MapPin, Database, Users, BookOpen, Loader, Shield, Sparkles, Plus, Trash2, Key } from "lucide-react";

function extractFaction(data: any): string {
  if (data.Faction) return data.Faction;
  if (data.Culture) return data.Culture;
  
  // Try to parse from name (e.g. 丹妮莉丝·坦格利安 -> 坦格利安家族)
  if (data.Name && data.Name.includes('·')) {
    const parts = data.Name.split('·');
    const surname = parts[parts.length - 1];
    return `${surname}家族`;
  }

  // Check RecentEvents for clues (e.g. "kingdom:坦格利安家族")
  if (data.RecentEvents && Array.isArray(data.RecentEvents)) {
    for (const event of data.RecentEvents) {
      if (typeof event.Description === 'string') {
        const match = event.Description.match(/kingdom:([^,)]+)/);
        if (match && match[1]) {
           return match[1].trim();
        }
      }
    }
  }
  
  // Check LocationType for kingdom
  if (data.LocationType && typeof data.LocationType === 'string') {
    const match = data.LocationType.match(/kingdom of ([^,)]+)/);
    if (match && match[1]) {
       return match[1].trim();
    }
  }

  return "维斯特洛领主 (Westeros Dignitary)";
}

export default function CharacterDetail({ id, onBack }: any) {
  const [data, setData] = useState<any>(null);
  const [state, setState] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  
  const [settingsOpen, setSettingsOpen] = useState(false);
  
  // Lore management
  const [lore, setLore] = useState("");
  const [loreLoading, setLoreLoading] = useState(false);
  const [loreEditing, setLoreEditing] = useState(false);
  const [loreText, setLoreText] = useState("");
  const [loreSaving, setLoreSaving] = useState(false);

  // Classified Secrets Registry
  const [secrets, setSecrets] = useState<string[]>([]);
  const [newSecret, setNewSecret] = useState("");
  const [secretsLoading, setSecretsLoading] = useState(false);
  const [secretsSaving, setSecretsSaving] = useState(false);

  const [rawMode, setRawMode] = useState(false);
  const [rawText, setRawText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [generatingPersonality, setGeneratingPersonality] = useState(false);
  const [metaFaction, setMetaFaction] = useState<string | null>(null);

  // Send message
  const [outboxMsg, setOutboxMsg] = useState("");
  const [sendingMsg, setSendingMsg] = useState(false);
  const [sendFeedback, setSendFeedback] = useState("");

  const fetchData = async () => {
    try {
      const res = await fetch(`/api/characters/${id}`);
      const json = await res.json();
      setData(json.json);
      setState(json.state);
      setMetaFaction(json.metaFaction || null);
      setRawText(JSON.stringify(json.json, null, 2));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchSecrets = async () => {
    setSecretsLoading(true);
    try {
      const res = await fetch(`/api/characters/${id}/secrets`);
      const json = await res.json();
      setSecrets(json.secrets || []);
    } catch (e) {
      console.error(e);
    } finally {
      setSecretsLoading(false);
    }
  };

  const fetchLore = async (force = false) => {
    setLoreLoading(true);
    try {
      const clean = data?.Name ? data.Name.replace(/\s*\(.*?\)/g, "").trim() : id;
      const url = `/api/lore/${encodeURIComponent(clean)}${force ? "?force=1" : ""}`;
      const res = await fetch(url);
      const json = await res.json();
      if (json.error) {
        setLore(json.error);
        setLoreText(json.error);
      } else {
        setLore(json.lore);
        setLoreText(json.lore);
      }
    } catch(e) {
      setLore("Failed to communicate with the Citadel Maesters.");
      setLoreText("Failed to communicate with the Citadel Maesters.");
    } finally {
      setLoreLoading(false);
    }
  };

  // Prompt diff state
  const [promptDiff, setPromptDiff] = useState<any>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [diffSaving, setDiffSaving] = useState(false);

  const fetchPromptDiff = async () => {
    setDiffLoading(true);
    try {
      const res = await fetch(`/api/characters/${id}/prompt_diff`);
      const json = await res.json();
      if (!json.error) {
        setPromptDiff(json);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setDiffLoading(false);
    }
  };

  const handleApproveDiff = async () => {
    setDiffSaving(true);
    try {
      await fetch(`/api/characters/${id}/prompt_diff/approve`, { method: "POST" });
      setPromptDiff(null);
      setState({ ...state, status: "active" });
      setSaveMessage("缓存变更已批准，将重新推演！");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (e) {
      setSaveMessage("Failed to approve");
    } finally {
      setDiffSaving(false);
    }
  };

  useEffect(() => {
    fetchData();
    fetchSecrets();
  }, [id]);

  useEffect(() => {
    if (state?.status === "pending_prompt") {
       fetchPromptDiff();
    }
  }, [state?.status]);

  useEffect(() => {
    // Only fetch lore if explicitly requested to save tokens
  }, [data]);

  const handleSaveRaw = async () => {
    setSaving(true);
    setSaveMessage("");
    try {
      const parsed = JSON.parse(rawText);
      await fetch(`/api/characters/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed)
      });
      setData(parsed);
      setSaveMessage("Saved successfully");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (e) {
      setSaveMessage("Invalid JSON format");
    } finally {
      setSaving(false);
    }
  };

  const handleSendMessage = async () => {
    if (!outboxMsg.trim()) return;
    setSendingMsg(true);
    setSendFeedback("");
    try {
      const res = await fetch(`/api/characters/${id}/send_message`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: outboxMsg })
      });
      if (res.ok) {
        setOutboxMsg("");
        setSendFeedback("飞鸽传书已送达发件箱！引擎将在下回合唤醒对方。");
        setTimeout(() => setSendFeedback(""), 5000);
      } else {
        setSendFeedback("发送失败！");
      }
    } catch (e) {
      setSendFeedback("发送时出现网络错误");
    } finally {
      setSendingMsg(false);
    }
  };

  const [generatingAll, setGeneratingAll] = useState(false);

  const handleGenerateAll = async () => {
    setGeneratingAll(true);
    try {
      await Promise.all([
        fetchLore(true),
        handleGeneratePersonality(true)
      ]);
    } catch (e) {
      console.error(e);
    } finally {
      setGeneratingAll(false);
    }
  };

  const handleGeneratePersonality = async (silent = false) => {
    setGeneratingPersonality(true);
    try {
      const res = await fetch(`/api/characters/${id}/generate_personality`, {
        method: "POST"
      });
      if (res.ok) {
        await fetchData();
      } else if (!silent) {
        alert("生成失败，请检查在服务端是否配置了 GEMINI_API_KEY。");
      }
    } catch (e) {
      console.error(e);
      if (!silent) alert("网络请求失败");
    } finally {
      setGeneratingPersonality(false);
    }
  };

  const handleSaveLore = async () => {
    setLoreSaving(true);
    try {
      await fetch(`/api/characters/${id}/lore`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lore: loreText })
      });
      setLore(loreText);
      setLoreEditing(false);
      setSaveMessage("Citadel Lore updated!");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (e) {
      setSaveMessage("Failed to override lore");
    } finally {
      setLoreSaving(false);
    }
  };

  const handleAddSecret = () => {
    if (!newSecret.trim()) return;
    setSecrets(prev => [...prev, newSecret.trim()]);
    setNewSecret("");
  };

  const handleRemoveSecret = (index: number) => {
    setSecrets(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveSecrets = async () => {
    setSecretsSaving(true);
    try {
      await fetch(`/api/characters/${id}/secrets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secrets })
      });
      setSaveMessage("Classified Secrets sealed!");
      setTimeout(() => setSaveMessage(""), 3000);
    } catch (e) {
      setSaveMessage("Failed to seal secrets");
    } finally {
      setSecretsSaving(false);
    }
  };

  if (loading) return (
    <div className="flex h-full items-center justify-center text-stone-600 bg-stone-100 font-sans p-12">
      <div className="text-center space-y-3">
        <Brain size={32} className="animate-pulse mx-auto text-stone-700" />
        <p className="text-sm font-display font-medium tracking-wide">学士院正在调阅文献... (Loading Chronicle)</p>
      </div>
    </div>
  );
  if (!data) return <div className="text-rose-700 font-sans p-8">Failed to find character parchment.</div>;

  const cleanName = data.Name.replace(/\s*\(.*?\)/g, "").trim();

  return (
    <div className="flex flex-col h-full bg-[#f6f2e9] rounded-2xl shadow-lg border border-stone-300 overflow-hidden font-sans">
      {/* Scroll Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-stone-300 bg-stone-100">
        <div className="flex items-center space-x-4">
          <button onClick={onBack} className="p-2 hover:bg-stone-200 transition-colors rounded-full text-stone-700">
             <ArrowLeft size={18} />
          </button>
          <div>
            <h2 className="text-2xl font-display font-bold text-stone-950 flex items-center gap-2">
              <span>{cleanName}</span>
              <span className="text-xs px-2 py-0.5 bg-stone-200 border border-stone-300 rounded text-stone-600 font-mono font-normal">
                {id}
              </span>
            </h2>
            <div className="text-xs text-stone-500 mt-1">
              {metaFaction || extractFaction(data)}
            </div>
          </div>
        </div>
        
        <div className="flex items-center space-x-3">
           <button
             onClick={handleGenerateAll}
             disabled={generatingAll || generatingPersonality || loreLoading}
             className="px-3 py-1.5 flex items-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-50"
             title="一键补全所有缺失学士档案和 AI 精神内核 (Generate All)"
           >
             {generatingAll ? <Loader size={14} className="animate-spin" /> : <Sparkles size={14} />}
             <span className="hidden sm:inline">撰写领主志 (Generate All)</span>
           </button>
           
           {saveMessage && (
             <span className={`text-xs font-medium px-3 py-1 rounded border animate-pulse ${saveMessage.includes("Invalid") || saveMessage.includes("Failed") ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-800"}`}>
               {saveMessage}
             </span>
           )}
           <button 
             onClick={() => setRawMode(!rawMode)}
             className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center transition-colors border ${rawMode ? "bg-stone-300 text-stone-900 border-stone-400" : "bg-stone-200 text-stone-800 border-stone-300 hover:bg-stone-300"}`}
           >
             <Code size={14} className="mr-1.5" /> 原始 JSON
           </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto bg-[#faf6eb]/50 relative p-6">
        {rawMode ? (
          <div className="h-full flex flex-col p-2 animate-in fade-in duration-300">
            <div className="flex justify-between items-center mb-2">
               <span className="text-xs font-display font-semibold text-stone-500 uppercase tracking-widest">领主原始属性记录 (Raw JSON Ledger)</span>
               <button
                 onClick={handleSaveRaw}
                 disabled={saving}
                 className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-100 rounded-lg flex items-center text-xs font-medium transition-colors disabled:opacity-50"
               >
                 <Save size={14} className="mr-1.5" /> 写入修改 (Save)
               </button>
            </div>
            <textarea 
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              className="flex-1 w-full p-4 font-mono text-xs border border-stone-300 bg-stone-50 rounded-xl focus:ring-1 focus:ring-stone-500 outline-none resize-none shadow-inner"
              spellCheck="false"
            />
          </div>
        ) : (
          <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300">
            
            {/* Maester's Report Stats Grid */}
            
            {state?.status === "pending_prompt" && (
              <div className="bg-amber-50 border border-amber-300 rounded-xl p-5 mb-6 shadow-sm">
                 <div className="flex items-center space-x-2 text-amber-900 mb-3">
                   <Shield size={20} className="text-amber-600" />
                   <h3 className="text-lg font-display font-bold">静态缓存截断预警 (Cache Miss Warning)</h3>
                 </div>
                 <p className="text-sm text-amber-800 mb-4 leading-relaxed font-serif">
                   由于领主设定的静态部分发生了变动，本次推演将无法命中全局前置缓存。为了防止昂贵的失控重计算，系统已暂停该领主的引擎循环。请核对变动，若确认无误，请点击「核准发送」。修改下方的“原著考据(Lore)”或“极密文档(Secrets)”会直接引发此类变动。
                 </p>
                 {!promptDiff ? (
                    <div className="bg-stone-50 border border-stone-200 p-4 rounded-lg mb-4 text-stone-500 text-sm flex items-center justify-between">
                       <span>{diffLoading ? "正在拉取比对数据..." : "无法自动拉取变更数据，可能是因为缓存文件已被消费或是读取失败。"}</span>
                       <button onClick={fetchPromptDiff} disabled={diffLoading} className="text-amber-700 hover:text-amber-900 px-3 py-1 bg-amber-200 hover:bg-amber-300 rounded-md transition-colors disabled:opacity-50">尝试重新拉取</button>
                    </div>
                 ) : (
                 <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-white border border-stone-200 rounded p-3 text-xs overflow-auto max-h-40 font-mono text-stone-600">
                      <div className="font-bold text-stone-400 mb-1">=== 上一次成功的缓存基底 ===</div>
                      {promptDiff.old}
                    </div>
                    <div className="bg-amber-100/50 border border-amber-200 rounded p-3 text-xs overflow-auto max-h-40 font-mono text-stone-900">
                      <div className="font-bold text-amber-600 mb-1">=== 新生成的缓存基底 ===</div>
                      {promptDiff.new}
                    </div>
                 </div>
                 )}
                 <div className="flex justify-end">
                    <button 
                      onClick={handleApproveDiff}
                      disabled={diffSaving}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-amber-50 rounded-lg text-sm font-medium flex items-center transition-colors shadow-sm disabled:opacity-50"
                    >
                      {diffSaving ? <Loader size={16} className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
                      {promptDiff ? "确认无误，核准发送 (Approve & Resume)" : "强制解除挂起 (Force Resume)"}
                    </button>
                 </div>
              </div>
            )}

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard icon={<Heart className="text-red-700" />} title="心境 / 情绪 (Mood)" value={data.EmotionalState?.Mood || "平静"} subtitle={data.EmotionalState?.Reason} />
              <StatCard icon={<MapPin className="text-stone-700" />} title="当前驻所 (Location)" value={data.LocationType?.replace(/\s*\(.*?\)/g, "") || "未知深林"} />
              <StatCard icon={<Database className="text-stone-700" />} title="存活状态 (Status)" value={data.IsAlive === false ? "已故 ☠️" : "健在 🛡️"} />
              <StatCard icon={<Users className="text-stone-700" />} title="亲卫队规模 (Forces)" value={data.NPCForces?.PartySize ? `${data.NPCForces.PartySize} 兵甲` : "无领兵"} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
              
              {/* Left Column: Lore and Soul */}
              <div className="md:col-span-7 space-y-6">
                
                {/* Genuine ASOIAF Lore Scroll */}
                <Section 
                  title="大十字学士原著考据 (Citadel True Lore)" 
                  icon={<BookOpen size={18} className="text-stone-800" />}
                  action={
                    <button
                      onClick={() => fetchLore(true)}
                      disabled={loreLoading || loreEditing}
                      className="flex items-center space-x-1.5 text-xs font-sans font-medium px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-colors border border-amber-300 disabled:opacity-50"
                      title="强制重新生成考据"
                    >
                      {loreLoading ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      <span>重新考据 (Regenerate)</span>
                    </button>
                  }
                >
                  <div className="bg-[#fcfaf2] p-5 rounded-xl border border-stone-300/85 shadow-sm relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl from-amber-100/30 to-transparent rounded-bl-full pointer-events-none" />
                    
                    {loreEditing ? (
                      <div className="space-y-3">
                        <textarea
                          value={loreText}
                          onChange={(e) => setLoreText(e.target.value)}
                          className="w-full p-3 font-sans text-sm border border-stone-300 bg-white rounded-lg focus:ring-1 focus:ring-stone-500 outline-none h-40"
                          placeholder="在此手动书写或编辑该领主的原著背景、生平介绍..."
                        />
                        <div className="flex justify-end space-x-2">
                          <button 
                            onClick={() => { setLoreEditing(false); setLoreText(lore); }}
                            className="px-3 py-1.5 bg-stone-200 text-stone-700 rounded text-xs hover:bg-stone-300 transition-colors"
                          >
                            取消
                          </button>
                          <button 
                            onClick={handleSaveLore}
                            disabled={loreSaving}
                            className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-100 rounded text-xs flex items-center transition-colors"
                          >
                            {loreSaving ? <Loader size={12} className="animate-spin mr-1" /> : <Save size={12} className="mr-1" />}
                            保存原著考据
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {loreLoading ? (
                          <div className="flex items-center justify-center p-4 text-xs text-stone-500">
                            <Loader size={14} className="animate-spin mr-1.5" /> 正在研读学士院古卷...
                          </div>
                        ) : (
                          <p className="text-stone-800 text-sm leading-relaxed whitespace-pre-wrap font-serif">
                            {lore || "尚无关于此人的旧镇文献记录。正在等待修撰。"}
                          </p>
                        )}
                        <div className="flex justify-end pt-2 border-t border-stone-200/60">
                          <button
                            onClick={() => setLoreEditing(true)}
                            className="text-xs text-stone-600 hover:text-stone-950 font-medium flex items-center gap-1"
                          >
                            <Sparkles size={12} /> 手动修正/重写此考据
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </Section>

                {/* Secret Documents Container */}
                <Section title="静思室极密文档袋 (Classified Secrets & Legends)" icon={<Key size={18} className="text-stone-800" />}>
                  <div className="bg-[#fdfcf7] p-5 rounded-xl border border-stone-300 shadow-sm space-y-4">
                    <p className="text-xs text-stone-500 leading-relaxed">
                      这里的机密记录非常简短，但会在后台推演时加载到角色的独白与渡鸦信函逻辑中，使其“知晓”游戏地图隐藏的神剑、背叛或阴谋主线。
                    </p>
                    
                    {secretsLoading ? (
                      <div className="text-xs text-stone-400 py-2">正在解开暗锁...</div>
                    ) : (
                      <div className="space-y-3">
                        {secrets.length === 0 ? (
                          <div className="text-xs italic text-stone-400 bg-stone-50 p-3 rounded-lg border border-dashed border-stone-200">
                            目前没有针对此领主封存的机密。在下方可以添加。
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {secrets.map((sec, idx) => (
                              <div key={idx} className="flex justify-between items-center bg-stone-100/60 px-3 py-2 rounded-lg border border-stone-200 group">
                                <span className="text-sm font-serif text-stone-800">{sec}</span>
                                <button
                                  onClick={() => handleRemoveSecret(idx)}
                                  className="text-stone-400 hover:text-rose-600 p-1 rounded hover:bg-stone-200 transition-colors"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="flex gap-2 pt-1">
                          <input
                            type="text"
                            value={newSecret}
                            onChange={(e) => setNewSecret(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && handleAddSecret()}
                            placeholder="例如：秘密持有古老神剑『碎心』的位置在..."
                            className="flex-1 px-3 py-1.5 text-xs bg-white border border-stone-300 rounded focus:ring-1 focus:ring-stone-500 outline-none font-serif"
                          />
                          <button
                            onClick={handleAddSecret}
                            className="px-3 bg-stone-200 hover:bg-stone-300 border border-stone-300 rounded text-stone-800 transition-colors"
                          >
                            <Plus size={14} />
                          </button>
                        </div>

                        <div className="flex justify-end pt-3 border-t border-stone-200">
                          <button
                            onClick={handleSaveSecrets}
                            disabled={secretsSaving}
                            className="px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-100 rounded text-xs font-medium flex items-center transition-colors shadow-sm"
                          >
                            {secretsSaving ? <Loader size={12} className="animate-spin mr-1.5" /> : <Save size={12} className="mr-1.5" />}
                            加盖火漆封闭 (Seal Secrets)
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </Section>

                {/* AI Core State Area */}
                <Section 
                  title="领主精神内核 (AI Legacy Mind)" 
                  icon={<Brain size={18} className="text-stone-800" />}
                  action={
                    <button
                      onClick={handleGeneratePersonality}
                      disabled={generatingPersonality}
                      className="flex items-center space-x-1.5 text-xs font-sans font-medium px-3 py-1 bg-amber-100 hover:bg-amber-200 text-amber-800 rounded-lg transition-colors border border-amber-300 disabled:opacity-50"
                    >
                      {generatingPersonality ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
                      <span>{data.AIGeneratedPersonality ? '重新编织设定 (Regenerate)' : '撰写初始人设 (Generate)'}</span>
                    </button>
                  }
                >
                  <div className="space-y-4">
                    <TextBlock label="长期本源人格设定 (AIGeneratedPersonality)" content={data.AIGeneratedPersonality || <span className="text-stone-400 italic">空缺...(Empty) 点击上方按钮呼叫学士院。</span>} />
                    <TextBlock label="宿命转折与底层记忆 (AIGeneratedBackstory)" content={data.AIGeneratedBackstory || <span className="text-stone-400 italic">空缺...(Empty)</span>} />
                    <TextBlock label="言语习惯与口癖 Quirk (AIGeneratedSpeechQuirks)" content={data.AIGeneratedSpeechQuirks || <span className="text-stone-400 italic">空缺...(Empty)</span>} />
                  </div>
                </Section>
                
              </div>

              {/* Right Column: Active Memo and Logs */}
              <div className="md:col-span-5 space-y-6">
                
                {/* Simulated Sanctuary Memo */}
                {state?.pending_talks?.length > 0 && (
                  <Section title="静思室备忘任务" icon={<Shield size={16} className="text-amber-800" />}>
                    <div className="bg-amber-50/70 p-4 rounded-xl border border-amber-200 text-stone-850">
                      <h5 className="text-xs font-display font-bold text-amber-900 mb-2">接下来的筹划事项：</h5>
                      <ul className="list-disc pl-5 space-y-1.5 text-sm font-serif">
                        {state.pending_talks.map((t: any, i: any) => <li key={i}>{t}</li>)}
                      </ul>
                    </div>
                  </Section>
                )}

                {/* Monologue / Ravens Log from game interactions */}
                <Section title="思维波 / 飞鸽渡鸦密信 (Chronicle Logs)" icon={<History size={18} className="text-stone-800" />}>
                  {/* Send Raven UI */}
                  <div className="mb-4 bg-stone-50 p-4 rounded-xl border border-stone-200">
                    <div className="flex items-center justify-between mb-2">
                       <span className="text-sm font-semibold text-stone-700">发送渡鸦传书 (Send Raven)</span>
                       {sendFeedback && <span className="text-xs text-amber-600 font-medium">{sendFeedback}</span>}
                    </div>
                    <textarea 
                      value={outboxMsg}
                      onChange={e => setOutboxMsg(e.target.value)}
                      placeholder="写下你想对TA说的话..."
                      className="w-full text-sm p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-amber-500/20 focus:border-amber-500 outline-none font-serif min-h-[80px]"
                    />
                    <div className="mt-2 text-right">
                       <button
                         onClick={handleSendMessage}
                         disabled={sendingMsg || !outboxMsg.trim()}
                         className="px-4 py-1.5 bg-stone-800 text-stone-100 text-sm rounded-lg hover:bg-stone-700 disabled:opacity-50 transition border border-stone-900 shadow-sm"
                       >
                         {sendingMsg ? "发送中 (Sending...)" : "放飞渡鸦 (Send)"}
                       </button>
                    </div>
                  </div>

                  <div className="bg-white border border-stone-300 rounded-xl max-h-[500px] overflow-y-auto shadow-sm">
                    {(!data.ConversationHistory || data.ConversationHistory.length === 0) ? (
                      <div className="p-8 text-center text-stone-400 font-serif italic text-sm">尚无静思思考。该领主需要被引擎激活。</div>
                    ) : (
                      <div className="divide-y divide-stone-100 font-serif">
                        {data.ConversationHistory.slice().reverse().map((entry: string, idx: number) => {
                          const isLetter = entry.includes("PLAYER_LETTER") || entry.toLowerCase().includes("致我") || entry.toLowerCase().includes("盟友");
                          const isOutgoing = entry.includes("[收到来信]") || entry.toLowerCase().includes("致：") || (entry.includes("发送给") && !entry.includes(`${data.Name} 发送`));

                          return (
                            <div key={idx} className={`p-4 hover:bg-stone-50 transition-colors ${(isLetter && !isOutgoing) ? "bg-[#fcfaf2]/60" : ""} ${isOutgoing ? "bg-stone-50" : ""}`}>
                              {isLetter && !isOutgoing && <div className="text-[10px] uppercase font-display font-semibold tracking-wider text-amber-800 mb-1">📬 寄往外界的渡鸦密函</div>}
                              {isOutgoing && <div className="text-[10px] uppercase font-display font-semibold tracking-wider text-stone-500 mb-1">🕊️ 你送出的渡鸦传书</div>}
                              <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-wrap">{entry.replace(/\[sent_via_.*?\]/g, "").trim()}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </Section>

              </div>

            </div>

          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, title, value, subtitle }: any) {
  return (
    <div className="bg-[#fdfcf7] p-4 rounded-2xl border border-stone-300 shadow-sm flex flex-col justify-center">
      <div className="flex items-center space-x-2 text-stone-500 mb-1">
        {React.cloneElement(icon, { size: 14 })}
        <span className="text-xs font-display font-semibold uppercase tracking-wider">{title}</span>
      </div>
      <div className="text-base font-bold text-stone-900 capitalize truncate font-serif">{value}</div>
      {subtitle && <div className="text-xs text-stone-400 mt-1 truncate font-serif">{subtitle}</div>}
    </div>
  );
}

function Section({ title, icon, children, action }: any) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          {icon}
          <h3 className="text-sm font-display font-bold text-stone-900 tracking-wider uppercase">{title}</h3>
        </div>
        {action && <div>{action}</div>}
      </div>
      {children}
    </div>
  );
}

function TextBlock({ label, content }: any) {
  if (!content) return null;
  return (
    <div className="bg-white p-5 rounded-xl border border-stone-300 shadow-sm">
      <div className="text-xs font-display font-semibold text-stone-400 uppercase tracking-widest mb-2 border-b border-stone-100 pb-1.5">{label}</div>
      <p className="text-sm text-stone-800 leading-relaxed whitespace-pre-wrap font-serif">{content}</p>
    </div>
  );
}
