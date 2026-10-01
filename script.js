/* ============================================================
   X-ZITH Learning Hub — Main Application Script
   ============================================================ */

// ============================================================
//  CONFIG
// ============================================================
const API_URL = "https://x-zith-backend.onrender.com";
const SESSION_KEY = 'xzith_user';
const PAGE_KEY = 'xzith_last_page';
const RECENT_QUIZZES_KEY = 'xzith_recent_quizzes';
const RECENT_STUDY_KEY = 'xzith_recent_study';
const REQUEST_TIMEOUT_MS = 90000;
const SLOW_SERVER_HINT_MS = 8000;
const SPEAK_LABEL = '🔊 Read Aloud';
const QUIZ_QUESTION_TIME = 20; // seconds

let currentUser = null;
let notifications = [];
let darkMode = storeGet('darkMode') === 'true';
let selectedLevel = null;
let selectedSubject = null;
let chatBusy = false;
let isSpeaking = false;
let authErrorTimer = null;

// Quiz state
let activeQuiz = null;         // { questions, currentIndex, score, timerId, timeLeft }

// Past questions state
let totalQuestionsGenerated = 0;
let currentExam = '', currentYear = '', currentSubject = '', currentTopic = '';

// Chat image state
let pendingChatImage = null;   // data URL

// Theory state
let theoryExam = '';
let theorySubject = '';
let theoryQuestions = [];      // array of 5 question strings

// ============================================================
//  SUBJECT LISTS
// ============================================================
const JSS_SUBJECTS = {
    'Core Subjects': ['English Language', 'Mathematics', 'Basic Science', 'Basic Technology', 'Social Studies', 'Civic Education', 'Computer Studies (ICT)'],
    'Prevocational & Practical': ['Agricultural Science', 'Home Economics', 'Business Studies', 'Physical & Health Education', 'Cultural & Creative Arts', 'Security Education'],
    'Religion & History': ['Christian Religious Studies', 'Islamic Religious Studies', 'History'],
    'Languages': ['Yoruba', 'Igbo', 'Hausa', 'French', 'Arabic']
};

const SSS_SUBJECTS = {
    'Core Subjects': ['English Language', 'Mathematics', 'Civic Education'],
    'Sciences': ['Physics', 'Chemistry', 'Biology', 'Further Mathematics', 'Agricultural Science', 'Geography', 'Computer Studies', 'Physical Education', 'Health Education', 'Technical Drawing'],
    'Arts & Humanities': ['Literature in English', 'Government', 'History', 'Christian Religious Studies', 'Islamic Religious Studies', 'Visual Art', 'Music'],
    'Commercial & Social Sciences': ['Economics', 'Financial Accounting', 'Commerce', 'Marketing', 'Insurance', 'Office Practice', 'Store Management'],
    'Languages': ['Yoruba', 'Igbo', 'Hausa', 'French', 'Arabic']
    // NOTE: Vocational & Technical removed per request — add back if needed
};

const JAMB_SUBJECTS = {
    'Compulsory': ['Use of English'],
    'Sciences': ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Agricultural Science', 'Computer Studies', 'Physical & Health Education'],
    'Arts': ['Literature in English', 'Government', 'History', 'Christian Religious Studies', 'Islamic Religious Studies', 'Art (Fine Art)', 'Music'],
    'Social Sciences & Commercial': ['Economics', 'Commerce', 'Principles of Accounts', 'Geography', 'Home Economics'],
    'Languages': ['French', 'Yoruba', 'Igbo', 'Hausa', 'Arabic']
};

const PQ_SUBJECTS = { WAEC: SSS_SUBJECTS, NECO: SSS_SUBJECTS, JAMB: JAMB_SUBJECTS };
const THEORY_SUBJECTS = SSS_SUBJECTS;

// ============================================================
//  HELPERS
// ============================================================
function storeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
function storeSet(key, value) { try { localStorage.setItem(key, value); } catch (e) {} }
function storeRemove(key) { try { localStorage.removeItem(key); } catch (e) {} }
function $(id) { return document.getElementById(id); }

function escapeHtml(value) {
    return String(value === undefined || value === null ? '' : value).replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}

function inlineFormat(escaped) {
    return escaped
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/(^|[^\w*])\*(?!\s)([^*]+?)\*(?![\w*])/g, '$1<em>$2</em>')
        .replace(/`([^`]+?)`/g, '<code>$1</code>');
}

function formatRichText(text) {
    const lines = escapeHtml(text).replace(/\r/g, '').split('\n');
    let html = '';
    let listType = null;
    let inCode = false;
    let codeBuf = [];
    const closeList = () => { if (listType) { html += '</' + listType + '>'; listType = null; } };
    const openList = type => { if (listType !== type) { closeList(); html += '<' + type + '>'; listType = type; } };

    lines.forEach(raw => {
        const line = raw.trim();
        if (/^```/.test(line)) {
            if (inCode) {
                html += '<pre><code>' + codeBuf.join('\n') + '</code></pre>';
                codeBuf = []; inCode = false;
            } else { closeList(); inCode = true; }
            return;
        }
        if (inCode) { codeBuf.push(raw); return; }

        let m;
        if (!line) { closeList(); return; }
        if (/^(-{3,}|_{3,}|\*{3,})$/.test(line)) { closeList(); html += '<hr>'; return; }
        if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
            closeList();
            const tag = m[1].length <= 2 ? 'h3' : 'h4';
            html += '<' + tag + '>' + inlineFormat(m[2]) + '</' + tag + '>';
        } else if ((m = line.match(/^[-*•]\s+(.*)$/))) {
            openList('ul'); html += '<li>' + inlineFormat(m[1]) + '</li>';
        } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
            openList('ol'); html += '<li>' + inlineFormat(m[1]) + '</li>';
        } else {
            closeList(); html += '<p>' + inlineFormat(line) + '</p>';
        }
    });
    closeList();
    if (inCode && codeBuf.length) html += '<pre><code>' + codeBuf.join('\n') + '</code></pre>';
    return html;
}

function safeUrl(url) {
    try {
        const u = new URL(url, window.location.href);
        return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : '#';
    } catch (e) { return '#'; }
}

function showToast(message, type = 'info', duration = 4000) {
    const box = $('toastBox');
    if (!box) return;
    const toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    box.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

async function withLoading(btn, label, task) {
    if (btn && btn.disabled) return;
    const original = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = label; btn.style.opacity = '0.7'; }
    try { return await task(); }
    finally {
        if (btn) { btn.disabled = false; btn.innerHTML = original; btn.style.opacity = ''; }
    }
}

function onEnter(id, handler) {
    const el = $(id);
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); handler(); } });
}

// ============================================================
//  API
// ============================================================
async function apiCall(endpoint, data, method = 'POST') {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const slowHint = setTimeout(() => {
        showToast('⏳ Waking up the server... the first request can take up to a minute.', 'info', 9000);
    }, SLOW_SERVER_HINT_MS);

    try {
        const options = { method, signal: controller.signal };
        if (method !== 'GET') {
            options.headers = { 'Content-Type': 'application/json' };
            if (data) options.body = JSON.stringify(data);
        }
        const res = await fetch(API_URL + endpoint, options);
        let body = null;
        try { body = await res.json(); } catch (e) { body = null; }

        if (!res.ok) {
            let msg = body && (body.error || body.detail || body.message);
            if (msg && typeof msg !== 'string') msg = JSON.stringify(msg);
            return { error: msg || ('Server error (' + res.status + ')'), status: res.status };
        }
        return body || {};
    } catch (err) {
        if (err.name === 'AbortError') return { error: 'The server took too long to respond. Please try again.' };
        return { error: 'Cannot reach the server. Check your internet connection and try again.' };
    } finally {
        clearTimeout(timeout);
        clearTimeout(slowHint);
    }
}

function wakeServer() {
    try { fetch(API_URL + '/', { mode: 'no-cors' }).catch(() => {}); } catch (e) {}
}

// ============================================================
//  DARK MODE
// ============================================================
function toggleTheme() {
    darkMode = !darkMode;
    storeSet('darkMode', darkMode);
    document.body.classList.toggle('dark-mode', darkMode);
    $('landingThemeIcon').textContent = darkMode ? '☀️' : '🌙';
    $('appThemeIcon').textContent = darkMode ? '☀️' : '🌙';
}

// ============================================================
//  LANDING / AUTH NAVIGATION
// ============================================================
function showLoginPage() {
    $('landingPage').classList.add('hidden');
    $('authPage').classList.remove('hidden');
    switchAuthTab('login');
}
function showSignupPage() {
    $('landingPage').classList.add('hidden');
    $('authPage').classList.remove('hidden');
    switchAuthTab('signup');
}
function goBackToLanding() {
    $('authPage').classList.add('hidden');
    $('landingPage').classList.remove('hidden');
    switchAuthTab('login');
    window.scrollTo(0, 0);
}
function scrollToFeatures() {
    $('featuresSection').scrollIntoView({ behavior: 'smooth' });
}
function switchAuthTab(tab) {
    $('loginTab').classList.toggle('hidden', tab !== 'login');
    $('signupTab').classList.toggle('hidden', tab !== 'signup');
    $('tabLoginBtn').classList.toggle('active', tab === 'login');
    $('tabSignupBtn').classList.toggle('active', tab === 'signup');
    $('errorMsg').classList.remove('show');
}

// ============================================================
//  SESSION
// ============================================================
function normalizeUser(user) {
    const u = Object.assign({}, user);
    u.username = u.username || u.name || (u.email ? String(u.email).split('@')[0] : 'Student');
    return u;
}
function saveSession() {
    if (!currentUser) return;
    const safe = Object.assign({}, currentUser);
    delete safe.password; delete safe.password_hash; delete safe.hashed_password;
    storeSet(SESSION_KEY, JSON.stringify(safe));
}
function restoreSession() {
    const raw = storeGet(SESSION_KEY);
    if (!raw) return false;
    try {
        const user = JSON.parse(raw);
        if (user && (user.username || user.email)) {
            currentUser = normalizeUser(user);
            return true;
        }
    } catch (e) {}
    storeRemove(SESSION_KEY);
    return false;
}
function startSession(user) {
    currentUser = normalizeUser(user);
    saveSession();
    enterApp();
    switchPage('dashboard');
}

// ============================================================
//  AUTH
// ============================================================
function showError(msg, type = 'error') {
    const authVisible = !$('authPage').classList.contains('hidden');
    if (authVisible) {
        const el = $('errorMsg');
        el.textContent = msg;
        el.classList.add('show');
        if (type === 'success') {
            el.style.background = 'rgba(46, 204, 113, 0.1)';
            el.style.color = 'var(--success)';
            el.style.borderLeft = '4px solid var(--success)';
        } else {
            el.style.background = 'rgba(231, 76, 60, 0.1)';
            el.style.color = 'var(--danger)';
            el.style.borderLeft = '4px solid var(--danger)';
        }
        clearTimeout(authErrorTimer);
        authErrorTimer = setTimeout(() => el.classList.remove('show'), 5000);
    } else {
        showToast(msg, type === 'success' ? 'success' : 'error', 5000);
    }
}

async function handleLogin(btn) {
    const email = $('loginEmail').value.trim();
    const pass = $('loginPass').value;
    if (!email || !pass) { showError('Fill all fields'); return; }
    await withLoading(btn, 'Logging in...', async () => {
        const res = await apiCall('/api/login', { email, password: pass });
        if (res.user) {
            startSession(res.user);
            addNotification('Welcome!', 'Welcome back, ' + currentUser.username + '!');
        } else {
            showError(res.error || 'Login failed');
        }
    });
}

async function handleSignup(btn) {
    const name = $('signupName').value.trim();
    const email = $('signupEmail').value.trim();
    const pass = $('signupPass').value;
    if (!name || !email || !pass) { showError('Fill all fields'); return; }
    if (pass.length < 6) { showError('Password must be at least 6 characters'); return; }
    await withLoading(btn, 'Creating account...', async () => {
        const res = await apiCall('/api/signup', { username: name, email, password: pass });
        if (res.user) {
            startSession(res.user);
            addNotification('Welcome!', 'Welcome to X-ZITH, ' + currentUser.username + '!');
        } else if (res.success) {
            showError('Account created! Now login.', 'success');
            $('loginEmail').value = email;
            setTimeout(() => switchAuthTab('login'), 1500);
        } else {
            showError(res.error || 'Signup failed');
        }
    });
}

function logout() {
    currentUser = null;
    notifications = [];
    storeRemove(SESSION_KEY);
    storeRemove(PAGE_KEY);
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    isSpeaking = false;
    if (activeQuiz && activeQuiz.timerId) clearInterval(activeQuiz.timerId);
    activeQuiz = null;

    resetChat();
    clearChatImage();
    $('textbookResult').classList.add('hidden');
    $('quizSection').classList.add('hidden');
    $('questionsResult').classList.add('hidden');
    $('progressSection').classList.add('hidden');
    $('searchResult').classList.add('hidden');
    $('theoryQuestionResult').classList.add('hidden');
    $('topicCard').classList.add('hidden');
    selectedLevel = null;
    selectedSubject = null;

    ['loginEmail', 'loginPass', 'signupName', 'signupEmail', 'signupPass', 'topicInput', 'searchQuery', 'pqTopic']
        .forEach(id => { const el = $(id); if (el) el.value = ''; });

    updateNotificationBadge();
    updateNotificationsList();
    $('notificationDropdown').classList.remove('active');
    $('mobileMenu').classList.remove('active');

    $('appPage').classList.add('hidden');
    $('authPage').classList.add('hidden');
    $('landingPage').classList.remove('hidden');
    document.documentElement.classList.remove('has-session');
    switchAuthTab('login');
    window.scrollTo(0, 0);
}

// ============================================================
//  APP SHELL
// ============================================================
function enterApp() {
    $('landingPage').classList.add('hidden');
    $('authPage').classList.add('hidden');
    $('appPage').classList.remove('hidden');
    $('appThemeIcon').textContent = darkMode ? '☀️' : '🌙';
    $('navUser').textContent = currentUser.username;
    $('dashName').textContent = currentUser.username;
    $('profileUsername').value = currentUser.username;
    updateDashboard();
}

function updateDashboard() {
    if (!currentUser) return;
    $('dashScore').textContent = currentUser.total_score || 0;
    $('dashQuizzes').textContent = currentUser.quizzes_taken || 0;
    $('dashStreak').textContent = currentUser.streak || 0;
}

function switchPage(pageId) {
    let target = $(pageId);
    if (!target || !target.classList.contains('page')) {
        pageId = 'dashboard';
        target = $('dashboard');
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    target.classList.add('active');
    document.querySelectorAll('[data-page]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === pageId);
    });
    $('notificationDropdown').classList.remove('active');
    storeSet(PAGE_KEY, pageId);
    window.scrollTo(0, 0);

    if (pageId === 'profile') populateProfile();
    else if (pageId === 'leaderboard') loadLeaderboard();
    else if (pageId === 'dashboard') updateDashboard();
}

function populateProfile() {
    if (!currentUser) return;
    $('profileUsername').value = currentUser.username || '';
    $('profileEmail').value = currentUser.email || '';
    $('profileScore').textContent = currentUser.total_score || 0;
    $('profileQuizzes').textContent = currentUser.quizzes_taken || 0;
    $('profileStreak').textContent = currentUser.streak || 0;
    renderRecentQuizzes();
    renderRecentStudy();
}

// ============================================================
//  RECENT ACTIVITY (localStorage per user)
// ============================================================
function recentKey(base) {
    const u = currentUser && currentUser.email ? currentUser.email : 'guest';
    return base + ':' + u;
}

function loadRecentList(base) {
    try {
        const raw = storeGet(recentKey(base));
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}
function saveRecentList(base, list) {
    storeSet(recentKey(base), JSON.stringify(list.slice(0, 8)));
}
function pushRecentQuiz(entry) {
    const list = loadRecentList(RECENT_QUIZZES_KEY);
    list.unshift(Object.assign({ date: new Date().toISOString() }, entry));
    saveRecentList(RECENT_QUIZZES_KEY, list);
}
function pushRecentStudy(entry) {
    const list = loadRecentList(RECENT_STUDY_KEY);
    list.unshift(Object.assign({ date: new Date().toISOString() }, entry));
    saveRecentList(RECENT_STUDY_KEY, list);
}

function formatRecentDate(iso) {
    try {
        const d = new Date(iso);
        const diff = Date.now() - d.getTime();
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min ago';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return hrs + ' hr ago';
        const days = Math.floor(hrs / 24);
        if (days < 7) return days + ' day' + (days > 1 ? 's' : '') + ' ago';
        return d.toLocaleDateString();
    } catch (e) { return ''; }
}

function renderRecentQuizzes() {
    const list = loadRecentList(RECENT_QUIZZES_KEY);
    const box = $('recentQuizzesList');
    if (!list.length) {
        box.innerHTML = '<div class="recent-empty">No quizzes yet. Take a quiz from the Textbook page!</div>';
        return;
    }
    box.innerHTML = list.map(q => `
        <div class="recent-item">
            <div class="recent-title">📝 ${escapeHtml(q.topic || 'Quiz')}</div>
            <div class="recent-score">${escapeHtml(String(q.score))}/${escapeHtml(String(q.total))}</div>
            <div class="recent-meta">${escapeHtml(formatRecentDate(q.date))}</div>
        </div>
    `).join('');
}

function renderRecentStudy() {
    const list = loadRecentList(RECENT_STUDY_KEY);
    const box = $('recentStudyList');
    if (!list.length) {
        box.innerHTML = '<div class="recent-empty">No study history yet. Generate a textbook note or theory question to begin.</div>';
        return;
    }
    box.innerHTML = list.map(s => `
        <div class="recent-item">
            <div class="recent-title">${s.type === 'theory' ? '✍️' : '📖'} ${escapeHtml(s.title || '')}</div>
            <div class="recent-meta">${escapeHtml(s.subject || '')} ${s.level ? '• ' + escapeHtml(s.level) : ''}</div>
            <div class="recent-meta">${escapeHtml(formatRecentDate(s.date))}</div>
        </div>
    `).join('');
}

// ============================================================
//  NOTIFICATIONS
// ============================================================
function toggleNotifications() { $('notificationDropdown').classList.toggle('active'); }

function addNotification(title, message) {
    notifications.unshift({ title, message, read: false });
    if (notifications.length > 30) notifications.length = 30;
    updateNotificationBadge();
    updateNotificationsList();
}
function updateNotificationBadge() {
    const badge = $('notificationBadge');
    const unread = notifications.filter(n => !n.read).length;
    if (unread > 0) { badge.style.display = 'flex'; badge.textContent = unread; }
    else badge.style.display = 'none';
}
function updateNotificationsList() {
    const list = $('notificationsList');
    list.innerHTML = '';
    if (!notifications.length) {
        list.innerHTML = '<div class="notification-item">No notifications yet</div>';
        return;
    }
    notifications.forEach(notif => {
        const div = document.createElement('div');
        div.className = 'notification-item' + (notif.read ? ' read' : '');
        div.onclick = () => { notif.read = true; div.classList.add('read'); updateNotificationBadge(); };
        div.innerHTML = '<strong>' + escapeHtml(notif.title) + '</strong><br><small>' + escapeHtml(notif.message) + '</small>';
        list.appendChild(div);
    });
}
function markAllAsRead() {
    notifications.forEach(n => { n.read = true; });
    updateNotificationBadge();
    updateNotificationsList();
}

// ============================================================
//  TEXTBOOK — SUBJECT PICKER WITH LEARN BUTTON
// ============================================================
function initTextbookSubjects() {
    const jssContainer = $('jssSubjects');
    const sssContainer = $('sssSubjects');
    jssContainer.innerHTML = '';
    sssContainer.innerHTML = '';

    // Flatten the JSS/SSS subject groups into a single list per level
    const jssFlat = [];
    Object.values(JSS_SUBJECTS).forEach(arr => arr.forEach(s => jssFlat.push(s)));
    const sssFlat = [];
    Object.values(SSS_SUBJECTS).forEach(arr => arr.forEach(s => sssFlat.push(s)));

    jssFlat.forEach(subject => {
        const row = document.createElement('div');
        row.className = 'subject-item';
        row.dataset.subject = subject;
        row.dataset.level = 'JSS';
        row.innerHTML = `
            <span class="subject-name">${escapeHtml(subject)}</span>
            <button class="learn-btn" onclick="selectTextbookSubject('${subject.replace(/'/g, "\\'")}', 'JSS', this)">Learn</button>
        `;
        jssContainer.appendChild(row);
    });

    sssFlat.forEach(subject => {
        const row = document.createElement('div');
        row.className = 'subject-item';
        row.dataset.subject = subject;
        row.dataset.level = 'SSS';
        row.innerHTML = `
            <span class="subject-name">${escapeHtml(subject)}</span>
            <button class="learn-btn" onclick="selectTextbookSubject('${subject.replace(/'/g, "\\'")}', 'SSS', this)">Learn</button>
        `;
        sssContainer.appendChild(row);
    });
}

function selectTextbookSubject(subject, level, buttonEl) {
    selectedLevel = level;
    selectedSubject = subject;
    document.querySelectorAll('#jssSubjects .subject-item, #sssSubjects .subject-item').forEach(el => el.classList.remove('selected'));
    if (buttonEl) {
        const row = buttonEl.closest('.subject-item');
        if (row) row.classList.add('selected');
    }
    $('topicCard').classList.remove('hidden');
    $('selectedClassLabel').textContent = `${subject} (${level})`;
    $('textbookResult').classList.add('hidden');
    $('quizSection').classList.add('hidden');
    $('topicInput').value = '';
    $('topicInput').focus();
    addNotification('📖 Subject Selected', subject + ' • ' + level);
}

async function generateTextbook(btn) {
    const topic = $('topicInput').value.trim();
    if (!selectedLevel) { showError('Please select a level (JSS or SSS)'); return; }
    if (!selectedSubject) { showError('Please select a subject'); return; }
    if (!topic) { showError('Please enter a topic'); return; }

    await withLoading(btn, 'Generating...', async () => {
        const res = await apiCall('/api/generate-textbook', {
            level: selectedLevel,
            subject: selectedSubject,
            topic
        });
        const content = res.note || res.response || res.textbook || res.content || res.text;
        if (res.error || !content) {
            showError(res.error || 'Could not generate notes. Please try again.');
            return;
        }
        $('textbookTitle').textContent = topic + ' — Study Notes';
        $('textbookOutput').innerHTML = formatRichText(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
        $('textbookResult').classList.remove('hidden');
        $('quizSection').classList.add('hidden');
        $('textbookResult').scrollIntoView({ behavior: 'smooth', block: 'start' });

        pushRecentStudy({
            type: 'textbook',
            title: topic,
            subject: selectedSubject,
            level: selectedLevel
        });

        addNotification('✅ Textbook Generated', 'Study notes on "' + topic + '" are ready! 📚');
    });
}

// ============================================================
//  VOICE (speak / stop)
// ============================================================
function speakText(elementId, btn) {
    if (!('speechSynthesis' in window)) {
        showError('Read aloud is not supported on this browser.');
        return;
    }
    const synth = window.speechSynthesis;
    if (isSpeaking || synth.speaking) {
        synth.cancel();
        isSpeaking = false;
        if (btn) btn.innerHTML = SPEAK_LABEL;
        return;
    }
    const el = $(elementId);
    const text = el ? el.innerText.trim() : '';
    if (!text) return;

    const sentences = text.match(/[^.!?\n]+[.!?]*\s*/g) || [text];
    const chunks = [];
    let current = '';
    sentences.forEach(s => {
        if ((current + s).length > 220 && current) { chunks.push(current); current = s; }
        else { current += s; }
    });
    if (current.trim()) chunks.push(current);

    isSpeaking = true;
    if (btn) btn.innerHTML = '⏹ Stop';
    chunks.forEach((chunk, i) => {
        const u = new SpeechSynthesisUtterance(chunk);
        u.rate = 0.9;
        if (i === chunks.length - 1) {
            u.onend = u.onerror = () => {
                isSpeaking = false;
                if (btn) btn.innerHTML = SPEAK_LABEL;
            };
        }
        synth.speak(u);
    });
}

// Generic speak for a raw string (used by chat bubble buttons)
function speakString(text, btn) {
    if (!('speechSynthesis' in window)) { showError('Read aloud not supported'); return; }
    const synth = window.speechSynthesis;
    if (synth.speaking) { synth.cancel(); }
    const u = new SpeechSynthesisUtterance(String(text).slice(0, 5000));
    u.rate = 0.9;
    if (btn) {
        const orig = btn.textContent;
        btn.textContent = '⏹ Speaking...';
        u.onend = u.onerror = () => { btn.textContent = orig; };
    }
    synth.speak(u);
}
function stopSpeaking(btn) {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    if (btn) { btn.textContent = '⏹ Stopped'; setTimeout(() => btn.textContent = '⏹ Stop', 800); }
}

// ============================================================
//  QUIZ (5 questions on the current textbook topic)
// ============================================================
async function startQuizFromTextbook(btn) {
    const topic = $('topicInput').value.trim() || $('textbookTitle').textContent.replace(' — Study Notes', '');
    if (!topic) { showError('Generate a note first'); return; }

    await withLoading(btn, '⏳ Preparing quiz...', async () => {
        const res = await apiCall('/api/generate-past-questions', {
            exam: 'WAEC',
            year: '2024',
            subject: selectedSubject || 'General',
            qtype: 'Objective',
            count: 5,
            topic
        });
        const content = questionsToText(res.raw || res.response || res.questions || res.content);
        if (res.error || !content.trim()) {
            showError(res.error || 'Could not generate quiz. Please try again.');
            return;
        }
        const questions = parseQuizQuestions(content).slice(0, 5);
        if (!questions.length) { showError('Quiz had no questions. Try again.'); return; }
        launchQuiz(questions, topic);
    });
}

// Parse text into structured question objects: {q, options:[{letter,text}], answer, explanation}
function parseQuizQuestions(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    const out = [];
    let cur = null;
    lines.forEach(line => {
        const numMatch = line.match(/^(\d+)[.)]\s+(.*)$/);
        const optMatch = line.match(/^([A-D])[).:]\s+(.*)$/i);
        const ansMatch = line.match(/^Answer\s*[:\-]\s*([A-D])/i);
        const expMatch = line.match(/^Explanation\s*[:\-]\s*(.*)$/i);

        if (numMatch && !optMatch) {
            if (cur) out.push(cur);
            cur = { q: numMatch[2], options: [], answer: '', explanation: '' };
        } else if (optMatch && cur) {
            cur.options.push({ letter: optMatch[1].toUpperCase(), text: optMatch[2] });
        } else if (ansMatch && cur) {
            cur.answer = ansMatch[1].toUpperCase();
        } else if (expMatch && cur) {
            cur.explanation = expMatch[1];
        } else if (cur && !cur.answer && cur.options.length) {
            if (cur.explanation) cur.explanation += ' ' + line;
            else cur.explanation = line;
        }
    });
    if (cur) out.push(cur);
    return out.filter(q => q.options.length >= 2);
}

function launchQuiz(questions, topic) {
    if (activeQuiz && activeQuiz.timerId) clearInterval(activeQuiz.timerId);
    activeQuiz = { questions, currentIndex: 0, score: 0, timerId: null, timeLeft: QUIZ_QUESTION_TIME };
    $('quizTopicLabel').textContent = topic;
    $('quizSection').classList.remove('hidden');
    renderQuizQuestion();
    $('quizSection').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderQuizQuestion() {
    const box = $('quizContainer');
    if (!activeQuiz) return;
    const i = activeQuiz.currentIndex;
    if (i >= activeQuiz.questions.length) {
        endQuiz();
        return;
    }
    const q = activeQuiz.questions[i];
    activeQuiz.timeLeft = QUIZ_QUESTION_TIME;

    box.innerHTML = `
        <div class="quiz-question">
            <div class="q-number">Question ${i + 1} of ${activeQuiz.questions.length}</div>
            <div>${escapeHtml(q.q)}</div>
            <div class="quiz-options">
                ${q.options.map(o => `
                    <div class="quiz-option" data-letter="${o.letter}" onclick="answerQuiz('${o.letter}', this)">
                        <strong>${o.letter})</strong> ${escapeHtml(o.text)}
                    </div>
                `).join('')}
            </div>
            <div class="quiz-explanation" id="quizExplanation">
                <strong>✓ Explanation:</strong>
                <p style="margin-top: 8px;">${escapeHtml(q.explanation || 'Correct answer: ' + q.answer)}</p>
            </div>
        </div>
    `;

    startQuizTimer();
}

function startQuizTimer() {
    if (activeQuiz && activeQuiz.timerId) clearInterval(activeQuiz.timerId);
    const timerEl = $('quizTimer');
    const tick = () => {
        if (!activeQuiz) return;
        timerEl.textContent = '⏱ ' + activeQuiz.timeLeft + 's';
        timerEl.classList.toggle('danger', activeQuiz.timeLeft <= 5);
        if (activeQuiz.timeLeft <= 0) {
            clearInterval(activeQuiz.timerId);
            activeQuiz.timerId = null;
            timeUpReveal();
            return;
        }
        activeQuiz.timeLeft--;
    };
    tick();
    activeQuiz.timerId = setInterval(tick, 1000);
}

function timeUpReveal() {
    if (!activeQuiz) return;
    const q = activeQuiz.questions[activeQuiz.currentIndex];
    document.querySelectorAll('#quizContainer .quiz-option').forEach(el => {
        el.classList.add('disabled');
        if (el.dataset.letter === q.answer) el.classList.add('correct');
    });
    $('quizExplanation').classList.add('show');
    addNotification('⏱ Time Up', 'Moving to the next question...');
    setTimeout(() => {
        if (!activeQuiz) return;
        activeQuiz.currentIndex++;
        renderQuizQuestion();
    }, 1800);
}

function answerQuiz(letter, el) {
    if (!activeQuiz) return;
    clearInterval(activeQuiz.timerId);
    activeQuiz.timerId = null;
    const q = activeQuiz.questions[activeQuiz.currentIndex];
    const isCorrect = letter === q.answer;
    if (isCorrect) activeQuiz.score++;

    document.querySelectorAll('#quizContainer .quiz-option').forEach(opt => {
        opt.classList.add('disabled');
        if (opt.dataset.letter === q.answer) opt.classList.add('correct');
        else if (opt.dataset.letter === letter && !isCorrect) opt.classList.add('wrong');
    });
    $('quizExplanation').classList.add('show');

    setTimeout(() => {
        if (!activeQuiz) return;
        activeQuiz.currentIndex++;
        renderQuizQuestion();
    }, 1800);
}

function endQuiz() {
    const total = activeQuiz.questions.length;
    const score = activeQuiz.score;
    const topic = $('quizTopicLabel').textContent;
    if (activeQuiz.timerId) clearInterval(activeQuiz.timerId);

    $('quizContainer').innerHTML = `
        <div class="quiz-summary">
            <div style="font-size: 48px;">${score === total ? '🏆' : score >= total * 0.6 ? '🎉' : '📚'}</div>
            <h2 style="margin: 10px 0;">Quiz Complete!</h2>
            <div class="score">${score} / ${total}</div>
            <p style="color: var(--text-light);">You got ${Math.round((score / total) * 100)}% on "${escapeHtml(topic)}"</p>
            <div class="result-footer" style="justify-content: center;">
                <button class="btn-primary" onclick="startQuizFromTextbook($('genTextbookBtn'))">🔄 Retake Quiz</button>
            </div>
        </div>
    `;
    $('quizTimer').textContent = '⏱ Done';
    $('quizTimer').classList.remove('danger');

    pushRecentQuiz({ topic, score, total });

    // Update local user stats + backend (optional)
    if (currentUser) {
        currentUser.quizzes_taken = (currentUser.quizzes_taken || 0) + 1;
        currentUser.total_score = (currentUser.total_score || 0) + score * 10;
        saveSession();
        updateDashboard();
    }

    activeQuiz = null;
}

// ============================================================
//  AI CHAT
// ============================================================
function chatGreetingHtml() {
    return '<div class="gpt-msg gpt-msg-ai">' +
        '<div class="gpt-avatar gpt-avatar-ai">🤖</div>' +
        '<div class="gpt-bubble-col">' +
        '<div class="gpt-bubble"><div class="rich"><p>Hello! 👋 I\'m your AI tutor. Ask me anything, or upload a photo of a question — I\'m here to help!</p></div></div>' +
        '</div></div>';
}

function resetChat() {
    $('chatBox').innerHTML = chatGreetingHtml();
    chatBusy = false;
    const input = $('chatInput');
    if (input) { input.value = ''; autoGrowChatInput(input); }
}

function autoGrowChatInput(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

async function copyChatMessage(btn) {
    const bubble = btn.closest('.gpt-bubble-col').querySelector('.gpt-bubble');
    const text = bubble ? bubble.innerText : '';
    try {
        await navigator.clipboard.writeText(text);
        const original = btn.textContent;
        btn.textContent = '✅ Copied';
        setTimeout(() => { btn.textContent = original; }, 1500);
    } catch (e) {
        showToast('Could not copy', 'error');
    }
}

function addChatBubble(role, text, imageDataUrl) {
    const box = $('chatBox');
    const div = document.createElement('div');

    if (role === 'user') {
        div.className = 'gpt-msg gpt-msg-user';
        div.innerHTML = '<div class="gpt-avatar gpt-avatar-user">🧑</div>' +
            '<div class="gpt-bubble-col"><div class="gpt-bubble"></div></div>';
        const bubble = div.querySelector('.gpt-bubble');
        if (imageDataUrl) {
            const img = document.createElement('img');
            img.src = imageDataUrl;
            img.className = 'chat-attached-image';
            bubble.appendChild(img);
        }
        if (text) {
            const p = document.createElement('div');
            p.textContent = text;
            bubble.appendChild(p);
        }
    } else if (role === 'error') {
        div.className = 'gpt-msg gpt-msg-ai gpt-msg-error';
        div.innerHTML = '<div class="gpt-avatar gpt-avatar-ai">🤖</div>' +
            '<div class="gpt-bubble-col"><div class="gpt-bubble"></div></div>';
        div.querySelector('.gpt-bubble').textContent = '⚠️ ' + text;
    } else if (role === 'typing') {
        div.className = 'gpt-msg gpt-msg-ai';
        div.innerHTML = '<div class="gpt-avatar gpt-avatar-ai">🤖</div>' +
            '<div class="gpt-bubble-col"><div class="gpt-bubble"><div class="gpt-typing"><span></span><span></span><span></span></div></div></div>';
    } else {
        div.className = 'gpt-msg gpt-msg-ai';
        div.innerHTML = '<div class="gpt-avatar gpt-avatar-ai">🤖</div>' +
            '<div class="gpt-bubble-col">' +
            '<div class="gpt-bubble"><div class="rich">' + formatRichText(text) + '</div></div>' +
            '<div class="gpt-msg-actions">' +
            '<button onclick="copyChatMessage(this)">📋 Copy</button>' +
            '<button onclick="speakString(this.closest(\'.gpt-bubble-col\').querySelector(\'.gpt-bubble\').innerText, this)">🔊 Speak</button>' +
            '<button onclick="stopSpeaking(this)">⏹ Stop</button>' +
            '</div></div>';
    }

    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
}

// --- Image upload ---
function handleChatImage(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
        showToast('Please choose an image file', 'error');
        return;
    }
    if (file.size > 4 * 1024 * 1024) {
        showToast('Image too large (max 4 MB)', 'error');
        return;
    }
    const reader = new FileReader();
    reader.onload = e => {
        pendingChatImage = e.target.result;
        $('chatImageThumb').src = pendingChatImage;
        $('chatImagePreview').classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}
function clearChatImage() {
    pendingChatImage = null;
    $('chatImagePreview').classList.add('hidden');
    $('chatImageThumb').src = '';
    const input = $('chatImageInput');
    if (input) input.value = '';
}

async function sendChat() {
    const input = $('chatInput');
    const msg = input.value.trim();
    if ((!msg && !pendingChatImage) || chatBusy) return;

    chatBusy = true;
    $('sendChatBtn').disabled = true;

    const imageToSend = pendingChatImage;
    addChatBubble('user', msg, imageToSend);
    input.value = '';
    autoGrowChatInput(input);
    clearChatImage();

    const typing = addChatBubble('typing');

    try {
        const payload = { message: msg || 'Please describe and answer the question in this image.' };
        if (imageToSend) payload.image = imageToSend;

        const res = await apiCall('/api/chat', payload);
        typing.remove();
        const reply = res.response || res.message || res.reply || res.answer;
        if (res.error || !reply) {
            addChatBubble('error', res.error || 'I could not generate a response. Please try again.');
        } else {
            addChatBubble('ai', typeof reply === 'string' ? reply : JSON.stringify(reply));
        }
    } finally {
        chatBusy = false;
        $('sendChatBtn').disabled = false;
        input.focus();
    }
}

// ============================================================
//  VOICE INPUT
// ============================================================
function startVoiceChat() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        showError('Voice recognition not supported on this device');
        return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.onstart = () => addNotification('🎤 Listening...', 'Speak your question');
    rec.onresult = (e) => {
        const text = Array.from(e.results).map(r => r[0].transcript).join('');
        $('chatInput').value = text;
        $('chatInput').focus();
        sendChat();
    };
    rec.onerror = () => showError('Microphone not available');
    rec.start();
}

function startVoiceSearch() {
    if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
        showError('Voice recognition not supported on this device');
        return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.onstart = () => addNotification('🎤 Listening...', 'Speak your search term');
    rec.onresult = (e) => {
        const text = Array.from(e.results).map(r => r[0].transcript).join('');
        $('searchQuery').value = text;
        performWebSearch($('searchBtn'));
    };
    rec.onerror = () => showError('Microphone not available');
    rec.start();
}

// ============================================================
//  PAST QUESTIONS
// ============================================================
function populateYears() {
    let html = '<option value="">📅 Select Year</option>';
    html += '<option value="2026">2026</option>';
    html += '<option value="2025">2025</option>';
    html += '<option value="2024">2024</option>';
    $('pqYear').innerHTML = html;
}

function onExamChange() {
    const exam = $('pqExam').value;
    const subjectSelect = $('pqSubject');

    if (!exam) {
        subjectSelect.innerHTML = '<option value="">📚 Select an exam first</option>';
        subjectSelect.disabled = true;
    } else {
        let html = '<option value="">📚 Select Subject</option>';
        Object.entries(PQ_SUBJECTS[exam]).forEach(([group, subjects]) => {
            html += '<optgroup label="' + escapeHtml(group) + '">' +
                subjects.map(s => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>').join('') +
                '</optgroup>';
        });
        subjectSelect.innerHTML = html;
        subjectSelect.disabled = false;
    }
}

function questionsToText(data) {
    if (typeof data === 'string') return data;
    if (!Array.isArray(data)) return '';
    return data.map((item, i) => {
        if (typeof item === 'string') return item;
        const q = item.question || item.q || item.text || '';
        let out = (i + 1) + '. ' + q;
        const opts = item.options || item.choices;
        if (Array.isArray(opts)) {
            opts.forEach((o, k) => { out += '\n' + String.fromCharCode(65 + k) + ') ' + o; });
        } else if (opts && typeof opts === 'object') {
            Object.entries(opts).forEach(([k, v]) => { out += '\n' + k + ') ' + v; });
        }
        const ans = item.answer || item.correct_answer;
        if (ans) out += '\nAnswer: ' + ans;
        if (item.explanation) out += '\nExplanation: ' + item.explanation;
        return out;
    }).join('\n\n');
}

// Parse into structured objects for interactive cards
function parsePastQuestions(text) {
    const lines = text.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    const out = [];
    let cur = null;
    lines.forEach(line => {
        const numMatch = line.match(/^(\d+)[.)]\s+(.*)$/);
        const optMatch = line.match(/^([A-D])[).:]\s+(.*)$/i);
        const ansMatch = line.match(/^Answer\s*[:\-]\s*([A-D])/i);
        const expMatch = line.match(/^Explanation\s*[:\-]\s*(.*)$/i);

        if (numMatch && !optMatch) {
            if (cur) out.push(cur);
            cur = { q: numMatch[2], options: [], answer: '', explanation: '' };
        } else if (optMatch && cur) {
            cur.options.push({ letter: optMatch[1].toUpperCase(), text: optMatch[2] });
        } else if (ansMatch && cur) {
            cur.answer = ansMatch[1].toUpperCase();
        } else if (expMatch && cur) {
            cur.explanation = expMatch[1];
        } else if (cur && !cur.answer) {
            if (cur.explanation) cur.explanation += ' ' + line;
            else cur.explanation = line;
        }
    });
    if (cur) out.push(cur);
    return out.filter(q => q.options.length >= 2);
}

function renderPastQuestions(questions, startIndex) {
    return questions.map((q, i) => {
        const qNum = startIndex + i + 1;
        const opts = q.options.map(o => `
            <div class="pq-option" data-letter="${o.letter}" onclick="revealPqAnswer(this, '${q.answer}', '${escapeHtml(q.explanation || '').replace(/'/g, "&#39;")}')">
                <strong>${o.letter})</strong> ${escapeHtml(o.text)}
            </div>
        `).join('');
        return `
            <div class="pq-question">
                <div class="pq-q-header">Q${qNum}: ${escapeHtml(q.q)}</div>
                ${opts}
                <div class="correction-box">
                    <strong>✓ Answer: ${q.answer}</strong>
                    <p style="margin-top: 8px;">${escapeHtml(q.explanation || 'Correct answer: ' + q.answer)}</p>
                </div>
            </div>
        `;
    }).join('');
}

function revealPqAnswer(el, correct, explanation) {
    const parent = el.parentElement;
    parent.querySelectorAll('.pq-option').forEach(opt => {
        opt.classList.add('disabled');
        if (opt.dataset.letter === correct) opt.classList.add('correct');
        else if (opt === el) opt.classList.add('wrong');
    });
    const box = parent.querySelector('.correction-box');
    if (box) box.classList.add('show');
}

async function generatePastQuestions(btn) {
    const exam = $('pqExam').value;
    const year = $('pqYear').value;
    const subject = $('pqSubject').value;
    const topic = $('pqTopic').value.trim();

    if (!exam || !year || !subject) {
        showError('Please select the exam, year and subject');
        return;
    }

    currentExam = exam;
    currentYear = year;
    currentSubject = subject;
    currentTopic = topic;
    totalQuestionsGenerated = 0;

    await withLoading(btn, 'Generating 10 questions...', async () => {
        const payload = { exam, year, subject, qtype: 'Objective', count: 10 };
        if (topic) payload.topic = topic;
        const res = await apiCall('/api/generate-past-questions', payload);

        const content = questionsToText(res.raw || res.response || res.questions || res.content);
        if (res.error || !content.trim()) {
            showError(res.error || 'Could not generate questions. Please try again.');
            return;
        }

        const questions = parsePastQuestions(content);
        if (!questions.length) { showError('No questions parsed. Try again.'); return; }

        $('questionsMeta').textContent = exam + ' ' + year + ' • ' + subject + (topic ? ' • ' + topic : '');
        $('questionsContainer').innerHTML = renderPastQuestions(questions, 0);
        totalQuestionsGenerated = questions.length;
        updateProgressBar();
        $('progressSection').classList.remove('hidden');
        $('questionsResult').classList.remove('hidden');
        $('generateMoreBtn').classList.toggle('show', totalQuestionsGenerated < 60);
        $('questionsResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
        addNotification('✅ Questions Generated', exam + ' ' + year + ' ' + subject + ' — ' + totalQuestionsGenerated + ' questions ready!');
    });
}

async function generateMorePastQuestions(btn) {
    if (totalQuestionsGenerated >= 60) {
        showToast('✨ Limit reached — 60 questions max', 'success');
        $('generateMoreBtn').classList.remove('show');
        return;
    }
    await withLoading(btn, 'Generating 10 more...', async () => {
        const payload = {
            exam: currentExam,
            year: currentYear,
            subject: currentSubject,
            qtype: 'Objective',
            count: 10
        };
        if (currentTopic) payload.topic = currentTopic;
        const res = await apiCall('/api/generate-past-questions', payload);

        const content = questionsToText(res.raw || res.response || res.questions || res.content);
        if (res.error || !content.trim()) {
            showError(res.error || 'Could not generate more questions.');
            return;
        }
        const questions = parsePastQuestions(content);
        if (!questions.length) { showError('No new questions parsed.'); return; }

        $('questionsContainer').innerHTML += renderPastQuestions(questions, totalQuestionsGenerated);
        totalQuestionsGenerated = Math.min(totalQuestionsGenerated + questions.length, 60);
        updateProgressBar();
        $('generateMoreBtn').classList.toggle('show', totalQuestionsGenerated < 60);
        $('questionsResult').scrollIntoView({ behavior: 'smooth', block: 'end' });
        addNotification('✅ More Questions Added', totalQuestionsGenerated + ' / 60 questions generated');
    });
}

function updateProgressBar() {
    const percentage = (totalQuestionsGenerated / 60) * 100;
    $('questionCount').textContent = totalQuestionsGenerated;
    $('progressFill').style.width = percentage + '%';
}

// ============================================================
//  THEORY — 5 questions per subject, Gemini explanation on demand
// ============================================================
function theoryUpdateCrumbs() {
    let html = '<button onclick="theoryGoToBoards()">📋 Exam Board' + (theoryExam ? ': ' + theoryExam : '') + '</button>';
    if (theoryExam) {
        html += '<span>›</span><button onclick="theoryGoToSubjects()">📚 Subject' + (theorySubject ? ': ' + escapeHtml(theorySubject) : '') + '</button>';
    }
    if (theorySubject) {
        html += '<span>›</span><button disabled style="opacity:0.7; cursor:default;">📝 Questions</button>';
    }
    $('theoryCrumbs').innerHTML = html;
}

function theoryGoToBoards() {
    theoryExam = '';
    theorySubject = '';
    theoryQuestions = [];
    $('theoryBoards').classList.remove('hidden');
    $('theorySubjects').classList.add('hidden');
    $('theoryQuestionResult').classList.add('hidden');
    theoryUpdateCrumbs();
}

function theoryGoToSubjects() {
    theorySubject = '';
    theoryQuestions = [];
    $('theoryBoards').classList.add('hidden');
    $('theorySubjects').classList.remove('hidden');
    $('theoryQuestionResult').classList.add('hidden');
    theoryUpdateCrumbs();
}

function theorySelectBoard(exam) {
    theoryExam = exam;
    $('theorySubjectsTitle').textContent = exam + ' — Select a Subject';

    let html = '';
    Object.entries(THEORY_SUBJECTS).forEach(([group, subjects]) => {
        html += '<div style="grid-column: 1 / -1;" class="subject-group-title">' + escapeHtml(group) + '</div>';
        subjects.forEach(s => {
            html += '<div class="subject-item" onclick="theorySelectSubject(\'' + s.replace(/'/g, "\\'") + '\')" style="cursor:pointer;">' +
                '<span class="subject-name">' + escapeHtml(s) + '</span></div>';
        });
    });
    $('theorySubjectsGrid').innerHTML = html;

    $('theoryBoards').classList.add('hidden');
    $('theorySubjects').classList.remove('hidden');
    $('theoryQuestionResult').classList.add('hidden');
    theoryUpdateCrumbs();
    $('theorySubjects').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function theorySelectSubject(subject) {
    theorySubject = subject;
    theoryUpdateCrumbs();

    $('theoryQuestionTitle').textContent = '📖 ' + subject + ' — Theory Questions';
    $('theoryMeta').textContent = theoryExam + ' • ' + subject + ' • 5 questions';
    $('theoryQuestionsList').innerHTML = '<div class="theory-question-card">⏳ Generating 5 questions...</div>';
    $('theoryQuestionResult').classList.remove('hidden');
    $('theoryQuestionResult').scrollIntoView({ behavior: 'smooth', block: 'start' });

    const res = await apiCall('/api/generate-theory-question', {
        exam: theoryExam,
        subject: theorySubject,
        qtype: 'Theory',
        count: 5
    });

    const content = (typeof res.questions === 'string' ? res.questions :
        typeof res.question === 'string' ? res.question :
        typeof res.raw === 'string' ? res.raw :
        typeof res.response === 'string' ? res.response : '');

    if (res.error || !content.trim()) {
        $('theoryQuestionsList').innerHTML =
            '<div class="theory-question-card" style="color: var(--danger);">⚠️ ' +
            escapeHtml(res.error || 'Could not generate questions. Please try again.') + '</div>';
        return;
    }

    theoryQuestions = parseTheoryQuestions(content).slice(0, 5);
    if (!theoryQuestions.length) theoryQuestions = [content];

    renderTheoryQuestions();
    addNotification('📝 Theory Questions Ready', theoryExam + ' ' + subject + ' — 5 questions generated!');
}

function parseTheoryQuestions(text) {
    const blocks = text
        .split(/\n(?=\s*(?:Question\s+)?\d+[.):])/i)
        .map(b => b.trim())
        .filter(Boolean);
    if (blocks.length >= 2) {
        return blocks.map(b => b.replace(/^\s*(?:Question\s+)?\d+[.):]\s*/i, '').trim());
    }
    return [text.trim()];
}

function renderTheoryQuestions() {
    const html = theoryQuestions.map((q, i) => `
        <div class="theory-question-card">
            <div class="theory-q-num">Question ${i + 1}</div>
            <div class="rich">${formatRichText(q)}</div>
            <div class="theory-actions">
                <button class="theory-btn theory-btn-primary" onclick="getTheoryExplanation(${i}, this)">💡 Get Explanation</button>
                <button class="voice-btn" onclick="speakString(${JSON.stringify(q).replace(/"/g, '&quot;')}, this)">🔊</button>
            </div>
            <div class="theory-explain-box" id="theoryExplain-${i}">
                <strong style="color: var(--success); display: block; margin-bottom: 8px;">💡 Explanation</strong>
                <div class="rich" id="theoryExplainContent-${i}"></div>
            </div>
        </div>
    `).join('');
    $('theoryQuestionsList').innerHTML = html;
}

async function getTheoryExplanation(index, btn) {
    const q = theoryQuestions[index];
    if (!q) return;
    const box = $('theoryExplain-' + index);
    const content = $('theoryExplainContent-' + index);

    if (box.classList.contains('show')) {
        box.classList.remove('show');
        return;
    }

    await withLoading(btn, '⏳ Thinking...', async () => {
        const res = await apiCall('/api/explain-theory-question', {
            exam: theoryExam,
            subject: theorySubject,
            question: q
        });
        const explanation = res.explanation || res.response || res.answer || res.raw || res.content;
        if (res.error || !explanation) {
            showError(res.error || 'Could not generate explanation. Try again.');
            return;
        }
        content.innerHTML = formatRichText(String(explanation));
        box.classList.add('show');
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
}

// ============================================================
//  WEB SEARCH
// ============================================================
let searchCache = {};

function searchLinksHtml(query) {
    const q = encodeURIComponent(query);
    const linkStyle = 'display: inline-block; margin: 4px 8px 4px 0; padding: 10px 16px; background: var(--primary); color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;';
    return '<div style="margin-top: 20px;">' +
        '<p style="color: var(--text-light); font-size: 14px; margin-bottom: 8px;">Search "' + escapeHtml(query) + '" directly on:</p>' +
        '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/results?search_query=' + q + '">🎥 YouTube</a>' +
        '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?q=' + q + '">🔍 Google</a>' +
        '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://en.wikipedia.org/w/index.php?search=' + q + '">📚 Wikipedia</a>' +
        '</div>';
}

async function performWebSearch(btn) {
    const query = $('searchQuery').value.trim();
    if (!query) { showError('Please enter a search query'); return; }

    if (searchCache[query]) {
        displaySearchResults(searchCache[query], query, true);
        return;
    }

    await withLoading(btn, 'Searching...', async () => {
        const res = await apiCall('/api/search', { q: query });
        const box = '<div style="padding: 15px; background: var(--bg); border-radius: 8px; color: var(--text-light);">';
        let html = '';
        const items = Array.isArray(res.results) ? res.results : (Array.isArray(res.items) ? res.items : null);

        if (res.error) {
            html = box + '⚠️ ' + escapeHtml(res.error) + '</div>';
        } else if (items && items.length) {
            items.forEach(result => {
                const link = safeUrl(result.link || result.url || '');
                const snippet = result.snippet || result.description || result.body || 'No description available';
                html += '<div style="margin-bottom: 20px; padding: 15px; background: var(--bg); border-radius: 8px; border-left: 4px solid var(--primary); overflow-wrap: anywhere;">' +
                    '<h3 style="margin-bottom: 8px; font-size: 18px;"><a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer" style="color: var(--primary); text-decoration: none;">' + escapeHtml(result.title || 'Untitled') + '</a></h3>' +
                    '<p style="color: var(--text-light); font-size: 14px; margin-bottom: 8px;">' + escapeHtml(snippet) + '</p>' +
                    (link !== '#' ? '<small style="color: var(--primary);">🔗 ' + escapeHtml(link) + '</small>' : '') +
                    '</div>';
            });
            searchCache[query] = html;
        } else if (typeof res.results === 'string' || typeof res.response === 'string') {
            html = '<div class="rich">' + formatRichText(res.results || res.response) + '</div>';
            searchCache[query] = html;
        } else {
            html = box + 'No results found. Try a different search query.</div>';
        }

        displaySearchResults(html, query, false);
        if (!res.error) addNotification('✅ Search Complete', 'Results for "' + query + '"');
    });
}

function displaySearchResults(html, query, fromCache) {
    const resultsHtml = html + searchLinksHtml(query);
    $('searchResultsList').innerHTML = resultsHtml;
    $('cacheIndicator').style.display = fromCache ? 'block' : 'none';
    $('searchResult').classList.remove('hidden');
    $('searchResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
//  LEADERBOARD
// ============================================================
function leaderboardMessage(text, color) {
    $('leaderboardBody').innerHTML = '<tr><td colspan="4" style="padding: 30px; text-align: center; color: ' + color + ';">' + text + '</td></tr>';
}

async function loadLeaderboard() {
    const tbody = $('leaderboardBody');
    leaderboardMessage('⏳ Loading leaderboard...', 'var(--text-light)');
    let res = await apiCall('/api/leaderboard', null, 'GET');
    if (res.error && [404, 405, 422].includes(res.status)) {
        res = await apiCall('/api/leaderboard', {}, 'POST');
    }
    if (res.error) {
        leaderboardMessage('⚠️ Could not load the leaderboard: ' + escapeHtml(res.error), 'var(--danger)');
        return;
    }
    const list = Array.isArray(res) ? res : (res.leaderboard || res.users || res.data || []);
    if (!Array.isArray(list) || !list.length) {
        leaderboardMessage('📊 No users on leaderboard yet. Start learning to appear here!', 'var(--text-light)');
        return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    tbody.innerHTML = '';
    list.slice(0, 10).forEach((user, i) => {
        const isMe = currentUser && ((user.email && user.email === currentUser.email) || user.username === currentUser.username);
        const tr = document.createElement('tr');
        if (isMe) tr.style.background = 'rgba(102, 126, 234, 0.12)';
        tr.innerHTML =
            '<td style="text-align:center;"><span style="font-size: 20px; font-weight: 700;">' + (medals[i] || (i + 1)) + '</span></td>' +
            '<td style="font-weight: 600;">' + escapeHtml(user.username || 'Anonymous') + (isMe ? ' <small style="color: var(--primary);">(you)</small>' : '') + '</td>' +
            '<td style="color: var(--primary); font-weight: 600;">' + escapeHtml(user.total_score || 0) + ' <small>pts</small></td>' +
            '<td style="color: var(--success); font-weight: 600;">🔥 ' + escapeHtml(user.streak || 0) + '</td>';
        tbody.appendChild(tr);
    });
}

// ============================================================
//  PROFILE
// ============================================================
function saveProfile() {
    const newUsername = $('profileUsername').value.trim();
    if (!newUsername) { showError('Username cannot be empty'); return; }
    currentUser.username = newUsername;
    saveSession();
    $('navUser').textContent = newUsername;
    $('dashName').textContent = newUsername;
    showToast('Profile saved', 'success');
    addNotification('✅ Profile Saved', 'Username updated to "' + newUsername + '"!');
}

// ============================================================
//  MENUS
// ============================================================
function toggleMobileMenu() { $('mobileMenu').classList.toggle('active'); }

document.addEventListener('click', function (event) {
    const mobileMenu = $('mobileMenu');
    const menuToggle = document.querySelector('.menu-toggle');
    if (mobileMenu && menuToggle && !mobileMenu.contains(event.target) && !menuToggle.contains(event.target)) {
        mobileMenu.classList.remove('active');
    }
    if (!event.target.closest('.notification-btn') && !event.target.closest('#notificationDropdown')) {
        $('notificationDropdown').classList.remove('active');
    }
});

window.addEventListener('storage', function (e) {
    if (e.key === SESSION_KEY && !e.newValue && currentUser) logout();
});

// ============================================================
//  START UP
// ============================================================
(function init() {
    if (darkMode) document.body.classList.add('dark-mode');
    $('landingThemeIcon').textContent = darkMode ? '☀️' : '🌙';
    $('appThemeIcon').textContent = darkMode ? '☀️' : '🌙';

    populateYears();
    onExamChange();
    initTextbookSubjects();

    onEnter('loginEmail', () => handleLogin($('loginBtn')));
    onEnter('loginPass', () => handleLogin($('loginBtn')));
    onEnter('signupName', () => handleSignup($('signupBtn')));
    onEnter('signupEmail', () => handleSignup($('signupBtn')));
    onEnter('signupPass', () => handleSignup($('signupBtn')));
    onEnter('topicInput', () => generateTextbook($('genTextbookBtn')));
    onEnter('pqTopic', () => generatePastQuestions($('pqBtn')));
    onEnter('searchQuery', () => performWebSearch($('searchBtn')));

    const chatInputEl = $('chatInput');
    if (chatInputEl) {
        chatInputEl.addEventListener('keydown', e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
        });
        chatInputEl.addEventListener('input', () => autoGrowChatInput(chatInputEl));
    }
    resetChat();
    theoryGoToBoards();

    wakeServer();

    if (restoreSession()) {
        enterApp();
        switchPage(storeGet(PAGE_KEY) || 'dashboard');
    }
    document.documentElement.classList.remove('has-session');
})();
