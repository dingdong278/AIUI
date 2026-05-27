import React, { useEffect, useRef, useState } from "react";
import { Loader, Users, Search, Plus, Settings, X, ArrowLeft } from "lucide-react";
import * as d3 from "d3";
import ApiSettingsModal from "./ApiSettingsModal";
import CharacterDetail from "./CharacterDetailView";

export default function RelationsView() {
  const [data, setData] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [searchName, setSearchName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = () => {
    setLoading(true);
    fetch("/api/relations")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        console.error(e);
        setLoading(false);
      });
  };

  const handleGenerate = async () => {
    if (!searchName.trim()) return;
    setGenerating(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/relations/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ character_name: searchName.trim() })
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Generation failed");
      setData(resData);
      setSearchName("");
    } catch (e: any) {
      setErrorMsg(e.message);
    } finally {
      setGenerating(false);
    }
  };

  useEffect(() => {
    if (!data || !data.nodes || !data.nodes.length || !svgRef.current || !containerRef.current) return;

    try {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;

      const svg = d3.select(svgRef.current);
      svg.selectAll("*").remove(); // clear old

      // Clone nodes and links to prevent mutating React state
      const nodes = data.nodes.map((d: any) => ({ ...d }));
      // Filter out links that reference non-existent nodes to avoid d3 errors
      const nodeIds = new Set(nodes.map((d) => d.id));
      const links = data.links ? data.links.filter((l: any) => nodeIds.has(l.source?.id || l.source) && nodeIds.has(l.target?.id || l.target)).map((d: any) => ({ ...d })) : [];

      const g = svg.append("g");

      // Set up zoom
      const zoom = d3.zoom<SVGSVGElement, unknown>().on("zoom", (event) => {
        g.attr("transform", event.transform);
      });
      svg.call(zoom as any);

      // Color scale for groups
      const color = d3.scaleOrdinal(d3.schemePaired);

      const simulation = d3
        .forceSimulation(nodes)
        .force(
          "link",
          d3
            .forceLink(links)
            .id((d: any) => d.id)
            .distance(150)
        )
        .force("charge", d3.forceManyBody().strength(-400))
        .force("center", d3.forceCenter(width / 2, height / 2));

      const link = g
        .append("g")
        .attr("stroke", "#999")
        .attr("stroke-opacity", 0.6)
        .selectAll("line")
        .data(links)
        .join("line")
        .attr("stroke-width", (d: any) => Math.sqrt(d.value || 1) * 2);

      const linkLabel = g
        .append("g")
        .selectAll("text")
        .data(links)
        .join("text")
        .attr("font-size", 10)
        .attr("fill", "#666")
        .text((d: any) => d.label);

      const node = g
        .append("g")
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .selectAll("circle")
        .data(nodes)
        .join("circle")
        .attr("r", 15)
        .attr("fill", (d: any) => color(d.group))
        .attr("cursor", "pointer")
        .on("click", (event, d: any) => {
           // Provide the Chinese full name (d.name) or fallback to ID, as server fuzzy matching checks both
           const searchKey = (d.name || d.id).replace(/\s*\(.*?\)/g, "").trim();
           setSelectedId(searchKey);
        })
        .call(
          d3
            .drag<SVGCircleElement, any>()
            .on("start", (event, d) => {
              if (!event.active) simulation.alphaTarget(0.3).restart();
              d.fx = d.x;
              d.fy = d.y;
            })
            .on("drag", (event, d) => {
              d.fx = event.x;
              d.fy = event.y;
            })
            .on("end", (event, d) => {
              if (!event.active) simulation.alphaTarget(0);
              d.fx = null;
              d.fy = null;
            })
        );

      const labels = g
        .append("g")
        .selectAll("text")
        .data(nodes)
        .join("text")
        .attr("font-size", 12)
        .attr("dx", 18)
        .attr("dy", 4)
        .attr("font-family", "serif")
        .attr("fill", "#333")
        .text((d: any) => d.name);

      node.append("title").text((d: any) => d.name);

      simulation.on("tick", () => {
        link
          .attr("x1", (d: any) => d.source.x)
          .attr("y1", (d: any) => d.source.y)
          .attr("x2", (d: any) => d.target.x)
          .attr("y2", (d: any) => d.target.y);

        linkLabel
          .attr("x", (d: any) => (d.source.x + d.target.x) / 2)
          .attr("y", (d: any) => (d.source.y + d.target.y) / 2);

        node.attr("cx", (d: any) => d.x).attr("cy", (d: any) => d.y);

        labels.attr("x", (d: any) => d.x).attr("y", (d: any) => d.y);
      });

      return () => {
        simulation.stop();
      };
    } catch (e) {
      console.error("D3 error:", e);
    }
  }, [data]);

  if (loading && !data) {
    return (
      <div className="flex justify-center items-center h-64 text-stone-400">
        <Loader className="animate-spin mr-2" /> 研读古老卷宗中的纠葛...
      </div>
    );
  }

  if (selectedId) {
    return (
       <div className="animate-in fade-in slide-in-from-right-4 duration-300 h-full max-w-6xl mx-auto pb-12 flex flex-col h-[calc(100vh-80px)]">
          <CharacterDetail 
             id={selectedId} 
             onBack={() => setSelectedId(null)} 
          />
       </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12 flex flex-col h-[calc(100vh-80px)]">
      <div className="flex justify-between items-end border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-display font-bold text-stone-800 flex items-center">
            <Users className="mr-2 text-indigo-600" />
            权力之网：原著角色羁绊图
          </h2>
          <p className="text-sm text-stone-500 mt-1 font-serif">
            通过《冰与火之歌》原著考据生成的核心人物关系网络，支持缩放拖拽。
          </p>
        </div>
        
        <div className="flex items-center gap-2">
          {errorMsg && <span className="text-xs text-red-600 pr-2">{errorMsg}</span>}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" size={14} />
            <input 
              type="text" 
              value={searchName}
              onChange={(e) => setSearchName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleGenerate()}
              placeholder="输入原著角色名..."
              className="pl-8 pr-3 py-1.5 w-48 text-sm bg-white border border-stone-300 rounded focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
            />
          </div>
          <button 
            onClick={handleGenerate}
            disabled={generating || !searchName.trim()}
            className="flex items-center px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-sm rounded transition-colors disabled:opacity-50"
          >
            {generating ? <Loader className="animate-spin mr-1" size={14} /> : <Plus className="mr-1" size={14} />}
            挖掘并接入网络
          </button>
          <button
            onClick={() => setSettingsOpen(true)}
            className="p-1.5 ml-2 text-stone-500 hover:text-stone-800 hover:bg-stone-200 rounded transition-colors"
            title="设置专用的生成模型(API)"
          >
            <Settings size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 bg-stone-50 border border-stone-200 rounded-lg shadow-inner overflow-hidden relative" ref={containerRef}>
        {!data || !data.nodes || data.nodes.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-stone-400">
            暂无原著人物关系数据，请在上方输入角色名并点击挖掘
          </div>
        ) : (
          <svg className="w-full h-full" ref={svgRef}></svg>
        )}
        {generating && (
          <div className="absolute inset-0 bg-stone-100/50 backdrop-blur-sm flex items-center justify-center flex-col z-10 transition-opacity">
            <Loader className="animate-spin text-indigo-600 mb-2" size={32} />
            <p className="text-indigo-800 font-medium text-sm font-display tracking-widest shadow-white drop-shadow-md">查阅大学士编年史...</p>
          </div>
        )}
      </div>

      <ApiSettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        featureKey="relations"
        title="权力之网"
        defaultPrompt={`你是一个《冰与火之歌》(权力的游戏)百科专家。请梳理【{character_name}】的核心人物关系网（包含本人以及5-10个最关键的亲属、盟友或敌人）。请严格以JSON格式输出，不要有任何多余的解释、不要加markdown包裹、不要其他任何文本。输出必须符合如下结构：
{
  "nodes": [
    {"id": "英文缩写", "name": "中文全名", "group": "所属中文势力/家族", "desc": "100-200字的该角色原著考据与性格简述"}
  ],
  "links": [
    {"source": "源节点id", "target": "目标节点id", "label": "中文关系描述文本", "value": 1}
  ]
}`}
      />
    </div>
  );
}
