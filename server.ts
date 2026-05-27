import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import fs from "fs/promises";
import { spawn, ChildProcess } from "child_process";
import cors from "cors";
import { GoogleGenAI } from "@google/genai";

// Optional utility if we need it for force-killing processes on Windows
import kill from "tree-kill";

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Process Management
let engineProcess: ChildProcess | null = null;
const logFile = path.resolve(process.cwd(), "logs/engine_latest.log");
const configPath = path.resolve(process.cwd(), "config.json");
const prioritiesPath = path.resolve(process.cwd(), "character_priorities.json");

// Utility to get active NPC Path
async function getActiveNpcPath() {
    let configStr = "{}";
    try { configStr = await fs.readFile(configPath, "utf-8"); } catch(e){}
    const config = JSON.parse(configStr);
    let basePath = config.base_path || "";
    
    if (process.platform !== "win32" && (basePath.startsWith("E:") || basePath.startsWith("C:") || basePath.includes("\\"))) {
        basePath = path.join(process.cwd(), "save_data");
    }
    
    // Check if the basePath ITSELF is a campaign directory (e.g. it directly contains npc_lives or .json character files)
    try {
        const hasNpcLives = await fs.access(path.join(basePath, "npc_lives")).then(() => true).catch(() => false);
        let hasJsonFiles = false;
        try {
            const files = await fs.readdir(basePath);
            hasJsonFiles = files.some(f => f.endsWith(".json") && f !== "engine_state.json" && f !== "config.json" && f !== "character_priorities.json");
        } catch(e) {}
        
        if (hasNpcLives || hasJsonFiles) {
            return basePath; // The provided path is already the valid campaign folder
        }
    } catch(e) {}

    let campaignPath = path.join(basePath, "simulator_mode");
    try {
       const dirs = await fs.readdir(basePath, { withFileTypes: true });
       const validDirs = dirs.filter(d => d.isDirectory() && d.name !== 'simulator_mode' && d.name !== 'logs');
       if (validDirs.length > 0) {
           // Get stats to find latest
           let latestDir = validDirs[0].name;
           let maxTime = 0;
           for (const dir of validDirs) {
               try {
                   const stats = await fs.stat(path.join(basePath, dir.name));
                   if (stats.mtimeMs > maxTime) {
                       maxTime = stats.mtimeMs;
                       latestDir = dir.name;
                   }
               } catch(e) {}
           }
           campaignPath = path.join(basePath, latestDir);
       }
    } catch(e) {
       // fallback
    }
    return campaignPath;
}

// API Routes
const PROMPT_CONFIG_FILE = path.join(process.cwd(), "prompt_config.json");

async function resolveCharacterId(campaignPath: string, targetId: string) {
    let exactPath = path.join(campaignPath, `${targetId}.json`);
    try {
        await fs.access(exactPath);
        return { filePath: exactPath, id: targetId.replace(/[\\/:*?"<>|]/g, '_'), exists: true };
    } catch {
        const files = await fs.readdir(campaignPath).catch(() => []);
        for (const file of files) {
            if (file.endsWith(".json")) {
                const tempPath = path.join(campaignPath, file);
                try {
                    const tempJson = JSON.parse(await fs.readFile(tempPath, "utf-8"));
                    const fileName = file.toLowerCase().replace(".json", "");
                    const charName = (tempJson.Name || "").toLowerCase();
                    const charStringId = (tempJson.StringId || "").toLowerCase();
                    const searchName = targetId.toLowerCase();

                    const isMatch = fileName.includes(searchName) || searchName.includes(fileName) ||
                        (charName && (charName.includes(searchName) || searchName.includes(charName))) ||
                        (charStringId && (charStringId.includes(searchName) || searchName.includes(charStringId)));

                    if (isMatch) {
                        return { filePath: tempPath, id: file.replace(".json", "").replace(/[\\/:*?"<>|]/g, '_'), exists: true };
                    }
                } catch(err) {}
            }
        }
    }
    return { filePath: exactPath, id: targetId.replace(/[\\/:*?"<>|]/g, '_'), exists: false };
}

app.get("/api/prompt_config", async (req, res) => {
  try {
    const data = await fs.readFile(PROMPT_CONFIG_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      res.json({ blocks: [], system_prompt: "" });
    } else {
      res.status(500).json({ error: e.message || "Failed to load prompt config" });
    }
  }
});

app.post("/api/prompt_config", async (req, res) => {
  try {
    await fs.writeFile(PROMPT_CONFIG_FILE, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to save prompt config" });
  }
});

const LORE_RELATIONS_FILE = path.join(process.cwd(), "lore_relations.json");

app.get("/api/relations", async (req, res) => {
  try {
    const data = await fs.readFile(LORE_RELATIONS_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      res.json({ nodes: [], links: [] });
    } else {
      res.status(500).json({ error: e.message || "Failed to load lore relations" });
    }
  }
});

app.post("/api/relations", async (req, res) => {
  try {
    await fs.writeFile(LORE_RELATIONS_FILE, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to save lore relations" });
  }
});

app.post("/api/relations/generate", async (req, res) => {
  try {
    const { character_name } = req.body;
    if (!character_name) return res.status(400).json({ error: "Name required" });

    const configStr = await fs.readFile(configPath, "utf-8");
    const configObj = JSON.parse(configStr);

    const apiKey = configObj.relations_api_key || configObj.utils_api_key || configObj.api_key;
    const reqBaseUrl = configObj.relations_base_url || configObj.utils_base_url || configObj.base_url || "https://api.deepseek.com";
    const apiUrl = reqBaseUrl.endsWith('/') ? `${reqBaseUrl}chat/completions` : `${reqBaseUrl}/chat/completions`;
    const model = configObj.relations_model || configObj.utils_model || configObj.model || "deepseek-chat";

    if (!apiKey) throw new Error("No API key configured for relations generation.");

    let promptTemplate = configObj.relations_prompt || `你是一个《冰与火之歌》(权力的游戏)百科专家。请梳理【{character_name}】的核心人物关系网（包含本人以及5-10个最关键的亲属、盟友或敌人）。请严格以JSON格式输出，不要有任何多余的解释、不要加markdown包裹、不要其他任何文本。输出必须符合如下结构：
{
  "nodes": [
    {"id": "英文缩写", "name": "中文全名", "group": "所属中文势力/家族", "desc": "100-200字的该角色原著考据与性格简述"}
  ],
  "links": [
    {"source": "源节点id", "target": "目标节点id", "label": "中文关系描述文本", "value": 1}
  ]
}`;
    const prompt = promptTemplate.replace(/{character_name}/g, character_name);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model,
        messages: [{ role: "user", content: prompt }]
      })
    });

    const data: any = await response.json();
    if (!data.choices || !data.choices[0]) throw new Error("API返回错误: " + JSON.stringify(data));

    let content = data.choices[0].message.content.trim();
    if (content.startsWith("```json")) {
      content = content.replace(/^```json/, "").replace(/```$/, "").trim();
    } else if (content.startsWith("```")) {
      content = content.replace(/^```/, "").replace(/```$/, "").trim();
    }

    const aiRes = JSON.parse(content);
    
    // Save generated descriptions automatically to lore files
    try {
      const campaignPath = await getActiveNpcPath();
      const files = await fs.readdir(campaignPath).catch(() => []);
      for (const node of aiRes.nodes) {
        if (node.desc && typeof node.desc === 'string') {
          let matchedName = (node.name || node.id).replace(/\s*\(.*?\)/g, "").trim();
          
          // Fuzzy match to find the true character Name to store under the correct folder
          const searchTargets = [node.name.toLowerCase(), node.id.toLowerCase()];
          for (const file of files) {
             if (!file.endsWith(".json")) continue;
             try {
                const tempPath = path.join(campaignPath, file);
                const tempJson = JSON.parse(await fs.readFile(tempPath, "utf-8"));
                const charName = (tempJson.Name || "").toLowerCase();
                const charStringId = (tempJson.StringId || "").toLowerCase();
                const fileName = file.toLowerCase().replace(".json", "");
                
                let found = false;
                for (const st of searchTargets) {
                   if (fileName.includes(st) || st.includes(fileName) ||
                      (charName && (charName.includes(st) || st.includes(charName))) ||
                      (charStringId && (charStringId.includes(st) || st.includes(charStringId)))) {
                      found = true; break;
                   }
                }
                if (found && tempJson.Name) {
                   matchedName = tempJson.Name.replace(/\s*\(.*?\)/g, "").trim();
                   break;
                }
             } catch(e) {}
          }
          
          const charFolder = path.join(campaignPath, "npc_lives", matchedName);
          const loreFile = path.join(charFolder, "lore.txt");
          await fs.mkdir(charFolder, { recursive: true });
          try {
            await fs.access(loreFile); // If exists, do not overwrite to respect manual edits
          } catch {
            await fs.writeFile(loreFile, node.desc, "utf-8"); // Write background/personality to lore.txt
          }
        }
      }
    } catch (e) {
       console.error("Failed to auto-save lore from relations:", e);
    }

    // Load current
    let currentRelations = { nodes: [], links: [] };
    try {
      const crObj = await fs.readFile(LORE_RELATIONS_FILE, "utf-8");
      currentRelations = JSON.parse(crObj);
    } catch (e) {}

    // Merge logic
    const existingNodeIds = new Set(currentRelations.nodes.map((n: any) => n.id));
    for (const node of aiRes.nodes) {
      if (!existingNodeIds.has(node.id)) {
        currentRelations.nodes.push(node as never);
        existingNodeIds.add(node.id);
      }
    }

    const existingLinks = new Set(currentRelations.links.map((l: any) => `${l.source}-${l.target}`));
    for (const link of aiRes.links) {
      const id1 = `${link.source}-${link.target}`;
      const id2 = `${link.target}-${link.source}`; // to avoid duplicates
      if (!existingLinks.has(id1) && !existingLinks.has(id2)) {
        currentRelations.links.push(link as never);
        existingLinks.add(id1);
      }
    }

    await fs.writeFile(LORE_RELATIONS_FILE, JSON.stringify(currentRelations, null, 2), "utf-8");
    res.json(currentRelations);

  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to generate relations" });
  }
});

app.get("/api/realm/status", async (req, res) => {
  try {
    const REALM_FILE = path.join(process.cwd(), "realm_status.json");
    const data = await fs.readFile(REALM_FILE, "utf-8");
    res.json(JSON.parse(data));
  } catch (e: any) {
    if (e.code === "ENOENT") {
      res.json({ reports: [] });
    } else {
      res.status(500).json({ error: e.message || "Failed to load realm status" });
    }
  }
});

app.post("/api/realm/generate", async (req, res) => {
  try {
    const configStr = await fs.readFile(configPath, "utf-8");
    const configObj = JSON.parse(configStr);

    const apiKey = configObj.realm_api_key || configObj.api_key;
    const reqBaseUrl = configObj.realm_base_url || configObj.base_url || "https://api.deepseek.com";
    const apiUrl = reqBaseUrl.endsWith('/') ? `${reqBaseUrl}chat/completions` : `${reqBaseUrl}/chat/completions`;
    const model = configObj.realm_model || configObj.model || "deepseek-chat";

    if (!apiKey) throw new Error("No API key configured for realm generation.");

    // Retrieve some logs
    let recentEvents = "无近期事件记录...";
    try {
      const basePath = configObj.base_path;
      if (basePath) {
        const eventsPath = path.join(basePath, "dynamic_events.json");
        const eventsStr = await fs.readFile(eventsPath, "utf-8");
        const evList = JSON.parse(eventsStr);
        // It might be an array of strings or objects. We handle both just in case:
        if (Array.isArray(evList)) {
          recentEvents = evList.slice(-20).map(e => typeof e === 'string' ? e : JSON.stringify(e)).join("\n");
        }
      }
    } catch(e) {
      // Fallback
      try {
        const logsPath = path.join(process.cwd(), "logs.json");
        const logsStr = await fs.readFile(logsPath, "utf-8");
        const logs = JSON.parse(logsStr).slice(0, 20);
        recentEvents = logs.map((l: any) => `[${l.timestamp}] ${l.npcName}: ${l.action} - ${l.details}`).join("\n");
      } catch(ex) {}
    }

    const promptTemplate = configObj.realm_prompt || `你是一位撰写《维斯特洛纪事》的学士。请根据下方提供的【最近发生的世界事件日志】，用充满史诗和奇幻学术风格的口吻，生成 2 - 3 条宏观世界局势总结汇报。
必须以强类型的 JSON 数组格式返回，必须符合如下结构，不要包含多余文本：
{
  "reports": [
    {
      "date": "如: 几天前 / 299年月",
      "title": "中文标题记录",
      "content": "记录的详细内容(描述生动有画面感，包含不同阵营动向)",
      "type": "war"
    }
  ]
}

【最近的世界事件如下】:
{recent_events}`;

    const prompt = promptTemplate.replace(/{recent_events}/g, recentEvents);

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model, messages: [{ role: "user", content: prompt }] })
    });
    const data: any = await response.json();
    if (!data.choices || !data.choices[0]) throw new Error("API返回错误: " + JSON.stringify(data));

    let content = data.choices[0].message.content.trim();
    if (content.startsWith("```json")) content = content.replace(/^```json/, "").replace(/```$/, "").trim();
    else if (content.startsWith("```")) content = content.replace(/^```/, "").replace(/```$/, "").trim();

    const parsed = JSON.parse(content);
    const REALM_FILE = path.join(process.cwd(), "realm_status.json");
    
    let existingReports = [];
    try {
      const existingData = await fs.readFile(REALM_FILE, "utf-8");
      const existingJson = JSON.parse(existingData);
      if (existingJson.reports && Array.isArray(existingJson.reports)) {
        existingReports = existingJson.reports;
      }
    } catch(e) {}
    
    const finalReports = [...(parsed.reports || []), ...existingReports];
    await fs.writeFile(REALM_FILE, JSON.stringify({ reports: finalReports }, null, 2), "utf-8");
    res.json({ reports: finalReports });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to generate realm history" });
  }
});

app.post("/api/maiden/chat", async (req, res) => {
  try {
    const { messages } = req.body;
    
    const configStr = await fs.readFile(configPath, "utf-8");
    const configObj = JSON.parse(configStr);

    const apiKey = configObj.maiden_api_key || configObj.api_key;
    const reqBaseUrl = configObj.maiden_base_url || configObj.base_url || "https://api.deepseek.com";
    const apiUrl = reqBaseUrl.endsWith('/') ? `${reqBaseUrl}chat/completions` : `${reqBaseUrl}/chat/completions`;
    const model = configObj.maiden_model || configObj.model || "deepseek-chat";

    if (!apiKey) throw new Error("No API key configured for maiden.");

    // Retrieve some logs
    let recentEvents = "无近期事件记录...";
    try {
      const basePath = configObj.base_path;
      if (basePath) {
        const eventsPath = path.join(basePath, "dynamic_events.json");
        const eventsStr = await fs.readFile(eventsPath, "utf-8");
        const evList = JSON.parse(eventsStr);
        if (Array.isArray(evList)) {
          recentEvents = evList.slice(-15).map(e => typeof e === 'string' ? e : JSON.stringify(e)).join("\n");
        }
      }
    } catch(e) {
      // Fallback
      try {
        const logsPath = path.join(process.cwd(), "logs.json");
        const logsStr = await fs.readFile(logsPath, "utf-8");
        const logs = JSON.parse(logsStr).slice(0, 15);
        recentEvents = logs.map((l: any) => `[${l.timestamp}] ${l.npcName}: ${l.action} - ${l.details}`).join("\n");
      } catch(ex) {}
    }

    // Retrieve character thoughts
    let thoughtsText = "";
    try {
      const campaignPath = await getActiveNpcPath();
      const files = await fs.readdir(campaignPath).catch(() => []);
      
      const charThoughtsList = [];
      for (const file of files) {
        if (file.endsWith(".json")) {
           try {
              const data = await fs.readFile(path.join(campaignPath, file), "utf-8");
              const json = JSON.parse(data);
              const npcStringId = file.replace(".json", "");
              const privateStateFile = path.join(campaignPath, "npc_lives", npcStringId, "private_state.json");
              try {
                  const privateData = await fs.readFile(privateStateFile, "utf-8");
                  const privateJson = JSON.parse(privateData);
                  if (privateJson.SecretDiaries) {
                     const keys = Object.keys(privateJson.SecretDiaries);
                     if (keys.length > 0) {
                        const latestKey = keys[keys.length - 1];
                        let content = privateJson.SecretDiaries[latestKey];
                        // Clean it up a bit if it's too long
                        if (content.length > 600) content = content.substring(0, 600) + "...";
                        charThoughtsList.push(`[${json.Name || json.StringId}] 祈祷/静思预兆：\n${content}`);
                     }
                   }
              } catch(pex) {}
           } catch(e){}
        }
      }
      
      if (charThoughtsList.length > 0) {
          thoughtsText = "\n\n【众生近期祈祷/静思卷宗(预言神力读取)】：\n" + charThoughtsList.slice(-15).join("\n");
      }
    } catch(e) {}

    const defaultPrompt = `你是一位侍奉七神的圣女。你的职责是倾听玩家的烦恼，结合最近发生的事件日志为玩家提供发展方向和角色交互建议。用温柔、关怀的口吻回答。
【最近的世界事件如下】:
{recent_events}`;
    const sysPromptTemplate = configObj.maiden_prompt || defaultPrompt;
    const sysPrompt = sysPromptTemplate.replace(/{recent_events}/g, recentEvents + thoughtsText);

    const fullMessages = [
      { role: "system", content: sysPrompt },
      ...messages
    ];

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model, messages: fullMessages })
    });
    
    const data: any = await response.json();
    if (!data.choices || !data.choices[0]) throw new Error("API返回错误: " + JSON.stringify(data));

    res.json({ reply: data.choices[0].message.content.trim() });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Holy maiden is unavailable" });
  }
});

app.get("/api/config", async (req, res) => {
  try {
    const data = await fs.readFile(configPath, "utf-8");
    res.json(JSON.parse(data));
  } catch (e) {
    if (e.code === "ENOENT") {
      res.json({});
    } else {
      res.status(500).json({ error: "Failed to read config" });
    }
  }
});

app.post("/api/config", async (req, res) => {
  try {
    await fs.writeFile(configPath, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to write config" });
  }
});

app.get("/api/priorities", async (req, res) => {
  try {
    const data = await fs.readFile(prioritiesPath, "utf-8");
    res.json(JSON.parse(data));
  } catch (e) {
    if (e.code === "ENOENT") {
      res.json({});
    } else {
      res.status(500).json({ error: "Failed to read priorities" });
    }
  }
});

app.post("/api/priorities", async (req, res) => {
  try {
    await fs.writeFile(prioritiesPath, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Failed to write priorities" });
  }
});

// Character Discovery & Operations
app.get("/api/characters", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const files = await fs.readdir(campaignPath).catch(() => []);
    const characters = [];
    
    const engineStatePath = path.join(campaignPath, "engine_state.json");
    let stateData = {};
    try {
        stateData = JSON.parse(await fs.readFile(engineStatePath, "utf-8"));
    } catch(e) {}
    
    for (const file of files) {
      if (file.endsWith(".json")) {
        const filePath = path.join(campaignPath, file);
        try {
          const data = await fs.readFile(filePath, "utf-8");
          const json = JSON.parse(data);
          if (json.StringId) {
             const charState = stateData[json.StringId] || {};
             characters.push({
                id: file.replace(".json", ""),
                name: json.Name || json.StringId,
                mood: json.EmotionalState?.Mood || "calm",
                location: json.LocationType || "Unknown",
                partySize: json.NPCForces?.PartySize || 0,
                status: charState.status || "idle",
                hasPersonality: !!json.AIGeneratedPersonality
             });
          }
        } catch(e) {}
      }
    }
    res.json({ characters, campaignPath });
  } catch (e) {
    res.json({ characters: [], error: e.message });
  }
});

app.get("/api/characters/:id", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const targetId = req.params.id;
    const resolved = await resolveCharacterId(campaignPath, targetId);
    
    if (!resolved.exists) {
      return res.json({ 
        json: {
          StringId: targetId,
          Name: targetId,
          AIGeneratedPersonality: "",
        },
        state: {},
        isVirtual: true
      });
    }

    const data = await fs.readFile(resolved.filePath, "utf-8");
    const jsonData = JSON.parse(data);
    
    // Also read engine_state.json if available
    const engineStatePath = path.join(campaignPath, "engine_state.json");
    let stateData: any = {};
    try {
        stateData = JSON.parse(await fs.readFile(engineStatePath, "utf-8"));
    } catch(e) {}
    
    // The exact id key might be original targetId or the found one, but since we parsed it we can use its StringId or filename
    const actualId = path.basename(resolved.filePath, ".json");

    res.json({ 
       json: jsonData,
       state: stateData[actualId] || {}
    });
  } catch(e: any) {
    res.status(404).json({ error: e.message || "Character not found" });
  }
});

app.post("/api/characters/:id", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    
    await fs.writeFile(resolved.filePath, JSON.stringify(req.body, null, 2), "utf-8");
    res.json({ success: true });
  } catch(e) {
    res.status(500).json({ error: "Failed to update character JSON" });
  }
});

app.post("/api/characters/:id/send_message", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    if (!resolved.exists) {
      return res.status(404).json({ error: "Character not found" });
    }
    
    const { message } = req.body;
    if (!message) {
       return res.status(400).json({ error: "Message is required" });
    }
    
    const outboxDir = path.join(campaignPath, "npc_lives", "outbox");
    await fs.mkdir(outboxDir, { recursive: true });
    
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, '0');
    const dateStr = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}`;
    const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
    
    const outboxFileName = `${resolved.id}_${dateStr}_${timeStr}.txt`;
    await fs.writeFile(path.join(outboxDir, outboxFileName), message, "utf-8");
    res.json({ success: true });
  } catch(e: any) {
    res.status(500).json({ error: e.message || "Failed to send message" });
  }
});

app.post("/api/characters/:id/generate_personality", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    let jsonData: any = { Name: req.params.id, StringId: req.params.id };
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    
    if (resolved.exists) {
      const data = await fs.readFile(resolved.filePath, "utf-8");
      jsonData = JSON.parse(data);
    }

    let configObj: any = { api_key: "", base_url: "", model: "" };
    try {
      const configStr = await fs.readFile(configPath, "utf-8");
      configObj = JSON.parse(configStr);
    } catch(e) {}

    const prompt = `You are an expert on George R. R. Martin's A Song of Ice and Fire universe, as well as Mount & Blade modding. The player is playing an ASOIAF related mod.
Please generate the comprehensive personality and backstory for the following character:
Name: ${jsonData.Name}
StringId: ${jsonData.StringId}
Gender: ${jsonData.Gender || 'unknown'}

Important Context: This is for a Mount & Blade mod setting. The time might be slightly altered (e.g., player can meet Daenerys earlier or later than books).

Respond ONLY with a valid JSON object matching this schema. Do not include markdown code blocks or any other text.
{
  "AIGeneratedPersonality": "Detailed paragraph about their psychology, motivations, fears, and core values.",
  "AIGeneratedBackstory": "Detailed paragraph about their past, key life events up to their current status, and significant relationships.",
  "AIGeneratedSpeechQuirks": "One or two sentences describing how they speak (e.g. archaic structures, specific metaphors, tone)."
}`;

    let resultText = "{}";

    const apiKey = configObj.utils_api_key || configObj.api_key;
    if (apiKey) {
      const tBaseUrl = configObj.utils_base_url || configObj.base_url || "https://api.deepseek.com";
      const apiUrl = tBaseUrl.endsWith('/') ? `${tBaseUrl}chat/completions` : `${tBaseUrl}/chat/completions`;
      const aiModel = configObj.utils_model || configObj.model || "deepseek-chat";

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: aiModel,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 2500
        })
      });

      if (!response.ok) {
         const errText = await response.text();
         throw new Error("API response failed: " + errText);
      }
      const responseData = await response.json();
      resultText = responseData.choices?.[0]?.message?.content;
      if (!resultText) {
          if (responseData.choices?.[0]?.finish_reason === "length") {
              throw new Error("AI 生成被截断 (finish_reason: length). 请检查 Max Tokens 配置或稍后重试。响应数据: " + JSON.stringify(responseData));
          } else {
              throw new Error("API 返回了空内容。响应数据: " + JSON.stringify(responseData));
          }
      }
    } else {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "No API Key configured. Please go to Settings to add one, or provide GEMINI_API_KEY." });
      }
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
        }
      });
      resultText = response.text() || "{}";
    }

    // Strip markdown if the AI didn't follow instructions
    if (resultText.includes("```json")) {
      const match = resultText.match(/```json\n([\s\S]*?)\n```/);
      if (match) resultText = match[1];
    } else if (resultText.includes("```")) {
      const match = resultText.match(/```\n([\s\S]*?)\n```/);
      if (match) resultText = match[1];
    }

    const generated = JSON.parse(resultText);

    jsonData.AIGeneratedPersonality = generated.AIGeneratedPersonality || jsonData.AIGeneratedPersonality;
    jsonData.AIGeneratedBackstory = generated.AIGeneratedBackstory || jsonData.AIGeneratedBackstory;
    jsonData.AIGeneratedSpeechQuirks = generated.AIGeneratedSpeechQuirks || jsonData.AIGeneratedSpeechQuirks;

    await fs.writeFile(filePath, JSON.stringify(jsonData, null, 2), "utf-8");
    
    res.json({ success: true, updated: generated });
  } catch(e: any) {
    console.error("Failed to generate personality:", e);
    res.status(500).json({ error: e.message || "Failed to generate personality" });
  }
});

app.get("/api/lore/:id", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    const id = resolved.id;
    const charFolder = path.join(campaignPath, "npc_lives", id);
    const loreFile = path.join(charFolder, "lore.txt");

    try {
      await fs.access(loreFile);
      const cachedLore = await fs.readFile(loreFile, "utf-8");
      return res.json({ lore: cachedLore, cached: true });
    } catch (err) {
      if (req.query.force !== "1") {
        return res.json({ lore: "" });
      }
    }

    let configObj: any = { api_key: "", base_url: "", model: "" };
    try {
      const configStr = await fs.readFile(configPath, "utf-8");
      configObj = JSON.parse(configStr);
    } catch(e) {}

    const apiKey = configObj.utils_api_key || configObj.api_key;
    let text = "";
    if (apiKey) {
      const tBaseUrl = configObj.utils_base_url || configObj.base_url || "https://api.deepseek.com";
      const apiUrl = tBaseUrl.endsWith('/') ? `${tBaseUrl}chat/completions` : `${tBaseUrl}/chat/completions`;

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: configObj.utils_model || configObj.model || "deepseek-chat",
          messages: [
            {
              role: "system",
              content: "你是一个专业的《冰与火之歌》(权力的游戏)世界百科专家。如果请求的名字是维斯特洛或厄斯索斯的原著角色，请用200-300字简短介绍其身份、家族、核心性格和宿命。如果是边缘人或MOD原创人物，请合理推测其背景。用中文回答，风格专业沉浸。"
            },
            { role: "user", content: `请求关于这个角色的档案：${id}` }
          ],
          temperature: 0.3,
          max_tokens: 1500
        })
      });

      if (!response.ok) {
         const errText = await response.text();
         return res.status(response.status).json({ error: "Citadel API response failed: " + errText });
      }

      const responseData = await response.json();
      text = responseData.choices?.[0]?.message?.content;
      if (!text) {
         if (responseData.choices?.[0]?.finish_reason === "length") {
            text = "人物考据信息过长，请求被截断。请稍后重试或尝试补齐。";
         } else {
            text = "暂无详细的考据数据。";
         }
      }
    } else if (process.env.GEMINI_API_KEY) {
       const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
       const prompt = `你是一个专业的《冰与火之歌》(权力的游戏)世界百科专家。如果请求的名字是维斯特洛或厄斯索斯的原著角色，请用200-300字简短介绍其身份、家族、核心性格和宿命。如果是边缘人或MOD原创人物，请合理推测其背景。用中文回答，风格专业沉浸。\n\n请求关于这个角色的档案：${id}`;
       const response = await ai.models.generateContent({
         model: "gemini-2.5-flash",
         contents: prompt
       });
       text = response.text();
       if (!text) {
         return res.status(500).json({ error: "Gemini API returned empty response" });
       }
    } else {
      const isStark = id.toLowerCase().includes("stark") || id.toLowerCase().includes("brian") || id.toLowerCase().includes("ned");
      const isLannister = id.toLowerCase().includes("lannister") || id.toLowerCase().includes("tyrion") || id.toLowerCase().includes("jaime") || id.toLowerCase().includes("cersei");
      const isTargaryen = id.toLowerCase().includes("targaryen") || id.toLowerCase().includes("daenerys") || id.toLowerCase().includes("jon");
      const isBaratheon = id.toLowerCase().includes("baratheon") || id.toLowerCase().includes("robert") || id.toLowerCase().includes("stannis") || id.toLowerCase().includes("renly");
      
      if (isStark) {
        text = `临冬城的史塔克家族成员。北境的守护者，流淌着古老先民的血液，以极其崇尚荣誉与传统而闻名。面对南方的君主与权谋之争，史塔克家族始终守护着绝境长城。他们坚信：资产凛冬将至，而孤狼必死，群狼生还。`;
      } else if (isLannister) {
        text = `凯岩城的兰尼斯特家族成员。西境的最高宰制者，控制高昂的黄金矿脉，以骇人财富和极端的政治手腕闻名。他们的族语是『听我怒吼』，但维斯特洛世人更深知他们的另一句非官方名言：『兰尼斯特有债必偿』。`;
      } else if (isTargaryen) {
        text = `坦格利安家族的血脉传人。古瓦雷利亚帝国遗留的真龙血统，曾以三条巨龙横扫七大王国，建立了三百年的铁王座帝国。他们的族语是『血火同源』。其后裔在流亡与复仇的火焰中淬炼，图谋重新登上维斯特洛之巅。`;
      } else if (isBaratheon) {
        text = `风息堡的拜拉席恩家族成员。风暴地的最高统治者，族徽为冠冕黑鹿，族语『怒火燎原』。自篡夺者战争后，由于血脉之争与皇权碎裂，其家族三兄弟各立山头，掀起五王之战的血雨腥风。`;
      } else {
        text = `维斯特洛大陆上的传奇子民。在旧神与七神的注视下，生存在风云变幻的列王纷争时代。面对来自冰冷北疆的低语和各大家族权力的游戏，他们在大历史的浪潮中，书写属于骑士、学士或平民的独特篇章。`;
      }
    }

    await fs.mkdir(charFolder, { recursive: true });
    await fs.writeFile(loreFile, text, "utf-8");
    res.json({ lore: text });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to fetch lore" });
  }
});

// Update specific character's Lore overridden by user in UI
app.post("/api/characters/:id/lore", async (req, res) => {
  try {
    const { lore } = req.body;
    const campaignPath = await getActiveNpcPath();
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    const id = resolved.id;
    const charFolder = path.join(campaignPath, "npc_lives", id);
    await fs.mkdir(charFolder, { recursive: true });
    await fs.writeFile(path.join(charFolder, "lore.txt"), lore, "utf-8");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to write lore override" });
  }
});

// Classified Secrets endpoints
app.get("/api/characters/:id/secrets", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    const id = resolved.id;
    const secretsFile = path.join(campaignPath, "npc_lives", id, "secrets_registry.json");
    try {
      await fs.access(secretsFile);
      const data = await fs.readFile(secretsFile, "utf-8");
      res.json(JSON.parse(data));
    } catch (e) {
      res.json({ secrets: [] });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to read secrets" });
  }
});

app.post("/api/characters/:id/secrets", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    const id = resolved.id;
    const charFolder = path.join(campaignPath, "npc_lives", id);
    await fs.mkdir(charFolder, { recursive: true });
    await fs.writeFile(
      path.join(charFolder, "secrets_registry.json"),
      JSON.stringify(req.body, null, 2),
      "utf-8"
    );
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to write secrets" });
  }
});

// Prompt cache validation endpoints
app.get("/api/characters/:id/prompt_diff", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    const cleanId = resolved.id;
    const pendingFile = path.join(campaignPath, "npc_lives", cleanId, "pending_static_diff.json");
    try {
      const data = await fs.readFile(pendingFile, "utf-8");
      res.json(JSON.parse(data));
    } catch(e) {
      res.json({ error: "No pending prompt diff" });
    }
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to fetch diff" });
  }
});

app.post("/api/characters/:id/prompt_diff/approve", async (req, res) => {
  try {
    const campaignPath = await getActiveNpcPath();
    const resolved = await resolveCharacterId(campaignPath, req.params.id);
    const cleanId = resolved.id;
    const forceSendFile = path.join(campaignPath, "npc_lives", cleanId, "force_send_static.txt");
    await fs.writeFile(forceSendFile, "approve", "utf-8");
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Failed to approve prompt diff" });
  }
});

app.get("/api/engine/status", (req, res) => {
  res.json({
    running: !!engineProcess && !engineProcess.killed,
    pid: engineProcess?.pid || null,
  });
});

app.post("/api/engine/start", async (req, res) => {
  if (engineProcess && !engineProcess.killed) {
    return res.status(400).json({ error: "Engine is already running" });
  }

  try {
    // Ensure log dir exists
    await fs.mkdir("logs", { recursive: true });
    
    // Clear log file on fresh start
    await fs.writeFile(logFile, "", "utf-8");

    // Spawn Python process
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    engineProcess = spawn(pythonCmd, ["engine.py"], {
      cwd: process.cwd(),
      env: process.env,
    });
    
    engineProcess.stdout?.on("data", (data) => fs.appendFile(logFile, `STDOUT: ${data}\n`));
    engineProcess.stderr?.on("data", (data) => fs.appendFile(logFile, `STDERR: ${data}\n`));
    
    engineProcess.on("error", (err) => {
      console.error("Failed to start engine:", err);
    });

    engineProcess.on("exit", (code) => {
      console.log(`Engine exited with code ${code}`);
      engineProcess = null;
    });

    res.json({ success: true, pid: engineProcess.pid });
  } catch (e) {
    res.status(500).json({ error: "Failed to start engine" });
  }
});

app.post("/api/engine/stop", (req, res) => {
  if (!engineProcess) {
    return res.status(400).json({ error: "Engine is not running" });
  }

  // Use simple kill first
  engineProcess.kill("SIGTERM");
  engineProcess = null;
  res.json({ success: true });
});

app.get("/api/logs", async (req, res) => {
  try {
    const logs = await fs.readFile(logFile, "utf-8");
    res.send(logs);
  } catch (e) {
    res.send("");
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
