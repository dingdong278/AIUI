import React, { useEffect, useRef, useState } from "react";
import { Loader, Users, Search, Plus, X } from "lucide-react";
import * as d3 from "d3";

export default function RelationsView() {
  const [data, setData] = useState<{ nodes: any[]; links: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [searchName, setSearchName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<any>(null);
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
           setSelectedNode(d);
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
      <div className="flex justify-center items-center h-64 text-stone-400 font-serif">
        <Loader className="animate-spin mr-2" /> 研读古老卷宗中的宿命纠葛...
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto animate-in fade-in duration-300 pb-12 flex flex-col h-[calc(100vh-80px)]">
      <div className="flex justify-between items-end border-b border-stone-200 pb-4">
        <div>
          <h2 className="text-xl font-display font-bold text-stone-800 flex items-center">
            <Users className="mr-2 text-stone-700" />
            权力之网：冰火羁绊图谱
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
              onKeyDown={(e) => {
                if(e.key === 'Enter') {
                  e.preventDefault();
                  handleGenerate();
                }
              }}
              placeholder="输入冰火原著角色名..."
              className="pl-8 pr-3 py-1.5 w-56 text-sm bg-white border border-stone-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-stone-500 font-sans shadow-sm"
            />
          </div>
          <button 
            onClick={handleGenerate}
            disabled={generating || !searchName.trim()}
            className="flex items-center px-4 py-1.5 bg-stone-800 hover:bg-stone-700 text-stone-100 text-sm rounded-lg transition-colors disabled:opacity-50 border border-stone-900 shadow-sm"
          >
            {generating ? <Loader className="animate-spin mr-1.5" size={14} /> : <Plus className="mr-1.5" size={14} />}
            挖掘并接入网络
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-4 h-full relative" ref={containerRef}>
        <div className={`transition-all duration-300 bg-white border border-stone-300 rounded-xl shadow-sm overflow-hidden relative ${selectedNode ? 'w-2/3' : 'w-full'}`}>
          {!data || !data.nodes || data.nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-stone-400 font-serif">
              暂无原著人物关系数据，请在上方输入角色名并点击挖掘
            </div>
          ) : (
            <svg className="w-full h-full" ref={svgRef}></svg>
          )}
          {generating && (
            <div className="absolute inset-0 bg-stone-50/70 backdrop-blur-sm flex items-center justify-center flex-col z-10 transition-opacity rounded-xl">
              <Loader className="animate-spin text-stone-800 mb-3" size={32} />
              <p className="text-stone-800 font-medium text-sm font-display tracking-widest">查阅大学士编年史中...</p>
            </div>
          )}
        </div>

        {selectedNode && (
          <div className="w-1/3 bg-[#fcfaf2] border border-stone-300 rounded-xl shadow-md p-6 flex flex-col relative animate-in slide-in-from-right-8 duration-300">
            <button 
               onClick={() => setSelectedNode(null)} 
               className="absolute top-4 right-4 text-stone-400 hover:text-stone-700"
            >
               <X size={18} />
            </button>
            <div className="mb-4">
              <span className="px-2 py-1 bg-amber-100 text-amber-800 text-[10px] uppercase font-bold tracking-wider rounded-sm shadow-sm">{selectedNode.group || "未知势力"}</span>
            </div>
            <h3 className="text-2xl font-display font-bold text-stone-900 mb-1">{selectedNode.name}</h3>
            <p className="text-xs text-stone-500 font-mono mb-6">{selectedNode.id}</p>
            
            <div className="flex-1 overflow-y-auto">
              <div className="prose prose-stone prose-sm">
                <p className="font-serif text-stone-800 leading-relaxed whitespace-pre-wrap">
                  {selectedNode.desc || "史书中并未找到该角色的详细记载。"}
                </p>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-stone-200">
              <button 
                 onClick={() => {
                   setSearchName(selectedNode.name); 
                   handleGenerate();
                 }}
                 disabled={generating}
                 className="w-full py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 font-medium rounded-lg transition-colors border border-stone-300 shadow-sm flex items-center justify-center gap-2"
              >
                 <Search size={16} /> 以此人为核心深入挖掘
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
