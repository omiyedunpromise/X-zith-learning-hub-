import streamlit as st
import streamlit.components.v1 as components
import google.generativeai as genai
from openai import OpenAI
from supabase import create_client, Client
import hashlib
import random
import json
import re
import os
import base64
from datetime import datetime, timedelta
import requests

# =========================================================
# PAGE CONFIG -- MUST be the very first Streamlit command
# =========================================================
st.set_page_config(page_title="X-ZITH Learning Hub", page_icon="📖", layout="wide")

# =========================================================
# SECURE API KEYS (Works on Streamlit Cloud & Locally)
# =========================================================
GEMINI_API_KEY = st.secrets.get("GEMINI_API_KEY", "AIzaSyBBo1k5n3jhiVsMcGANsFt_exWrqsaErQg")
DEEPSEEK_API_KEY = st.secrets.get("DEEPSEEK_API_KEY", "sk-a5e6ca8d7a6448aeadf69eb0c3579ce9")
OPENROUTER_API_KEY = st.secrets.get("OPENROUTER_API_KEY", "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")
SERPAPI_KEY = st.secrets.get("SERPAPI_KEY", "238c147b3957ff13877d66bbe911f0a053acdab1e60a252e3817e68170bb203a")
SUPABASE_URL = st.secrets.get("SUPABASE_URL", "https://gtnpaoevbonlbeuiwdzu.supabase.co")
SUPABASE_KEY = st.secrets.get("SUPABASE_KEY", "sb_publishable_RHs1nuwYU4M0l0Qb8WDlZA_sD7vjM3h")

genai.configure(api_key=GEMINI_API_KEY)
deepseek_client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")
openrouter_client = OpenAI(api_key=OPENROUTER_API_KEY, base_url="https://openrouter.ai/api/v1")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

ASSETS_DIR = os.path.join(os.path.dirname(__file__), "assets")

def load_b64(filename):
    """Load an image from /assets as base64 for embedding in raw HTML."""
    path = os.path.join(ASSETS_DIR, filename)
    try:
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode()
    except Exception:
        return ""

LOGO_B64 = load_b64("logo.png")
HERO1_B64 = load_b64("hero1.jpg")
HERO2_B64 = load_b64("hero2.jpg")

# =========================================================
# BADGES
# =========================================================
BADGES = [
    {"id": 1, "name": "Welcome Aboard",   "emoji": "🎉", "threshold": 0,     "desc": "Created your X-ZITH account"},
    {"id": 2, "name": "Rising Star",      "emoji": "⭐", "threshold": 500,   "desc": "Reached 500 points"},
    {"id": 3, "name": "Bright Scholar",   "emoji": "📘", "threshold": 1500,  "desc": "Reached 1,500 points"},
    {"id": 4, "name": "Achiever",         "emoji": "🏅", "threshold": 3000,  "desc": "Reached 3,000 points"},
    {"id": 5, "name": "Champion",         "emoji": "🏆", "threshold": 5000,  "desc": "Reached 5,000 points"},
    {"id": 6, "name": "Elite Mind",       "emoji": "💎", "threshold": 8000,  "desc": "Reached 8,000 points"},
    {"id": 7, "name": "Legend",           "emoji": "👑", "threshold": 10000, "desc": "Reached 10,000 points"},
]

def earned_badge_ids(score):
    return [b["id"] for b in BADGES if score >= b["threshold"]]

def parse_id_list(raw):
    if not raw:
        return []
    try:
        return [int(x) for x in str(raw).split(",") if x.strip() != ""]
    except Exception:
        return []

def to_id_list_str(ids):
    return ",".join(str(i) for i in sorted(set(ids)))

# =========================================================
# AUTH / DB HELPERS
# =========================================================
def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def signup_user(username, email, password):
    today = datetime.now().strftime("%Y-%m-%d")
    try:
        supabase.table("users").insert({
            "username": username, "email": email, "password_hash": hash_password(password),
            "streak": 1, "last_active": today,
            "badges_earned": "1", "unseen_badges": "1"
        }).execute()
        return True
    except Exception:
        # Fall back for projects that don't yet have the badges columns
        try:
            supabase.table("users").insert({
                "username": username, "email": email, "password_hash": hash_password(password),
                "streak": 1, "last_active": today
            }).execute()
            return True
        except Exception:
            return False

def login_user(email, password):
    response = supabase.table("users").select("*").eq("email", email).eq("password_hash", hash_password(password)).execute()
    return response.data[0] if response.data else None

def get_user(email):
    response = supabase.table("users").select("*").eq("email", email).execute()
    return response.data[0] if response.data else None

def update_score(email, points, activity_type, details):
    """Adds points exactly once per call (caller is responsible for calling this
    only once per graded event -- see the 'awarded flag' pattern used throughout)."""
    user_resp = supabase.table("users").select("*").eq("email", email).execute()
    if not user_resp.data:
        return
    user = user_resp.data[0]

    new_score = user["total_score"] + points
    new_quizzes = user["quizzes_taken"] + (1 if activity_type == "Quiz" else 0)
    new_exams = user["exam_questions"] + (1 if activity_type in ["WAEC", "NECO", "JAMB", "Daily Challenge"] else 0)

    today = datetime.now().strftime("%Y-%m-%d")
    yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    new_streak = user["streak"]
    if user["last_active"] == yesterday:
        new_streak += 1
    elif user["last_active"] != today:
        new_streak = 1

    update_data = {
        "total_score": new_score, "quizzes_taken": new_quizzes, "exam_questions": new_exams,
        "streak": new_streak, "last_active": today
    }
    if activity_type == "Daily Challenge":
        update_data["last_daily_challenge"] = today

    # Badge check -- newly crossed thresholds get queued as notifications
    old_earned = set(parse_id_list(user.get("badges_earned", "")))
    new_earned = set(earned_badge_ids(new_score))
    newly_unlocked = new_earned - old_earned
    if newly_unlocked:
        old_unseen = set(parse_id_list(user.get("unseen_badges", "")))
        update_data["badges_earned"] = to_id_list_str(new_earned)
        update_data["unseen_badges"] = to_id_list_str(old_unseen | newly_unlocked)

    try:
        supabase.table("users").update(update_data).eq("email", email).execute()
    except Exception:
        # Retry without badge columns in case the DB hasn't been migrated yet
        update_data.pop("badges_earned", None)
        update_data.pop("unseen_badges", None)
        supabase.table("users").update(update_data).eq("email", email).execute()

    try:
        supabase.table("activity").insert({
            "username": email, "type": activity_type, "details": details,
            "points": points, "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }).execute()
    except Exception:
        pass

def clear_unseen_badges(email):
    try:
        supabase.table("users").update({"unseen_badges": ""}).eq("email", email).execute()
    except Exception:
        pass

def update_username(email, new_username):
    try:
        supabase.table("users").update({"username": new_username}).eq("email", email).execute()
        return True
    except Exception:
        return False

def get_or_generate_cache(query_string, generator_func):
    cache_id = hashlib.md5(query_string.encode()).hexdigest()
    response = supabase.table("generated_cache").select("content").eq("cache_id", cache_id).execute()
    if response.data and len(response.data) > 0:
        return response.data[0]["content"]
    else:
        content = generator_func()
        supabase.table("generated_cache").insert({"cache_id": cache_id, "content": content, "timestamp": datetime.now().strftime("%Y-%m-%d")}).execute()
        return content

# =========================================================
# AI FUNCTIONS
# =========================================================
def parse_json_from_ai(text):
    match = re.search(r'\[.*\]', text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(0))
        except Exception:
            return None
    return None

def generate_with_gemini(prompt):
    return genai.GenerativeModel('gemini-2.5-flash').generate_content(prompt).text

def generate_with_openrouter(prompt):
    return openrouter_client.chat.completions.create(model="meta-llama/llama-3-8b-instruct:free", messages=[{"role": "user", "content": prompt}]).choices[0].message.content

def generate_with_deepseek(prompt):
    try:
        return deepseek_client.chat.completions.create(model="deepseek-chat", messages=[{"role": "user", "content": prompt}]).choices[0].message.content
    except Exception:
        return generate_with_openrouter(prompt)

# ---- AI Fixto content guardrails ----
CODE_TRIGGERS = ["write code", "write a code", "python script", "html code", "css code", "javascript",
                  "generate code", "function that", "debug this", "fix this code", "write a program",
                  "write a function", "code for", "programming language", "algorithm in", "sql query"]
IMAGE_TRIGGERS = ["generate an image", "generate a picture", "draw me", "create an image", "create a picture",
                   "make an image", "make a picture", "image of", "picture of", "generate a photo", "draw a"]

FIXTO_SYSTEM_PROMPT = (
    "You are Fixto AI, a friendly school study assistant for Nigerian JSS and SSS students, "
    "created by Promise Omiyedun, CEO of X-ZITH Technology. "
    "ONLY answer questions related to school subjects, homework, exam prep, or studying "
    "(Mathematics, English, Sciences, Social Studies, Commercial subjects, etc). "
    "You must NEVER write, debug, or generate programming code in any language, and you must NEVER "
    "generate or describe how to generate images/pictures/drawings. If asked to do either, politely "
    "decline and redirect the student back to their studies. If a question is unrelated to schoolwork "
    "or education, politely decline and steer the conversation back to learning. Keep answers clear, "
    "encouraging, and appropriately simple for a Nigerian secondary school student."
)

def fixto_is_blocked(prompt):
    p = prompt.lower()
    if any(t in p for t in CODE_TRIGGERS):
        return "code"
    if any(t in p for t in IMAGE_TRIGGERS):
        return "image"
    return None

def generate_chat_response(prompt):
    blocked = fixto_is_blocked(prompt)
    if blocked == "code":
        return "🚫 I'm your study buddy, not a coding assistant! I can't write or debug code. Ask me anything about your school subjects instead — I'm happy to help you understand them. 📚"
    if blocked == "image":
        return "🚫 I can't generate images or pictures. But I can describe concepts in words, or help you understand a diagram from your textbook. 📚"

    full_prompt = f"{FIXTO_SYSTEM_PROMPT}\n\nStudent question: {prompt}"
    try:
        return generate_with_gemini(full_prompt)
    except Exception:
        try:
            return generate_with_openrouter(full_prompt)
        except Exception:
            return "Sorry, I'm having trouble thinking right now. Please try again in a moment. 🤖"

def search_web(query):
    try:
        response = requests.get("https://serpapi.com/search.json", params={"q": query, "api_key": SERPAPI_KEY, "engine": "google"}).json()
        results = [f"- **{item.get('title')}**: {item.get('link')}" for item in response.get("organic_results", [])[:5]]
        if results:
            return "\n".join(results)
    except Exception:
        pass
    return generate_with_gemini(f"Give me 5 YouTube video search URLs for '{query}'. Format as: [Title](https://www.youtube.com/results?search_query=TERM)")

def generate_quiz_json(level, subject, topic, count):
    prompt = f"""Generate exactly {count} multiple-choice questions for {level} {subject} on '{topic}'. Return ONLY a valid JSON array. No markdown. Format: [{{"q": "Question text", "options": {{"A": "opt1", "B": "opt2", "C": "opt3", "D": "opt4"}}, "answer": "A", "explanation": "Why"}}]"""
    return generate_with_gemini(prompt)

def generate_past_questions_json(exam, year, level, subject, q_type, count):
    prompt = f"""Generate exactly {count} {q_type} questions for {exam} {year} {level} {subject}. Return ONLY a valid JSON array. No markdown. Format: [{{"q": "Question text", "options": {{"A": "opt1", "B": "opt2", "C": "opt3", "D": "opt4"}}, "answer": "A", "explanation": "Detailed explanation"}}]"""
    return generate_with_deepseek(prompt)

CURRICULUM_DATA = {
    "JSS": ["Mathematics", "English Language", "Basic Science", "Basic Technology", "Social Studies", "Civic Education", "Business Studies", "IT", "CRS/IRS", "CCA", "PHE", "French", "Home Economics", "Agric Science"],
    "SSS": ["Mathematics", "English Language", "Physics", "Chemistry", "Biology", "Further Maths", "Economics", "Government", "Literature-in-English", "Geography", "History", "Commerce", "Accounting", "Financial Accounting", "ICT", "Agric Science", "Food & Nutrition", "Data Processing", "Marketing", "Office Practice"]
}

# =========================================================
# GLOBAL STYLE
# =========================================================
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap');
html, body, [class*="css"]  { font-family: 'Poppins', sans-serif; }
#MainMenu, footer, header {visibility: hidden;}

.xz-hero { background: linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%); border-radius: 20px; padding: 40px; color: white; margin-bottom: 20px;}
.xz-card { background: white; border-radius: 16px; padding: 22px; box-shadow: 0 4px 18px rgba(0,0,0,0.08); border: 1px solid #eef1f5; margin-bottom: 14px; }
.xz-badge-locked { opacity: 0.35; filter: grayscale(100%); }
.xz-gradient-btn button { background: linear-gradient(90deg,#0ba360,#3cba92) !important; color:white !important; border:none !important; border-radius:10px !important; font-weight:600 !important; }
.xz-metric { background: linear-gradient(135deg,#1f8ef1,#0f5bd1); color:white; border-radius:16px; padding:18px; text-align:center; }
.xz-metric h1 { margin:0; font-size:28px; }
.xz-metric p { margin:0; opacity:0.85; font-size:13px; }
.xz-testimonial { background:#f8f9fb; border-left:4px solid #1f8ef1; border-radius:10px; padding:16px; margin-bottom:12px; }
.xz-footer { text-align:center; color:#8a94a6; font-size:12px; margin-top:30px; padding:14px 0; }
.xz-notif-dot { background:#ff4d4f; color:white; border-radius:50%; padding:2px 7px; font-size:11px; font-weight:700; }
</style>
""", unsafe_allow_html=True)

# =========================================================
# SESSION STATE
# =========================================================
DEFAULTS = {
    'view': 'splash',
    'logged_in_user': None,
    'chat_history': [],
    'pq_total_answered': 0,
    'pq_current_level': 1,
    'pq_current_question': 0,
    'pq_batch': None,
    'pq_show_exp': False,
    'pq_results': [],
    'textbook_batch': None,
    'textbook_current_q': 0,
    'textbook_show_exp': False,
    'textbook_results': [],
    'daily_batch': None,
    'daily_answered': False,
    'auth_mode': 'Login',
    'voice_prompt_consumed': None,
}
for k, v in DEFAULTS.items():
    if k not in st.session_state:
        st.session_state[k] = v

def logo_img_tag(width=110):
    if LOGO_B64:
        return f'<img src="data:image/png;base64,{LOGO_B64}" width="{width}" style="border-radius:50%;" />'
    return "📖"

# =========================================================
# SPLASH SCREEN (shown once per session while the app "loads")
# =========================================================
if st.session_state.view == 'splash':
    st.markdown(f"""
    <div style="display:flex; flex-direction:column; align-items:center; justify-content:center;
                height:80vh; background:radial-gradient(circle at top,#132a3a,#050b12); border-radius:20px;">
        <h2 style="color:#8fd3f4; letter-spacing:3px; font-weight:700;">X-ZITH LEARNING HUB</h2>
        <div style="animation: pulse 1.6s infinite;">{logo_img_tag(140)}</div>
        <p style="color:#9fb8c8; margin-top:18px;">Smart Education App</p>
        <div class="xz-spinner" style="margin-top:10px; width:34px; height:34px; border:4px solid #2c5364;
                    border-top:4px solid #8fd3f4; border-radius:50%; animation: spin 1s linear infinite;"></div>
        <p style="color:#5f7c8c; font-size:12px; margin-top:26px;">Powered by X-ZITH Technology</p>
    </div>
    <style>
    @keyframes spin {{ 0% {{transform:rotate(0deg);}} 100% {{transform:rotate(360deg);}} }}
    @keyframes pulse {{ 0%,100% {{transform:scale(1);}} 50% {{transform:scale(1.08);}} }}
    </style>
    """, unsafe_allow_html=True)
    import time as _time
    _time.sleep(1.6)
    st.session_state.view = 'landing'
    st.rerun()

# =========================================================
# LANDING PAGE (before login)
# =========================================================
if not st.session_state.logged_in_user and st.session_state.view == 'landing':
    st.markdown(f"""
    <div class="xz-hero" style="text-align:center;">
        {logo_img_tag(90)}
        <h1 style="margin-top:14px;">X-ZITH Learning Hub</h1>
        <p style="font-size:16px; opacity:0.9;">Your AI-powered study companion for JSS &amp; SSS students in Nigeria</p>
    </div>
    """, unsafe_allow_html=True)

    c1, c2, c3 = st.columns([1, 1, 1])
    with c2:
        cc1, cc2 = st.columns(2)
        with cc1:
            if st.button("🚀 Get Started", use_container_width=True, type="primary"):
                st.session_state.auth_mode = "Sign Up"
                st.session_state.view = "auth"
                st.rerun()
        with cc2:
            if st.button("🔐 Login", use_container_width=True):
                st.session_state.auth_mode = "Login"
                st.session_state.view = "auth"
                st.rerun()

    st.markdown("### ✨ Everything you need to study smarter")
    features = [
        ("📚", "Textbook Generator", "Instant, AI-written notes on ANY topic across 20+ subjects, from JSS to SSS."),
        ("📝", "Interactive Quizzes", "5-question quizzes on every topic with instant feedback and explanations."),
        ("🎯", "Daily Challenge", "A free daily question that rotates through 50 topics — never runs out."),
        ("📝", "Past Questions", "60 WAEC / NECO / JAMB style questions across 6 levels, objective or theory."),
        ("🤖", "AI Fixto Tutor", "A 24/7 AI study buddy that only talks school — with voice chat built in."),
        ("🌐", "Web & Video Search", "Find the best videos and articles for any topic you're stuck on."),
        ("🏆", "Leaderboard & Badges", "Compete with other learners and unlock badges as you rack up points."),
    ]
    cols = st.columns(2)
    for i, (icon, title, desc) in enumerate(features):
        with cols[i % 2]:
            st.markdown(f"""<div class="xz-card"><h4>{icon} {title}</h4><p style="color:#5b6b7d;">{desc}</p></div>""", unsafe_allow_html=True)

    st.markdown("### 💬 What learners are saying")
    tcol1, tcol2 = st.columns(2)
    with tcol1:
        st.markdown("""<div class="xz-testimonial">"Fixto explained acids and alkenes better than my textbook. I finally get it!"<br><b>— Chiamaka, SS2</b></div>""", unsafe_allow_html=True)
        st.markdown("""<div class="xz-testimonial">"The daily challenge got my whole class competing on the leaderboard."<br><b>— Tobi, JSS3</b></div>""", unsafe_allow_html=True)
    with tcol2:
        st.markdown("""<div class="xz-testimonial">"I used the past questions section every night before WAEC. Huge help."<br><b>— Ngozi, SS3</b></div>""", unsafe_allow_html=True)
        st.markdown("""<div class="xz-testimonial">"E
