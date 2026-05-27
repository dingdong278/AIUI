import json
import logging
import os
import re
import sys
import shutil
import time
import hashlib
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any, Tuple
from logging.handlers import RotatingFileHandler

from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(iterable, **kwargs):
        return iterable

# ================= 动态配置 =================
def get_engine_config():
    import json
    from pathlib import Path
    cp = Path.cwd() / "config.json"
    if cp.exists():
        try:
            with open(cp, 'r', encoding='utf-8') as f: return json.load(f)
        except: pass
    return {}

_cfg = get_engine_config()
API_KEY = _cfg.get("api", {}).get("engine", {}).get("key") or _cfg.get("api_key") or os.getenv("DEEPSEEK_API_KEY", "sk-7d2a561839574a19823228d28ee3b355")
BASE_URL = _cfg.get("api", {}).get("engine", {}).get("url") or _cfg.get("base_url") or os.getenv("API_BASE_URL", "https://api.deepseek.com")
if "generativelanguage.googleapis.com" in BASE_URL:
    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
MODEL = _cfg.get("api", {}).get("engine", {}).get("model") or _cfg.get("model") or os.getenv("API_MODEL", "deepseek-v4-flash")

# 这些路径将在启动时根据实际存档 ID 自动确定
BASE_AIINFLUENCE = None
NPC_FOLDER: Path = None
OUR_FOLDER: Path = None

STATE_FILE = "engine_state.json"
DYNAMIC_EVENTS_FILE = "dynamic_events.json"
WORLD_EVENTS_SNAPSHOT = "world_events_snapshot.json"
KINGDOM_LEADERSHIP_FILE = "kingdom_leadership_history.json"
SETTLEMENT_INDEX_FILE = "settlement_index.json"

ANALYSIS_INTERVAL_DAYS = 7
MAX_COST_USD = 1.0

# 放宽了 Token 限制，允许角色进行长篇史诗输出
ROUND_OUTPUT_TOKEN_BUDGET = 500000  
VILLAGER_MAX_TOKENS_HIGH = 1500
DORMANT_THRESHOLD_ROUNDS = 6

PRICE_CACHE_HIT = 0.02 / 7.1
PRICE_PROMPT_MISS = 1.0 / 7.1
PRICE_COMPLETION = 2.0 / 7.1

CACHE_MISS_ANOMALY_THRESHOLD = 3000

EMOTION_TO_PORTRAIT = {
    "angry": "angry", "furious": "angry", "bitter": "angry",
    "worried": "worried", "anxious": "worried", "concerned": "worried",
    "melancholy": "melancholy", "sad": "melancholy", "sorrowful": "melancholy",
    "grieving": "melancholy",
    "determined": "determined", "resolute": "determined", "vigilant": "determined",
    "joyful": "joyful", "proud": "joyful", "happy": "joyful", "hopeful": "joyful",
    "calm": "calm", "content": "calm", "neutral": "calm",
}

# ================= 世界背景（固定前缀）=================
WORLD_CONTEXT = _cfg.get("prompts", {}).get("worldContext") or """[世界背景]
冰与火之歌世界（维斯特洛与厄斯索斯大陆）

大陆正处于中世纪封建与大混战时期。维斯特洛在旧王朝崩塌后，各大家族（史塔克、兰尼斯特、拜拉席恩等）争夺铁王座或割据一方；东方的厄斯索斯大陆则城邦林立、部分地区依然盛行奴隶买卖。古老的魔法正在觉醒，而绝境长城以北凛冬将至。唯一的生存法则就是铁、血与金龙（即金币）。

社会与生存现实：
- 阶级森严：纯粹封建制。领主与骑士以家族纹章和荣誉为依归；平民（农夫、铁匠、步卒）如同草芥，流离失所。
- 重商与危险：跨海贸易能带来高额利润。野外乡间遍布逃兵、自由游骑兵、佣兵团与强盗。雇佣兵效忠于能够付出最多金龙的主子。
- 极度现实：这里的权斗极为冷酷无情，几乎没有任何事情是透明的。暗流涌动，阴谋密布，连誓言也随时可能被撕毁。
"""

# ================= 日志 =================
g_id_to_name = {}

LOG_FILE = None
REPORT_FILE = None
logger = None

def setup_logging(verbose: bool = True):
    global logger, LOG_FILE, REPORT_FILE
    date_str = datetime.now().strftime('%Y%m%d')
    log_dir = Path("logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    LOG_FILE = log_dir / f"engine_latest.log"
    REPORT_FILE = log_dir / "report_latest.txt"
    
    logger = logging.getLogger("NPC_LifeEngine")
    logger.setLevel(logging.DEBUG)
    
    if logger.hasHandlers(): logger.handlers.clear()

    file_handler = logging.FileHandler(LOG_FILE, mode='a', encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    file_formatter = logging.Formatter('%(asctime)s %(levelname)-8s %(message)s', datefmt='%Y-%m-%d %H:%M:%S')
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)

    if verbose:
        console = logging.StreamHandler()
        console.setLevel(logging.INFO)
        console_formatter = logging.Formatter('[%(asctime)s] %(message)s', datefmt='%H:%M:%S')
        console.setFormatter(console_formatter)
        logger.addHandler(console)
    return logger

# ================= 费用追踪 =================
class CostTracker:
    def __init__(self, max_cost=MAX_COST_USD):
        self.cache_hit = self.cache_miss = self.output = 0
        self.max_cost = max_cost
    def add_usage(self, cache_hit_tokens, cache_miss_tokens, output_tokens):
        self.cache_hit += cache_hit_tokens; self.cache_miss += cache_miss_tokens; self.output += output_tokens
    def current_cost(self): return (self.cache_hit / 1e6) * PRICE_CACHE_HIT + (self.cache_miss / 1e6) * PRICE_PROMPT_MISS + (self.output / 1e6) * PRICE_COMPLETION
    def is_budget_exceeded(self): return self.current_cost() > self.max_cost
    def summary(self): cost = self.current_cost(); return f"累计费用 ≈ ${cost:.4f} (¥{cost*7.1:.4f})"
    def to_dict(self): return {"cache_hit": self.cache_hit, "cache_miss": self.cache_miss, "output": self.output}
    @classmethod
    def from_dict(cls, d, max_cost=MAX_COST_USD):
        obj = cls(max_cost)
        obj.cache_hit, obj.cache_miss, obj.output = d.get("cache_hit", 0), d.get("cache_miss", 0), d.get("output", 0)
        return obj

# ================= 基础工具 =================
def load_json(filepath: Path) -> dict:
    with open(filepath, 'r', encoding='utf-8') as f: return json.load(f)
def safe_load_json(filepath: Path, default=None):
    try: return load_json(filepath) if filepath.exists() else (default or {})
    except: return default or {}
def save_json(filepath: Path, data: dict):
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f: json.dump(data, f, indent=2, ensure_ascii=False)

def notify_sync(filepath: Path):
    if not NPC_FOLDER: return
    sync_file = NPC_FOLDER / "_chatsynco_sync.txt"
    abs_path = filepath.resolve().as_posix()
    with open(sync_file, 'w', encoding='utf-8') as f: f.write(abs_path)

def load_text(filepath: Path) -> str:
    with open(filepath, 'r', encoding='utf-8') as f: return f.read()
def save_text(filepath: Path, text: str):
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f: f.write(text)
def compute_hash(text: str) -> str: return hashlib.md5(text.encode('utf-8')).hexdigest()

def get_player_name() -> str:
    for f in list_npc_files(NPC_FOLDER):
        try:
            name = load_json(f).get("PlayerInfo", {}).get("RealName", "")
            if name: return name
        except: continue
    return "玩家"

# ================= 角色识别与索引 =================
def is_valid_npc_json(filepath: Path) -> bool:
    invalid_names = {"dynamic_events.json", "war_statistics.json", "diplomatic_events.json", "diplomatic_statements.json", "alliances.json", "trade_agreements.json", "territory_transfers.json", "tributes.json", "reparations.json", "kingdom_leadership_history.json", "analysis_results.txt", "pending_player_statements.json", "mod_settings.json", "campaign_info.json"}
    if filepath.name in invalid_names: return False
    try:
        data = load_json(filepath)
        return "StringId" in data and "PlayerInfo" in data
    except: return False

def list_npc_files(folder: Path) -> List[Path]: return [f for f in folder.glob("*.json") if is_valid_npc_json(f)]

def find_npc_json(npc_string_id: str) -> Optional[Path]:
    if not npc_string_id: return None
    save_dir = OUR_FOLDER.parent 
    direct_path = save_dir / f"{npc_string_id}.json"
    if direct_path.exists(): return direct_path
    pure_id_match = re.search(r'\(([^)]+)\)', npc_string_id)
    core_id = pure_id_match.group(1).strip() if pure_id_match else npc_string_id.strip()
    for json_file in save_dir.glob("*.json"):
        if f"({core_id})" in json_file.name or core_id == json_file.stem: return json_file
    return None

g_id_to_name, g_name_to_id, g_settlement_name_to_id, g_settlement_id_to_name, g_leaders_set = {}, {}, {}, {}, set()
g_name_to_faction = {}
g_faction_members = {}

def build_indices():
    g_id_to_name.clear(); g_name_to_id.clear(); g_leaders_set.clear()
    g_name_to_faction.clear(); g_faction_members.clear()
    
    meta_file = NPC_FOLDER / "meta_factions.json"
    if meta_file.exists():
        try:
            meta_data = load_json(meta_file)
            for name, faction in meta_data.items():
                g_name_to_faction[name] = faction
                if faction not in g_faction_members:
                    g_faction_members[faction] = set()
        except Exception as e:
            logger.error(f"Error loading meta_factions.json: {e}")

    for f in list_npc_files(NPC_FOLDER):
        try:
            d = load_json(f)
            name = d.get("Name")
            sid = d.get("StringId")
            if name and sid: 
                g_id_to_name[sid] = name
                g_name_to_id[name] = sid
                clean_name = re.sub(r'\s*\(.*?\)', '', name).strip()
                faction = g_name_to_faction.get(clean_name)
                if faction:
                    g_faction_members[faction].add(sid)
            
            # 防御性补充：如果文件名里带有带括号的大逃杀ID，也提取出来做备用映射
            pure = re.search(r'\(([^)]+)\)', f.stem)
            if pure and name:
                g_id_to_name[pure.group(1).strip()] = name
        except: continue
    
    kingdom_leadership_file = NPC_FOLDER / KINGDOM_LEADERSHIP_FILE
    if kingdom_leadership_file.exists():
        try:
            hist = safe_load_json(kingdom_leadership_file).get("leadershipHistory", {})
            for kd in hist.values():
                if kd.get("CurrentLeaderId"): g_leaders_set.add(kd["CurrentLeaderId"])
                for c in kd.get("LeadershipChanges", []):
                    if c.get("PreviousLeaderId"): g_leaders_set.add(c["PreviousLeaderId"])
                    if c.get("NewLeaderId"): g_leaders_set.add(c["NewLeaderId"])
        except: pass
    logger.info(f"索引加载完成: {len(g_id_to_name)} 角色, {len(g_leaders_set)} 统治者记录")

def resolve_receiver_id(raw_receiver: str) -> Optional[str]:
    text = re.sub(r'\s*(写信|的信|的信件|收$)\s*$', '', re.sub(r'^(给|致|寄给|To|to)\s*', '', raw_receiver.strip(), flags=re.IGNORECASE))
    match = re.search(r'(\w+_\d+(_\d+)?)', text)
    if match and match.group(1) in g_id_to_name: return match.group(1)
    b_match = re.search(r'\(([^)]+)\)', text)
    if b_match and b_match.group(1).strip() in g_id_to_name: return b_match.group(1).strip()
    name = re.sub(r'\([^)]*\)', '', text).strip()
    return g_name_to_id.get(name)

# ================= 文件夹管理 =================
def get_our_npc_folder(npc_string_id: str) -> Path:
    f = OUR_FOLDER / re.sub(r'[\\/:*?"<>|]', '_', npc_string_id)
    f.mkdir(parents=True, exist_ok=True)
    return f

def get_profile_path(npc_string_id: str) -> Path: return get_our_npc_folder(npc_string_id) / "profile.txt"
def get_memory_chain_path(npc_string_id: str) -> Path: return get_our_npc_folder(npc_string_id) / "memory_chain.txt"
def get_private_state_path(npc_string_id: str) -> Path: return get_our_npc_folder(npc_string_id) / "private_state.json"
def ensure_name_txt(npc_string_id: str, npc_name: str):
    name_file = get_our_npc_folder(npc_string_id) / "name.txt"
    if not name_file.exists(): save_text(name_file, npc_name)

# ================= 对话与事件增量 =================
def get_new_conversations_since(npc_json: dict, last_conv_count: int, engine_state: dict, npc_string_id: str) -> List[str]:
    convs = npc_json.get("ConversationHistory", [])
    if len(convs) <= last_conv_count: return []
    hashes = set(engine_state.get(npc_string_id, {}).get("_injected_hashes", []))
    return [c for c in convs[last_conv_count:] if compute_hash(c) not in hashes]

def get_new_events_since(npc_json: dict, last_seen_day: float) -> List[dict]:
    return [e for e in npc_json.get("RecentEvents", []) if e.get("EventTimeDays", 0) > last_seen_day]

def has_personality(npc_json: dict) -> bool: return bool(npc_json.get("AIGeneratedPersonality"))

def initialize_npc_profile(npc_json: dict, npc_string_id: str):
    name = npc_json.get("Name", "未知")
    profile = f"[角色底色]\n姓名: {name}\n性别: {npc_json.get('Gender', 'unknown')}\n"
    if has_personality(npc_json):
        profile += f"个性: {npc_json.get('AIGeneratedPersonality', '')}\n背景: {npc_json.get('AIGeneratedBackstory', '')}\n说话风格: {npc_json.get('AIGeneratedSpeechQuirks', '')}\n"
    save_text(get_profile_path(npc_string_id), profile)
    ensure_name_txt(npc_string_id, name)

def initialize_memory_chain(npc_json: dict, npc_string_id: str, current_day: float):
    chain = f"=== Day {int(current_day)} 初始化 ===\n"
    npc_name = npc_json.get('Name', npc_string_id)
    player_info = npc_json.get("PlayerInfo", {})
    target_name = player_info.get("ClaimedName") or player_info.get("RealName", "玩家")
    for c in npc_json.get("ConversationHistory", [])[-70:]: 
        text = c.strip()
        if text.startswith(f"{npc_name}:") or text.startswith(f"{npc_name}："): text = f"[{npc_name} 发送给 {target_name}] {text[len(npc_name)+1:].strip()}"
        elif text.startswith("Player:") or text.startswith("Player："): text = f"[{target_name} 发送给 {npc_name}] {text[7:].strip()}"
        elif text.startswith(f"{target_name}:") or text.startswith(f"{target_name}："): text = f"[{target_name} 发送给 {npc_name}] {text[len(target_name)+1:].strip()}"
        chain += f"[通信/对话] {text[:1500] + '...' if len(text)>1500 else text}\n"
    known_event_ids = npc_json.get("DynamicEvents", [])
    if known_event_ids:
        events_path = OUR_FOLDER.parent / "dynamic_events.json"
        all_events = safe_load_json(events_path, [])
        event_dict = {ev.get("id"): ev for ev in all_events if ev.get("id")}
        known_events_objs = [event_dict[eid] for eid in known_event_ids if eid in event_dict]
        known_events_sorted = sorted(known_events_objs, key=lambda x: x.get("creation_campaign_days", 0))
        for ev in known_events_sorted[-5:]:
            title = ev.get('title', '未知事件')
            desc = ev["event_history"][-1].get("description", "")[:150] if ev.get("event_history") else ev.get("description", "")[:150]
            chain += f"[世界大势] 标题：{title}。最新进展：{desc}...\n"
    save_text(get_memory_chain_path(npc_string_id), chain)

# ================= 全局宏观领袖情报提取 =================
def get_global_leadership_text(current_day: float) -> str:
    filepath = NPC_FOLDER / KINGDOM_LEADERSHIP_FILE
    if not filepath.exists(): return ""
    try:
        data = load_json(filepath)
        history = data.get("leadershipHistory", {})
        lines, changes = [], []
        for k_id, k_data in history.items():
            k_name = k_data.get("KingdomName", k_id)
            leader = k_data.get("CurrentLeaderName", "未知")
            lines.append(f"{k_name}: {leader}")
            chgs = k_data.get("LeadershipChanges", [])
            if chgs:
                last_chg = chgs[-1]
                date = last_chg.get("ChangeDate", "")
                
                is_recent = True
                if date and current_day > 0:
                    try:
                        parts = date.split('.')
                        if len(parts) == 3:
                            y = int(parts[0])
                            s_idx = {"spring": 0, "summer": 1, "autumn": 2, "winter": 3}.get(parts[1].lower(), 0)
                            d = int(parts[2])
                            event_day_abs = y * 84 + s_idx * 21 + d
                            if current_day - event_day_abs > 28:
                                is_recent = False
                    except: pass
                
                if is_recent:
                    prev = last_chg.get("PreviousLeaderName", "未知")
                    reason = "权力交接" if last_chg.get("ChangeReason") == "succession" else last_chg.get("ChangeReason", "未知原因")
                    changes.append(f"【{date}】{k_name}的统治者已更替！前任 {prev} 下台/身故，新任为 {leader} ({reason})。")
        
        res = "目前维斯特洛与世界各国领袖：" + "； ".join(lines) + "。"
        if changes: res += "\n近期震撼大陆的王权更替：" + "\n".join(changes[-3:])
        return res
    except: return ""

# ================= 玩家 WebUI 发信箱处理 =================
def process_outbox(current_day: float, engine_state: dict) -> int:
    outbox_dir = OUR_FOLDER / "outbox"
    if not outbox_dir.exists(): return 0
    processed, player_name = 0, get_player_name()
    for file in outbox_dir.iterdir():
        if not file.is_file() or file.suffix != '.txt': continue
        filename = file.stem
        match = re.match(r'^(.*?)_\d{8}_\d{6}$', filename)
        npc_id = match.group(1) if match else filename
        try: content = load_text(file).strip()
        except: file.unlink(); continue
        if not content: file.unlink(); continue
        npc_json_path = find_npc_json(npc_id)
        if not npc_json_path: file.unlink(); continue
        try: npc_json = load_json(npc_json_path)
        except: file.unlink(); continue
        entry = f"[收到来信] 来自：{player_name}\n正文：{content}\n[sent_via_raven_at_days={current_day}]"
        npc_json.setdefault('ConversationHistory', []).append(entry)
        save_json(npc_json_path, npc_json)
        notify_sync(npc_json_path)
        real_key = npc_json_path.stem
        if real_key in engine_state:
            engine_state[real_key]["has_new_letters"] = True
            engine_state[real_key]["dormant"] = False
        logger.info(f"  [飞鸽传书] 你写给 {npc_json.get('Name', npc_id)} 的密信已瞬间送达并唤醒目标！")
        processed += 1
        file.unlink()
    return processed

# ================= Prompt 组装与 AI 调用 =================
def days_to_aegon(days: float) -> str:
    aegon_year = 298 + int(days // 84)
    moon_turn = int((days % 84) // 7) + 1
    period = "上旬" if (days % 84) % 7 < 2 else "中旬" if (days % 84) % 7 < 5 else "下旬"
    return f"伊耿历{aegon_year}年第{moon_turn}月{period}"

def is_trivial_event(event: dict) -> bool:
    etype = event.get("Type", "")
    desc = event.get("Description", "").lower()
    if etype == "Battle":
        if "bandits" in desc or "looters" in desc or "劫匪" in desc or "匪徒" in desc:
            if "lost" not in desc or "lost 0" in desc:
                return True # minor skirmish with no real lore consequence
            if "defeated" in desc and ("you" in desc or "my" in desc or "our" in desc):
                pass 
    if "long time no see" in desc or "haven't seen" in desc: return True 
    return False

def build_prompt(npc_json: dict, npc_string_id: str, current_day: float, new_convs: List[str], new_events: List[dict], world_events_text: str = "", force_output: bool = False, bg_letters_text: str = "") -> str:
    new_events = [e for e in new_events if not is_trivial_event(e)]
    if not get_profile_path(npc_string_id).exists(): initialize_npc_profile(npc_json, npc_string_id)
    if not get_memory_chain_path(npc_string_id).exists(): initialize_memory_chain(npc_json, npc_string_id, current_day)
    
    profile = load_text(get_profile_path(npc_string_id))
    memory = load_text(get_memory_chain_path(npc_string_id))
    private_state = safe_load_json(get_private_state_path(npc_string_id))

    npc_name = npc_json.get('Name', npc_string_id)
    player_info = npc_json.get("PlayerInfo", {})
    target_name = player_info.get("ClaimedName") or player_info.get("RealName", "玩家")

    cleaned_convs = []
    for c in new_convs:
        text = c.strip()
        if text.startswith(f"{npc_name}:") or text.startswith(f"{npc_name}："): text = f"[{npc_name} 发送给 {target_name}] {text[len(npc_name)+1:].strip()}"
        elif text.startswith("Player:") or text.startswith("Player："): text = f"[{target_name} 发送给 {npc_name}] {text[7:].strip()}"
        elif text.startswith(f"{target_name}:") or text.startswith(f"{target_name}："): text = f"[{target_name} 发送给 {npc_name}] {text[len(target_name)+1:].strip()}"
        cleaned_convs.append(text)

    conv_block = ("\n[新交互消息]\n" + "\n".join([c[:1500] + ('...' if len(c)>1500 else '') for c in cleaned_convs])) if cleaned_convs else ""
    bg_letters_block = ("\n[暗网收件箱]\n" + bg_letters_text.strip()) if bg_letters_text.strip() else ""
    
    # 私密防潮日记回顾
    diaries = private_state.get("SecretDiaries", {})
    diary_block = ""
    if diaries:
        diary_block += f"\n【残缺的领主心智碎片（私密日记卷轴的目录）】\n过往记忆已转化为简明的日记标题。如果你忘了某个细节并影响了判断，可以使用标签 [RECALL_DIARY] <日记卷首标题> 在下一回合唤醒原本包含推演与信件的详细日记内容。\n"
        for entry in reversed(list(diaries.keys())[-6:]): diary_block += f"- 日记卷轴标题: {entry}\n"
        
    active_recall = private_state.get("ActiveRecallMemory", "")
    if active_recall:
        diary_block += f"\n【翻阅日记：被你唤醒的深度卷轴记载】\n{active_recall}\n"
        private_state["ActiveRecallMemory"] = "" # 阅后即焚
        save_json(get_private_state_path(npc_string_id), private_state)
    
    if new_events:
        events_by_type = {}
        for e in new_events:
            etype = e.get("Type", "Other")
            events_by_type.setdefault(etype, []).append(e)

        event_lines = []
        for etype, ev_list in events_by_type.items():
            type_zh = {"Battle": "⚔️ 战斗与冲突", "SettlementCapture": "🏰 攻城与领地", "PrisonerTaken": "⛓️ 俘虏与囚禁", "Released": "🕊️ 重获自由", "Tournament": "🏆 竞技大会", "Marriage": "💍 誓约联姻", "ChildBorn": "👶 血脉延续", "HeroKilled": "☠️ 死亡哀歌", "ClanChange": "🎭 效忠背叛"}.get(etype, f"📌 杂项变故 ({etype})")
            event_lines.append(f"{type_zh} (共 {len(ev_list)} 件):")
            sorted_ev = sorted(ev_list, key=lambda x: x.get("EventTimeDays", 0))
            for e in sorted_ev[-3:]:
                desc_short = e.get('Description', '')[:150]
                event_lines.append(f"  - {days_to_aegon(e.get('EventTimeDays', current_day))}: {desc_short}...")
        event_block = "\n[新个人事件(已被浓缩换算为伊耿历)]\n" + "\n".join(event_lines)
    else:
        event_block = ""
    
    global_leadership = get_global_leadership_text(current_day)
    world_event_block = ""
    if world_events_text.strip() or global_leadership.strip():
        world_event_block = "\n[世界大势与宏观情报]\n" + global_leadership + "\n\n" + world_events_text.strip()

    raw_location = npc_json.get('LocationType', '未知位置')
    clean_location = re.sub(r', Was.*?\)', ')', raw_location)
    
    status_lines = [f"\n[当前现状 - 战役历 Day {int(current_day)}]"]
    
    time_ctx = npc_json.get("TimeContext", {})
    if time_ctx:
        season_map = {"spring": "春季", "summer": "夏季", "autumn": "秋季", "winter": "冬季"}
        tod_map = {"morning": "清晨", "noon": "正午", "afternoon": "下午", "evening": "傍晚", "night": "深夜", "midnight": "午夜"}
        s_zh = season_map.get(str(time_ctx.get("Season", "")).lower(), "未知季节")
        t_zh = tod_map.get(str(time_ctx.get("TimeOfDay", "")).lower(), "未知时段")
        status_lines.append(f"当前时间：{time_ctx.get('Year', '未知')}年 {s_zh} {t_zh}（约 {time_ctx.get('Hour', '')}:00）。")

    status_lines.append(f"{npc_name} 当前位于：{clean_location}。 当前任务：{npc_json.get('CurrentTask', '无')}。")
    
    emotional = npc_json.get("EmotionalState", {})
    escalation = npc_json.get("EscalationState", "neutral")
    esc_text = f" (交涉防备状态: {escalation})" if escalation != "neutral" else ""
    status_lines.append(f"情绪状态：{emotional.get('Mood', '未知')}（原因：{emotional.get('Reason', '无')}）{esc_text}。")
    
    npc_forces = npc_json.get("NPCForces", {})
    party_size = npc_forces.get('PartySize', 0)
    wounded_pct = npc_forces.get('WoundedPercentage', 0.0)
    prisoner_count = npc_forces.get('PrisonerCount', npc_json.get('PrisonerCount', 0))
    party_heroes = npc_json.get("PartyHeroes", npc_forces.get("PartyHeroes", []))
    prisoner_heroes = npc_json.get("PrisonerHeroes", npc_forces.get("PrisonerHeroes", []))
    
    force_text = f"你的部队：{party_size}人 (伤兵率 {wounded_pct:.1f}%)"
    if prisoner_count > 0: force_text += f"，当前押解着 {prisoner_count} 名普通俘虏"
    status_lines.append(force_text + "。")
    if npc_forces.get("ArmyDetails"): status_lines.append(f"军事详情：{npc_forces.get('ArmyDetails')}")
        
    if party_heroes:
        ph_names = [h.get("Name", h) if isinstance(h, dict) else str(h) for h in party_heroes]
        status_lines.append(f"【身边的人】与你同队/同军团的其他将领：{', '.join(ph_names)}。")
    if prisoner_heroes:
        pr_names = [h.get("Name", h) if isinstance(h, dict) else str(h) for h in prisoner_heroes]
        status_lines.append(f"【重要战利品】你当前关押的敌方将领/领主俘虏：{', '.join(pr_names)}！")

    player_forces = npc_json.get("PlayerForces", {})
    if player_forces.get("PartySize", 0) > 0:
        status_lines.append(f"已知情报：玩家({target_name})的部队现有 {player_forces.get('PartySize', 0)}人 (伤兵率 {player_forces.get('WoundedPercentage', 0.0):.1f}%)。")

    is_prisoner = (npc_json.get("IsPrisoner", False) or "Prisoner" in raw_location or "Captive" in raw_location or "俘虏" in raw_location)
    if is_prisoner:
        status_lines.append(f"【⚠️ 身份严重警告：你当前是一名阶下囚！】你被剥夺了自由，正被关押在敌人的地牢或随军囚笼中！你的部队已经溃散。如果要给别人写信，请在内心独白说明你是如何艰难贿赂看守的！")
    
    if (npc_json.get("IsInPlayerParty", False) or npc_json.get("IsWithPlayer", False)) and not is_prisoner:
        status_lines.append(f"【注意：你当前正与玩家在同一队伍或同处一地，随时可以当面交谈，尽量不要用飞鸽传书给玩家写信！】")

    trust = npc_json.get("TrustLevel", 1.0)
    suspected_lie = npc_json.get("PlayerInfo", {}).get("SuspectedLie", False)
    lie_text = "【直觉警告：你强烈怀疑玩家最近对你撒了谎！】" if suspected_lie else ""
    status_lines.append(f"对玩家的态度：信任度 {trust:.1f}/1.0 (表面关系值：{npc_json.get('PlayerRelation', {}).get('Value', 0)}) {lie_text}")

    if npc_json.get("IsSick", False):
        status_lines.append(f"健康状态：【身染重病！】 (疾病恶化进度: {npc_json.get('DiseaseProgress', 0.0):.2f})")
    else:
        status_lines.append("健康状态：良好。")

    romance = npc_json.get("RomanceLevel", 0.0)
    if romance > 10: status_lines.append(f"与玩家私密关系：存在深度的浪漫羁绊 (亲密值 {romance:.1f})。")
    last_seen = npc_json.get("LastSeenFriends", {})
    if last_seen:
        seen_list = [f"{g_id_to_name.get(fid, fid)}(阔别{int(current_day - day)}天)" for fid, day in last_seen.items() if current_day - day > 30 and fid != "main_hero"]
        if seen_list: status_lines.append(f"久别未见的老友：{', '.join(seen_list[:5])}")

    active_quests = npc_json.get("ActiveAIQuests", [])
    if active_quests: 
        status_lines.append(f"你当前正在推进的待办任务：{', '.join([str(q) for q in active_quests])}")
    secrets = npc_json.get("KnownSecrets", [])
    if secrets:
        status_lines.append(f"你目前掌握的黑暗秘密/黑材料：{', '.join([str(s) for s in secrets])}")

    if npc_json.get("WarStatus"): status_lines.append(f"当前战争状态：{npc_json.get('WarStatus').strip()}")
    
    secrets_text = get_world_secrets_text(npc_json)
    if secrets_text:
        status_lines.append(f"\n你掌握的暗网世界秘密：\n{secrets_text}")
    
    status = "\n".join(status_lines)

    footer = (
        f"\n\n记住，你是【{npc_name}】，一个在这个世界里活生生的人，不要将你看到的当成数据与虚构，那些都是你的人生与你的经历，从角色角度出发与思考！根据以上你的人生过去的时间线和你最近经历的事情，并依据天数变化，自然的体现时间的流逝，与你经历的事情。\n"
        f"【重要强制设定】**你所看到的[新个人时间]、[当前现状]等数字内容为事实，而你的对话内容中包裹为事实，其它内心独白等行为，均为你自己的个人看法。禁止杜撰你没有看到，你不知道的事情，比如不存在的信件，没有得到的回信，你不了解的情报，想象自己成功脱困。你的一切内心活动与可能行动，不能脱离数据事实，如显示你被囚禁，你不应该认为自己已经成功脱困，如你没有收到信件（你在记忆流里没有看到一封信），就不应该认为自己收到信件，其它内容不举例，你所看到的是你生活的一角，但不应该臆测，尊重数据事实。\n"
        f"【写信格式原则】如果需要写信，注意写信格式为，姓名 : 正文，冒号前必须是完整的中文名，无需写ID。并且请在正文开头，根据你和对方关系，自然的称呼对方。严格注意，你是一个活生生的人，你只能代表自己行动，不能代表他人行动。“玩家”的真实身份是“{target_name}”。如果提到他，请根据地位关系自然称呼（例如：陛下、大人、头儿、老友，或直呼其名，甚至直接咒骂）。格式注意，包裹的为行为或者第三方描写，并非对话内容。\n"
        f"你需要产出今天的思考或决定。"
    )

    force_text = "\n\n【系统提示】你已经沉默太久了，请至少写点什么。不要输出NONE。" if force_output else ""
    if not new_convs and not new_events and not bg_letters_text.strip():
        force_text += "\n【系统提示】目前世界风平浪静，没有任何新的对话、事件或来信发生。严格遵守你的记忆与以上时间线，请仅仅根据你当前心境进行一段简短的内心独白或日常思考，严格杜绝编造目前不存在的冲突或交互！如果没有特别的想法就简短带过。"
    
    return WORLD_CONTEXT + "\n\n" + profile + diary_block + "\n\n" + memory + conv_block + bg_letters_block + event_block + world_event_block + status + footer + force_text

# ================= AI 调用 =================
SYSTEM_PROMPT_TEMPLATE = _cfg.get("prompts", {}).get("systemTemplate") or """你是一个《冰与火之歌》(权力的游戏)世界中的真实角色。你需要基于自己的人生记忆时间线，生成今天的内心活动和可能的行动。

# 输出格式
你必须严格按以下部分输出，每部分以英文方括号开头：

[INTERNAL_THOUGHTS]
（今天的内心独白，150-300字。结合当前的时间、季节、天气和你的处境进行深刻的描写。你可以反思最近的对话，检视自己、推演权力的游戏。若本轮无大事且情绪稳定，可写 NONE，跳过本项。）

[EMOTIONAL_CHANGE]
NONE
或者：
新情绪: （如 worried, hopeful, angry, calm, melancholy, determined）
原因: （简短说明）

[SIGNIFICANT_MEMORY]
NONE
或者：
（50-100字。极度克制！专门用于记录“人际关系的重大转折”。无论是对“玩家”，还是对“其他角色”（结盟、决裂、深仇大恨、生死之交），一旦确立了重要的情感转变，必须记录！这将作为你的核心底色被永远铭记。）

[PENDING_TALK_TO_PLAYER]
NONE
或者：
（10-30字。发现有极度重要的事情必须在下次见面时主动向玩家提及时，写在这里。这将作为最高优先级的潜意识提醒你：比如“质问他为什么和兰尼斯特结盟”。）

[CLEAR_PENDING_TALK]
NONE
或者：
YES（如果你发现之前的待办事项已经在[新交互消息]中和玩家说过了，输出 YES 以清除该记录。）

[NPC_COMMUNICATIONS]
NONE
或者严格按照以下格式写（最多2封渡鸦传书）：
姓名 : 正文

规则：
- 冒号前必须是"完整的中文名"
- 战乱时期渡鸦经常被射下，非情感或利益剧烈波动时不应长篇大论！正文通常极其简短隐晦。
- 在正文末尾请明确是否期待回信：如果需要回复，请写"静候回信"或"盼复"；纯通知请写"此信仅作告知，无需回信"。

[PLAYER_RELATION_CHANGE]
NONE
或者：
变化值: （-3到+3之间的整数）
原因: （简短说明）

[PLAYER_LETTER]
NONE
或者：
信件正文（100-250字。发送给玩家的渡鸦。如果你得知玩家目前正与你在同一支队伍，或者就在你身边，绝对不要用书信！直接在内心待办里记录。）

[RECALL_DIARY]
NONE
或者：
（如果需要回忆某个心智碎片，写入完整标题名。）

[EVENT_SUMMARY]
一句话概括最近发生的主要事件（少于100字，如某座城池陷落、某个家族被灭）。本轮无大事写：NONE

# 核心原则
1. **绝对事实原则**：你看到的[新个人时间]、[当前现状]为不可篡改的系统客观事实，你的【内心独白】为主观推演。绝不脱离客观数据！（没被囚禁就别说脱困，没收到信就别回复！）
2. **权谋与情绪克制**：中世纪领主多冷酷且防备心理深。除非触发重大事件，否则保持情绪稳定。不要像现代小姑娘般一惊一乍。
3. **冰火文学语境**：使用古典、低魔语境。用词带有冷金属、皮革、血腥或灰烬感。如果骂人，请用该世界本土粗口。
"""

def parse_ai_output(text: str) -> dict:
    result = {"internal_thoughts": "", "emotional_change": None, "npc_communications": [], "player_relation_change": None, "player_letter": None, "event_summary": "", "significant_memory": "", "recall_diary": ""}
    blocks = {m.group(1): p[m.end():].strip() for p in re.split(r'\n(?=\[)', text) if (m := re.match(r'\[(INTERNAL_THOUGHTS|EMOTIONAL_CHANGE|NPC_COMMUNICATIONS|PLAYER_RELATION_CHANGE|PLAYER_LETTER|EVENT_SUMMARY|SIGNIFICANT_MEMORY|PENDING_TALK_TO_PLAYER|CLEAR_PENDING_TALK|RECALL_DIARY)\]\s*', p))}
    
    if 'PENDING_TALK_TO_PLAYER' in blocks and not blocks['PENDING_TALK_TO_PLAYER'].startswith('NONE'):
        result['pending_talk'] = blocks['PENDING_TALK_TO_PLAYER']
    if 'CLEAR_PENDING_TALK' in blocks and 'YES' in blocks['CLEAR_PENDING_TALK'].upper():
        result['clear_talk'] = True
    
    if 'INTERNAL_THOUGHTS' in blocks: result['internal_thoughts'] = blocks['INTERNAL_THOUGHTS']
    if 'RECALL_DIARY' in blocks and not blocks['RECALL_DIARY'].startswith('NONE'): result['recall_diary'] = blocks['RECALL_DIARY']

    if 'EMOTIONAL_CHANGE' in blocks and not blocks['EMOTIONAL_CHANGE'].startswith('NONE'):
        if (m1 := re.search(r'新情绪:\s*(.+)', blocks['EMOTIONAL_CHANGE'])): result['emotional_change'] = {"mood": m1.group(1).strip(), "reason": (m2.group(1).strip() if (m2 := re.search(r'原因:\s*(.+)', blocks['EMOTIONAL_CHANGE'])) else "")}
    
    if 'SIGNIFICANT_MEMORY' in blocks and not blocks['SIGNIFICANT_MEMORY'].startswith('NONE'):
        result['significant_memory'] = blocks['SIGNIFICANT_MEMORY']

    if 'NPC_COMMUNICATIONS' in blocks and not blocks['NPC_COMMUNICATIONS'].startswith('NONE'):
        current_receiver = None
        current_content = []
        def save_current_comm():
            if current_receiver:
                resolved = resolve_receiver_id(current_receiver)
                full_content = '\n'.join(current_content).strip()
                if resolved and full_content:
                    expect = None
                    if any(p in full_content for p in ['无需', '不必回复', '不必']): expect = False
                    elif any(p in full_content for p in ['静候你的回信', '盼复', '期待你的答复', '答复']): expect = True
                    result['npc_communications'].append({"raw_receiver": current_receiver, "resolved_id": resolved, "content": full_content, "expect_reply": expect})

        for line in blocks['NPC_COMMUNICATIONS'].split('\n'):
            line_s = line.strip()
            if not line_s: continue
            if ':' in line_s and len(line_s.split(':', 1)[0]) < 40 and not line_s.startswith('收信人') and not line_s.startswith('信件'):
                save_current_comm()
                raw_receiver, text = line_s.split(':', 1)
                current_receiver = raw_receiver.strip()
                current_content = [text.strip()] if text.strip() else []
            else:
                if current_receiver: current_content.append(line_s)
        save_current_comm()
        
    if 'PLAYER_RELATION_CHANGE' in blocks and not blocks['PLAYER_RELATION_CHANGE'].startswith('NONE'):
        if (m1 := re.search(r'变化值:\s*([+-]?\d+)', blocks['PLAYER_RELATION_CHANGE'])): 
            result['player_relation_change'] = {"delta": max(-3, min(3, int(m1.group(1)))), "reason": (m2.group(1).strip() if (m2 := re.search(r'原因:\s*(.+)', blocks['PLAYER_RELATION_CHANGE'])) else "")}
    
    if 'PLAYER_LETTER' in blocks and not blocks['PLAYER_LETTER'].startswith('NONE') and len(blocks['PLAYER_LETTER']) > 10: 
        result['player_letter'] = blocks['PLAYER_LETTER']
    
    if 'EVENT_SUMMARY' in blocks and not blocks['EVENT_SUMMARY'].startswith('NONE'): 
        result['event_summary'] = blocks['EVENT_SUMMARY']
        
    return result

def analyze_npc(npc_json: dict, npc_string_id: str, current_day: float, new_convs: List[str], new_events: List[dict], cost_tracker: CostTracker, max_tokens: int = 2000, world_events_text: str = "", force_output: bool = False, bg_letters_text: str = "") -> Optional[dict]:
    if cost_tracker.is_budget_exceeded(): return None
    
    prompt = build_prompt(npc_json, npc_string_id, current_day, new_convs, new_events, world_events_text, force_output, bg_letters_text)
    
    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    folder = get_our_npc_folder(npc_string_id)
    save_text(folder / "latest_prompt.txt", prompt) 
    with open(folder / "prompt_history.txt", 'a', encoding='utf-8') as f:
        f.write(f"\n\n{'='*20} {now_str} (游戏 Day {int(current_day)}) {'='*20}\n")
        f.write(prompt)

    try:
        client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
    except Exception as e:
        logger.error(f"  无法初始化大模型客户端, API Key未配置? {e}")
        return None

    npc_name = npc_json.get('Name', npc_string_id)
    
    for attempt in range(3):
        try:
            logger.info(f"\n================================ 【 大模型请求 - 角色: {npc_name} 】 ================================\n")
            logger.info(f"[系统指令模板]: \n{SYSTEM_PROMPT_TEMPLATE}\n")
            logger.info(f"[用户输入的上下文数据 (Prompt)]: \n{prompt}\n")
            logger.info("... 正在等待模型返回 (Wait for AI inference) ...\n")
            
            resp = client.chat.completions.create(model=MODEL, messages=[{"role": "system", "content": SYSTEM_PROMPT_TEMPLATE}, {"role": "user", "content": prompt}], temperature=0.4, max_tokens=max_tokens)
            
            reply_text = resp.choices[0].message.content.strip()
            logger.info(f"\n<<< [模型推理回复原文]: \n{reply_text}\n========================================================================================\n")
            
            if not reply_text: time.sleep(1); continue
            
            hit = miss = out_tok = 0
            if resp.usage:
                out_tok = getattr(resp.usage, 'completion_tokens', 0)
                hit = getattr(resp.usage, 'prompt_cache_hit_tokens', None)
                miss = getattr(resp.usage, 'prompt_cache_miss_tokens', None)
                if hit is None or miss is None:
                    extra = getattr(resp.usage, 'model_extra', {})
                    if isinstance(extra, dict):
                        hit = extra.get('prompt_cache_hit_tokens', 0)
                        miss = extra.get('prompt_cache_miss_tokens', 0)
                hit = hit or 0; miss = miss or 0
                cost_tracker.add_usage(hit, miss, out_tok)
            
            logger.info(f"  [推演完毕] {npc_name} | 命中缓存: {hit} | 未命中: {miss} | 输出: {out_tok} tokens")
            raw_content = resp.choices[0].message.content.strip()
            logger.info(f"\n{'='*20} 接收到 {npc_name} 的大模型原始输出 {'='*20}\n{raw_content}\n{'='*60}")
            parsed = parse_ai_output(raw_content)
            parsed["_raw_response"] = raw_content
            return parsed
        except Exception as e: 
            logger.error(f"  {npc_name} 失败 (尝试 {attempt+1}): {e}")
            time.sleep(1)
    return None

# ================= 记忆写入与数据保存 =================
def update_memory_chain(npc_string_id: str, current_day: float, result: dict, engine_state: dict, new_convs: list, new_events: list):
    chain_path = get_memory_chain_path(npc_string_id)
    new_entry = f"\n=== Day {int(current_day)} 生成 ===\n"
    
    for c in new_convs: new_entry += f"[交互记忆] {c}\n"
    if result.get('event_summary'): new_entry += f"[事件摘要] {result['event_summary']}\n"
    if result.get('internal_thoughts'): new_entry += f"[内心独白] {result['internal_thoughts']}\n"
    if result.get('significant_memory'): new_entry += f"[内心铭记] {result['significant_memory']}\n"
        
    emo = result.get('emotional_change') or {}
    if emo and emo.get('mood'): new_entry += f"[情绪] {emo.get('mood')} - {emo.get('reason', '')}\n"
        
    for comm in result.get('npc_communications', []): 
        clean_name = re.sub(r'\s*\(.*?\)', '', comm.get('raw_receiver', '未知')).strip()
        new_entry += f"[通信] 寄给 {clean_name} 的信: {comm['content']}\n"
        
    if result.get('player_letter'): 
        mood_str = emo.get('mood', '') if isinstance(emo, dict) else ''
        portrait = EMOTION_TO_PORTRAIT.get(mood_str.lower(), 'calm') if mood_str else 'calm'
        new_entry += f"[给玩家的信件:{portrait}] {result['player_letter']}\n"
        
    if result.get('player_relation_change') and isinstance(result.get('player_relation_change'), dict): 
        delta = result['player_relation_change'].get('delta', 0)
        reason = result['player_relation_change'].get('reason', '')
        new_entry += f"[关系] 玩家关系变化 {delta:+d} ({reason})\n"
    
    save_text(chain_path, (load_text(chain_path) if chain_path.exists() else "") + new_entry)
    if result.get('player_letter'):
        for i, line in enumerate(load_text(chain_path).split('\n')):
            if line.startswith('[给玩家的信件') and result['player_letter'][:30] in line:
                engine_state.setdefault("_new_letters_this_round", []).append(f"{npc_string_id}_{i}"); break

def append_death_marker(npc_string_id: str, current_day: float):
    chain_path = get_memory_chain_path(npc_string_id)
    save_text(chain_path, (load_text(chain_path) if chain_path.exists() else "") + f"\n=== Day {int(current_day)} ===\n[死亡] 角色已逝去。\n")

def safe_write_to_json(npc_json: dict, npc_string_id: str, npc_filepath: Path, result: dict, current_day: float, npc_name: str, engine_state: dict):
    modified = False
    npc_state = engine_state.setdefault(npc_string_id, {})
    
    # 私密状态读取
    private_state_path = get_private_state_path(npc_string_id)
    private_state = safe_load_json(private_state_path)

    # 1. 基础情绪与关系写入
    if result['emotional_change']: 
        npc_json['EmotionalState'] = {"Mood": result['emotional_change']['mood'], "Reason": result['emotional_change']['reason']}
        modified = True
    if result['player_relation_change']: 
        npc_json['PendingRelationChange'] = {"RelationChange": result['player_relation_change']['delta'], "Message": f"你与{npc_name}的关系发生了变化。", "Color": {"Red": 0.2, "Green": 0.8, "Blue": 0.2, "Alpha": 1.0}}
        modified = True
        
    # 2. 对话写入（信件与铭记）
    if result['player_letter']:
        entry = f"{npc_name}: 【一封来自{npc_name}的信】\n{result['player_letter']}\n——{npc_name} [sent_via_raven_at_days={current_day}]"
        engine_state.setdefault(npc_string_id, {}).setdefault("_injected_hashes", []).append(compute_hash(entry))
        npc_json.setdefault('ConversationHistory', []).append(entry); modified = True
    if result.get('significant_memory'):
        entry = f"*(内心铭记)* {result['significant_memory']}"
        engine_state.setdefault(npc_string_id, {}).setdefault("_injected_hashes", []).append(compute_hash(entry))
        npc_json.setdefault('ConversationHistory', []).append(entry); modified = True

    # =============== 日志打包与抽象摘要 =====================
    has_thoughts = result.get('internal_thoughts') != "NONE" and result.get('internal_thoughts')
    has_letter = result.get('player_letter') != "NONE" and result.get('player_letter')
    has_summary = result.get('event_summary') != "NONE" and result.get('event_summary')
    
    if has_thoughts or has_letter or has_summary:
        summary_text = result.get('event_summary', '大陆局势之推演')
        aegon_year = 298 + int(current_day // 84)
        moon_turn = int((current_day % 84) // 7) + 1
        diary_id_title = f"学士日记卷轴《伊耿历{aegon_year}年第{moon_turn}月：{summary_text[:10]}...》"
        
        diary_content = f"【当年推演的繁杂内容】\n"
        if has_thoughts: diary_content += f"内心独白: {result['internal_thoughts']}\n"
        if has_letter: diary_content += f"向外界发送过的渡鸦: {result['player_letter']}\n"
        
        private_state.setdefault("SecretDiaries", {})[diary_id_title] = diary_content
        save_json(private_state_path, private_state)
        
    # 日志唤醒 (Active Recall)
    recall_tag = result.get('recall_diary')
    if recall_tag and recall_tag != "NONE":
        diaries = private_state.get("SecretDiaries", {})
        matched_content = ""
        for tag_id, content in diaries.items():
            if recall_tag.strip().lower() in tag_id.lower() or tag_id.lower() in recall_tag.strip().lower():
                matched_content = f"[{tag_id}]\n{content}"
                break
        
        if matched_content:
            private_state["ActiveRecallMemory"] = matched_content
            save_json(private_state_path, private_state)

    # ================= 🌟 核心：待办事项注入 AIGeneratedPersonality 🌟 =================
    if result.get('clear_talk'):
        npc_state['pending_talks'] = []  # 核销任务
        modified = True
    if result.get('pending_talk'):
        npc_state.setdefault('pending_talks', []).append(result['pending_talk'])
        modified = True

    orig_personality = npc_json.get('AIGeneratedPersonality', '')
    if "【前台最高指令" in orig_personality:
        orig_personality = orig_personality.split("【前台最高指令")[0].strip()

    pending_talks = npc_state.get('pending_talks', [])
    if pending_talks:
        new_personality = orig_personality + "\n\n【前台最高指令(下次见到玩家必须主动提出)】：\n" + "\n".join(pending_talks)
    else:
        new_personality = orig_personality

    if npc_json.get('AIGeneratedPersonality') != new_personality:
        npc_json['AIGeneratedPersonality'] = new_personality
        modified = True

    if modified: 
        save_json(npc_filepath, npc_json)
        notify_sync(npc_filepath)

def write_npc_communication_to_receiver(receiver_id: str, sender_name: str, content: str, current_day: float, expect_reply: bool = None):
    inbox_dir = OUR_FOLDER / "inbox"
    inbox_dir.mkdir(parents=True, exist_ok=True)
    letter_file = inbox_dir / f"{receiver_id}.txt"
    entry = f"[收到后台密信] 来自：{sender_name}\n正文：{content}\n" + ("[本信期待回信]" if expect_reply else "[本信无需回信]" if expect_reply is False else "")
    entry = entry.strip() + f"\n[sent_via_raven_at_days={current_day}]\n\n"
    with open(letter_file, 'a', encoding='utf-8') as f: f.write(entry)
    logger.info(f"  [暗网通信] {sender_name} 的信已悄悄投递至 {g_id_to_name.get(receiver_id, receiver_id)} 的后台信箱。")

# ================= 动态事件处理 =================
def compute_world_event_updates(engine_state: dict) -> Dict[str, str]:
    events = load_json(NPC_FOLDER / DYNAMIC_EVENTS_FILE) if (NPC_FOLDER / DYNAMIC_EVENTS_FILE).exists() else None
    if not events: return {}
    hashes, updates = engine_state.get("world_event_hashes", {}), {}
    for ev in events:
        if (eid := ev.get("id")) and (history := ev.get("event_history")):
            desc = history[-1].get("description", "")
            if hashes.get(eid) != (h := compute_hash(desc)):
                if hashes.get(eid) is not None: updates[eid] = f"标题：{ev.get('title', '')}。最新进展：{desc[:120]}"
                hashes[eid] = h
    engine_state["world_event_hashes"] = hashes
    return updates

def get_world_secrets_text(npc_json: dict) -> str:
    """提取世界秘密并匹配给特定的 NPC"""
    secrets_text = ""
    try:
        secrets_path = BASE_AIINFLUENCE / "world_secrets.json"
        if secrets_path.exists():
            secrets = safe_load_json(secrets_path, [])
            for s in secrets:
                if s.get("id") == "example1" or not s.get("description"): continue
                
                roles = s.get("applicableNPCs", [])
                is_ruler = npc_json.get("StringId", "") in g_leaders_set
                is_lord = npc_json.get("StringId", "").startswith("lord_") or is_ruler
                
                if ("faction_leaders" in roles and is_ruler) or ("lords" in roles and is_lord) or ("all" in roles):
                    secrets_text += f"【绝密情报】: {s.get('description')}\n"
    except: pass
    return secrets_text

# ================= 角色推演核心逻辑 =================
def is_dead(npc_json: dict) -> bool: 
    return any(npc_json.get(k) is not None for k in ["PendingDeath", "RoleplayDeathReason", "KillerStringId"]) or npc_json.get("IsAlive") is False

_FACTION_MAPPING = {
    "Stark": ["史塔克", "北境"],
    "Lannister": ["兰尼斯特", "西境"],
    "Targaryen": ["坦格利安", "龙石岛", "无垢者"],
    "Baratheon": ["拜拉席恩", "风暴地", "龙石岛"],
    "Tyrell": ["提利尔", "河湾"],
    "Martell": ["马泰尔", "多恩"],
    "Greyjoy": ["葛雷乔伊", "铁群岛"],
    "Tully": ["徒利", "河间"],
    "Arryn": ["艾林", "谷地"],
    "Nightwatch": ["守夜人", "黑城堡", "长城"],
    "Wildlings": ["自由民", "野人", "塞外"]
}

def is_allied_relevant(npc_json: dict) -> bool:
    npc_string_id = npc_json.get("StringId", "")
    if not npc_string_id: return False
    
    exclude_ids = _cfg.get("exclude_ids", [])
    if npc_string_id in exclude_ids:
        return False
        
    force_simulate_ids = _cfg.get("force_simulate_ids", [])
    if npc_string_id in force_simulate_ids:
        return True
        
    allied_faction = _cfg.get("allied_faction", "")
    if not allied_faction or not _cfg.get("only_allied_simulation", False): 
        return True
        
    npc_name = str(npc_json.get("Name") or "").strip()
    npc_name_clean = re.sub(r'\s*\(.*?\)', '', npc_name).strip()
    faction = g_name_to_faction.get(npc_name_clean)
    
    if faction == allied_faction:
        return True
        
    # Also fallback to mapping keyword check just in case meta_factions is missing some
    keywords = _FACTION_MAPPING.get(allied_faction, [])
    if keywords:
        text_to_search = str(npc_json.get("LocationType", "")) + str(npc_json.get("CharacterDescription", ""))
        if any(kw in text_to_search for kw in keywords):
            return True
            
    return False

def classify_npc(filepath: Path) -> Tuple[str, str, Optional[int]]:
    try: data = load_json(filepath)
    except: return ("", "villager", None)
    sid = data.get("StringId", "")
    if not sid: return ("", "villager", None)
    
    is_allied = is_allied_relevant(data)
    
    is_companion_or_party = data.get("IsCompanion", False) or data.get("IsInPlayerParty", False)
    should_simulate_companions = _cfg.get("always_simulate_companions", False)
    
    if not is_allied:
        if is_companion_or_party and should_simulate_companions:
            pass # continue to normal classification
        else:
            return (sid, "skipped_by_faction", None)
        
    if sid in g_leaders_set: return (sid, "ruler", 2500)
    if has_personality(data): return (sid, "active", 2000)
    if should_simulate_companions and is_companion_or_party: return (sid, "active", 2000)
    return (sid, "villager", None)

def enrich_profile_with_family(npc_json: dict, npc_string_id: str):
    profile_path = get_profile_path(npc_string_id)
    if not profile_path.exists(): return
    
    profile_text = load_text(profile_path)
    if "【家族/势力信息】" in profile_text: return
    
    npc_name = str(npc_json.get("Name") or "").strip()
    npc_name_clean = re.sub(r'\s*\(.*?\)', '', npc_name).strip()
    faction = g_name_to_faction.get(npc_name_clean)
    if not faction: return
    
    members_ids = g_faction_members.get(faction, set())
    last_seen_friends = npc_json.get("LastSeenFriends", {})
    
    family_names = []
    for mid in members_ids:
        if mid != npc_string_id and mid in last_seen_friends:
            fname = g_id_to_name.get(mid)
            if fname: family_names.append(fname)
            
    family_str = f"\n\n【家族/势力信息】\n你属于势力/家族 [{faction}]。"
    if family_names:
        family_str += f"\n基于你的记忆，你的已知家族成员/同阵营关键人物包括（你见过他们）：{', '.join(family_names)}。"
    else:
        family_str += f"\n你尚未结识任何其他族人或阵营核心成员。"
        
    save_text(profile_path, profile_text + family_str)

g_auto_gen_count = 0

def auto_generate_personality(npc_json: dict, npc_string_id: str, filepath: Path) -> bool:
    global _cfg, g_auto_gen_count
    
    if g_auto_gen_count >= 3:
        return False
        
    if str(npc_json.get("AIGeneratedPersonality") or "").strip():
        return True
        
    name = str(npc_json.get("Name") or "未知")
    gender = str(npc_json.get("Gender") or "unknown")
    location = str(npc_json.get("LocationType") or "未知位置")
    task = str(npc_json.get("CurrentTask") or "未知任务")
    war_status = str(npc_json.get("WarStatus") or "和平")
    
    prompt = f"""你是一名《冰与火之歌》世界观专家。请为以下角色生成详细人设，用于骑士与砍杀2的NPC。

角色名称: {name}
性别: {gender}
当前身份/位置: {location}（{task}）
当前战争状态: {war_status}

重要: 游戏中的时间线可能与原著不同，某些事件可能提前或延后。请根据给出的“当前身份”来推断角色的心理阶段和性格，不要拘泥于原著特定时间轴。

请只返回一个JSON对象，包含以下字段，不要包含任何额外文字：
{{
  "AIGeneratedPersonality": "一段详细的心理描写，包括动机、恐惧、核心价值",
  "AIGeneratedBackstory": "简明扼要的背景故事，反映其到达当前状态的关键事件",
  "AIGeneratedSpeechQuirks": "一两句话描述其说话风格、常用词或比喻"
}}
"""

    lore_api_key = _cfg.get("api", {}).get("lore", {}).get("key") or _cfg.get("utils_api_key")
    lore_base_url = _cfg.get("api", {}).get("lore", {}).get("url") or _cfg.get("utils_base_url")
    lore_model = _cfg.get("api", {}).get("lore", {}).get("model") or _cfg.get("utils_model")
    
    if not lore_api_key or not lore_base_url or not lore_model:
        logger.warning(f"【自动人设补全】未配置学士(lore) API，跳过 {name} ({npc_string_id}) 的人设生成。")
        return False
        
    try:
        from openai import OpenAI
        lore_client = OpenAI(api_key=lore_api_key, base_url=lore_base_url)
        
        logger.info(f"【自动人设补全】开始为 {name} ({npc_string_id}) 生成人设...")
        resp = lore_client.chat.completions.create(
            model=lore_model,
            messages=[
                {"role": "system", "content": "你是一个严格输出JSON的助手，不能有任何额外文字或markdown代码块标记（如```json）。"},
                {"role": "user", "content": prompt}
            ],
            temperature=0.3,
            max_tokens=1500
        )
        
        reply_text = resp.choices[0].message.content.strip()
        if reply_text.startswith("```"):
            lines = reply_text.split('\n')
            if lines[0].startswith("```"): lines = lines[1:]
            if lines and lines[-1].startswith("```"): lines = lines[:-1]
            reply_text = '\n'.join(lines).strip()
            
        import json
        result = json.loads(reply_text)
        
        personality = result.get("AIGeneratedPersonality", "")
        backstory = result.get("AIGeneratedBackstory", "")
        speech_quirks = result.get("AIGeneratedSpeechQuirks", "")
        
        if personality:
            npc_json["AIGeneratedPersonality"] = personality
            npc_json["AIGeneratedBackstory"] = backstory
            npc_json["AIGeneratedSpeechQuirks"] = speech_quirks
            
            save_json(filepath, npc_json)
            notify_sync(filepath)
            logger.info(f"【自动人设补全】成功生成 {name} ({npc_string_id}) 的人设！")
            g_auto_gen_count += 1
            return True
            
        return False
        
    except Exception as e:
        logger.error(f"【自动人设补全】生成失败 {name} ({npc_string_id}): {e}")
        return False

def process_npc(filepath: Path, current_day: float, engine_state: dict, cost_tracker: CostTracker, world_event_updates: dict, max_tokens: int) -> dict:
    npc_string_id = filepath.stem
    try:
        with open(filepath, 'r', encoding='utf-8') as file: npc_json = json.load(file)
    except: return {"processed": 0, "skipped": 1, "communications": 0, "player_letters": 0}
        
    npc_name = npc_json.get('Name', npc_string_id)
    npc_state = engine_state.setdefault(npc_string_id, {})
    stats = {"processed": 0, "skipped": 0, "communications": 0, "player_letters": 0}

    profile_path = get_profile_path(npc_string_id)
    if not profile_path.exists():
        if not has_personality(npc_json):
            if is_allied_relevant(npc_json):
                generated = auto_generate_personality(npc_json, npc_string_id, filepath)
                if not generated: return {**stats, "skipped": 1}
            else:
                return {**stats, "skipped": 1}
        initialize_npc_profile(npc_json, npc_string_id)
            
    enrich_profile_with_family(npc_json, npc_string_id)
            
    try:
        if "[屏蔽]" in profile_path.read_text(encoding='utf-8'): return {**stats, "skipped": 1}
    except: pass

    if is_dead(npc_json):
        if not npc_state.get("deceased"):
            append_death_marker(npc_string_id, current_day)
            npc_state["deceased"] = True
        return {**stats, "skipped": 1} 

    inbox_file = OUR_FOLDER / "inbox" / f"{npc_string_id}.txt"
    has_background_letters = inbox_file.exists()
    bg_letters_content = load_text(inbox_file) if has_background_letters else ""

    current_loc = npc_json.get('LocationType', '')
    current_party = npc_json.get('NPCForces', {}).get('PartySize', 0)
    current_events_len = len(npc_json.get('RecentEvents', []))
    
    last_loc = npc_state.get("last_loc", "")
    last_party = npc_state.get("last_party", 0)
    last_events_len = npc_state.get("last_events_len", 0)
    
    days_since = current_day - npc_state.get("last_analysis_day", 0)
    has_new_letters = npc_state.get("has_new_letters", False)
    
    changed = (current_loc != last_loc or abs(current_party - last_party) > 15 or current_events_len > last_events_len)
    
    if not changed and not has_new_letters and not has_background_letters:
        if days_since < 14 and npc_state.get("last_analysis_day", 0) > 0:
            return {**stats, "skipped": 1}

    is_first_run = (npc_state.get("last_analysis_day", 0) == 0)
    if is_first_run:
        new_convs = []; world_text = "" 
        events = npc_json.get("RecentEvents", [])
        events_sorted = sorted(events, key=lambda x: x.get("EventTimeDays", 0))
        new_events = events_sorted[-10:]
    else:
        new_convs = get_new_conversations_since(npc_json, npc_state.get("last_conv_count", 0), engine_state, npc_string_id)
        new_events = get_new_events_since(npc_json, npc_state.get("last_analysis_day", 0))
        world_text = "\n".join([world_event_updates[eid] for eid in npc_json.get("DynamicEvents", []) if eid in world_event_updates])

    result = analyze_npc(npc_json, npc_string_id, current_day, new_convs, new_events, cost_tracker, max_tokens, world_text, force_output=(npc_state.get("consecutive_skip_count", 0) >= 3), bg_letters_text=bg_letters_content)
    
    if not result:
        npc_state.update({"consecutive_skip_count": npc_state.get("consecutive_skip_count", 0) + 1, "last_conv_count": len(npc_json.get("ConversationHistory", []))})
        return {**stats, "skipped": 1}

    if has_background_letters: inbox_file.unlink()

    if result.get('internal_thoughts', '').startswith('NONE') and (not result.get('event_summary') or result.get('event_summary', '').startswith('NONE')) and not any([result.get('emotional_change'), result.get('npc_communications'), result.get('player_letter'), result.get('player_relation_change'), result.get('significant_memory')]):
        npc_state.update({
            "last_analysis_day": current_day, "last_conv_count": len(npc_json.get("ConversationHistory", [])), 
            "consecutive_skip_count": npc_state.get("consecutive_skip_count", 0) + 1, "has_new_letters": False,
            "last_loc": current_loc, "last_party": current_party, "last_events_len": current_events_len
        })
        return {**stats, "processed": 1}

    try:
        if result.get('internal_thoughts') and not result['internal_thoughts'].startswith('NONE'): logger.info(f"    ↳ [思考] {result['internal_thoughts'][:40].replace(chr(10), ' ')}...")
        if result.get('player_letter'): logger.info(f"    ↳ [💌 给你的信] {result['player_letter'][:35].replace(chr(10), ' ')}...")
        if result.get('significant_memory'): logger.info(f"    ↳ [📌 铭记] {result['significant_memory'][:35].replace(chr(10), ' ')}...")
        for comm in result.get('npc_communications', []):
            rec_name = g_id_to_name.get(comm['resolved_id'], comm.get('raw_receiver', '未知'))
            clean_rec_name = re.sub(r'\s*\(.*?\)', '', rec_name).strip()
            logger.info(f"    ↳ [寄信给 {clean_rec_name}] {comm['content'][:30].replace(chr(10), ' ')}...")
    except: pass

    npc_state["consecutive_skip_count"] = 0; npc_state["has_new_letters"] = False
    update_memory_chain(npc_string_id, current_day, result, engine_state, new_convs, new_events)
    safe_write_to_json(npc_json, npc_string_id, filepath, result, current_day, npc_name, engine_state)
    for comm in result.get('npc_communications', []): write_npc_communication_to_receiver(comm['resolved_id'], npc_name, comm['content'], current_day, comm.get('expect_reply'))
    npc_state.update({"last_analysis_day": current_day, "last_conv_count": len(npc_json.get("ConversationHistory", [])), "last_loc": current_loc, "last_party": current_party, "last_events_len": current_events_len})
    return {"processed": 1, "skipped": 0, "communications": len(result.get('npc_communications', [])), "player_letters": 1 if result.get('player_letter') else 0}

def get_latest_game_day() -> float:
    max_day = 0.0
    for f in list_npc_files(NPC_FOLDER):
        try: max_day = max(max_day, load_json(f).get("LastInteractionTimeDays", 0), *(e.get("EventTimeDays", 0) for e in load_json(f).get("RecentEvents", [])))
        except: continue
    return max_day

def run_analysis_round(current_day: float, engine_state: dict, cost_tracker: CostTracker, stats: dict):
    global g_auto_gen_count
    g_auto_gen_count = 0
    (OUR_FOLDER / "json_backups").mkdir(parents=True, exist_ok=True)
    for f in list_npc_files(NPC_FOLDER):
        if has_personality(load_json(f)): save_json(OUR_FOLDER / "json_backups" / f.name, load_json(f))

    engine_state["_new_letters_this_round"] = []
    world_updates = compute_world_event_updates(engine_state)

    tier1_files, villager_files = [], []
    for f in list_npc_files(NPC_FOLDER):
        sid, tier, _ = classify_npc(f)
        if sid:
            if tier == "skipped_by_faction":
                stats["skipped"] += 1
            elif tier in ("ruler", "active"): 
                tier1_files.append(f)
            else:
                villager_files.append(f)

    for f in tqdm(tier1_files, desc="深度推演重要角色"):
        if cost_tracker.is_budget_exceeded(): break
        res = process_npc(f, current_day, engine_state, cost_tracker, world_updates, classify_npc(f)[2] or 2000)
        for k in res: stats[k] += res[k]

    for f in tqdm(villager_files, desc="推演其他相关人员"):
        if cost_tracker.is_budget_exceeded(): break
        res = process_npc(f, current_day, engine_state, cost_tracker, world_updates, VILLAGER_MAX_TOKENS_HIGH)
        for k in res: stats[k] += res[k]

    stats.update({"dormant": sum(1 for s in engine_state.values() if isinstance(s, dict) and s.get("dormant")), "deceased": sum(1 for s in engine_state.values() if isinstance(s, dict) and s.get("deceased"))})

def find_campaign_id():
    if not BASE_AIINFLUENCE.exists(): raise FileNotFoundError(f"目录不存在: {BASE_AIINFLUENCE}")
    candidates = [d for d in BASE_AIINFLUENCE.iterdir() if d.is_dir() and (d / "npc_lives").exists()]
    if not candidates: raise FileNotFoundError("未找到包含 npc_lives 的存档")
    if len(candidates) == 1: return candidates[0].name
    def get_latest_file_mtime(campaign_folder):
        m = max([f.stat().st_mtime for f in campaign_folder.glob("*.json")], default=0.0)
        nl = campaign_folder / "npc_lives"
        if nl.exists(): m = max(m, max([f.stat().st_mtime for f in nl.rglob("*") if f.is_file()], default=0.0))
        return m
    candidates.sort(key=get_latest_file_mtime, reverse=True)
    return candidates[0].name

def main_loop():
    global logger, NPC_FOLDER, OUR_FOLDER
    setup_logging()
    logger.info("=== NPC 后台生命引擎 (双层世界极速版 + 情报升级) 启动 ===")
    build_indices()

    state_path = OUR_FOLDER / STATE_FILE
    engine_state = safe_load_json(state_path)
    engine_state.setdefault("world_event_hashes", {})
    engine_state.setdefault("player_letters_unread", [])

    cost_tracker = CostTracker.from_dict(engine_state.get("cumulative_cost", {}))
    last_run_day = engine_state.get("last_run_day", 0)
    
    last_heartbeat_time = time.time()
    HEARTBEAT_INTERVAL = 360  

    try:
        while True:
            global _cfg, API_KEY, BASE_URL, MODEL
            new_cfg = get_engine_config()
            if new_cfg:
                _cfg = new_cfg
                API_KEY = _cfg.get("api", {}).get("engine", {}).get("key") or _cfg.get("api_key") or os.getenv("DEEPSEEK_API_KEY", "sk-7d2a561839574a19823228d28ee3b355")
                BASE_URL = _cfg.get("api", {}).get("engine", {}).get("url") or _cfg.get("base_url") or os.getenv("API_BASE_URL", "https://api.deepseek.com")
                if "generativelanguage.googleapis.com" in BASE_URL:
                    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"
                MODEL = _cfg.get("api", {}).get("engine", {}).get("model") or _cfg.get("model") or os.getenv("API_MODEL", "deepseek-v4-flash")
                
            current_day = get_latest_game_day()
            
            # 延缓频繁推进 (14天)
            if current_day - last_run_day < ANALYSIS_INTERVAL_DAYS and last_run_day > 0:
                letters_handled = process_outbox(current_day, engine_state)
                if letters_handled == 0:
                    time.sleep(10)
                    # continue is avoided here to let heartbeat still work below
                else:
                    # process partial round just for the letter if needed, or wait
                    pass
                    
            letters_handled = process_outbox(current_day, engine_state)
            
            if current_day - last_run_day >= ANALYSIS_INTERVAL_DAYS or letters_handled > 0:
                stats = {k: 0 for k in ["processed", "skipped", "communications", "player_letters", "dormant", "deceased"]}
                stats["outbox_processed"] = letters_handled
                
                run_analysis_round(current_day, engine_state, cost_tracker, stats)
                
                engine_state["player_letters_unread"] = list(set(safe_load_json(state_path).get("player_letters_unread", []) + engine_state.pop("_new_letters_this_round", [])))
                engine_state.update({"cumulative_cost": cost_tracker.to_dict()})
                
                if current_day - last_run_day >= ANALYSIS_INTERVAL_DAYS:
                    engine_state["last_run_day"] = current_day
                    last_run_day = current_day
                    
                save_json(state_path, engine_state)
                
                report_str = f"""=== NPC 后台生命引擎 v4.5 运行报告 ===
时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}
游戏天数: Day {int(current_day)}

【处理统计】
深度推演角色数: {stats['processed']} 人
保持休眠角色数: {stats['dormant']} 人
跳过无关角色数: {stats['skipped']} 人
已确认死亡角色: {stats['deceased']} 人

【通信枢纽】
NPC 暗网通信: {stats['communications']} 封 (未污染游戏数据)
NPC 致信玩家: {stats['player_letters']} 封
成功送达玩家信件: {stats.get('outbox_processed', 0)} 封

【财务与状态】
{cost_tracker.summary()}
"""
                save_text(REPORT_FILE, report_str)
                logger.info(f"本轮推演完成！(处理了 {letters_handled} 封飞鸽传书)")
                
            current_time = time.time()
            if current_time - last_heartbeat_time > HEARTBEAT_INTERVAL:
                logger.info("\n【系统】触发全局固定心跳，为所有重要领主无条件续期缓存...")
                tier1_files = [f for f in list_npc_files(NPC_FOLDER) if classify_npc(f)[1] in ("ruler", "active")]
                
                try:
                    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
                    hit_total = 0
                    for f in tier1_files:
                        try:
                            npc_string_id = f.stem
                            profile_path = get_profile_path(npc_string_id)
                            memory_path = get_memory_chain_path(npc_string_id)
                            if not profile_path.exists() or not memory_path.exists(): continue
                            
                            profile = load_text(profile_path)
                            memory = load_text(memory_path)
                            warmup_prompt = WORLD_CONTEXT + "\n\n" + profile + "\n\n" + memory
                            
                            resp = client.chat.completions.create(
                                model=MODEL, 
                                messages=[{"role": "system", "content": SYSTEM_PROMPT_TEMPLATE}, {"role": "user", "content": warmup_prompt}], 
                                temperature=0.1, 
                                max_tokens=1
                            )
                            if resp.usage:
                                extra = getattr(resp.usage, 'model_extra', {})
                                hit = getattr(resp.usage, 'prompt_cache_hit_tokens', None) or (extra.get('prompt_cache_hit_tokens', 0) if isinstance(extra, dict) else 0)
                                hit_total += hit
                        except: pass
                    
                    logger.info(f"【心跳完成】成功续期了 {hit_total} tokens 的记忆缓存，未修改任何游戏状态！\n")
                except Exception as e:
                    pass
                last_heartbeat_time = time.time()
            
            time.sleep(10)
            
    except KeyboardInterrupt:
        engine_state.update({"cumulative_cost": cost_tracker.to_dict(), "last_run_day": last_run_day})
        save_json(state_path, engine_state)
        logger.info("引擎已安全退出。")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NPC 后台生命引擎")
    parser.add_argument("--campaign-id", type=str, help="指定存档ID", default="")
    parser.add_argument("--base-path", type=str, help="存档根目录", default=str(Path.cwd() / "data" / "saves"))
    args = parser.parse_args()
    
    BASE_AIINFLUENCE = Path(args.base_path)
    if not BASE_AIINFLUENCE.exists():
        BASE_AIINFLUENCE.mkdir(parents=True, exist_ok=True)
    try:
        campaign_id = args.campaign_id or find_campaign_id()
        NPC_FOLDER = BASE_AIINFLUENCE / campaign_id
        OUR_FOLDER = NPC_FOLDER / "npc_lives"
        OUR_FOLDER.mkdir(parents=True, exist_ok=True)
        print(f"载入最新存档 ID: {campaign_id}")
        main_loop()
    except FileNotFoundError as e:
        print(f"Error: {e}")
        campaign_id = "simulator_mode"
        NPC_FOLDER = BASE_AIINFLUENCE / campaign_id
        NPC_FOLDER.mkdir(parents=True, exist_ok=True)
        OUR_FOLDER = NPC_FOLDER / "npc_lives"
        OUR_FOLDER.mkdir(parents=True, exist_ok=True)
        print(f"Fallback to {campaign_id}")
        main_loop()
