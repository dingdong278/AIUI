import React, { useState, useEffect } from "react";
import { Save, Loader, ArrowUp, ArrowDown, GripVertical, Settings2 } from "lucide-react";

export default function PromptBuilderView() {
  const [config, setConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/prompt_config");
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch("/api/prompt_config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      setMessage("法则序列已更新。需等待一次完整循环或重启生效。");
      setTimeout(() => setMessage(""), 3000);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const moveBlock = (index: number, direction: -1 | 1) => {
    const newBlocks = [...config.blocks];
    if (index + direction < 0 || index + direction >= newBlocks.length) return;
    const temp = newBlocks[index];
    newBlocks[index] = newBlocks[index + direction];
    newBlocks[index + direction] = temp;
    setConfig({ ...config, blocks: newBlocks });
  };

  const updateBlockContent = (index: number, content: string) => {
    const newBlocks = [...config.blocks];
    newBlocks[index].content = content;
    setConfig({ ...config, blocks: newBlocks });
  };

  const updateSystemPrompt = (val: string) => {
    setConfig({ ...config, system_prompt: val });
  };

  if (loading || !config) {
    return (
      <div className="flex justify-center items-center h-64 text-stone-400">
        <Loader className="animate-spin mr-2" /> 研读旧镇卷宗...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto animate-in fade-in duration-300 pb-12">
      <div className="flex justify-between items-end border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-display font-bold text-stone-800 flex items-center">
            <Settings2 className="mr-2 text-amber-600" />
            法则铸造台 (Prompt Builder)
          </h2>
          <p className="text-sm text-stone-500 mt-1 font-serif">
            拖拽或点击上下以重塑推演基底序列。警告：静态与动态区的截断关系将影响模型推理缓存效率。
          </p>
        </div>
        <div className="flex items-center gap-3">
          {message && <span className="text-emerald-600 font-bold text-sm bg-emerald-50 px-3 py-1 rounded">{message}</span>}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center px-4 py-2 bg-amber-600 hover:bg-amber-700 text-amber-50 rounded shadow-sm text-sm font-semibold transition-colors disabled:opacity-50"
          >
            {saving ? <Loader size={16} className="animate-spin mr-2" /> : <Save size={16} className="mr-2" />}
            镌刻法则 (Save Configurations)
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="font-display font-medium text-stone-700">【顶层潜意识规则 / System Prompt】</h3>
        <textarea
          value={config.system_prompt || ""}
          onChange={(e) => updateSystemPrompt(e.target.value)}
          rows={12}
          className="w-full bg-stone-900 text-emerald-400 font-mono text-xs p-4 rounded focus:ring-2 focus:ring-amber-500 border border-stone-800"
          placeholder="扮演规则..."
        />
      </div>

      <div className="space-y-4 pt-4">
        <h3 className="font-display font-medium text-stone-700 flex justify-between items-center">
          <span>【思维区块链路 / Prompt Blocks (User Message)】</span>
        </h3>
        
        <div className="space-y-3">
          {config.blocks?.map((block: any, index: number) => {
            const isVar = block.type === "variable";
            const isDivider = block.type === "divider";
            
            return (
              <div 
                key={block.id || index}
                className={`border rounded flex overflow-hidden shadow-sm transition-colors ${
                  isDivider ? "border-amber-400 bg-amber-50/50" : 
                  isVar ? "border-stone-200 bg-white" : "border-stone-300 bg-stone-50"
                }`}
              >
                <div className="bg-stone-100 border-r border-stone-200 p-2 flex flex-col items-center justify-center space-y-2 w-12 text-stone-400">
                   <GripVertical size={16} />
                   <div className="flex flex-col gap-1 mt-2">
                      <button 
                        onClick={() => moveBlock(index, -1)}
                        disabled={index === 0}
                        className="p-1 hover:bg-stone-200 hover:text-stone-700 rounded disabled:opacity-30"
                      ><ArrowUp size={14}/></button>
                      <button 
                        onClick={() => moveBlock(index, 1)}
                        disabled={index === config.blocks.length - 1}
                        className="p-1 hover:bg-stone-200 hover:text-stone-700 rounded disabled:opacity-30"
                      ><ArrowDown size={14}/></button>
                   </div>
                </div>
                
                <div className="p-4 flex-1">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className={`font-bold font-display text-sm ${isDivider ? "text-amber-700" : isVar ? "text-indigo-700" : "text-stone-800"}`}>
                      {block.title}
                    </h4>
                    <span className="text-[10px] font-mono tracking-widest uppercase rounded px-2 py-0.5 bg-stone-200 text-stone-600">
                      {block.type}
                    </span>
                  </div>
                  
                  {isVar ? (
                    <div className="text-xs font-mono text-stone-500 bg-stone-100 p-2 rounded">
                      [渲染引擎自动填充动态变量: {block.var_name}]
                    </div>
                  ) : (
                    <textarea
                      value={block.content || ""}
                      onChange={(e) => updateBlockContent(index, e.target.value)}
                      rows={isDivider ? 1 : 6}
                      className="w-full bg-white text-stone-700 font-serif text-sm p-3 rounded focus:ring-2 focus:ring-amber-500 border border-stone-300 focus:border-transparent"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
    </div>
  );
}
