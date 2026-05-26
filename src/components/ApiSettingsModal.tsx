import React, { useState, useEffect } from "react";
import { X, Save, Key, Globe, Cpu, FileText } from "lucide-react";

export default function ApiSettingsModal({
  isOpen,
  onClose,
  featureKey,
  title,
  defaultPrompt
}: {
  isOpen: boolean;
  onClose: () => void;
  featureKey: string;
  title: string;
  defaultPrompt?: string;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<any>({});

  useEffect(() => {
    if (isOpen) {
      setLoading(true);
      fetch("/api/config")
        .then(r => r.json())
        .then(data => {
          setConfig(data);
          setLoading(false);
        });
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleChange = (e: any) => {
    setConfig({ ...config, [e.target.name]: e.target.value });
  };

  const handleSave = async () => {
    setSaving(true);
    await fetch("/api/config", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config)
    });
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-in fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col font-sans">
        <div className="flex items-center justify-between p-4 border-b border-stone-200 bg-stone-50">
          <h3 className="font-display font-bold text-stone-800 text-lg">⚙️ {title} - 专属 API 设置</h3>
          <button onClick={onClose} className="p-1 text-stone-400 hover:text-stone-700 hover:bg-stone-200 rounded">
            <X size={20} />
          </button>
        </div>
        
        <div className="p-6 space-y-5 overflow-y-auto max-h-[70vh]">
          {loading ? (
            <div className="text-stone-500 py-4 text-center">读取密印中...</div>
          ) : (
            <>
              <div className="bg-blue-50 text-blue-800 p-3 rounded-lg text-sm mb-4 border border-blue-200">
                如果以下 API 设置留空，系统将自动使用「圣堂金卷」中配置的主力 API 进行推演。
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1 flex items-center gap-1">
                    <Key size={14} /> API Key (独立密钥)
                  </label>
                  <input
                    type="password"
                    name={`${featureKey}_api_key`}
                    value={config[`${featureKey}_api_key`] || ""}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="如留空，则退回全局主密钥"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1 flex items-center gap-1">
                    <Globe size={14} /> Base URL (独立中转端点)
                  </label>
                  <input
                    type="text"
                    name={`${featureKey}_base_url`}
                    value={config[`${featureKey}_base_url`] || ""}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="如留空，则退回全局 Base URL"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1 flex items-center gap-1">
                    <Cpu size={14} /> Model (独立模型代号)
                  </label>
                  <input
                    type="text"
                    name={`${featureKey}_model`}
                    value={config[`${featureKey}_model`] || ""}
                    onChange={handleChange}
                    className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
                    placeholder="如留空，则退回全局模型"
                  />
                </div>

                {defaultPrompt !== undefined && (
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1 flex items-center gap-1">
                      <FileText size={14} /> 自定义系统指令 (System Prompt)
                    </label>
                    <textarea
                      name={`${featureKey}_prompt`}
                      value={config[`${featureKey}_prompt`] || ""}
                      onChange={handleChange}
                      placeholder={defaultPrompt}
                      rows={6}
                      className="w-full px-3 py-2 border border-stone-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-amber-500 placeholder:text-stone-300"
                    ></textarea>
                    <p className="text-[11px] text-stone-500 mt-1">留空将使用默认的系统内部提示词。</p>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-stone-200 bg-stone-50 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-stone-600 hover:bg-stone-200 rounded-lg text-sm font-medium transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="px-4 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors disabled:opacity-50"
          >
            <Save size={16} />
            {saving ? "保存中..." : "烙印法则 (Save)"}
          </button>
        </div>
      </div>
    </div>
  );
}
