import React, { useState, useEffect } from "react";

export default function ConfigView() {
  const [config, setConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  const loadConfig = async () => {
    try {
      const res = await fetch("/api/config");
      const data = await res.json();
      setConfig(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, []);

  const handleChange = (e: any) => {
    const { name, value, type, checked } = e.target;
    let parsedValue = type === "checkbox" ? checked : value;
    if (type === "number") {
      parsedValue = parseFloat(value);
    }
    setConfig((prev: any) => ({ ...prev, [name]: parsedValue }));
  };

  const handleSave = async (e: any) => {
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

  return (
    <div className="max-w-3xl mx-auto bg-stone-50 rounded-xl shadow-lg border border-stone-200 p-1 font-sans">
      <div className="p-6 border-b border-stone-200 flex justify-between items-center bg-stone-100/80 rounded-t-lg backdrop-blur-sm">
        <div>
          <h3 className="text-xl font-display font-semibold text-stone-900 tracking-tight">学士圣堂控制台 (Citadel Sanctuary)</h3>
          <p className="text-sm text-stone-500 mt-1">在此调校后台生命推演引擎、API 密钥与剧本势力关联聚焦。</p>
        </div>
        {message && <div className="text-sm text-emerald-800 font-medium bg-emerald-50 px-3 py-1.5 rounded-md border border-emerald-100">{message}</div>}
      </div>

      <form onSubmit={handleSave} className="p-6 space-y-6">
        <div className="space-y-4">
          <div className="space-y-4 pb-2">
            <h4 className="text-sm font-display font-semibold text-stone-900 pb-2">🧠 主推演 API 设定 (Main Engine API)</h4>
            <Field 
              label="主要 API Key (主密钥)" 
              name="api_key" 
              value={config.api_key || ""} 
              onChange={handleChange} 
              type="password" 
              desc="用于向大十字学士提炼真知的模型密钥 (DeepSeek / Gemini API Key)。所有子功能均会默认回退至该主密钥。" 
            />
            <Field 
              label="主要 Base URL (主中转端点)" 
              name="base_url" 
              value={config.base_url || ""} 
              onChange={handleChange} 
              desc="AI 代理接口端点，默认为 https://api.deepseek.com" 
            />
            <Field 
              label="主要 Model (主脑波模型)" 
              name="model" 
              value={config.model || ""} 
              onChange={handleChange} 
              desc="主推演模型代号，推荐 deepseek-chat 等高智商模型。" 
            />
          </div>

          <div className="space-y-4 pt-4 border-t border-stone-200">
            <h4 className="text-sm font-display font-semibold text-stone-900 pb-2">⚙️ 游戏引擎挂载设定 (Engine Mount)</h4>
            <Field 
              label="AIInfluence 游戏存档模块物理路径" 
              name="base_path" 
              value={config.base_path || ""} 
              onChange={handleChange} 
              desc="骑马与砍杀2 AIInfluence/save_data 的真实绝对路径。" 
            />
          </div>

          {/* ASOIAF Alliance Focus settings */}
          <div className="bg-stone-100/50 p-5 rounded-lg border border-stone-200 space-y-4">
            <h4 className="text-sm font-display font-semibold text-stone-900 flex items-center gap-1.5 border-b border-stone-200 pb-2">
              <span>🛡️ 家族效忠与核心扮演 (ASOIAF Allegiance Core Focus)</span>
            </h4>
            
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">选定玩家效忠/亲近势力 (Allied Faction)</label>
              <select
                name="allied_faction"
                value={config.allied_faction || ""}
                onChange={handleChange}
                className="w-full px-4 py-2 bg-white border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 transition-shadow outline-none text-sm text-stone-900"
              >
                <option value="">-- 全员自主推演 (不绑定特定家族) --</option>
                <option value="Stark">史塔克家族 (House Stark)</option>
                <option value="Lannister">兰尼斯特家族 (House Lannister)</option>
                <option value="Targaryen">坦格利安家族 (House Targaryen)</option>
                <option value="Baratheon">拜拉席恩家族 (House Baratheon)</option>
                <option value="Tyrell">提利尔家族 (House Tyrell)</option>
                <option value="Martell">马泰尔家族 (House Martell)</option>
                <option value="Greyjoy">葛雷乔伊家族 (House Greyjoy)</option>
                <option value="Tully">徒利家族 (House Tully)</option>
                <option value="Arryn">艾林家族 (House Arryn)</option>
              </select>
              <p className="mt-1 text-xs text-stone-500">
                如果绑定，该势力下的核心领主将被重点关注，即使没有遭遇亦会自动在后台持续活跃推算。
              </p>
            </div>

            <div className="flex items-start gap-2.5 pt-1.5">
              <input
                type="checkbox"
                name="only_allied_simulation"
                id="only_allied_simulation"
                checked={!!config.only_allied_simulation}
                onChange={handleChange}
                className="mt-1 h-4 w-4 rounded border-stone-300 text-stone-700 focus:ring-stone-500"
              />
              <div className="text-sm">
                <label htmlFor="only_allied_simulation" className="font-semibold text-stone-800 cursor-pointer">
                  锁定势力剧本专注 (Exclusive Allied Simulation)
                </label>
                <p className="text-xs text-stone-500 leading-relaxed">
                  开启后，除非领主被您手工标记为“强制活跃”，其余与当前效忠势力无关的边缘领主、村长、流浪汉将自动静止低耗运行，极大幅度节约密钥额度并加速后台轮次运转！
                </p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field 
              label="推演分析间隙 (Analysis Interval Days)" 
              name="analysis_interval_days" 
              value={config.analysis_interval_days || 0} 
              onChange={handleChange} 
              type="number"
            />
            <Field 
              label="引擎心跳率/休眠等候 (Heartbeat s)" 
              name="heartbeat_interval" 
              value={config.heartbeat_interval || 0} 
              onChange={handleChange} 
              type="number"
            />
          </div>
          <Field 
            label="累计推演单轮预算最大额度 (USD)" 
            name="max_cost_usd" 
            value={config.max_cost_usd || 0} 
            onChange={handleChange} 
            type="number" step="0.1"
          />
        </div>

        <div className="pt-4 flex justify-end border-t border-stone-200">
          <button 
            type="submit" 
            disabled={saving}
            className="px-6 py-2 bg-stone-800 hover:bg-stone-700 text-stone-100 rounded-lg font-medium transition-colors disabled:opacity-75 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-500"
          >
            {saving ? "正在镌刻..." : "保存圣堂金卷"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, name, value, onChange, type = "text", desc, step }: any) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        id={name}
        value={value}
        onChange={onChange}
        step={step}
        className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-shadow outline-none text-sm"
      />
      {desc && <p className="mt-1 text-xs text-slate-500">{desc}</p>}
    </div>
  );
}
