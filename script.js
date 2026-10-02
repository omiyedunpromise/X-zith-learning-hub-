/* =====================================================================
   X-ZITH Learning Hub — App Logic
   ===================================================================== */
    // ============================================================
    //  CONFIG
    // ============================================================
    const API_URL = "https://x-zith-backend.onrender.com";
    const SESSION_KEY = 'xzith_user';       // keeps the user logged in across reloads
    const PAGE_KEY = 'xzith_last_page';     // reopens the page the user was on
    const REQUEST_TIMEOUT_MS = 90000;       // Render free servers can take ~1 min to wake up
    const SLOW_SERVER_HINT_MS = 8000;
    const SPEAK_LABEL = '🔊 Read Aloud';

    let currentUser = null;
    let notifications = [];
    let darkMode = storeGet('darkMode') === 'true';
    let selectedLevel = null;
    let selectedSubject = null;
    let chatBusy = false;
    let isSpeaking = false;
    let authErrorTimer = null;
    let pendingChatImage = null; // { dataUrl, name } attached to the next chat message

    const HISTORY_KEY = 'xzith_history';   // recent quizzes + recent study, kept locally per device
    const GOAL_KEY = 'xzith_daily_goal';   // { target, date, count }

    // ============================================================
    //  SUBJECT LISTS
    // ============================================================
    const JSS_SUBJECTS = {
        'Core Subjects': ['English Language', 'Mathematics', 'Basic Science', 'Basic Technology', 'Social Studies', 'Civic Education', 'Computer Studies (ICT)'],
        'Prevocational & Practical': ['Agricultural Science', 'Home Economics', 'Business Studies', 'Physical & Health Education', 'Cultural & Creative Arts', 'Security Education'],
        'Religion & History': ['Christian Religious Studies', 'Islamic Religious Studies', 'History'],
        'Languages': ['Yoruba', 'Igbo', 'Hausa', 'French', 'Arabic']
    };

    // Used for WAEC / NECO past questions and Theory practice (includes trade/vocational subjects, as real WASSCE/SSCE do)
    const SSS_SUBJECTS = {
        'Core Subjects': ['English Language', 'Mathematics', 'Civic Education'],
        'Sciences': ['Physics', 'Chemistry', 'Biology', 'Further Mathematics', 'Agricultural Science', 'Geography', 'Computer Studies', 'Physical Education', 'Health Education', 'Technical Drawing'],
        'Arts & Humanities': ['Literature in English', 'Government', 'History', 'Christian Religious Studies', 'Islamic Religious Studies', 'Visual Art', 'Music'],
        'Commercial & Social Sciences': ['Economics', 'Financial Accounting', 'Commerce', 'Marketing', 'Insurance', 'Office Practice', 'Store Management'],
        'Languages': ['Yoruba', 'Igbo', 'Hausa', 'French', 'Arabic'],
        'Vocational & Technical': ['Food & Nutrition', 'Home Management', 'Catering Craft Practice', 'Clothing & Textiles', 'Animal Husbandry', 'Fisheries', 'Data Processing', 'Building Construction', 'Woodwork', 'Metalwork', 'Auto Mechanics', 'Electronics', 'Applied Electricity']
    };

    // Used for the SSS Textbook only — academic subjects, no vocational/technical trades
    const SSS_SUBJECTS_TEXTBOOK = {
        'Core Subjects': ['English Language', 'Mathematics', 'Civic Education'],
        'Sciences': ['Physics', 'Chemistry', 'Biology', 'Further Mathematics', 'Agricultural Science', 'Geography', 'Computer Studies', 'Physical Education', 'Health Education', 'Technical Drawing'],
        'Arts & Humanities': ['Literature in English', 'Government', 'History', 'Christian Religious Studies', 'Islamic Religious Studies', 'Visual Art', 'Music'],
        'Commercial & Social Sciences': ['Economics', 'Financial Accounting', 'Commerce', 'Marketing', 'Insurance', 'Office Practice', 'Store Management'],
        'Languages': ['Yoruba', 'Igbo', 'Hausa', 'French', 'Arabic']
    };

    const JAMB_SUBJECTS = {
        'Compulsory': ['Use of English'],
        'Sciences': ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Agricultural Science', 'Computer Studies', 'Physical & Health Education'],
        'Arts': ['Literature in English', 'Government', 'History', 'Christian Religious Studies', 'Islamic Religious Studies', 'Art (Fine Art)', 'Music'],
        'Social Sciences & Commercial': ['Economics', 'Commerce', 'Principles of Accounts', 'Geography', 'Home Economics'],
        'Languages': ['French', 'Yoruba', 'Igbo', 'Hausa', 'Arabic']
    };

    const TEXTBOOK_SUBJECTS = { JSS: JSS_SUBJECTS, SSS: SSS_SUBJECTS_TEXTBOOK };
    const PQ_SUBJECTS = { WAEC: SSS_SUBJECTS, NECO: SSS_SUBJECTS, JAMB: JAMB_SUBJECTS };
    const THEORY_SUBJECTS = { WAEC: SSS_SUBJECTS, NECO: SSS_SUBJECTS };

    // 6 quick-launch subjects shown on the Dashboard (jump straight into Textbook > Learn)
    const QUICK_SUBJECTS = ['English Language', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Economics'];

    // Deterministic 2-letter avatar + color for a subject name (used on Theory subject cards)
    const SUBJECT_AVATAR_COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899', '#6366f1', '#14b8a6'];
    function subjectAvatar(subject) {
        const words = subject.split(/\s+/).filter(Boolean);
        const abbr = (words.length > 1 ? words[0][0] + words[1][0] : subject.substring(0, 2)).toUpperCase();
        let hash = 0;
        for (let i = 0; i < subject.length; i++) hash = (hash * 31 + subject.charCodeAt(i)) >>> 0;
        const color = SUBJECT_AVATAR_COLORS[hash % SUBJECT_AVATAR_COLORS.length];
        return { abbr, color };
    }

    // ============================================================
    //  SMALL HELPERS
    // ============================================================
    function storeGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
    function storeSet(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } }
    function storeRemove(key) { try { localStorage.removeItem(key); } catch (e) { /* private mode */ } }

    function $(id) { return document.getElementById(id); }

    // Stops user / server text from being run as HTML
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

    // Turns AI markdown-style text into safe, properly closed HTML
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

            // Fenced code blocks: ```
            if (/^```/.test(line)) {
                if (inCode) {
                    html += '<pre><code>' + codeBuf.join('\n') + '</code></pre>';
                    codeBuf = [];
                    inCode = false;
                } else {
                    closeList();
                    inCode = true;
                }
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
                openList('ul');
                html += '<li>' + inlineFormat(m[1]) + '</li>';
            } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
                openList('ol');
                html += '<li>' + inlineFormat(m[1]) + '</li>';
            } else {
                closeList();
                html += '<p>' + inlineFormat(line) + '</p>';
            }
        });
        closeList();
        // Unclosed code fence — flush whatever was collected
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

    // Disables a button and shows a label while an async task runs
    async function withLoading(btn, label, task) {
        if (btn && btn.disabled) return;
        const original = btn ? btn.innerHTML : '';
        if (btn) { btn.disabled = true; btn.innerHTML = label; btn.style.opacity = '0.7'; }
        try {
            return await task();
        } finally {
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
            if (err.name === 'AbortError') {
                return { error: 'The server took too long to respond. Please try again.' };
            }
            return { error: 'Cannot reach the server. Check your internet connection and try again.' };
        } finally {
            clearTimeout(timeout);
            clearTimeout(slowHint);
        }
    }

    // Wakes a sleeping Render server in the background (response is ignored)
    function wakeServer() {
        try { fetch(API_URL + '/', { mode: 'no-cors' }).catch(() => {}); } catch (e) { /* ignore */ }
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
    //  SESSION (stay logged in after reload)
    // ============================================================
    function normalizeUser(user) {
        const u = Object.assign({}, user);
        u.username = u.username || u.name || (u.email ? String(u.email).split('@')[0] : 'Student');
        return u;
    }

    function saveSession() {
        if (!currentUser) return;
        const safe = Object.assign({}, currentUser);
        delete safe.password;
        delete safe.password_hash;
        delete safe.hashed_password;
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
        } catch (e) { /* corrupted data, fall through */ }
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
        if (!email || !pass) {
            showError('Fill all fields');
            return;
        }
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
        if (!name || !email || !pass) {
            showError('Fill all fields');
            return;
        }
        if (pass.length < 6) {
            showError('Password must be at least 6 characters');
            return;
        }
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
        window.speechSynthesis && window.speechSynthesis.cancel();
        isSpeaking = false;

        // Clear anything the last user saw so the next person on this device starts clean
        resetChat();
        $('textbookResult').classList.add('hidden');
        $('questionsResult').classList.add('hidden');
        $('searchResult').classList.add('hidden');
        ['loginEmail', 'loginPass', 'signupName', 'signupEmail', 'signupPass', 'topicInput', 'searchQuery', 'pqTopic']
            .forEach(id => { $(id).value = ''; });
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
        renderDailyGoal();
        renderQuickSubjects();
    }

    function switchPage(pageId) {
        let target = $(pageId);
        if (!target || !target.classList.contains('page')) {
            pageId = 'dashboard';
            target = $('dashboard');
        }

        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        target.classList.add('active');

        // Highlight the current page in both menus
        document.querySelectorAll('[data-page]').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === pageId);
        });

        $('notificationDropdown').classList.remove('active');
        storeSet(PAGE_KEY, pageId);
        window.scrollTo(0, 0);

        if (pageId === 'profile') {
            populateProfile();
        } else if (pageId === 'leaderboard') {
            loadLeaderboard();
        } else if (pageId === 'dashboard') {
            updateDashboard();
        }
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
    //  NOTIFICATIONS
    // ============================================================
    function toggleNotifications() {
        $('notificationDropdown').classList.toggle('active');
    }

    function addNotification(title, message) {
        notifications.unshift({ title, message, read: false });
        if (notifications.length > 30) notifications.length = 30;
        updateNotificationBadge();
        updateNotificationsList();
    }

    function updateNotificationBadge() {
        const badge = $('notificationBadge');
        const unread = notifications.filter(n => !n.read).length;
        if (unread > 0) {
            badge.style.display = 'flex';
            badge.textContent = unread;
        } else {
            badge.style.display = 'none';
        }
    }

    function updateNotificationsList() {
        const list = $('notificationsList');
        list.innerHTML = '';
        if (notifications.length === 0) {
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
    //  LANDING PAGE: FAQ ACCORDION
    // ============================================================
    function toggleFaq(el) {
        const item = el.closest('.faq-item');
        const wasOpen = item.classList.contains('open');
        document.querySelectorAll('.faq-item.open').forEach(i => i.classList.remove('open'));
        if (!wasOpen) item.classList.add('open');
    }

    // ============================================================
    //  LOCAL HISTORY (recent quizzes & study — shown on Profile)
    // ============================================================
    function loadHistory() {
        try {
            const raw = storeGet(HISTORY_KEY);
            const data = raw ? JSON.parse(raw) : {};
            return { quizzes: Array.isArray(data.quizzes) ? data.quizzes : [], study: Array.isArray(data.study) ? data.study : [] };
        } catch (e) { return { quizzes: [], study: [] }; }
    }

    function saveHistory(history) {
        storeSet(HISTORY_KEY, JSON.stringify(history));
    }

    function recordQuizResult(entry) {
        const history = loadHistory();
        history.quizzes.unshift(Object.assign({ date: new Date().toISOString() }, entry));
        history.quizzes = history.quizzes.slice(0, 10);
        saveHistory(history);
    }

    function recordStudyEntry(entry) {
        const history = loadHistory();
        history.study.unshift(Object.assign({ date: new Date().toISOString() }, entry));
        history.study = history.study.slice(0, 10);
        saveHistory(history);
    }

    function formatHistoryDate(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' • ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return ''; }
    }

    function renderRecentQuizzes() {
        const box = $('profileRecentQuizzes');
        if (!box) return;
        const quizzes = loadHistory().quizzes;
        if (!quizzes.length) {
            box.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">No quizzes taken yet. Head to Textbook → Learn a topic → Take Quiz! 📝</p>';
            return;
        }
        box.innerHTML = quizzes.map(q =>
            '<div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 15px; background: var(--bg); border-radius: 8px; margin-bottom: 8px; gap: 10px; flex-wrap: wrap;">' +
                '<div><strong>' + escapeHtml(q.subject || '') + '</strong><span style="color: var(--text-light); font-size: 13px;"> — ' + escapeHtml(q.topic || '') + '</span>' +
                '<div style="color: var(--text-light); font-size: 12px;">' + formatHistoryDate(q.date) + '</div></div>' +
                '<div style="font-weight: 700; color: ' + (q.score >= q.total * 0.6 ? 'var(--success)' : 'var(--warning)') + ';">' + (q.score ?? 0) + ' / ' + (q.total ?? 5) + '</div>' +
            '</div>'
        ).join('');
    }

    function renderRecentStudy() {
        const box = $('profileRecentStudy');
        if (!box) return;
        const study = loadHistory().study;
        if (!study.length) {
            box.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">No study notes generated yet. Visit Textbook to get started! 📖</p>';
            return;
        }
        box.innerHTML = study.map(s =>
            '<div style="padding: 12px 15px; background: var(--bg); border-radius: 8px; margin-bottom: 8px;">' +
                '<strong>' + escapeHtml(s.subject || '') + '</strong><span style="color: var(--text-light); font-size: 13px;"> — ' + escapeHtml(s.topic || '') + '</span>' +
                '<div style="color: var(--text-light); font-size: 12px;">' + escapeHtml(s.level || '') + ' • ' + formatHistoryDate(s.date) + '</div>' +
            '</div>'
        ).join('');
    }

    // ============================================================
    //  DAILY GOAL (Dashboard)
    // ============================================================
    function todayStr() { return new Date().toISOString().slice(0, 10); }

    function getDailyGoal() {
        try {
            const raw = storeGet(GOAL_KEY);
            let goal = raw ? JSON.parse(raw) : null;
            if (!goal || typeof goal !== 'object') goal = { target: 5, date: todayStr(), count: 0 };
            if (goal.date !== todayStr()) { goal.date = todayStr(); goal.count = 0; } // new day, fresh start
            return goal;
        } catch (e) { return { target: 5, date: todayStr(), count: 0 }; }
    }

    function setDailyGoal(target) {
        const goal = getDailyGoal();
        goal.target = target;
        storeSet(GOAL_KEY, JSON.stringify(goal));
        renderDailyGoal();
    }

    function incrementDailyGoal() {
        const goal = getDailyGoal();
        goal.count += 1;
        storeSet(GOAL_KEY, JSON.stringify(goal));
        renderDailyGoal();
    }

    function renderDailyGoal() {
        const box = $('dailyGoalProgress');
        if (!box) return;
        const goal = getDailyGoal();
        const pct = Math.min(100, Math.round((goal.count / goal.target) * 100));
        box.innerHTML = goal.count >= goal.target
            ? '🎉 Goal reached! ' + goal.count + ' / ' + goal.target + ' activities today'
            : goal.count + ' / ' + goal.target + ' activities today';
        const fill = $('dailyGoalFill');
        if (fill) fill.style.width = pct + '%';
        document.querySelectorAll('.goal-option-btn').forEach(b => {
            b.classList.toggle('active', parseInt(b.dataset.goal, 10) === goal.target);
        });
    }

    function renderQuickSubjects() {
        const box = $('quickSubjectsGrid');
        if (!box) return;
        box.innerHTML = QUICK_SUBJECTS.map(subject => {
            const av = subjectAvatar(subject);
            return '<div class="quick-subject-card" onclick="dashboardQuickLearn(' + JSON.stringify(subject).replace(/"/g, '&quot;') + ')">' +
                '<div class="quick-subject-avatar" style="background:' + av.color + '">' + av.abbr + '</div>' +
                '<div class="quick-subject-name">' + escapeHtml(subject) + '</div>' +
            '</div>';
        }).join('');
    }

    function dashboardQuickLearn(subject) {
        switchPage('textbook');
        textbookOpenLearn(subject, 'SSS');
    }

    // ============================================================
    //  TEXTBOOK
    // ============================================================
    // ===== TEXTBOOK SUBJECT SELECTION =====
    function initTextbookSubjects() {
        // Populate JSS subjects
        const jssContainer = $('jssSubjects');
        Object.values(JSS_SUBJECTS).forEach(subjectList => {
            subjectList.forEach(subject => {
                const item = document.createElement('div');
                item.className = 'subject-item';
                item.textContent = subject;
                item.onclick = () => textbookOpenLearn(subject, 'JSS');
                jssContainer.appendChild(item);
            });
        });

        // Populate SSS subjects (academic only — no vocational/technical trades)
        const sssContainer = $('sssSubjects');
        Object.values(SSS_SUBJECTS_TEXTBOOK).forEach(subjectList => {
            subjectList.forEach(subject => {
                const item = document.createElement('div');
                item.className = 'subject-item';
                item.textContent = subject;
                item.onclick = () => textbookOpenLearn(subject, 'SSS');
                sssContainer.appendChild(item);
            });
        });
    }

    // ===== LEARN FLOW: topic -> notes -> quiz =====
    function textbookOpenLearn(subject, level) {
        selectedLevel = level;
        selectedSubject = subject;

        $('textbookSubjectGrid').classList.add('hidden');
        $('textbookLearn').classList.remove('hidden');
        $('learnSubjectLabel').textContent = subject + ' (' + level + ')';
        $('topicInput').value = '';
        $('textbookResult').classList.add('hidden');
        $('takeQuizBtn').classList.add('hidden');
        $('quizPanel').classList.add('hidden');
        $('textbookLearn').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('topicInput').focus();
    }

    function textbookBackToSubjects() {
        $('textbookSubjectGrid').classList.remove('hidden');
        $('textbookLearn').classList.add('hidden');
        $('quizPanel').classList.add('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
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
                topic: topic
            });

            const content = res.note || res.response || res.textbook || res.content || res.text;
            if (res.error || !content) {
                showError(res.error || 'Could not generate notes. Please try again.');
                return;
            }

            $('textbookTitle').textContent = topic + ' - Study Notes';
            $('textbookOutput').innerHTML = formatRichText(typeof content === 'string' ? content : JSON.stringify(content, null, 2));
            $('textbookResult').classList.remove('hidden');
            $('takeQuizBtn').classList.remove('hidden');
            $('quizPanel').classList.add('hidden');
            $('textbookResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
            addNotification('✅ Textbook Generated', 'Your study notes on "' + topic + '" are ready! 📚');
            recordStudyEntry({ subject: selectedSubject, topic, level: selectedLevel });
            incrementDailyGoal();
        });
    }

    // ============================================================
    //  QUIZ (5 questions, 20s timer each, generated from the topic just studied)
    // ============================================================
    const QUIZ_TIME_PER_Q = 20;
    let quizState = null;
    let quizTimerId = null;

    // Best-effort parse of freeform quiz text into structured { question, options:[{label,text}], correctLabel, explanation }
    function parseQuizText(text) {
        const lines = String(text).replace(/\r/g, '').split('\n');
        const startRe = /^\s*(?:\*\*)?(?:Question\s*)?\d+\s*[.):]/i;
        const blocks = [];
        let cur = [];
        lines.forEach(line => {
            if (startRe.test(line) && cur.length) { blocks.push(cur); cur = []; }
            if (line.trim()) cur.push(line.trim());
        });
        if (cur.length) blocks.push(cur);

        return blocks.map(block => {
            let question = '';
            const options = [];
            let correctLabel = '';
            let explanation = '';
            block.forEach(line => {
                const optMatch = line.match(/^([A-D])\s*[.):]\s*(.*)$/);
                if (optMatch) {
                    const isCorrect = /^✓|\(correct\)/i.test(optMatch[2]);
                    options.push({ label: optMatch[1], text: optMatch[2].replace(/^✓\s*/, '').replace(/\(correct\)/i, '').trim() });
                    if (isCorrect) correctLabel = optMatch[1];
                } else if (/^(correct\s+)?answer\s*[:\-]/i.test(line)) {
                    const m = line.match(/([A-D])\b/);
                    if (m) correctLabel = m[1];
                } else if (/^(explanation|solution|why)\s*[:\-]/i.test(line)) {
                    explanation = line.replace(/^(explanation|solution|why)\s*[:\-]\s*/i, '');
                } else if (!question) {
                    question = line.replace(startRe, '').trim();
                } else if (!explanation) {
                    explanation += (explanation ? ' ' : '') + line;
                }
            });
            return { question, options, correctLabel: correctLabel || (options[0] && options[0].label) || 'A', explanation };
        }).filter(q => q.question && q.options.length >= 2);
    }

    async function startQuiz(btn) {
        if (!selectedSubject) return;
        const topic = $('topicInput').value.trim() || $('textbookTitle').textContent;

        $('quizPanel').classList.remove('hidden');
        $('quizPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('quizQuestionArea').innerHTML = '⏳ Generating your 5-question quiz...';
        $('quizSummary').classList.add('hidden');

        await withLoading(btn, '⏳ Preparing quiz...', async () => {
            const res = await apiCall('/api/generate-quiz', { subject: selectedSubject, topic, level: selectedLevel, count: 5 });

            let questions = [];
            const rawQuestions = res.quiz || res.questions || res.raw || res.response || res.content;
            if (Array.isArray(rawQuestions) && rawQuestions.length && typeof rawQuestions[0] === 'object') {
                questions = rawQuestions.map(item => {
                    const opts = item.options || item.choices || {};
                    const optionList = Array.isArray(opts)
                        ? opts.map((o, k) => ({ label: String.fromCharCode(65 + k), text: o }))
                        : Object.entries(opts).map(([k, v]) => ({ label: k, text: v }));
                    return {
                        question: item.question || item.q || item.text || '',
                        options: optionList,
                        correctLabel: (item.answer || item.correct_answer || optionList[0]?.label || 'A').toString().trim().charAt(0).toUpperCase(),
                        explanation: item.explanation || ''
                    };
                });
            } else if (typeof rawQuestions === 'string') {
                questions = parseQuizText(rawQuestions);
            }

            if (res.error || !questions.length) {
                $('quizQuestionArea').innerHTML = '<span style="color: var(--danger);">⚠️ ' + escapeHtml(res.error || 'Could not generate a quiz. Please try again.') + '</span>';
                return;
            }

            quizState = { questions: questions.slice(0, 5), index: 0, score: 0, subject: selectedSubject, topic };
            renderQuizQuestion();
        });
    }

    function stopQuizTimer() {
        if (quizTimerId) { clearInterval(quizTimerId); quizTimerId = null; }
    }

    function renderQuizQuestion() {
        stopQuizTimer();
        const q = quizState.questions[quizState.index];
        let timeLeft = QUIZ_TIME_PER_Q;

        const optionsHtml = q.options.map(o =>
            '<div class="quiz-option" data-label="' + o.label + '" onclick="selectQuizAnswer(' + "'" + o.label + "'" + ')">' +
                '<strong>' + o.label + ')</strong> ' + escapeHtml(o.text) +
            '</div>'
        ).join('');

        $('quizQuestionArea').innerHTML =
            '<div class="quiz-progress-row">' +
                '<span>Question ' + (quizState.index + 1) + ' / ' + quizState.questions.length + '</span>' +
                '<span id="quizTimerLabel">⏱ ' + timeLeft + 's</span>' +
            '</div>' +
            '<div class="quiz-timer-bar"><div class="quiz-timer-fill" id="quizTimerFill" style="width:100%"></div></div>' +
            '<div class="quiz-question-text">' +
                escapeHtml(q.question) +
                ' <button class="voice-btn" style="width:34px;height:34px;min-width:34px;font-size:14px;" onclick="speakQuizQuestion()" title="Read question aloud">🔊</button>' +
            '</div>' +
            '<div id="quizOptions">' + optionsHtml + '</div>' +
            '<div id="quizExplainBox" class="theory-explain-box"></div>' +
            '<div class="theory-actions">' +
                '<button id="quizNextBtn" class="theory-btn theory-btn-primary hidden" onclick="nextQuizQuestion()">' + (quizState.index === quizState.questions.length - 1 ? 'Finish Quiz 🏁' : 'Next Question ➡️') + '</button>' +
            '</div>';

        quizTimerId = setInterval(() => {
            timeLeft--;
            const label = $('quizTimerLabel');
            const fill = $('quizTimerFill');
            if (label) label.textContent = '⏱ ' + Math.max(timeLeft, 0) + 's';
            if (fill) fill.style.width = Math.max(0, (timeLeft / QUIZ_TIME_PER_Q) * 100) + '%';
            if (timeLeft <= 0) { stopQuizTimer(); quizRevealAnswer(null); }
        }, 1000);
    }

    function speakQuizQuestion() {
        if (!('speechSynthesis' in window) || !quizState) return;
        const q = quizState.questions[quizState.index];
        const text = q.question + '. ' + q.options.map(o => o.label + '. ' + o.text).join('. ');
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }

    function selectQuizAnswer(label) {
        if (!quizState) return;
        stopQuizTimer();
        quizRevealAnswer(label);
    }

    function quizRevealAnswer(selectedLabel) {
        const q = quizState.questions[quizState.index];
        const correct = selectedLabel === q.correctLabel;
        if (correct) quizState.score++;

        document.querySelectorAll('.quiz-option').forEach(el => {
            el.onclick = null;
            if (el.dataset.label === q.correctLabel) el.classList.add('correct');
            else if (el.dataset.label === selectedLabel) el.classList.add('incorrect');
        });

        const explainBox = $('quizExplainBox');
        if (explainBox) {
            explainBox.classList.add('show');
            explainBox.innerHTML = '<strong style="color: ' + (correct ? 'var(--success)' : 'var(--danger)') + ';">' +
                (selectedLabel ? (correct ? '✅ Correct!' : '❌ Not quite — correct answer: ' + q.correctLabel) : '⏰ Time\'s up — correct answer: ' + q.correctLabel) +
                '</strong>' + (q.explanation ? '<p style="margin-top: 8px;">' + escapeHtml(q.explanation) + '</p>' : '');
        }
        const nextBtn = $('quizNextBtn');
        if (nextBtn) nextBtn.classList.remove('hidden');
    }

    function nextQuizQuestion() {
        stopQuizTimer();
        quizState.index++;
        if (quizState.index >= quizState.questions.length) {
            finishQuiz();
        } else {
            renderQuizQuestion();
        }
    }

    function finishQuiz() {
        const total = quizState.questions.length;
        const score = quizState.score;
        $('quizQuestionArea').innerHTML = '';
        $('quizSummary').classList.remove('hidden');
        $('quizSummary').innerHTML =
            '<div style="text-align:center; padding: 20px 0;">' +
                '<div style="font-size: 48px; margin-bottom: 10px;">' + (score >= total * 0.6 ? '🎉' : '💪') + '</div>' +
                '<h3 style="margin-bottom: 8px;">You scored ' + score + ' / ' + total + '</h3>' +
                '<p style="color: var(--text-light); margin-bottom: 20px;">' + quizState.subject + ' • ' + escapeHtml(quizState.topic) + '</p>' +
                '<button class="theory-btn theory-btn-primary" onclick="startQuiz(this)">🔄 Try Another Quiz</button> ' +
                '<button class="theory-btn theory-btn-secondary" onclick="textbookBackToSubjects()">⬅️ Back to Subjects</button>' +
            '</div>';

        if (currentUser) {
            currentUser.quizzes_taken = (currentUser.quizzes_taken || 0) + 1;
            currentUser.total_score = (currentUser.total_score || 0) + score;
            saveSession();
            updateDashboard();
        }
        recordQuizResult({ subject: quizState.subject, topic: quizState.topic, score, total });
        incrementDailyGoal();
        addNotification('🏁 Quiz Complete', quizState.subject + ': ' + score + ' / ' + total);
    }

    function speakText(elementId, btn) {
        if (!('speechSynthesis' in window)) {
            showError('Read aloud is not supported on this browser.');
            return;
        }
        const synth = window.speechSynthesis;

        // Second click stops reading
        if (isSpeaking || synth.speaking) {
            synth.cancel();
            isSpeaking = false;
            if (btn) btn.innerHTML = SPEAK_LABEL;
            return;
        }

        const el = $(elementId);
        const text = el ? el.innerText.trim() : '';
        if (!text) return;

        // Long text is read in small chunks (some browsers cut off long utterances)
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
            const utterance = new SpeechSynthesisUtterance(chunk);
            utterance.rate = 0.9;
            if (i === chunks.length - 1) {
                utterance.onend = utterance.onerror = () => {
                    isSpeaking = false;
                    if (btn) btn.innerHTML = SPEAK_LABEL;
                };
            }
            synth.speak(utterance);
        });
    }

    // ============================================================
    //  AI CHAT (ChatGPT-style)
    // ============================================================
    function chatGreetingHtml() {
        return '<div class="gpt-msg gpt-msg-ai"><div class="gpt-avatar gpt-avatar-ai">🤖</div>' +
            '<div class="gpt-bubble-col">' +
            '<div class="gpt-bubble"><div class="rich"><p>Hello! 👋 I\'m your AI tutor. Ask me anything about Mathematics, Science, English, or any subject. I\'m here to help!</p></div></div>' +
            '</div></div>';
    }

    function resetChat() {
        $('chatBox').innerHTML = chatGreetingHtml();
        chatBusy = false;
        clearChatImage();
        const input = $('chatInput');
        if (input) { input.value = ''; autoGrowChatInput(input); input.focus(); }
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
            showError('Could not copy to clipboard');
        }
    }

    function speakChatMessage(btn) {
        if (!('speechSynthesis' in window)) { showError('Read aloud is not supported on this browser.'); return; }
        const bubble = btn.closest('.gpt-bubble-col').querySelector('.gpt-bubble');
        const text = bubble ? bubble.innerText.trim() : '';
        if (!text) return;
        speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text.substring(0, 5000));
        utterance.rate = 0.9;
        speechSynthesis.speak(utterance);
    }

    function stopChatMessage() {
        if ('speechSynthesis' in window) speechSynthesis.cancel();
    }

    // ===== IMAGE UPLOAD =====
    function triggerChatImageUpload() {
        $('chatImageInput').click();
    }

    function handleChatImageSelected(input) {
        const file = input.files && input.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) { showError('Please choose an image file'); return; }

        const reader = new FileReader();
        reader.onload = () => {
            pendingChatImage = { dataUrl: reader.result, name: file.name };
            $('chatImagePreview').innerHTML =
                '<img src="' + reader.result + '" alt="attached image">' +
                '<button onclick="clearChatImage()" title="Remove image">✕</button>';
            $('chatImagePreview').classList.remove('hidden');
        };
        reader.readAsDataURL(file);
        input.value = '';
    }

    function clearChatImage() {
        pendingChatImage = null;
        $('chatImagePreview').innerHTML = '';
        $('chatImagePreview').classList.add('hidden');
    }

    function addChatBubble(role, text, imageDataUrl) {
        const box = $('chatBox');
        const div = document.createElement('div');
        const imgHtml = imageDataUrl ? '<img src="' + imageDataUrl + '" class="gpt-chat-image" alt="attached image">' : '';

        if (role === 'user') {
            div.className = 'gpt-msg gpt-msg-user';
            div.innerHTML = '<div class="gpt-avatar gpt-avatar-user">🧑</div>' +
                '<div class="gpt-bubble-col"><div class="gpt-bubble">' + imgHtml + '</div></div>';
            if (text) div.querySelector('.gpt-bubble').appendChild(document.createTextNode(text));
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
                    '<button onclick="copyChatMessage(this)" title="Copy">📋 Copy</button>' +
                    '<button onclick="speakChatMessage(this)" title="Read aloud">🔊 Speak</button>' +
                    '<button onclick="stopChatMessage()" title="Stop reading">⏹ Stop</button>' +
                '</div>' +
                '</div>';
        }

        box.appendChild(div);
        box.scrollTop = box.scrollHeight;
        return div;
    }

    async function sendChat() {
        const input = $('chatInput');
        const msg = input.value.trim();
        const image = pendingChatImage;
        if ((!msg && !image) || chatBusy) return;

        chatBusy = true;
        $('sendChatBtn').disabled = true;
        addChatBubble('user', msg, image ? image.dataUrl : null);
        input.value = '';
        autoGrowChatInput(input);
        clearChatImage();
        const typing = addChatBubble('typing');

        try {
            const payload = { message: msg };
            if (image) payload.image = image.dataUrl;
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

        // Past Questions is objective-only now (Theory/Essay practice lives on its own Theory page)
    }

    // Accepts text or an array of question objects and returns plain text
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

    // ===== VOICE FUNCTIONS =====
    function startVoiceChat() {
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            showError('Voice recognition not supported on this device');
            return;
        }
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.onstart = () => showNotification('🎤 Listening...', 'Speak your question');
        recognition.onresult = (e) => {
            const text = Array.from(e.results)
                .map(r => r[0].transcript)
                .join('');
            $('chatInput').value = text;
            $('chatInput').focus();
            sendChat();
        };
        recognition.onerror = () => showError('Microphone not available');
        recognition.start();
    }

    function startVoiceSearch() {
        if (!('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
            showError('Voice recognition not supported on this device');
            return;
        }
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const recognition = new SpeechRecognition();
        recognition.onstart = () => showNotification('🎤 Listening...', 'Speak your search term');
        recognition.onresult = (e) => {
            const text = Array.from(e.results)
                .map(r => r[0].transcript)
                .join('');
            $('searchQuery').value = text;
            performWebSearch($('searchBtn'));
        };
        recognition.onerror = () => showError('Microphone not available');
        recognition.start();
    }

    function speakText(elementId, btn) {
        const element = $(elementId);
        if (!element || !element.textContent.trim()) {
            showError('Nothing to read');
            return;
        }

        if ('speechSynthesis' in window) {
            if (speechSynthesis.speaking) {
                speechSynthesis.cancel();
                btn.textContent = '🔊';
                return;
            }
            const utterance = new SpeechSynthesisUtterance(element.innerText.substring(0, 5000));
            utterance.rate = 0.9;
            utterance.onend = () => { btn.textContent = '🔊'; };
            btn.textContent = '⏸️';
            speechSynthesis.speak(utterance);
        }
    }

    function speakLastMessage() {
        const messages = document.querySelectorAll('#chatBox > div');
        if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1].textContent;
            if ('speechSynthesis' in window) {
                speechSynthesis.cancel();
                const utterance = new SpeechSynthesisUtterance(lastMessage);
                utterance.rate = 0.9;
                speechSynthesis.speak(utterance);
            }
        }
    }

    // ===== PAST QUESTIONS WITH CORRECTIONS & PROGRESS (Objective only) =====
    let totalQuestionsGenerated = 0;
    let currentExam = '', currentYear = '', currentSubject = '', currentTopic = '';
    const PQ_QTYPE = 'Objective';

    async function generatePastQuestions(btn) {
        const exam = $('pqExam').value;
        const year = $('pqYear').value;
        const subject = $('pqSubject').value;
        const topic = $('pqTopic').value.trim();

        if (!exam || !year || !subject) {
            showError('Please select the exam, year and subject');
            return;
        }

        // Store for "Generate More"
        currentExam = exam;
        currentYear = year;
        currentSubject = subject;
        currentTopic = topic;
        totalQuestionsGenerated = 0;

        await withLoading(btn, 'Generating first 10 questions...', async () => {
            const payload = { exam, year, subject, qtype: PQ_QTYPE, count: 10 };
            if (topic) payload.topic = topic;
            const res = await apiCall('/api/generate-past-questions', payload);

            const content = questionsToText(res.raw || res.response || res.questions || res.content);
            if (res.error || !content.trim()) {
                showError(res.error || 'Could not generate questions. Please try again.');
                return;
            }

            $('questionsMeta').textContent = exam + ' ' + year + ' • ' + subject + ' • Objective' + (topic ? ' • ' + topic : '');
            $('questionsContainer').innerHTML = formatQuestionsWithCorrections(content);
            totalQuestionsGenerated = 10;
            updateProgressBar();
            $('progressSection').classList.remove('hidden');
            $('questionsResult').classList.remove('hidden');
            $('generateMoreBtn').classList.toggle('show', totalQuestionsGenerated < 60);
            $('questionsResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
            addNotification('✅ 10 Questions Generated', 'Click answers to see corrections!');
        });
    }

    async function generateMorePastQuestions(btn) {
        if (totalQuestionsGenerated >= 60) {
            showNotification('✨ Limit Reached', 'You have generated the maximum 60 questions', 'success');
            $('generateMoreBtn').classList.remove('show');
            return;
        }

        await withLoading(btn, 'Generating 10 more questions...', async () => {
            const payload = {
                exam: currentExam,
                year: currentYear,
                subject: currentSubject,
                qtype: PQ_QTYPE,
                count: 10
            };
            if (currentTopic) payload.topic = currentTopic;
            const res = await apiCall('/api/generate-past-questions', payload);

            const content = questionsToText(res.raw || res.response || res.questions || res.content);
            if (res.error || !content.trim()) {
                showError(res.error || 'Could not generate more questions.');
                return;
            }

            const newQuestionsHtml = formatQuestionsWithCorrections(content);
            $('questionsContainer').innerHTML += newQuestionsHtml;
            totalQuestionsGenerated += 10;
            updateProgressBar();
            $('generateMoreBtn').classList.toggle('show', totalQuestionsGenerated < 60);
            $('questionsResult').scrollIntoView({ behavior: 'smooth', block: 'end' });
            addNotification('✅ 10 More Questions Added', totalQuestionsGenerated + ' / 60 questions generated');
        });
    }

    function updateProgressBar() {
        const percentage = (totalQuestionsGenerated / 60) * 100;
        $('questionCount').textContent = totalQuestionsGenerated;
        $('progressFill').style.width = percentage + '%';
    }

    function formatQuestionsWithCorrections(text) {
        const lines = text.split('\n').filter(l => l.trim());
        let html = '';
        let currentQ = null;
        let qNum = totalQuestionsGenerated + 1;

        lines.forEach(line => {
            const trimmed = line.trim();
            if (/^\d+[\.\)]\s+/.test(trimmed) || /^Q\d+:|^Question \d+:/i.test(trimmed)) {
                if (currentQ) html += '</div>';
                currentQ = trimmed.replace(/^\d+[\.\)]\s*/, '').replace(/^Q\d+:\s*/, '');
                html += `<div class="pq-question" data-question="${escapeHtml(currentQ).replace(/"/g, '&quot;')}" style="margin-bottom: 25px; padding: 20px; background: var(--bg); border-radius: 10px; border-left: 4px solid var(--primary);">
                    <div style="display:flex; justify-content: space-between; align-items: flex-start; gap: 10px; margin-bottom: 15px;">
                        <div style="font-weight: 700; color: var(--primary);">Q${qNum}: ${escapeHtml(currentQ)}</div>
                        <button class="voice-btn" style="width:30px;height:30px;min-width:30px;font-size:13px;margin-left:0;" onclick="speakPQQuestion(this)" title="Read question aloud">🔊</button>
                    </div>`;
                qNum++;
            } else if (/^[A-D]\s*[\.\)]\s+/.test(trimmed)) {
                const option = trimmed.match(/^([A-D])/)[1];
                const text = trimmed.replace(/^[A-D]\s*[\.\)]\s*/, '');
                const isCorrect = /^✓|correct|answer|right/i.test(text);
                html += `<div style="padding: 12px 15px; margin: 10px 0; background: var(--bg-card); border-radius: 8px; border-left: 3px solid ${isCorrect ? 'var(--success)' : 'var(--border)'}; cursor: pointer;" onclick="showCorrection(event)">
                    <strong>${option})</strong> ${escapeHtml(text.replace(/^✓\s*/, ''))}
                </div>`;
            } else if (trimmed && /^(explanation|answer|why|because|note)/i.test(trimmed)) {
                html += `<div class="correction-box" style="display: none;">
                    <strong>✓ Explanation:</strong>
                    <p style="margin-top: 8px;">${escapeHtml(trimmed)}</p>
                </div>`;
            }
        });

        if (currentQ) html += '</div>';
        return html;
    }

    // ============================================================
    //  THEORY PRACTICE (WAEC / NECO)
    // ============================================================
    let theoryExam = '';
    let theorySubject = '';
    let theoryBusy = false;

    function theoryUpdateCrumbs() {
        let html = '<button onclick="theoryGoToBoards()">📋 Exam Board' + (theoryExam ? ': ' + theoryExam : '') + '</button>';
        if (theoryExam) {
            html += '<span>›</span><button onclick="theoryGoToSubjects()">📚 Subject' + (theorySubject ? ': ' + escapeHtml(theorySubject) : '') + '</button>';
        }
        if (theorySubject) {
            html += '<span>›</span><button disabled style="opacity:0.7; cursor:default;">📝 Question</button>';
        }
        $('theoryCrumbs').innerHTML = html;
    }

    function theoryGoToBoards() {
        theoryExam = '';
        theorySubject = '';
        $('theoryBoards').classList.remove('hidden');
        $('theorySubjects').classList.add('hidden');
        $('theoryQuestionResult').classList.add('hidden');
        theoryUpdateCrumbs();
    }

    function theoryGoToSubjects() {
        theorySubject = '';
        $('theoryBoards').classList.add('hidden');
        $('theorySubjects').classList.remove('hidden');
        $('theoryQuestionResult').classList.add('hidden');
        theoryUpdateCrumbs();
    }

    function theorySelectBoard(exam) {
        theoryExam = exam;
        $('theorySubjectsTitle').textContent = exam + ' — Select a Subject';

        let html = '';
        Object.entries(THEORY_SUBJECTS[exam]).forEach(([group, subjects]) => {
            subjects.forEach(s => {
                const av = subjectAvatar(s);
                html += '<div class="theory-subject-card" onclick="theorySelectSubject(' + JSON.stringify(s).replace(/"/g, '&quot;') + ')">' +
                    '<div class="theory-subject-avatar" style="background:' + av.color + '">' + av.abbr + '</div>' +
                    '<div class="theory-subject-info"><div class="theory-subject-name">' + escapeHtml(s) + '</div>' +
                    '<span class="theory-subject-badge">' + exam + ' · 5</span></div>' +
                    '<div class="theory-subject-chevron">›</div>' +
                '</div>';
            });
        });
        $('theorySubjectsGrid').innerHTML = html;

        $('theoryBoards').classList.add('hidden');
        $('theorySubjects').classList.remove('hidden');
        $('theoryQuestionResult').classList.add('hidden');
        theoryUpdateCrumbs();
        $('theorySubjects').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function theorySelectSubject(subject) {
        theorySubject = subject;
        theoryUpdateCrumbs();
        theoryFetchQuestion();
    }

    // Accepts a string, an array, or a question object and returns an array of question strings
    function theoryQuestionsToList(data) {
        if (Array.isArray(data)) {
            return data.map(item => (typeof item === 'string' ? item : (item.question || item.q || item.text || ''))).filter(Boolean);
        }
        if (typeof data === 'string') {
            // Split a block of text into up to 5 numbered questions
            const parts = data.split(/\n(?=\s*\d+[.)]\s)/).map(s => s.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
            return parts.length ? parts : [data.trim()];
        }
        if (data && typeof data === 'object') {
            const q = data.question || data.q || data.text;
            return q ? [q] : [];
        }
        return [];
    }

    async function theoryFetchQuestion(btn) {
        if (theoryBusy || !theoryExam || !theorySubject) return;
        theoryBusy = true;

        $('theoryQuestionTitle').textContent = '📖 ' + theorySubject + ' Theory Questions';
        $('theoryMeta').textContent = theoryExam + ' • ' + theorySubject + ' • 5 Theory / Essay Questions';
        $('theoryQuestionBox').innerHTML = '⏳ Generating 5 questions...';
        $('theoryQuestionResult').classList.remove('hidden');
        $('theoryQuestionResult').scrollIntoView({ behavior: 'smooth', block: 'start' });

        const run = async () => {
            const res = await apiCall('/api/generate-theory-question', { exam: theoryExam, subject: theorySubject, qtype: 'Theory', count: 5 });
            const list = theoryQuestionsToList(res.raw || res.response || res.questions || res.question || res.content).slice(0, 5);

            if (res.error || !list.length) {
                $('theoryQuestionBox').innerHTML = '<span style="color: var(--danger);">⚠️ ' + escapeHtml(res.error || 'Could not generate questions. Please try again.') + '</span>';
                return;
            }

            $('theoryQuestionBox').innerHTML = list.map((q, i) =>
                '<div class="theory-q-item" data-question="' + escapeHtml(q).replace(/"/g, '&quot;') + '" style="margin-bottom: ' + (i < list.length - 1 ? '24px' : '0') + '; padding-bottom: ' + (i < list.length - 1 ? '20px' : '0') + '; border-bottom: ' + (i < list.length - 1 ? '1px solid var(--border)' : 'none') + ';">' +
                    '<div style="display:flex; justify-content: space-between; align-items: flex-start; gap: 10px;">' +
                        '<div class="rich" style="flex:1;"><strong>Q' + (i + 1) + '.</strong> ' + formatRichText(q).replace(/^<p>|<\/p>$/g, '') + '</div>' +
                        '<button class="voice-btn" style="width:34px;height:34px;min-width:34px;font-size:14px;" onclick="speakTheoryQuestion(this)" title="Read question aloud">🔊</button>' +
                    '</div>' +
                    '<div class="theory-explain-box" id="theoryExplain' + i + '"></div>' +
                    '<button class="theory-btn theory-btn-primary" style="margin-top: 10px; font-size: 13px; padding: 8px 16px;" onclick="getTheoryExplanation(this, ' + i + ')">💡 Get Explanation</button>' +
                '</div>'
            ).join('');
            addNotification('📝 Theory Questions Ready', theoryExam + ' ' + theorySubject + ' — 5 questions generated!');
        };

        if (btn) {
            await withLoading(btn, '⏳ Loading...', run);
        } else {
            await run();
        }
        theoryBusy = false;
    }

    function speakTheoryQuestion(btn) {
        const item = btn.closest('.theory-q-item');
        const text = item ? item.dataset.question : '';
        if (!text || !('speechSynthesis' in window)) return;
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }

    async function getTheoryExplanation(btn, index) {
        const item = btn.closest('.theory-q-item');
        const question = item ? item.dataset.question : '';
        if (!question) return;

        await withLoading(btn, '⏳ Thinking...', async () => {
            const res = await apiCall('/api/explain-theory-question', {
                exam: theoryExam,
                subject: theorySubject,
                question
            });
            const content = res.explanation || res.response || res.answer || res.raw || res.content;

            if (res.error || !content || !String(content).trim()) {
                showError(res.error || 'Could not generate an explanation. Please try again.');
                return;
            }

            const explainBox = $('theoryExplain' + index);
            explainBox.innerHTML = '<strong style="color: var(--success); display: block; margin-bottom: 8px;">💡 Explanation</strong>' +
                '<div class="rich">' + formatRichText(String(content)) + '</div>' +
                '<button class="voice-btn" style="width:34px;height:34px;min-width:34px;font-size:14px; margin-top: 8px;" onclick="speakTheoryExplanation(this)" title="Read explanation aloud">🔊</button>';
            explainBox.classList.add('show');
            explainBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
    }

    function speakTheoryExplanation(btn) {
        const box = btn.closest('.theory-explain-box');
        const text = box ? box.innerText : '';
        if (!text || !('speechSynthesis' in window)) return;
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }

    function showCorrection(event) {
        const correction = event.currentTarget.parentElement.querySelector('.correction-box');
        if (correction) {
            correction.classList.toggle('show');
            correction.style.display = correction.style.display === 'none' ? 'block' : 'none';
        }
    }

    function speakPQQuestion(btn) {
        const card = btn.closest('.pq-question');
        const text = card ? card.dataset.question : '';
        if (!text || !('speechSynthesis' in window)) return;
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }

    // ============================================================
    //  WEB SEARCH WITH CACHING
    // ============================================================
    let searchCache = {};
    function searchLinksHtml(query) {
        const q = encodeURIComponent(query);
        const linkStyle = 'display: inline-block; margin: 4px 8px 4px 0; padding: 10px 16px; background: var(--primary); color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;';
        return '<div style="margin-top: 20px;"><p style="color: var(--text-light); font-size: 14px; margin-bottom: 8px;">Search "' + escapeHtml(query) + '" directly on:</p>' +
            '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/results?search_query=' + q + '">🎥 YouTube</a>' +
            '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?q=' + q + '">🔍 Google</a>' +
            '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://en.wikipedia.org/w/index.php?search=' + q + '">📚 Wikipedia</a></div>';
    }

    async function performWebSearch(btn) {
        const query = $('searchQuery').value.trim();
        if (!query) {
            showError('Please enter a search query');
            return;
        }

        // Check cache first
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
                // Cache the results
                searchCache[query] = html;
            } else if (typeof res.results === 'string' || typeof res.response === 'string') {
                html = '<div class="rich">' + formatRichText(res.results || res.response) + '</div>';
                searchCache[query] = html;
            } else {
                html = box + 'No results found. Try a different search query.</div>';
            }

            displaySearchResults(html, query, false);
            if (!res.error) addNotification('✅ Search Complete', 'Found results for "' + query + '"');
        });
    }

    function displaySearchResults(html, query, fromCache) {
        const resultsHtml = html + searchLinksHtml(query);
        $('searchResultsList').innerHTML = resultsHtml;
        
        // Show cache indicator
        if (fromCache) {
            $('cacheIndicator').style.display = 'block';
        } else {
            $('cacheIndicator').style.display = 'none';
        }
        
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

        // The endpoint may be GET or POST on the server, so try GET first and fall back
        let res = await apiCall('/api/leaderboard', null, 'GET');
        if (res.error && [404, 405, 422].includes(res.status)) {
            res = await apiCall('/api/leaderboard', {}, 'POST');
        }

        if (res.error) {
            leaderboardMessage('⚠️ Could not load the leaderboard: ' + escapeHtml(res.error), 'var(--danger)');
            return;
        }

        const list = Array.isArray(res) ? res : (res.leaderboard || res.users || res.data || []);
        if (!Array.isArray(list) || list.length === 0) {
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
                '<td style="padding: 15px; border-bottom: 1px solid var(--border); text-align: center;"><span style="font-size: 20px; font-weight: 700;">' + (medals[i] || (i + 1)) + '</span></td>' +
                '<td style="padding: 15px; border-bottom: 1px solid var(--border); font-weight: 600;">' + escapeHtml(user.username || 'Anonymous') + (isMe ? ' <small style="color: var(--primary);">(you)</small>' : '') + '</td>' +
                '<td style="padding: 15px; border-bottom: 1px solid var(--border); color: var(--primary); font-weight: 600;">' + escapeHtml(user.total_score || 0) + ' <small>pts</small></td>' +
                '<td style="padding: 15px; border-bottom: 1px solid var(--border); color: var(--success); font-weight: 600;">🔥 ' + escapeHtml(user.streak || 0) + '</td>';
            tbody.appendChild(tr);
        });
    }

    // ============================================================
    //  PROFILE
    // ============================================================
    function saveProfile() {
        const newUsername = $('profileUsername').value.trim();
        if (!newUsername) {
            showError('Username cannot be empty');
            return;
        }

        currentUser.username = newUsername;
        saveSession();   // keeps the new name after a reload
        $('navUser').textContent = newUsername;
        $('dashName').textContent = newUsername;
        showToast('Profile saved', 'success');
        addNotification('✅ Profile Saved', 'Username updated to "' + newUsername + '"!');
    }

    // ============================================================
    //  MENUS
    // ============================================================
    function toggleMobileMenu() {
        $('mobileMenu').classList.toggle('active');
    }

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

    // Logging out in one tab logs out the others too
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

        // Chat: Enter sends, Shift+Enter makes a new line; textarea auto-grows
        const chatInputEl = $('chatInput');
        if (chatInputEl) {
            chatInputEl.addEventListener('keydown', e => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
            });
            chatInputEl.addEventListener('input', () => autoGrowChatInput(chatInputEl));
        }
        resetChat();
        theoryGoToBoards();
        renderDailyGoal();
        renderQuickSubjects();

        wakeServer();

        // Logged in before? Go straight back into the app.
        if (restoreSession()) {
            enterApp();
            switchPage(storeGet(PAGE_KEY) || 'dashboard');
        }
        document.documentElement.classList.remove('has-session');
    })();
