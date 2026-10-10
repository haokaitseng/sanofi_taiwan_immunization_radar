"""Static configuration: vaccine taxonomy, keyword rules and source settings."""
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
ITEMS_DIR = DATA_DIR / "items"          # one JSONL file per publication day
SITE_DATA_DIR = ROOT / "site" / "data"  # what the static site reads

TZ = ZoneInfo("Asia/Taipei")
USER_AGENT = "tw-immunization-radar/0.1 (independent portfolio project)"
BACKFILL_DAYS = 90
DAILY_LOOKBACK_DAYS = 7   # daily runs re-read a week so a few failed runs never lose items (dedupe by URL)

# Vaccine groups, in chart-colour order. Enhanced flu is split three ways:
# the class in general when the type is not stated ("enh"), adjuvanted ("adj") and high-dose ("hd").
VACCINES = {
    "flu": {"label": "Flu", "zh": "流感疫苗"},
    "enh": {"label": "Enhanced", "zh": "加強型流感疫苗（佐劑或高劑量，未指明）"},
    "adj": {"label": "Adjuvanted", "zh": "佐劑流感疫苗"},
    "hd": {"label": "High-dose", "zh": "高劑量流感疫苗"},
    "rsv": {"label": "RSV", "zh": "呼吸道融合病毒"},
    "tdap": {"label": "Tdap", "zh": "百日咳（Tdap）"},
}

# Keyword rules for the deterministic tagger. Case-insensitive regular expressions.
# The LLM tagger refines these; the rules are the fallback and the collection pre-filter.
# Note: Chinese characters count as word characters, so \b fails in "RSV疫苗"; use ASCII-letter lookarounds instead.
_A = r"(?<![a-z])"   # no Latin letter before
_Z = r"(?![a-z])"    # no Latin letter after
KEYWORDS = {
    "flu": [r"流感疫苗", r"流感.{0,6}疫苗", r"公費流感", r"influenza vaccin", _A + r"flu (?:vaccin|shot|jab)"],
    "enh": [r"加強型(?:流感)?疫苗", r"enhanced (?:influenza|flu) vaccin"],
    "adj": [r"佐劑", r"adjuvant"],
    "hd": [r"高劑量", r"high[- ]dose", r"(?:4|四)\s*倍(?:的)?抗原"],
    "rsv": [_A + r"rsv" + _Z, r"呼吸道融合病毒", r"呼吸道合胞病毒", r"beyfortus", r"nirsevimab", r"尼塞韋",
            r"abrysvo", r"arexvy", r"mresvia", r"clesrovimab", r"enflonsia"],
    "tdap": [_A + r"tdap" + _Z, r"百日咳", r"pertussis", r"whooping cough", r"boostrix", r"adacel"],
}
# Brand names that identify an enhanced type even without a flu keyword nearby. Taiwan 2026 public programme:
# FLUAD = 輔流禦流感疫苗 (TTY Biopharm, adjuvanted, 50+); Efluelda = 菲優達高劑量三價流感疫苗 (Sanofi, high-dose, 65+).
ENHANCED_BRANDS = {"adj": [_A + r"fluad" + _Z, _A + r"mf59", r"輔流禦"],
                   "hd": [r"efluelda", r"菲優達", r"fluzone high"]}
FLU_CONTEXT = r"流感|influenza|" + _A + r"flu" + _Z
# A search result whose headline names no vaccine is still kept, with the search's vaccine as a provisional tag,
# if the headline mentions one of these broad terms; the LLM tagger then confirms or drops it.
BROAD_HEALTH = r"疫苗|接種|流感|呼吸道|咳|重症|嬰|長者|孕"
# Animal influenza is out of scope.
EXCLUDE = r"禽流感|豬流感|avian (?:flu|influenza)|bird flu|豬瘟"

# ---------------------------------------------------------------- policy sources
CDC = {
    "base": "https://www.cdc.gov.tw",
    "press_list": "https://www.cdc.gov.tw/Bulletin/List/MmgtpeidAR5Ooai4-fgHzQ",       # 新聞稿 (dated, ?page=N)
    "letters_rss": "https://www.cdc.gov.tw/RSS/RssXml/khD5i5xbqmYc8zCDhJimNg?type=1",   # 致醫界通函
    "clarify_rss": "https://www.cdc.gov.tw/RSS/RssXml/VYgwM0EtOqAhCmd0iJrhfg?type=4",   # 澄清專區
}
TFDA = {
    "rss": {
        "news": "https://www.fda.gov.tw/TC/rssNews.ashx",
        "announcement": "https://www.fda.gov.tw/TC/rssAnnouncement.ashx",
        "drug_safety": "https://www.fda.gov.tw/TC/rssLight_Drug.ashx",
        "rumor": "https://www.fda.gov.tw/TC/rssNewsAboutRumor.ashx",
    },
    # Paginated lists (&pn=N) for backfill.
    "lists": {
        "news": "https://www.fda.gov.tw/TC/news.aspx?cid=4",
        "announcement": "https://www.fda.gov.tw/TC/news.aspx?cid=3",
    },
}
# TFDA publishes mostly food notices; keep only items that also mention vaccines or biologics.
TFDA_PREFILTER = r"疫苗|vaccin|生物藥品|檢驗封緘|單株抗體"

# ---------------------------------------------------------------- media sources
# Google News search RSS, zh-TW edition. Daily runs use when:7d; backfill uses weekly after:/before: windows.
# The feed carries headlines only, but Google matches the query against the full article. So each article records
# which searches found it (Item.found_by): evidence that its text mentions that vaccine type or funding, even when
# the headline just says 加強型. (query, key): vaccine keys also serve as the provisional tag for headlines that
# name no vaccine; funding keys (public, self_pay) are evidence only.
# One term per search: the zh-TW feed silently drops most results for OR queries (tested 2026-10-10:
# "RSV 疫苗 OR 呼吸道融合病毒 OR ..." returned 9 articles in 90 days; 呼吸道融合病毒 alone returned 53).
# Latin brand names (Beyfortus, FLUAD, Efluelda, Tdap) return nothing in this edition; headline keywords still catch them.
GNEWS_QUERIES = [
    ("流感疫苗", "flu"),
    ("加強型流感疫苗", "enh"),
    ("高劑量流感疫苗", "hd"),
    ("菲優達", "hd"),
    ("佐劑流感疫苗", "adj"),
    ("輔流禦", "adj"),
    ("公費 流感疫苗", "public"),
    ("自費 流感疫苗", "self_pay"),
    ("RSV 疫苗", "rsv"),
    ("呼吸道融合病毒", "rsv"),
    ("RSV 單株抗體", "rsv"),
    ("百日咳", "tdap"),
]
FUNDING_KEYS = ("public", "self_pay")
# The zh-TW Google News edition also carries Hong Kong and mainland outlets; their local programmes are out of scope.
NON_TAIWAN_OUTLETS = (r"TVB|Now ?新聞|now\.com|香港|明報|東網|on\.cc|星島|Singtao|文匯|大公|信報|RTHK|am730|頭條日報|"
                      r"巴士的報|dotdotnews|點新聞|i-CABLE|有線新聞|New Monday|HK01|HKET|"
                      r"世界新聞網|World Journal|澳門|新華|人民網|央視|中新網|環球網|新浪新闻|网易|搜狐")

# ---------------------------------------------------------------- social sources
# PTT refuses requests from cloud (GitHub Actions) IP ranges, so it only refreshes on local runs.
LOCAL_ONLY_SOURCES = {"ptt"}
PTT_BOARDS = ["BabyMother", "Preschooler", "Gossiping", "WomenTalk", "Health", "Doctor-Info", "nurse"]
# PTT search matches titles only. "疫苗" is the catch-all; the tagger then reads title + body to keep relevant posts.
PTT_KEYWORDS = ["疫苗", "流感", "高劑量", "佐劑", "RSV", "呼吸道融合", "百日咳", "Tdap"]

# Apify actors (pay per result). Each run has a hard USD cap. One run of both costs about US$0.46, so on the
# free plan (US$5/month) they run twice a week; with a paid plan, set APIFY_WEEKDAYS = range(7).
APIFY_WEEKDAYS = (0, 3)   # Monday, Thursday (Asia/Taipei); each run looks back 7 days
APIFY = {
    "threads": {
        "actor": "futurizerush/meta-threads-scraper",
        "keywords": ["流感疫苗", "高劑量流感疫苗", "佐劑流感疫苗", "加強型流感疫苗", "菲優達", "輔流禦", "自費流感疫苗",
                     "RSV疫苗", "RSV單株抗體", "百日咳疫苗"],
        "max_posts": 30, "max_posts_backfill": 150,       # per keyword
        "cap_usd": 0.5, "cap_usd_backfill": 4.0,
    },
    "facebook": {
        # Public institutional pages only; comments on their vaccine posts are the signal.
        "pages": ["https://www.facebook.com/TWCDC", "https://www.facebook.com/mohw.gov.tw"],
        "posts_per_page": 20, "comments_per_post": 40,
        "cap_usd": 0.5,
    },
}

# ---------------------------------------------------------------- attention
WIKI_ARTICLES = {
    "flu": [("zh.wikipedia", "季節性流感疫苗"), ("en.wikipedia", "Influenza_vaccine")],
    "rsv": [("zh.wikipedia", "人類呼吸道合胞病毒"), ("en.wikipedia", "Respiratory_syncytial_virus"),
            ("en.wikipedia", "Nirsevimab"), ("en.wikipedia", "Respiratory_syncytial_virus_vaccine")],
    "tdap": [("zh.wikipedia", "百日咳"), ("zh.wikipedia", "百日咳疫苗"),
             ("en.wikipedia", "DPT_vaccine"), ("en.wikipedia", "Whooping_cough")],
}
