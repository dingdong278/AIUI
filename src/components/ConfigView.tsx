import React, { useState, useEffect } from "react";
import { Save, AlertCircle, Sparkles, BookOpen } from "lucide-react";

export default function ConfigView() {
  const [config, setConfig] = useState<any>({ api: {}, prompts: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const loadConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      
      // Merge in defaults if absent to ensure UI loads correctly
      const merged = {
        api: data.api || {
          engine: { key: data.api_key || "", url: data.base_url || "", model: data.model || "" },
          lore: { key: "", url: "", model: "" },
          historian: { key: "", url: "", model: "" },
          maiden: { key: "", url: "", model: "" },
          relations: { key: "", url: "", model: "" },
          translator: { key: "", url: "", model: "" }
        },
        prompts: data.prompts || {
          worldContext: "",
          systemTemplate: ""
        },
        base_path: data.base_path || "",
        allied_faction: data.allied_faction || "",
        only_allied_simulation: !!data.only_allied_simulation,
      };
      
      setConfig(merged);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleApiChange = (moduleName: string, field: string, value: string) => {
    setConfig((prev: any) => ({
      ...prev,
      api: {
        ...prev.api,
        [moduleName]: {
          ...prev.api[moduleName],
          [field]: value
        }
      }
    }));
  };

  const handlePromptChange = (field: string, value: string) => {
    setConfig((prev: any) => ({
      ...prev,
      prompts: {
        ...prev.prompts,
        [field]: value
      }
    }));
  };

  const handleBaseChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    let parsedValue: any = value;
    if (type === "checkbox") {
      parsedValue = (e.target as HTMLInputElement).checked;
    }
    setConfig((prev: any) => ({ ...prev, [name]: parsedValue }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
      });
      setMessage("学士卷轴保存成功 (Configuration saved).");
      setTimeout(() => setMessage(""), 3000);
    } catch (error) {
      setMessage("Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-stone-500 font-sans p-6 text-center">正在查阅旧镇誓言卷轴... (Loading)</div>;

  const modules = [
    { id: "engine", name: "🧠 主推演引擎", desc: "角色思维与全服世界推演" },
    { id: "lore", name: "📚 原著考据/角色传记", desc: "生成权力之网与角色背景" },
    { id: "historian", name: "📜 史官/圣堂金卷", desc: "大盘推演及势力编年史" },
    { id: "maiden", name: "🕊️ 圣女谏言", desc: "玩家发展游玩祈祷解答" },
    { id: "relations", name: "🕸️ 权力之网", desc: "人物关系图谱生成" }
  ];

  return (
    <div className="max-w-4xl mx-auto bg-stone-50 rounded-xl shadow-lg border border-stone-200 p-1 font-sans mb-12">
      <div className="p-6 border-b border-stone-200 flex justify-between items-center bg-stone-100/80 rounded-t-lg backdrop-blur-sm sticky top-0 z-10">
        <div>
          <h3 className="text-xl font-display font-semibold text-stone-900 tracking-tight flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-stone-700" />
            学士圣堂控制台 (Citadel Sanctuary)
          </h3>
          <p className="text-sm text-stone-500 mt-1">每个功能模块可独立配置模型，未填写的配置将默认使用「🧠主推演引擎」的模型参数。</p>
        </div>
        {message && <div className="text-sm text-emerald-800 font-medium bg-emerald-50 px-3 py-1.5 rounded-md border border-emerald-100 flex items-center gap-1.5"><Sparkles className="w-4 h-4"/>{message}</div>}
      </div>

      <form onSubmit={handleSave} className="p-6 space-y-8">
        {/* Module API Configs */}
        <div className="space-y-6">
           <h4 className="text-lg font-display font-semibold text-stone-900 pb-2 border-b border-stone-200">各学城职能与模型挂载配置</h4>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
             {modules.map(mod => {
               const modData = config.api?.[mod.id] || {};
               return (
                 <div key={mod.id} className="bg-white p-4 rounded-xl border border-stone-200 shadow-sm space-y-3">
                   <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                      <div>
                        <div className="font-semibold text-stone-800">{mod.name}</div>
                        <div className="text-xs text-stone-500">{mod.desc}</div>
                      </div>
                   </div>
                   <div className="space-y-2">
                     <input
                       type={mod.id === "engine" ? "password" : "text"}
                       placeholder={mod.id === "engine" ? "API Key (必需)" : "API Key (留空则继承主引擎)"}
                       value={modData.key || ""}
                       onChange={e => handleApiChange(mod.id, "key", e.target.value)}
                       className="w-full px-3 py-1.5 text-sm bg-stone-50 border border-stone-300 rounded focus:ring-1 focus:ring-stone-400 outline-none"
                     />
                     <input
                       type="text"
                       placeholder={mod.id === "engine" ? "Base URL (如 https://api.deepseek.com)" : "Base URL (继承)"}
                       value={modData.url || ""}
                       onChange={e => handleApiChange(mod.id, "url", e.target.value)}
                       className="w-full px-3 py-1.5 text-sm bg-stone-50 border border-stone-300 rounded focus:ring-1 focus:ring-stone-400 outline-none"
                     />
                     <input
                       type="text"
                       placeholder={mod.id === "engine" ? "模型代号 (如 deepseek-chat)" : "模型名称 (继承)"}
                       value={modData.model || ""}
                       onChange={e => handleApiChange(mod.id, "model", e.target.value)}
                       className="w-full px-3 py-1.5 text-sm bg-stone-50 border border-stone-300 rounded focus:ring-1 focus:ring-stone-400 outline-none"
                     />
                   </div>
                 </div>
               );
             })}
           </div>
        </div>

        {/* Global Settings */}
        <div className="space-y-4 pt-4 border-t border-stone-200">
           <h4 className="text-lg font-display font-semibold text-stone-900 pb-2">系统本地环境配置</h4>
           <div>
             <label className="block text-sm font-medium text-stone-700 mb-1">AIInfluence 存档绝对路径</label>
             <input
               type="text"
               name="base_path"
               value={config.base_path || ""}
               onChange={handleBaseChange}
               placeholder="如: E:\\SteamLibrary\\steamapps\\common\\Mount & Blade II Bannerlord\\Modules\\AIInfluence\\save_data"
               className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-sm font-mono bg-stone-50"
             />
             <div className="text-xs text-stone-500 mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3"/> 本地运行必填，指向MOD游戏存档根路径。</div>
           </div>
        </div>

        {/* Alliance Focus */}
        <div className="bg-stone-100/60 p-5 rounded-lg border border-stone-200 space-y-4">
          <h4 className="text-sm font-display font-semibold text-stone-900 flex items-center gap-1.5 border-b border-stone-200 pb-2">
             ⚔️ 冰火原著：家族效忠与核心扮演 (ASOIAF Allegiance Focus)
          </h4>
          
          <div>
             <label className="block text-sm font-medium text-stone-700 mb-1">玩家拟效忠/亲近势力 (Allied Faction)</label>
             <select
               name="allied_faction"
               value={config.allied_faction || ""}
               onChange={handleBaseChange}
               className="w-full px-4 py-2 bg-white border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-sm text-stone-900"
             >
               <option value="">-- 均衡沙盒推演 (无势力绑定) --</option>
               <option value="Stark">史塔克家族 (House Stark)</option>
               <option value="Lannister">兰尼斯特家族 (House Lannister)</option>
               <option value="Targaryen">坦格利安家族 (House Targaryen)</option>
               <option value="Baratheon">拜拉席恩家族 (House Baratheon)</option>
               <option value="Tyrell">提利尔家族 (House Tyrell)</option>
               <option value="Martell">马泰尔家族 (House Martell)</option>
               <option value="Greyjoy">葛雷乔伊家族 (House Greyjoy)</option>
               <option value="Tully">徒利家族 (House Tully)</option>
               <option value="Arryn">艾林家族 (House Arryn)</option>
               <option value="Nightwatch">守夜人军团 (Night's Watch)</option>
               <option value="Wildlings">自由民 (Wildlings)</option>
             </select>
             <p className="mt-1 text-xs text-stone-500">
               绑定后，所属势力的领主将享有更高推演优先级。
             </p>
          </div>

          <div className="flex items-start gap-2.5 pt-1.5">
             <input
               type="checkbox"
               name="only_allied_simulation"
               id="only_allied_simulation"
               checked={!!config.only_allied_simulation}
               onChange={handleBaseChange}
               className="mt-1 h-4 w-4 rounded border-stone-300 text-stone-700 focus:ring-stone-500"
             />
             <div className="text-sm">
               <label htmlFor="only_allied_simulation" className="font-semibold text-stone-800 cursor-pointer">
                 极限冰火沉浸模式 (Exclusive Faction Simulation)
               </label>
               <p className="text-xs text-stone-500 leading-relaxed max-w-2xl mt-0.5">
                 开启后将强制“跳过”不相关家族领主的日常推演（除非被玩家标记为重点对象），极大降低无用API耗损，提升与玩家势力相关人物的运转极速。
               </p>
             </div>
          </div>
        </div>

        {/* Prompt Editors */}
        <div className="space-y-4 pt-4 border-t border-stone-200">
           <h4 className="text-lg font-display font-semibold text-stone-900 pb-2">底座神谕与世界箴言 (Prompts Matrix)</h4>
           
           <div>
             <label className="block text-sm font-medium text-stone-700 mb-1">🌍 世界背景覆盖 (World Context Prompt)</label>
             <textarea
               value={config.prompts?.worldContext || ""}
               onChange={e => handlePromptChange("worldContext", e.target.value)}
               rows={6}
               placeholder="(如果留空，后台将使用硬编码的默认「冰与火之歌」宏大背景)"
               className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-sm font-mono bg-stone-50"
             />
             <p className="text-xs text-stone-500 mt-1">决定 AI 眼中的世界运行法则。支持维斯特洛大陆的基础客观法则描述。</p>
           </div>
           
           <div>
             <label className="block text-sm font-medium text-stone-700 mb-1">🤖 引擎内核指令模板 (System Template)</label>
             <textarea
               value={config.prompts?.systemTemplate || ""}
               onChange={e => handlePromptChange("systemTemplate", e.target.value)}
               rows={10}
               placeholder="(如果留空，将使用内置的 ASOIAF 内心独白、信件解析主指令)"
               className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-sm font-mono bg-stone-50"
             />
             <p className="text-xs text-stone-500 mt-1">推演架构的绝对核心，包含输出占位符 [INTERNAL_THOUGHTS] 等的规则说明。</p>
           </div>

           <div>
             <label className="block text-sm font-medium text-stone-700 mb-1">👰 圣女谏言神谕 (Maiden Prompt Override)</label>
             <textarea
               value={config.prompts?.maidenTemplate || ""}
               onChange={e => handlePromptChange("maidenTemplate", e.target.value)}
               rows={4}
               placeholder="(可选) 重定义圣女问答时的开场设定..."
               className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-sm font-mono bg-stone-50"
             />
           </div>
           
           <div>
             <label className="block text-sm font-medium text-stone-700 mb-1">🕸️ 权力之网系统约束 (Relations Prompt Override)</label>
             <textarea
               value={config.prompts?.relationsPrompt || ""}
               onChange={e => handlePromptChange("relationsPrompt", e.target.value)}
               rows={4}
               placeholder="(可选) 控制生成节点 JSON 的特殊格式要求..."
               className="w-full px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 outline-none text-sm font-mono bg-stone-50"
             />
           </div>
        </div>

        <div className="pt-6 flex justify-end items-center gap-4 border-t border-stone-200">
           <button
             type="button"
             onClick={async () => {
                try {
                  const res = await fetch('/api/config/test', { method: 'POST' });
                  const json = await res.json();
                  if (res.ok) {
                    setMessage(`通信成功！AI回应: ${json.response}`);
                  } else {
                    setMessage(`通信失败: ${json.error}`);
                  }
                } catch(e: any) {
                  setMessage(`网络错误: ${e.message}`);
                }
             }}
             className="px-6 py-2.5 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-stone-500 shadow-sm"
           >
             测试长城连接
           </button>
           <button 
             type="submit" 
             disabled={saving}
             className="px-8 py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-100 rounded-xl font-medium transition-colors disabled:opacity-75 focus:outline-none focus:ring-2 focus:ring-stone-500 shadow-sm flex items-center gap-2"
           >
             <Save className="w-4 h-4"/>
             {saving ? "正在镌刻..." : "保存圣堂金卷"}
           </button>
        </div>
      </form>
    </div>
  );
}

