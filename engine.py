#!/usr/bin/env python3
"""
NPC 后台生命引擎 v4.5 (双层世界极速版 + 宏观情报与深度隐私升级) - 配合前端 UI 增强版
"""

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

from openai import OpenAI

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(iterable, **kwargs):
        return iterable

# ================= 动态配置加载 =================
def load_config():
    config_path = Path("config.json")
    if config_path.exists():
        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}

config = load_config()

API_KEY = config.get("api_key", os.getenv("DEEPSEEK_API_KEY", ""))
BASE_URL = config.get("base_url", "https://api.deepseek.com")
MODEL = config.get("model", "deepseek-v4-flash")
BASE_AIINFLUENCE_PATH = config.get("base_path", r"E:\SteamLibrary\steamapps\common\Mount & Blade II Bannerlord\Modules\AIInfluence\save_data")
BASE_AIINFLUENCE = Path(BASE_AIINFLUENCE_PATH)

ANALYSIS_INTERVAL_DAYS = float(config.get("analysis_interval_days", 7))
MAX_COST_USD = float(config.get("max_cost_usd", 1.0))
HEARTBEAT_INTERVAL = int(config.get("heartbeat_interval", 360))

NPC_FOLDER: Path = None
OUR_FOLDER: Path = None

STATE_FILE = "engine_state.json"
DYNAMIC_EVENTS_FILE = "dynamic_events.json"
WORLD_EVENTS_SNAPSHOT = "world_events_snapshot.json"
KINGDOM_LEADERSHIP_FILE = "kingdom_leadership_history.json"
SETTLEMENT_INDEX_FILE = "settlement_index.json"

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
    "grieving": "melancholy", "determined": "determined", "resolute": "determined",
    "vigilant": "determined", "joyful": "joyful", "proud": "joyful", "happy": "joyful",
    "hopeful": "joyful", "calm": "calm", "content": "calm", "neutral": "calm",
}

WORLD_CONTEXT = """[世界背景]
维斯特洛(Westeros)与厄斯索斯(Essos)大陆 —— 冰与火之歌世界设定

这是一片由权力、血脉与冰火交织的残酷生存法则主导的大陆。维斯特洛由七大王国组成，最高权力象征是位于君临的铁王座。主要家族势力包括：北境的史塔克(Stark)、西境的兰尼斯特(Lannister)、龙石岛的坦格利安(Targaryen)、风暴地的拜拉席恩(Baratheon)、河湾地的提利尔(Tyrell)、多恩的马泰尔(Martell)等。

核心生存准则：
- 权力的游戏：不当赢家，只有死路一条。荣誉可能导致你掉脑袋，这里充满着暗杀、背叛、毒药与利益联姻。
- 凛冬将至 (Winter is Coming)：季节可能持续几年。异鬼与长夜的传说正在塞外复苏，寒冷带来绝望。
- 铁与血的阶级：极端的封建贵族制。渡鸦(Ravens)是跨越城堡通信的唯一方式；学士提供医治与知识辅佐。
"""

# ================= 日志 =================
g_id_to_name = {}
LOG_FILE = None
REPORT_FILE = None
logger = None

def setup_logging(verbose: bool = True):
    global logger, LOG_FILE, REPORT_FILE
    log_dir = Path("logs")
    log_dir.mkdir(exist_ok=True)
    LOG_FILE = log_dir / "engine_latest.log"
    REPORT_FILE = log_dir / "report_latest.txt"
    
    logger = logging.getLogger("NPC_LifeEngine")
    logger.setLevel(logging.DEBUG)
    
    if logger.hasHandlers(): logger.handlers.clear()

    file_handler = logging.FileHandler(LOG_FILE, mode='w', encoding='utf-8')
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

def load_json(filepath: Path) -> dict:
    with open(filepath, 'r', encoding='utf-8') as f: return json.load(f)
def safe_load_json(filepath: Path, default=None):
    try: return load_json(filepath) if filepath.exists() else (default or {})
    except: return default or {}
def save_json(filepath: Path, data: dict):
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f: json.dump(data, f, indent=2, ensure_ascii=False)
def load_text(filepath: Path) -> str:
    with open(filepath, 'r', encoding='utf-8') as f: return f.read()
def save_text(filepath: Path, text: str):
    filepath.parent.mkdir(parents=True, exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f: f.write(text)
def compute_hash(text: str) -> str: return hashlib.md5(text.encode('utf-8')).hexdigest()

def is_valid_npc_json(filepath: Path) -> bool:
    try: return "StringId" in load_json(filepath) and "PlayerInfo" in load_json(filepath)
    except: return False

def list_npc_files(folder: Path) -> List[Path]:
    if not folder.exists(): return []
    return [f for f in folder.glob("*.json") if is_valid_npc_json(f)]

def find_npc_json(npc_string_id: str) -> Optional[Path]:
    return None

g_id_to_name, g_leaders_set = {}, set()

def build_indices(): pass
def get_our_npc_folder(npc_string_id: str) -> Path:
    f = OUR_FOLDER / re.sub(r'[\\/:*?"<>|]', '_', npc_string_id); f.mkdir(parents=True, exist_ok=True); return f
def get_profile_path(npc_string_id: str) -> Path: return get_our_npc_folder(npc_string_id) / "profile.txt"
def get_memory_chain_path(npc_string_id: str) -> Path: return get_our_npc_folder(npc_string_id) / "memory_chain.txt"
def ensure_name_txt(npc_string_id: str, npc_name: str): pass
def has_personality(npc_json: dict) -> bool: return bool(npc_json.get("AIGeneratedPersonality"))
def get_global_leadership_text(current_day: float) -> str: return ""

def build_prompt(npc_json, npc_string_id, current_day, new_convs, new_events, force_output=False, lore_text="", secrets_text=""):
    prompt_config_path = Path("prompt_config.json")
    if prompt_config_path.exists():
        try:
            with open(prompt_config_path, "r", encoding="utf-8") as f:
                prompt_config = json.load(f)
        except:
            prompt_config = {"blocks": []}
    else:
        # Fallback empty config, UI will create it
        prompt_config = {"blocks": []}

    blocks = prompt_config.get("blocks", [])
    
    # Pre-calculate some values
    aegon_year = 298 + int(current_day // 84)
    day_in_year = current_day % 84
    moon_turn = int(day_in_year // 7) + 1
    day_in_moon = day_in_year % 7
    period = "上旬" if day_in_moon <= 2 else "中旬" if day_in_moon <= 5 else "下旬"
    
    filtered_events = []
    if new_events:
        for ev in new_events:
            ev_str = str(ev).lower()
            ev_origin = str(ev)
            is_bandit = any(x in ev_str for x in ["looter", "bandit", "sea raider", "deserter", "劫匪", "强盗", "海寇", "逃兵", "匪类"])
            is_defeat = any(x in ev_str for x in ["defeat", "captured", "lost", "prisoner", "被击败", "被俘", "战败", "输给"])
            is_dead = npc_json.get('IsAlive') == False
            if is_bandit:
                filtered_events.append("领地日常：你或麾下队伍近日清剿了一小撮流寇山民，维护了法律与秩序。")
            elif is_defeat and not is_dead:
                filtered_events.append("前线军情：领地的一支先锋队伍在局部冲突中遭到算计受连累，但并未伤及你的核心实力与统帅威望。")
            else:
                filtered_events.append(ev_origin)
        filtered_events = list(dict.fromkeys(filtered_events))

    prompt = ""
    for block in blocks:
        if block.get("type") == "text" or block.get("type") == "divider":
            content = block.get("content", "")
            if content: prompt += content + "\n"
        elif block.get("type") == "variable":
            var_name = block.get("var_name")
            if var_name == "LORE" and lore_text:
                prompt += f"\n【大十字学士提供的原著考据 / 冰与火之歌历史档案 (Citadel True Lore)】\n你在《冰与火之歌》世界里的正史生平、宿命轨迹及核心声誉（绝对底层事实，指引本源人格）：\n{lore_text}\n"
            elif var_name == "SECRETS" and secrets_text:
                prompt += f"\n【维斯特洛绝密档案 / 秘密与古老传言 (Classified Secrets & Legends)】\n你在静思室中暗中掌握、调查或在底层深埋的信息与秘传：\n{secrets_text}\n"
            elif var_name == "CORE_INFO":
                prompt += f"\n【AI 核心记忆与固定设定档案】\n角色标识 (StringId): {npc_string_id}\n真实姓名 (Name): {npc_json.get('Name', npc_string_id)}\n性格特征 (Personality): {npc_json.get('AIGeneratedPersonality', '暂无特定性格记载')}\n背景身世 (Backstory): {npc_json.get('AIGeneratedBackstory', '暂无重要转折记载')}\n"
            elif var_name == "CALENDAR":
                prompt += f"当前维斯特洛历法时间：伊耿历 {aegon_year} 年, 第 {moon_turn} 个月相 {period}\n"
            elif var_name == "CURRENT_STATE":
                prompt += f"\n【当前游戏现状及驻地】\n生命状态: {'已故' if npc_json.get('IsAlive') == False else '存活'}\n目前驻地 (LocationType): {npc_json.get('LocationType', '未知')}\n当前情感 (EmotionalState): {json.dumps(npc_json.get('EmotionalState', {}), ensure_ascii=False)}\n"
            elif var_name == "EVENTS" and filtered_events:
                prompt += f"\n【最新发生的大陆局势与个人情报】\n"
                for ev in filtered_events: prompt += f"- {ev}\n"
            elif var_name == "DIARIES":
                diaries = npc_json.get("SecretDiaries", {})
                if diaries:
                    prompt += f"\n【残缺的领主心智碎片（私密日记卷轴的目录）】\n过往记忆已转化为简明的日记标题。如果你忘了某个细节并影响了判断，可以使用标签 [RECALL_DIARY] <日记卷首标题> 在下一回合唤醒原本包含推演与信件的详细日记内容。\n"
                    for entry in reversed(list(diaries.keys())[-6:]): prompt += f"- 日记卷轴标题: {entry}\n"
            elif var_name == "CONVERSATION":
                conv_hist = npc_json.get('ConversationHistory', [])
                if conv_hist:
                    prompt += f"\n【近期实体世界的真实互动纪要】\n"
                    for entry in reversed(conv_hist[-5:]): prompt += f"- 外界记录: {entry}\n"
            elif var_name == "ACTIVE_RECALL":
                active_recall = npc_json.get("ActiveRecallMemory", "")
                if active_recall:
                    prompt += f"\n【翻阅日记：被你唤醒的深度卷轴记载】\n{active_recall}\n"
                    npc_json["ActiveRecallMemory"] = "" # 阅后即焚

    return prompt

SYSTEM_PROMPT_TEMPLATE = """你生存在残酷的《冰与火之歌》(权力的游戏)世界。你需要基于自己的人生记忆时间线，生成今天的内心活动和可能的行动。请使用符合维斯特洛贵族、骑士或平民的古典语境。

# 输出格式 (必须包含以下英文标签头部)
[INTERNAL_THOUGHTS]
(内心独白，200字左右。必须结合当前极具压迫感的中世纪权力局势或者安全规则来描写你独自在【静思室】内心的欲望与恐惧。若是平安无事可写 NONE。)
[EMOTIONAL_CHANGE]
(格式必须为 - 新情绪: 喜悦/悲哀/戒备 等之一, 原因: 因为xxx。或者 NONE)
[SIGNIFICANT_MEMORY]
(重大记事，遇到改变命运的背叛、秘密时写在这里，或者 NONE)
[PENDING_TALK_TO_PLAYER]
(下次见到玩家必须开口质问/谋划的话，或者 NONE)
[CLEAR_PENDING_TALK]
(YES 或者 NONE)
[NPC_COMMUNICATIONS]
(通过渡鸦发送出去的信，或者 NONE，格式务必是：姓名 : 正文内容。请自称在发渡鸦信件！)
[PLAYER_RELATION_CHANGE]
(变化值: +1/-1 等，或者 NONE)
[PLAYER_LETTER]
(给玩家发送的渡鸦密信，150-250字，或者 NONE)
[EVENT_SUMMARY]
(对近期事件的一句话概括，极其精简)
[RECALL_DIARY]
(如果上方“残缺的心智碎片”中某个<日记卷首标题>引起了你的疑惑，填入该标题以在下个推演轮回找回完整记忆，否则填 NONE)
"""

def parse_ai_output(text: str) -> dict:
    res = {
        "internal_thoughts": "处于静思室中，思索权力纷争、家族未来与即将到来的风暴。",
        "emotional_change": None,
        "significant_memory": None,
        "pending_talk": None,
        "clear_talk": False,
        "npc_communications": [],
        "player_relation_change": None,
        "player_letter": None,
        "event_summary": "安好于维斯特洛。",
        "recall_diary": None,
        "_raw_response": text
    }
    
    def get_tag_content(tag: str) -> str:
        pattern = rf"\[{tag}\](.*?)(?=\s*\[[A-Z_]+\]|$)"
        m = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        return m.group(1).strip() if m else ""

    th = get_tag_content("INTERNAL_THOUGHTS")
    if th: res["internal_thoughts"] = th

    emo = get_tag_content("EMOTIONAL_CHANGE")
    if emo and emo != "NONE":
        m = re.search(r"新情绪\s*:\s*([^,，\s]+)[,，\s]*原因\s*:\s*(.*)", emo)
        if m:
            res["emotional_change"] = {"mood": m.group(1).strip(), "reason": m.group(2).strip()}
        else:
            res["emotional_change"] = {"mood": emo, "reason": "静思起伏"}

    mem = get_tag_content("SIGNIFICANT_MEMORY")
    if mem and mem != "NONE":
        res["significant_memory"] = mem

    pt = get_tag_content("PENDING_TALK_TO_PLAYER")
    if pt and pt != "NONE":
        res["pending_talk"] = pt

    ct = get_tag_content("CLEAR_PENDING_TALK")
    if ct and "YES" in ct.upper():
        res["clear_talk"] = True

    comm = get_tag_content("NPC_COMMUNICATIONS")
    if comm and comm != "NONE":
        lines = [line.strip() for line in comm.split("\n") if line.strip()]
        for line in lines:
            if ":" in line:
                parts = line.split(":", 1)
                res["npc_communications"].append({"to": parts[0].strip(), "text": parts[1].strip()})

    rel = get_tag_content("PLAYER_RELATION_CHANGE")
    if rel and rel != "NONE":
        res["player_relation_change"] = rel

    let = get_tag_content("PLAYER_LETTER")
    if let and let != "NONE":
        res["player_letter"] = let

    ev = get_tag_content("EVENT_SUMMARY")
    if ev and ev != "NONE":
        res["event_summary"] = ev
        
    rc = get_tag_content("RECALL_DIARY")
    if rc and rc != "NONE":
        res["recall_diary"] = rc

    return res

def analyze_npc(npc_json: dict, npc_string_id: str, current_day: float, new_convs: List[str], new_events: List[dict], cost_tracker: CostTracker, max_tokens: int = 2000, world_events_text: str = "", force_output: bool = False, bg_letters_text: str = "") -> Optional[dict]:
    client = OpenAI(api_key=API_KEY, base_url=BASE_URL)
    npc_name = npc_json.get('Name', npc_string_id)

    # 1. Load Lore if exists
    lore_text = ""
    try:
        our_folder = get_our_npc_folder(npc_string_id)
        lore_file = our_folder / "lore.txt"
        if lore_file.exists():
            lore_text = lore_file.read_text(encoding="utf-8")
    except Exception as e:
        logger.warning(f"  读取 Lore 发生异常: {e}")

    # 2. Load Secrets if exists
    secrets_text = ""
    try:
        our_folder = get_our_npc_folder(npc_string_id)
        secrets_file = our_folder / "secrets_registry.json"
        if secrets_file.exists():
            secrets_data = json.loads(secrets_file.read_text(encoding="utf-8"))
            scs = secrets_data.get("secrets", [])
            if scs:
                secrets_text = "\n".join(f"- {s}" for s in scs)
    except Exception as e:
        logger.warning(f"  读取 Secrets 发生异常: {e}")

    # 3. Build Prompt properly!
    prompt = build_prompt(npc_json, npc_string_id, current_day, new_convs, new_events, force_output, lore_text, secrets_text)

    # 4. Handle Static Cache Check
    static_prefix = prompt.split("【------------- 动态与易变情报区开始 -------------】")[0]
    our_folder = get_our_npc_folder(npc_string_id)
    cache_lock_file = our_folder / "static_cache_lock.txt"
    pending_file = our_folder / "pending_static_diff.json"

    needs_approval = False
    if cache_lock_file.exists():
        last_static = cache_lock_file.read_text(encoding="utf-8")
        if last_static != static_prefix:
            force_send_file = our_folder / "force_send_static.txt"
            if force_send_file.exists():
                force_send_file.unlink() # consume the force send token
                cache_lock_file.write_text(static_prefix, encoding="utf-8")
            else:
                # Save diff and pause
                pending_diff = {"old": last_static, "new": static_prefix, "full_prompt": prompt}
                pending_file.write_text(json.dumps(pending_diff, ensure_ascii=False), encoding="utf-8")
                needs_approval = True
    else:
        cache_lock_file.write_text(static_prefix, encoding="utf-8")

    if needs_approval:
        logger.warning(f"  [缓存截断警告] {npc_string_id} 静态提示词发生变动，进入挂起状态等待确认！")
        return {"_pending_prompt_approval": True}
        
    if pending_file.exists():
        pending_file.unlink()

    try:
        sys_prompt = SYSTEM_PROMPT_TEMPLATE
        prompt_config_path = Path("prompt_config.json")
        if prompt_config_path.exists():
            try:
                with open(prompt_config_path, "r", encoding="utf-8") as f:
                    prompt_config = json.load(f)
                    sys_prompt = prompt_config.get("system_prompt", SYSTEM_PROMPT_TEMPLATE)
            except:
                pass

        if not API_KEY:
            time.sleep(0.5)
            # Create a rich procedural mock response based on who they are to show functionality
            is_stark = "stark" in npc_string_id.lower() or "stark" in npc_name.lower() or "ned" in npc_string_id.lower()
            is_lannister = "lannister" in npc_string_id.lower() or "lannister" in npc_name.lower() or "tyrion" in npc_string_id.lower()
            
            thoughts = ""
            if is_stark:
                thoughts = "北境的寒风在临冬城上空咆哮。我站在临冬城的静思室中，抚摸着旧神林里的心树落叶。史塔克家族的荣誉不可被玷污，但君临传来的不祥预兆让我夜不能寐。凛冬将至，我们需要囤积粮食，并修补长城附近的防线。"
            elif is_lannister:
                thoughts = "凯岩城的黄金足够买下半个维斯特洛，但买不来绝对的忠诚。站在静思室中，我审视着战局地图。狮子必须时刻磨砺利爪，铁王座上的蠢货还在争吵，而我们必须在奔流河间地布下天罗地网。"
            else:
                thoughts = f"独自在静思室的一灯烛火下，我审视着这残酷的七大王国。在权力的游戏里，不当赢家，就是死路一条。我必须更加警惕，并用渡鸦联络我的盟友。"
                
            mock_text = f"""[INTERNAL_THOUGHTS]
{thoughts}
[EMOTIONAL_CHANGE]
新情绪: 戒备, 原因: 临冬城方向传来了冰雪异动的谣言与异鬼传闻
[SIGNIFICANT_MEMORY]
在学士指引防范下，我秘密回忆起了关于瓦雷利亚钢剑『寒冰/碎心』的秘传起源。
[PENDING_TALK_TO_PLAYER]
“听着，维斯特洛不是仁慈之地。你跟哪一方结盟，最好想清楚。”
[CLEAR_PENDING_TALK]
NONE
[NPC_COMMUNICATIONS]
Greatjon : 凛冬已至，集结奔流城的旧部，加强哨口戒备，防范铁群岛。
[PLAYER_RELATION_CHANGE]
NONE
[PLAYER_LETTER]
致我最信任的盟友：维斯特洛的政局波诡云谲。据可靠渡鸦密信汇报。在绝境长城附近，似乎有瓦雷利亚钢剑的残缺线报。请在暗中留意。
[EVENT_SUMMARY]
在风暴来临前，厉兵秣马。
"""
            return parse_ai_output(mock_text)
            
        resp = client.chat.completions.create(
            model=MODEL, 
            messages=[
                {"role": "system", "content": sys_prompt}, 
                {"role": "user", "content": prompt}
            ], 
            max_tokens=max_tokens
        )
        ai_resp = resp.choices[0].message.content.strip()
        
        # Track simulated usage estimate
        prompt_tokens = len(prompt) // 2
        comp_tokens = len(ai_resp) // 2
        cost_tracker.add_usage(0, prompt_tokens, comp_tokens)
        
        return parse_ai_output(ai_resp)
    except Exception as e:
        logger.error(f"  AI 请求失败: {e}")
        return None

def update_memory_chain(*args): pass

def safe_write_to_json(npc_json: dict, npc_string_id: str, npc_filepath: Path, result: dict, current_day: float, npc_name: str, engine_state: dict):
    modified = False
    npc_state = engine_state.setdefault(npc_string_id, {})
    
    if result.get('emotional_change'): 
        npc_json['EmotionalState'] = {"Mood": result['emotional_change']['mood'], "Reason": result['emotional_change']['reason']}
        modified = True
        
    # [1] 核心记忆提炼 -> AIGeneratedBackstory (持久化，不会因为聊天被冲走)
    if result.get('significant_memory'):
        orig_backstory = npc_json.get('AIGeneratedBackstory', '')
        if orig_backstory:
            npc_json['AIGeneratedBackstory'] = orig_backstory + f"\\n*(难忘转折)* {result['significant_memory']}"
        else:
            npc_json['AIGeneratedBackstory'] = f"*(难忘转折)* {result['significant_memory']}"
        modified = True

    # [2] 待办事项 / 前台命令 -> 私人备忘录风格
    if result.get('clear_talk'):
        npc_state['pending_talks'] = []
        modified = True
    if result.get('pending_talk'):
        npc_state.setdefault('pending_talks', []).append(result['pending_talk'])
        modified = True

    import hashlib
    # [3] 日志打包与抽象摘要: 不再将所有冗长独白和信件塞回 ConversationHistory，而是转入 SecretDiaries，只在 History 里保留卷轴标题。
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
        
        npc_json.setdefault("SecretDiaries", {})[diary_id_title] = diary_content
        modified = True
        
    # [4] 日志唤醒 (Active Recall): 如果 AI 本回合传入了 RECALL_DIARY，下回合将把它单独喂进 prompt 并阅后即焚
    recall_tag = result.get('recall_diary')
    if recall_tag and recall_tag != "NONE":
        diaries = npc_json.get("SecretDiaries", {})
        # 尝试模糊匹配，因为 AI 可能会改变格式
        matched_content = ""
        for tag_id, content in diaries.items():
            if recall_tag.strip().lower() in tag_id.lower() or tag_id.lower() in recall_tag.strip().lower():
                matched_content = f"[{tag_id}]\n{content}"
                break
        
        if matched_content:
            npc_json["ActiveRecallMemory"] = matched_content
            modified = True

    orig_personality = npc_json.get('AIGeneratedPersonality', '')
    if "[近期私人备忘录" in orig_personality:
        orig_personality = orig_personality.split("[近期私人备忘录")[0].strip()

    pending_talks = npc_state.get('pending_talks', [])
    if pending_talks:
        # 修改成更自然的待办事项表达
        new_personality = orig_personality + "\\n\\n[近期私人备忘录（接下来的计划事项）]：\\n" + "\\n".join(f"- {t}" for t in pending_talks)
    else:
        new_personality = orig_personality

    if npc_json.get('AIGeneratedPersonality') != new_personality:
        npc_json['AIGeneratedPersonality'] = new_personality
        modified = True

    if modified: 
        save_json(npc_filepath, npc_json)

def classify_npc(filepath: Path) -> Tuple[str, str, Optional[int]]:
    sid = filepath.stem
    return (sid, "active", 2000)

def process_npc(filepath: Path, current_day: float, engine_state: dict, cost_tracker: CostTracker, world_event_updates: dict, max_tokens: int) -> dict:
    npc_string_id = filepath.stem
    stats = {"processed": 0, "skipped": 0, "communications": 0, "player_letters": 0}
    
    # [3] 提供手动定义优先级的办法 (结合 React UI / config)
    priorities_path = Path("character_priorities.json")
    priorities = safe_load_json(priorities_path)
    char_priority = priorities.get(npc_string_id, "auto")
    
    if char_priority == "sleep":
        logger.info(f"  [强制休眠] 玩家手动设置了 {npc_string_id} 休眠，跳过。")
        return {**stats, "skipped": 1}
        
    force_wakeup = (char_priority == "force_active")
    
    npc_json = {"StringId": npc_string_id, "Name": npc_string_id}
    try:
        if filepath.exists():
           npc_json = load_json(filepath)
    except: pass
           
    npc_name = npc_json.get('Name', npc_string_id)

    # 4. Faction Allied prioritization filtering
    config_dict = load_config()
    allied_faction = config_dict.get("allied_faction", "")
    only_allied = config_dict.get("only_allied_simulation", False)

    is_allied = False
    if allied_faction:
        pat = allied_faction.lower()
        if (pat in npc_string_id.lower() or 
            pat in npc_name.lower() or 
            pat in str(npc_json.get("Faction", "")).lower() or
            pat in str(npc_json.get("Culture", "")).lower()):
            is_allied = True

    if only_allied and not is_allied and not force_wakeup:
        logger.info(f"  [势力局势过滤] {npc_string_id} 不属于当前效忠势力 '{allied_faction}'，自动静休。")
        return {**stats, "skipped": 1}
    
    # Skip simulation if nothing changed typically... overriding with force_wakeup or is_allied status
    if force_wakeup:
        logger.info(f"  [强制唤醒] {npc_string_id} 正被高优先级关注！分析继续。")
    elif is_allied:
         logger.info(f"  [重点势力关注] {npc_string_id} 属于选定效忠势力 '{allied_faction}'，强制激活推演！")

    res = analyze_npc(npc_json, npc_string_id, current_day, [], [], cost_tracker, max_tokens)
    if res:
        if res.get("_pending_prompt_approval"):
            engine_state.setdefault(npc_string_id, {})["status"] = "pending_prompt"
            return {**stats, "skipped": 1}
            
        engine_state.setdefault(npc_string_id, {})["status"] = "active"
        safe_write_to_json(npc_json, npc_string_id, filepath, res, current_day, npc_name, engine_state)
        return {**stats, "processed": 1}
    
    return {**stats, "skipped": 1}

def get_latest_game_day() -> float: return 1.0

def run_analysis_round(current_day: float, engine_state: dict, cost_tracker: CostTracker, stats: dict):
    if not NPC_FOLDER.exists():
        NPC_FOLDER.mkdir(parents=True, exist_ok=True)
        # Sandbox fake lords to demonstrate the functionality in the web UI
        fake_names = ["ruler_1_valand", "lord_2_khuzait", "companion_3_smith", "villager_4_bland"]
        for name in fake_names:
            save_json(NPC_FOLDER / f"{name}.json", {"StringId": name, "Name": name.replace('_', ' ').title(), "PlayerInfo": {}})
    
    files = list_npc_files(NPC_FOLDER)
    for f in files:
        if cost_tracker.is_budget_exceeded(): break
        res = process_npc(f, current_day, engine_state, cost_tracker, {}, 2000)
        for k in res: stats[k] += res[k]
        time.sleep(2) # artificially delay to show progress

def main_loop():
    global logger, NPC_FOLDER, OUR_FOLDER
    setup_logging()
    logger.info("=== NPC 后台生命引擎 v4.5 (极速版 + 前端 UI 集成增强) 启动 ===")
    
    if not BASE_AIINFLUENCE.exists():
        logger.info(f"配置路径 {BASE_AIINFLUENCE} 未发现真实游戏环境，使用沙盒模拟。")
        BASE_AIINFLUENCE.mkdir(parents=True, exist_ok=True)
        
    campaign_id = "simulator_mode"
    NPC_FOLDER = BASE_AIINFLUENCE / campaign_id
    OUR_FOLDER = NPC_FOLDER / "npc_lives"
    OUR_FOLDER.mkdir(parents=True, exist_ok=True)

    state_path = Path("engine_state.json")
    engine_state = safe_load_json(state_path)

    cost_tracker = CostTracker.from_dict(engine_state.get("cumulative_cost", {}))
    
    cycle = 0
    try:
        while True:
            cycle += 1
            config = load_config() # Reload dynamic settings
            logger.info(f"---- [周期 #{cycle}] 正在推演世界线 ----")
            
            stats = {k: 0 for k in ["processed", "skipped", "communications", "player_letters", "dormant", "deceased"]}
            run_analysis_round(1.0, engine_state, cost_tracker, stats)
            save_json(state_path, engine_state)
            
            logger.info(f"本轮完毕。参与运算角色: {stats['processed']} 人 | 跳过: {stats['skipped']} 人")
            time.sleep(5) # Delay for next loop in simulator
            
    except KeyboardInterrupt:
        logger.info("引擎被用户安全终止。")

if __name__ == "__main__":
    main_loop()
