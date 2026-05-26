import React, { useState, useEffect } from "react";
import { User, Bell, Moon, Shield, Sparkles, Plus } from "lucide-react";

export default function PrioritiesView() {
  const [priorities, setPriorities] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [newId, setNewId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPriorities();
  }, []);

  const loadPriorities = async () => {
    try {
      const res = await fetch("/api/priorities");
      const data = await res.json();
      setPriorities(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async (updatedPriorities: any) => {
    setSaving(true);
    try {
      await fetch("/api/priorities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updatedPriorities)
      });
      setPriorities(updatedPriorities);
    } catch (e) {
      console.error(e);
    } finally {
      setSaving(false);
    }
  };

  const addCharacter = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newId.trim()) return;
    const updated = { ...priorities, [newId.trim()]: "auto" };
    handleSave(updated);
    setNewId("");
  };

  const updateStatus = (id: string, status: string) => {
    const updated = { ...priorities, [id]: status };
    handleSave(updated);
  };

  const removeCharacter = (id: string) => {
    const updated = { ...priorities };
    delete updated[id];
    handleSave(updated);
  };

  if (loading) return <div className="text-stone-500 font-sans p-6 text-center">查阅誓盟名单中...</div>;

  const entries = Object.entries(priorities);

  return (
    <div className="max-w-4xl mx-auto space-y-6 font-sans">
      <div className="bg-stone-50 rounded-xl shadow-lg border border-stone-200">
        <div className="p-6 border-b border-stone-200 bg-stone-100 rounded-t-xl">
          <h3 className="text-xl font-display font-semibold text-stone-900 tracking-tight">领主静思优先名册 (Character Dispatcher)</h3>
          <p className="text-sm text-stone-500 mt-1">控制特定的领主在后台的状态：强制唤醒推算、完全进入静修不消耗密钥、或服从智能过滤。</p>
        </div>

        <div className="p-6">
          <form onSubmit={addCharacter} className="flex gap-3 mb-8">
            <input
              type="text"
              value={newId}
              onChange={(e) => setNewId(e.target.value)}
              placeholder="输入领主 ID (例如 lord_stark_1)"
              className="flex-1 px-4 py-2 border border-stone-300 rounded-lg focus:ring-2 focus:ring-stone-400 focus:border-stone-400 outline-none text-stone-900 placeholder-stone-400 font-serif text-sm bg-white"
            />
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 bg-stone-800 text-stone-100 hover:bg-stone-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-75 flex items-center gap-1.5 cursor-pointer shadow-sm"
            >
              <Plus size={14} /> Add Dignitary
            </button>
          </form>

          {entries.length === 0 ? (
            <div className="text-center py-16 text-stone-400 border border-dashed border-stone-200 rounded-xl bg-stone-50/50">
              <Shield size={40} className="mx-auto mb-3 opacity-30 text-stone-400" />
              <p className="font-display font-bold text-stone-850">尚未登记特定的领主推演加急令</p>
              <p className="text-xs mt-1 text-stone-500 leading-relaxed">后台生命引擎将严格开启自主轮循或服从选派的效忠势力过滤规则。</p>
            </div>
          ) : (
            <div className="space-y-3">
              {entries.map(([id, status]: any) => (
                <div key={id} className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-white border border-stone-250 rounded-lg gap-3">
                  <div className="flex items-center space-x-3">
                    <div className="w-9 h-9 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 border border-stone-250">
                      <Shield size={16} />
                    </div>
                    <div>
                      <div className="font-mono text-xs font-semibold text-stone-900">{id}</div>
                      <div className="text-xs text-stone-400 capitalize font-serif">{String(status).replace("_", " ")} mode active</div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <StatusBtn 
                       active={status === "force_active"}
                       onClick={() => updateStatus(id, "force_active")}
                       icon={<Bell size={13} className="mr-1" />}
                       label="唤醒 (Wake)"
                       activeColor="bg-amber-100 text-amber-900 border-amber-300"
                    />
                    <StatusBtn 
                       active={status === "auto"}
                       onClick={() => updateStatus(id, "auto")}
                       icon={<Sparkles size={13} className="mr-1" />}
                       label="智能 (Auto)"
                       activeColor="bg-stone-300 text-stone-900 border-stone-400"
                    />
                    <StatusBtn 
                       active={status === "sleep"}
                       onClick={() => updateStatus(id, "sleep")}
                       icon={<Moon size={13} className="mr-1" />}
                       label="静休 (Sleep)"
                       activeColor="bg-stone-800 text-stone-100 border-stone-800"
                    />
                    <button 
                      onClick={() => removeCharacter(id)}
                      className="p-2 ml-4 text-stone-400 hover:text-rose-600 transition-colors text-lg"
                      title="Remove custom rule"
                    >
                      &times;
                    </button>
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

function StatusBtn({ active, onClick, icon, label, activeColor }: any) {
  const base = "flex items-center px-3 py-1.5 text-xs font-medium border rounded-md transition-colors cursor-pointer";
  const def = "bg-white text-stone-700 border-stone-300 hover:bg-stone-100";
  return (
    <button onClick={onClick} className={`${base} ${active ? activeColor : def}`}>
      {icon} {label}
    </button>
  );
}
