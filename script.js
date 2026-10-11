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

    // Used for the SSS Textbook only — academic subjects, no vocational/technical trades
    const SSS_SUBJECTS_TEXTBOOK = {
        'Core Subjects': ['English Language', 'Mathematics', 'Civic Education'],
        'Sciences': ['Physics', 'Chemistry', 'Biology', 'Further Mathematics', 'Agricultural Science', 'Geography', 'Computer Studies', 'Physical Education', 'Health Education', 'Technical Drawing'],
        'Arts & Humanities': ['Literature in English', 'Government', 'History', 'Christian Religious Studies', 'Islamic Religious Studies', 'Visual Art', 'Music'],
        'Commercial & Social Sciences': ['Economics', 'Financial Accounting', 'Commerce', 'Marketing', 'Insurance', 'Office Practice', 'Store Management'],
        'Languages': ['Yoruba', 'Igbo', 'Hausa', 'French', 'Arabic']
    };

    // WAEC / NECO subjects used by Past Questions and Theory
    const EXAM_SUBJECTS_WAEC_NECO = ['Economics', 'Commerce', 'Marketing', 'Financial Accounting', 'Computer Studies', 'Visual Art',
        'Literature in English', 'Government', 'History', 'Christian Religious Studies', 'Biology', 'Chemistry', 'Physics',
        'Agricultural Science', 'Further Mathematics', 'Geography', 'Foods and Nutrition', 'English Language',
        'General Mathematics', 'Civic Education'];

    const JAMB_SUBJECTS = {
        'Compulsory': ['Use of English'],
        'Sciences': ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'Agricultural Science', 'Computer Studies', 'Physical & Health Education'],
        'Arts': ['Literature in English', 'Government', 'History', 'Christian Religious Studies', 'Islamic Religious Studies', 'Art (Fine Art)', 'Music'],
        'Social Sciences & Commercial': ['Economics', 'Commerce', 'Principles of Accounts', 'Geography', 'Home Economics'],
        'Languages': ['French', 'Yoruba', 'Igbo', 'Hausa', 'Arabic']
    };

    const TEXTBOOK_SUBJECTS = { JSS: JSS_SUBJECTS, SSS: SSS_SUBJECTS_TEXTBOOK };

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

    // Numbered step dots: "① ② ③ ... > Results" — shared by Quiz Arena and Past Questions
    // results[i] is undefined (not reached), 'correct', or 'wrong'
    function stepperHtml(total, currentIndex, results) {
        let dots = '';
        for (let i = 0; i < total; i++) {
            let cls = 'upcoming';
            if (results[i] === 'correct') cls = 'correct';
            else if (results[i] === 'wrong') cls = 'wrong';
            else if (i === currentIndex) cls = 'current';
            dots += '<span class="step-dot ' + cls + '">' + (i + 1) + '</span>';
            if (i < total - 1) dots += '<span class="step-chevron">›</span>';
        }
        const resultsCls = currentIndex >= total ? 'current' : 'upcoming';
        dots += '<span class="step-chevron">›</span><span class="step-dot step-dot-results ' + resultsCls + '">Results</span>';
        return '<div class="step-dots">' + dots + '</div>';
    }

    // A clickable MCQ option row with a colored circular letter badge
    function mcqOptionHtml(label, text, onclickAttr) {
        return '<div class="quiz-option" data-label="' + label + '" onclick="' + onclickAttr + '">' +
            '<span class="option-badge">' + label + '</span><span class="option-text">' + escapeHtml(text) + '</span>' +
        '</div>';
    }

    // Speak / Stop buttons placed under an explanation box
    function explainVoiceActionsHtml() {
        return '<div class="gpt-msg-actions" style="margin-top: 10px;">' +
            '<button onclick="speakExplainBox(this)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg> Speak</button>' +
            '<button onclick="stopChatMessage()"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop</button>' +
        '</div>';
    }

    function speakText(elementId, btn) {
        if (!('speechSynthesis' in window)) { showError('Read aloud is not supported on this browser.'); return; }
        const el = $(elementId);
        const text = el ? el.innerText.trim() : '';
        if (!text) { showError('Nothing to read'); return; }
        if (speechSynthesis.speaking) {
            speechSynthesis.cancel();
            if (btn) btn.innerHTML = btn.dataset.idle || btn.innerHTML;
            return;
        }
        const u = new SpeechSynthesisUtterance(text.substring(0, 5000));
        u.rate = 0.9;
        if (btn) { btn.dataset.idle = btn.innerHTML; btn.innerHTML = '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop'; }
        u.onend = () => { if (btn && btn.dataset.idle) btn.innerHTML = btn.dataset.idle; };
        speechSynthesis.speak(u);
    }

    function speakExplainBox(btn) {
        const box = btn.closest('.theory-explain-box, .theory-explain-panel');
        if (!box || !('speechSynthesis' in window)) return;
        const clone = box.cloneNode(true);
        clone.querySelectorAll('.gpt-msg-actions').forEach(n => n.remove());
        const text = clone.textContent.trim();
        if (!text) return;
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(text.substring(0, 5000)));
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
    function renderMarkdownTable(rows) {
        const cells = r => r.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const isSep = r => /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(r);
        const data = rows.filter(r => !isSep(r));
        if (!data.length) return '';
        const head = cells(data[0]);
        const body = data.slice(1).map(cells);
        let t = '<table class="md-table"><thead><tr>' + head.map(c => '<th>' + inlineFormat(c) + '</th>').join('') + '</tr></thead>';
        t += '<tbody>' + body.map(r => '<tr>' + r.map(c => '<td>' + inlineFormat(c) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
        return '<div class="md-table-wrap">' + t + '</div>';
    }

    // Turns AI markdown-style text into safe, properly closed HTML (headings, lists, code blocks, tables)
    function formatRichText(text) {
        const lines = escapeHtml(text).replace(/\r/g, '').split('\n');
        let html = '';
        let listType = null;
        let inCode = false;
        let codeBuf = [];
        let tableBuf = [];
        const closeList = () => { if (listType) { html += '</' + listType + '>'; listType = null; } };
        const openList = type => { if (listType !== type) { closeList(); html += '<' + type + '>'; listType = type; } };
        const flushTable = () => { if (tableBuf.length) { html += renderMarkdownTable(tableBuf); tableBuf = []; } };

        lines.forEach(raw => {
            const line = raw.trim();

            if (/^```/.test(line)) {
                flushTable();
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

            // Consecutive lines that start and end with a pipe form a table
            if (line.length > 1 && line.charAt(0) === '|' && line.charAt(line.length - 1) === '|') {
                closeList();
                tableBuf.push(line);
                return;
            }
            flushTable();

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
        flushTable();
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
            showToast('Waking up the server... the first request can take up to a minute.', 'info', 9000);
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
    function setThemeIcons() {
        const icon = darkMode ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/></svg>';
        ['landingThemeIcon', 'appThemeIcon'].forEach(id => { const el = $(id); if (el) el.innerHTML = icon; });
    }

    function toggleTheme() {
        darkMode = !darkMode;
        storeSet('darkMode', darkMode);
        document.body.classList.toggle('dark-mode', darkMode);
        setThemeIcons();
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

    let justSignedUp = false;

    function startSession(user, isNew) {
        currentUser = normalizeUser(user);
        justSignedUp = !!isNew;
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
                startSession(res.user, false);
                const greeting = timeGreeting() + ', ' + currentUser.username;
                addNotification(timeGreeting(), greeting);
                showToast(greeting, 'success', 4000);
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
                startSession(res.user, true);
                addNotification('Welcome', 'Welcome to X-ZITH Learning Hub, ' + currentUser.username);
                showToast('Welcome to X-ZITH Learning Hub, ' + currentUser.username, 'success', 5000);
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
        $('pqPanel').classList.add('hidden');
        $('searchResult').classList.add('hidden');
        ['loginEmail', 'loginPass', 'signupName', 'signupEmail', 'signupPass', 'topicInput', 'searchQuery']
            .forEach(id => { $(id).value = ''; });
        updateNotificationBadge();
        updateNotificationsList();
        $('notificationDropdown').classList.remove('active');
        closeMobileMenu();

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
        setThemeIcons();
        $('navUser').textContent = currentUser.username;
        $('dashName').textContent = currentUser.username;
        $('dashGreeting').textContent = justSignedUp ? 'Welcome to X-ZITH Learning Hub' : timeGreeting();
        $('profileUsername').value = currentUser.username;
        restoreChat();
        updateDashboard();
        loadDailyChallenge();
    }

    function updateDashboard() {
        if (!currentUser) return;
        $('dashScore').textContent = currentUser.total_score || 0;
        $('dashQuizzes').textContent = currentUser.quizzes_taken || 0;
        $('dashStreak').textContent = displayStreak();
        $('dashStreakHint').textContent = streakHintText();
        if ($('menuScore')) {
            $('menuScore').textContent = currentUser.total_score || 0;
            $('menuStreak').textContent = displayStreak();
        }
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
            loadDailyChallenge();
        } else if (pageId === 'chat') {
            const box = $('chatBox');
            box.scrollTop = box.scrollHeight;
        }
    }

    function populateProfile() {
        if (!currentUser) return;
        $('profileUsername').value = currentUser.username || '';
        $('profileEmail').value = currentUser.email || '';
        $('profileScore').textContent = currentUser.total_score || 0;
        $('profileQuizzes').textContent = currentUser.quizzes_taken || 0;
        $('profileStreak').textContent = displayStreak();
        $('profileStreakHint').textContent = streakHintText();
        renderRecentActivity();
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
            box.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">No quizzes taken yet. Head to Textbook → Learn a topic → Take Quiz! </p>';
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
            box.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">No study notes generated yet. Visit Textbook to get started! </p>';
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
            ? 'Goal reached! ' + goal.count + ' / ' + goal.target + ' activities today'
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
    //  DAILY CHALLENGE (Dashboard — 5 questions, resets every day)
    // ============================================================

    // ============================================================
    //  TEXTBOOK
    // ============================================================
    // ===== TEXTBOOK SUBJECT SELECTION =====
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
        $('textbookLearn').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('topicInput').focus();
    }

    function textbookBackToSubjects() {
        $('textbookSubjectGrid').classList.remove('hidden');
        $('textbookLearn').classList.add('hidden');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // "Take Quiz" on a generated note sends the user to Quiz Arena, prefilled with this subject/topic
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
            $('textbookResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
            addNotification('Textbook Generated', 'Your study notes on "' + topic + '" are ready! ');
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

    const POINTS_PER_CORRECT = 5;

    // Turns a raw API response (array of objects OR freeform text) into structured questions
    function toStructuredQuestions(raw) {
        if (Array.isArray(raw) && raw.length && typeof raw[0] === 'object') {
            return raw.map(item => {
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
            }).filter(q => q.question && q.options.length >= 2);
        }
        if (typeof raw === 'string') return parseQuizText(raw);
        return [];
    }

    // quizState.ids = { area, summary } — Quiz Arena's panel (Textbook's "Take Quiz" now also routes here)
    // quizState.source = 'arena' | 'daily' — controls which result buttons are shown
    // Shared by Quiz Arena, Daily Challenge, and Textbook's "Take Quiz"
    // ===== CURATED QUESTION BANK (handpicked questions on specific topics) =====
    function stopQuizTimer() {
        if (quizTimerId) { clearInterval(quizTimerId); quizTimerId = null; }
    }

    function renderQuizQuestion() {
        stopQuizTimer();
        const q = quizState.questions[quizState.index];
        let timeLeft = QUIZ_TIME_PER_Q;

        const optionsHtml = q.options.map(o =>
            mcqOptionHtml(o.label, o.text, "selectQuizAnswer('" + o.label + "')")
        ).join('');

        $(quizState.ids.area).innerHTML =
            stepperHtml(quizState.questions.length, quizState.index, quizState.results) +
            '<div class="quiz-progress-row">' +
                '<span>Question ' + (quizState.index + 1) + ' / ' + quizState.questions.length + ' • ' + (quizState.score * POINTS_PER_CORRECT) + ' pts</span>' +
                '<span id="quizTimerLabel">' + timeLeft + 's</span>' +
            '</div>' +
            '<div class="quiz-timer-bar"><div class="quiz-timer-fill" id="quizTimerFill" style="width:100%"></div></div>' +
            '<div class="quiz-question-text">' +
                escapeHtml(q.question) +
                ' <button class="voice-btn" style="width:34px;height:34px;min-width:34px;font-size:14px;" onclick="speakQuizQuestion()" title="Read question aloud"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg></button>' +
            '</div>' +
            '<div id="quizOptions">' + optionsHtml + '</div>' +
            '<div id="quizExplainBox" class="theory-explain-box"></div>' +
            '<div class="theory-actions">' +
                '<button id="quizNextBtn" class="theory-btn theory-btn-primary hidden" onclick="nextQuizQuestion()">' + (quizState.index === quizState.questions.length - 1 ? 'Finish Quiz ' : 'Next Question ') + '</button>' +
            '</div>';

        quizTimerId = setInterval(() => {
            timeLeft--;
            const label = $('quizTimerLabel');
            const fill = $('quizTimerFill');
            if (label) label.textContent = '' + Math.max(timeLeft, 0) + 's';
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
        quizState.results[quizState.index] = correct ? 'correct' : 'wrong';

        document.querySelectorAll('.quiz-option').forEach(el => {
            el.onclick = null;
            if (el.dataset.label === q.correctLabel) el.classList.add('correct');
            else if (el.dataset.label === selectedLabel) el.classList.add('incorrect');
        });

        const explainBox = $('quizExplainBox');
        if (explainBox) {
            explainBox.classList.add('show');
            explainBox.innerHTML = '<strong style="color: ' + (correct ? 'var(--success)' : 'var(--danger)') + ';">' +
                (selectedLabel ? (correct ? 'Correct! +' + POINTS_PER_CORRECT + ' pts' : 'Not quite — correct answer: ' + q.correctLabel) : 'Time\'s up — correct answer: ' + q.correctLabel) +
                '</strong>' + (q.explanation ? '<p style="margin-top: 8px;">' + escapeHtml(q.explanation) + '</p>' : '') +
                (q.explanation ? explainVoiceActionsHtml() : '');
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

    // ============================================================
    //  AI CHAT (ChatGPT-style)
    // ============================================================
    function chatGreetingHtml() {
        return '<div class="gpt-msg gpt-msg-ai"><div class="gpt-avatar gpt-avatar-ai"></div>' +
            '<div class="gpt-bubble-col">' +
            '<div class="gpt-bubble"><div class="rich"><p>Hello! I\'m your AI tutor. Ask me anything about Mathematics, Science, English, or any subject. I\'m here to help!</p></div></div>' +
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
            const original = btn.innerHTML;
            btn.textContent = 'Copied';
            setTimeout(() => { btn.innerHTML = original; }, 1500);
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
                '<button onclick="clearChatImage()" title="Remove image"></button>';
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
            div.innerHTML = '<div class="gpt-avatar gpt-avatar-user"></div>' +
                '<div class="gpt-bubble-col"><div class="gpt-bubble">' + imgHtml + '</div></div>';
            if (text) div.querySelector('.gpt-bubble').appendChild(document.createTextNode(text));
        } else if (role === 'error') {
            div.className = 'gpt-msg gpt-msg-ai gpt-msg-error';
            div.innerHTML = '<div class="gpt-avatar gpt-avatar-ai"></div>' +
                '<div class="gpt-bubble-col"><div class="gpt-bubble"></div></div>';
            div.querySelector('.gpt-bubble').textContent = '' + text;
        } else if (role === 'typing') {
            div.className = 'gpt-msg gpt-msg-ai';
            div.innerHTML = '<div class="gpt-avatar gpt-avatar-ai"></div>' +
                '<div class="gpt-bubble-col"><div class="gpt-bubble"><div class="gpt-typing"><span></span><span></span><span></span></div></div></div>';
        } else {
            div.className = 'gpt-msg gpt-msg-ai';
            div.innerHTML = '<div class="gpt-avatar gpt-avatar-ai"></div>' +
                '<div class="gpt-bubble-col">' +
                '<div class="gpt-bubble"><div class="rich">' + formatRichText(text) + '</div></div>' +
                '<div class="gpt-msg-actions">' +
                    '<button onclick="copyChatMessage(this)" title="Copy"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg> Copy</button>' +
                    '<button onclick="speakChatMessage(this)" title="Read aloud"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg> Speak</button>' +
                    '<button onclick="stopChatMessage()" title="Stop reading"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop</button>' +
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
        saveChatMessage('user', msg, !!image);
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
                const replyText = typeof reply === 'string' ? reply : JSON.stringify(reply);
                addChatBubble('ai', replyText);
                saveChatMessage('ai', replyText, false);
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
    // ===== EXAM TAB SELECTION (WAEC / JAMB / NECO) =====
    let currentExam = 'WAEC';

    function pqPopulateSubjects() {
        const list = currentExam === 'JAMB' ? Object.values(JAMB_SUBJECTS).flat() : EXAM_SUBJECTS_WAEC_NECO;
        $('pqSubject').innerHTML = '<option value="">Select a subject</option>' +
            list.map(s => '<option value="' + escapeHtml(s) + '">' + escapeHtml(s) + '</option>').join('');
    }

    function pqSelectExam(exam, btnEl) {
        currentExam = exam;
        document.querySelectorAll('.pq-exam-tab').forEach(b => { if (b.closest('#pastquestions')) b.classList.remove('active'); });
        if (btnEl) btnEl.classList.add('active');
        pqPopulateSubjects();
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
        recognition.onstart = () => showNotification('<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/></svg> Listening...', 'Speak your question');
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
        recognition.onstart = () => showNotification('<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0014 0"/><path d="M12 18v3"/></svg> Listening...', 'Speak your search term');
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

    // ===== PAST QUESTIONS — 30 questions across 3 levels (1-10, 11-20, 21-30), sequential, untimed =====
    const PQ_QTYPE = 'Objective';
    const PQ_PER_LEVEL = 10;
    const PQ_LEVELS = 3; // 30 questions total
    let pqState = null;

    async function pqFetchLevel(level, btn) {
        const run = async () => {
            $('pqQuestionArea').innerHTML = 'Generating Level ' + level + ' questions (' + ((level - 1) * PQ_PER_LEVEL + 1) + '-' + (level * PQ_PER_LEVEL) + ')...';
            $('pqLevelResults').classList.add('hidden');

            const res = await apiCall('/api/generate-past-questions', { exam: pqState.exam, subject: pqState.subject, qtype: PQ_QTYPE, count: PQ_PER_LEVEL, level });
            const questions = toStructuredQuestions(res.raw || res.response || res.questions || res.content);

            if (res.error || !questions.length) {
                $('pqQuestionArea').innerHTML = '<span style="color: var(--danger);">' + escapeHtml(res.error || 'Could not generate questions. Please try again.') + '</span>';
                return;
            }

            pqState.level = level;
            pqState.questions = questions.slice(0, PQ_PER_LEVEL);
            pqState.index = 0;
            pqState.levelCorrect = 0;
            pqState.levelWrong = 0;
            pqState.results = [];
            pqRenderQuestion();
        };

        if (btn) await withLoading(btn, 'Loading...', run);
        else await run();
    }

    async function generatePastQuestions(btn) {
        const subject = $('pqSubject').value.trim();
        if (!subject) { showError('Please select a subject'); return; }

        pqState = { exam: currentExam, subject, level: 1, totalCorrect: 0, totalWrong: 0 };
        $('questionsMeta').textContent = currentExam + ' • ' + subject + ' • Objective • 30 Questions (3 Levels)';
        $('pqPanel').classList.remove('hidden');
        $('pqPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
        await pqFetchLevel(1, btn);
    }

    function pqRenderQuestion() {
        const q = pqState.questions[pqState.index];
        const globalNum = (pqState.level - 1) * PQ_PER_LEVEL + pqState.index + 1;

        const optionsHtml = q.options.map(o =>
            mcqOptionHtml(o.label, o.text, "pqSelectAnswer('" + o.label + "')")
        ).join('');

        $('pqQuestionArea').innerHTML =
            '<div class="pq-stats-bar">' +
                '<span class="pq-stat"><span class="pq-dot pq-dot-correct"></span>' + pqState.levelCorrect + ' correct</span>' +
                '<span class="pq-stat"><span class="pq-dot pq-dot-wrong"></span>' + pqState.levelWrong + ' wrong</span>' +
                '<span class="pq-stat pq-stat-count">Q ' + (pqState.index + 1) + ' of ' + PQ_PER_LEVEL + '</span>' +
            '</div>' +
            stepperHtml(pqState.questions.length, pqState.index, pqState.results) +
            '<div class="pq-meta-row">' +
                '<span class="detail-badge detail-badge-blue">' + pqState.exam + '</span>' +
                '<span style="color: var(--text-light); font-size: 13px;">Level ' + pqState.level + ' • Q' + globalNum + ' overall</span>' +
            '</div>' +
            '<div class="quiz-question-text">' +
                escapeHtml(q.question) +
                ' <button class="voice-btn" style="width:34px;height:34px;min-width:34px;font-size:14px;" onclick="speakPqQuestion()" title="Read question aloud"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg></button>' +
            '</div>' +
            '<div id="pqOptions">' + optionsHtml + '</div>' +
            '<div id="pqExplainBox" class="theory-explain-box"></div>' +
            '<div class="theory-actions">' +
                '<button id="pqNextBtn" class="theory-btn theory-btn-primary hidden" onclick="pqNextQuestion()">' + (pqState.index === pqState.questions.length - 1 ? 'See Results ' : 'Next Question ') + '</button>' +
            '</div>';
    }

    function speakPqQuestion() {
        if (!('speechSynthesis' in window) || !pqState) return;
        const q = pqState.questions[pqState.index];
        const text = q.question + '. ' + q.options.map(o => o.label + '. ' + o.text).join('. ');
        speechSynthesis.cancel();
        speechSynthesis.speak(new SpeechSynthesisUtterance(text));
    }

    function pqSelectAnswer(selectedLabel) {
        const q = pqState.questions[pqState.index];
        const correct = selectedLabel === q.correctLabel;

        if (correct) { pqState.levelCorrect++; pqState.totalCorrect++; }
        else { pqState.levelWrong++; pqState.totalWrong++; }
        pqState.results[pqState.index] = correct ? 'correct' : 'wrong';

        document.querySelectorAll('#pqOptions .quiz-option').forEach(el => {
            el.onclick = null;
            if (el.dataset.label === q.correctLabel) el.classList.add('correct');
            else if (el.dataset.label === selectedLabel) el.classList.add('incorrect');
        });

        const explainBox = $('pqExplainBox');
        explainBox.classList.add('show');
        explainBox.innerHTML = '<strong style="color: ' + (correct ? 'var(--success)' : 'var(--danger)') + ';">' +
            (correct ? 'Correct! +' + POINTS_PER_CORRECT + ' pts' : 'Not quite — correct answer: ' + q.correctLabel) + '</strong>' +
            (q.explanation ? '<p style="margin-top: 8px;">' + escapeHtml(q.explanation) + '</p>' : '') +
            (q.explanation ? explainVoiceActionsHtml() : '');

        $('pqNextBtn').classList.remove('hidden');
    }

    function pqNextQuestion() {
        pqState.index++;
        if (pqState.index >= pqState.questions.length) {
            pqShowLevelResults();
        } else {
            pqRenderQuestion();
        }
    }

    function pqShowLevelResults() {
        const isFinal = pqState.level >= PQ_LEVELS;
        const levelPoints = pqState.levelCorrect * POINTS_PER_CORRECT;
        const totalPoints = pqState.totalCorrect * POINTS_PER_CORRECT;

        $('pqQuestionArea').innerHTML = '';
        $('pqLevelResults').classList.remove('hidden');

        let actionsHtml = '<button class="theory-btn theory-btn-secondary" onclick="switchPage(' + "'leaderboard'" + ')">Leaderboard</button>';
        if (isFinal) {
            actionsHtml += ' <button class="theory-btn theory-btn-secondary" onclick="generatePastQuestions(this)">Retake</button>' +
                ' <button class="theory-btn theory-btn-secondary" onclick="switchPage(' + "'dashboard'" + ')">Dashboard</button>';
        } else {
            actionsHtml += ' <button class="theory-btn theory-btn-primary" onclick="pqFetchLevel(' + (pqState.level + 1) + ', this)">' + (pqState.level + 1 === PQ_LEVELS ? 'Final Level' : 'Level ' + (pqState.level + 1)) + '</button>';
        }

        $('pqLevelResults').innerHTML =
            '<div style="text-align:center; padding: 20px 0;">' +
                '<div style="font-size: 48px; margin-bottom: 10px;">' + (isFinal ? '' : (pqState.levelCorrect >= PQ_PER_LEVEL * 0.6 ? '' : '')) + '</div>' +
                '<h3 style="margin-bottom: 8px;">' + (isFinal ? 'All 30 Questions Complete!' : 'Level ' + pqState.level + ' Complete!') + '</h3>' +
                '<p style="margin-bottom: 4px;">This level: ' + pqState.levelCorrect + ' Correct ' + pqState.levelWrong + ' Wrong — ' + levelPoints + ' pts</p>' +
                (isFinal ? '<p style="color: var(--text-light); margin-bottom: 20px;">Total: ' + pqState.totalCorrect + ' / 30 Correct • ' + totalPoints + ' pts</p>' : '<p style="color: var(--text-light); margin-bottom: 20px;">' + pqState.exam + ' • ' + escapeHtml(pqState.subject) + '</p>') +
                actionsHtml +
            '</div>';

        if (currentUser) {
            currentUser.quizzes_taken = (currentUser.quizzes_taken || 0) + 1;
            currentUser.total_score = (currentUser.total_score || 0) + levelPoints;
            saveSession();
            updateDashboard();
        }
        recordQuizResult({
            subject: pqState.subject,
            topic: pqState.exam + ' Past Questions — Level ' + pqState.level,
            score: pqState.levelCorrect, total: PQ_PER_LEVEL, points: levelPoints
        });
        incrementDailyGoal();
        addNotification(isFinal ? 'Past Questions Complete' : 'Level ' + pqState.level + ' Done', pqState.subject + ': ' + pqState.levelCorrect + ' / ' + PQ_PER_LEVEL + ' (' + levelPoints + ' pts)');
    }


    // ============================================================
    //  THEORY PRACTICE (WAEC / NECO)
    // ============================================================
    let theoryExam = '';
    let theorySubject = '';
    let theoryBusy = false;

    // Accepts a string, an array, or a question object and returns an array of question strings
    // ============================================================
    //  THEORY — TOP-LEVEL TAB SWITCH (Topic Lessons vs WAEC/NECO Theory)
    // ============================================================
    // ============================================================
    //  WAEC / NECO THEORY — curated bank of real past questions
    // ============================================================

    // ============================================================
    //  WEB SEARCH WITH CACHING
    // ============================================================
    let searchCache = {};
    function searchLinksHtml(query) {
        const q = encodeURIComponent(query);
        const linkStyle = 'display: inline-block; margin: 4px 8px 4px 0; padding: 10px 16px; background: var(--primary); color: white; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;';
        return '<div style="margin-top: 20px;"><p style="color: var(--text-light); font-size: 14px; margin-bottom: 8px;">Search "' + escapeHtml(query) + '" directly on:</p>' +
            '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://www.youtube.com/results?search_query=' + q + '">YouTube</a>' +
            '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://www.google.com/search?q=' + q + '">Google</a>' +
            '<a style="' + linkStyle + '" target="_blank" rel="noopener noreferrer" href="https://en.wikipedia.org/w/index.php?search=' + q + '">Wikipedia</a></div>';
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
                html = box + '' + escapeHtml(res.error) + '</div>';
            } else if (items && items.length) {
                items.forEach(result => {
                    const link = safeUrl(result.link || result.url || '');
                    const snippet = result.snippet || result.description || result.body || 'No description available';
                    html += '<div style="margin-bottom: 20px; padding: 15px; background: var(--bg); border-radius: 8px; border-left: 4px solid var(--primary); overflow-wrap: anywhere;">' +
                        '<h3 style="margin-bottom: 8px; font-size: 18px;"><a href="' + escapeHtml(link) + '" target="_blank" rel="noopener noreferrer" style="color: var(--primary); text-decoration: none;">' + escapeHtml(result.title || 'Untitled') + '</a></h3>' +
                        '<p style="color: var(--text-light); font-size: 14px; margin-bottom: 8px;">' + escapeHtml(snippet) + '</p>' +
                        (link !== '#' ? '<small style="color: var(--primary);">' + escapeHtml(link) + '</small>' : '') +
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
            if (!res.error) addNotification('Search Complete', 'Found results for "' + query + '"');
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
        leaderboardMessage('Loading leaderboard...', 'var(--text-light)');

        // The endpoint may be GET or POST on the server, so try GET first and fall back
        let res = await apiCall('/api/leaderboard', null, 'GET');
        if (res.error && [404, 405, 422].includes(res.status)) {
            res = await apiCall('/api/leaderboard', {}, 'POST');
        }

        if (res.error) {
            leaderboardMessage('Could not load the leaderboard: ' + escapeHtml(res.error), 'var(--danger)');
            return;
        }

        const list = Array.isArray(res) ? res : (res.leaderboard || res.users || res.data || []);
        if (!Array.isArray(list) || list.length === 0) {
            leaderboardMessage('No users on leaderboard yet. Start learning to appear here!', 'var(--text-light)');
            return;
        }

        const medals = [];
        tbody.innerHTML = '';
        list.slice(0, 10).forEach((user, i) => {
            const isMe = currentUser && ((user.email && user.email === currentUser.email) || user.username === currentUser.username);
            const tr = document.createElement('tr');
            if (isMe) tr.style.background = 'rgba(102, 126, 234, 0.12)';
            tr.innerHTML =
                '<td style="padding: 15px; border-bottom: 1px solid var(--border); text-align: center;"><span style="font-size: 20px; font-weight: 700;">' + (medals[i] || (i + 1)) + '</span></td>' +
                '<td style="padding: 15px; border-bottom: 1px solid var(--border); font-weight: 600;">' + escapeHtml(user.username || 'Anonymous') + (isMe ? ' <small style="color: var(--primary);">(you)</small>' : '') + '</td>' +
                '<td style="padding: 15px; border-bottom: 1px solid var(--border); color: var(--primary); font-weight: 600;">' + escapeHtml(user.total_score || 0) + ' <small>pts</small></td>' +
                '<td style="padding: 15px; border-bottom: 1px solid var(--border); color: var(--success); font-weight: 600;">' + escapeHtml((user.total_score || 0) >= STREAK_UNLOCK_SCORE ? (user.streak || 0) : 0) + '</td>';
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
        addNotification('Profile Saved', 'Username updated to "' + newUsername + '"!');
    }

    // ============================================================
    //  MENUS
    // ============================================================
    function toggleMobileMenu() {
        const open = $('mobileMenu').classList.toggle('active');
        $('mobileMenuOverlay').classList.toggle('active', open);
        document.body.classList.toggle('menu-open', open);
    }

    function closeMobileMenu() {
        $('mobileMenu').classList.remove('active');
        $('mobileMenuOverlay').classList.remove('active');
        document.body.classList.remove('menu-open');
    }

    document.addEventListener('click', function (event) {
        if (!event.target.closest('.notification-btn') && !event.target.closest('#notificationDropdown')) {
            $('notificationDropdown').classList.remove('active');
        }
    });

    // Logging out in one tab logs out the others too
    window.addEventListener('storage', function (e) {
        if (e.key === SESSION_KEY && !e.newValue && currentUser) logout();
    });

    function renderRecentActivity() {
        const box = $('profileRecentActivity');
        if (!box) return;
        const history = loadHistory();
        const merged = [
            ...history.quizzes.map(q => ({ type: 'quiz', ...q })),
            ...history.study.map(x => ({ type: 'study', ...x }))
        ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 8);

        if (!merged.length) {
            box.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">No activity yet. Take a quiz or generate study notes to get started.</p>';
            return;
        }
        box.innerHTML = merged.map(item => {
            const detail = item.type === 'quiz'
                ? (item.score ?? 0) + ' / ' + (item.total ?? 5) + (item.points ? ' · ' + item.points + ' pts' : '')
                : (item.level || '');
            return '<div class="activity-row">' +
                '<div><span class="activity-tag ' + item.type + '">' + (item.type === 'quiz' ? 'Quiz' : 'Study') + '</span> ' +
                '<strong>' + escapeHtml(item.subject || '') + '</strong><span style="color: var(--text-light); font-size: 13px;"> · ' + escapeHtml(item.topic || '') + '</span></div>' +
                '<div style="color: var(--text-light); font-size: 12px; white-space: nowrap;">' + escapeHtml(String(detail)) + '</div>' +
            '</div>';
        }).join('');
    }

    // ============================================================
    //  GREETING + STREAK RULE
    // ============================================================
    const STREAK_UNLOCK_SCORE = 5000; // a learning streak is only earned once the user reaches 5,000 points

    function timeGreeting() {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 17) return 'Good afternoon';
        return 'Good evening';
    }

    function displayStreak() {
        return currentUser && (currentUser.total_score || 0) >= STREAK_UNLOCK_SCORE ? (currentUser.streak || 0) : 0;
    }

    function streakHintText() {
        const score = (currentUser && currentUser.total_score) || 0;
        if (score >= STREAK_UNLOCK_SCORE) return '';
        return 'Unlocks at 5,000 points (' + (STREAK_UNLOCK_SCORE - score).toLocaleString() + ' to go)';
    }

    // ============================================================
    //  AI CHAT: history survives reloads and redeploys (stored per user in localStorage)
    // ============================================================
    function chatStorageKey() {
        return 'xzith_chat_' + String((currentUser && (currentUser.email || currentUser.username)) || 'guest').toLowerCase();
    }

    function loadChatHistory() {
        try {
            const raw = storeGet(chatStorageKey());
            const list = raw ? JSON.parse(raw) : [];
            return Array.isArray(list) ? list : [];
        } catch (e) { return []; }
    }

    function saveChatMessage(role, text, hasImage) {
        const list = loadChatHistory();
        list.push({ role, text, hasImage: !!hasImage, t: Date.now() });
        storeSet(chatStorageKey(), JSON.stringify(list.slice(-100)));
    }

    function restoreChat() {
        resetChat();
        loadChatHistory().forEach(m => addChatBubble(m.role === 'user' ? 'user' : 'ai', (m.hasImage ? '[Image attached] ' : '') + m.text));
        const box = $('chatBox');
        box.scrollTop = box.scrollHeight;
    }

    // ============================================================
    //  DAILY CHALLENGE (one question a day, read from the database; one attempt per day)
    // ============================================================
    let dailyChallengeData = null;
    let dailyChallengeLoading = false;

    function dcToday() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function dcDate(c) { return /^\d{4}-\d{2}-\d{2}$/.test(String(c.date || '')) ? c.date : dcToday(); }
    function dcOptionText(opt) { return String(opt).replace(/^\s*[A-D][.):]\s*/i, ''); }
    function dcAnswerLetter(c) { return String(c.answer || '').trim().charAt(0).toUpperCase(); }

    async function loadDailyChallenge() {
        const box = $('dailyChallengeBox');
        if (!box || dailyChallengeLoading) return;
        if (dailyChallengeData && dailyChallengeData._loadedOn === dcToday()) { renderDailyChallenge(); return; }

        dailyChallengeLoading = true;
        box.innerHTML = '<div class="dc-loading">Loading today\'s challenge...</div>';
        const res = await apiCall('/api/daily-challenge', null, 'GET');
        dailyChallengeLoading = false;

        const c = res && res.challenge;
        if (res.error || !c || !c.question) {
            box.innerHTML = '<div class="dc-loading">Today\'s challenge is not available right now.</div>';
            return;
        }
        dailyChallengeData = Object.assign({}, c, { _loadedOn: dcToday() });
        renderDailyChallenge();
    }

    function renderDailyChallenge() {
        const c = dailyChallengeData;
        const box = $('dailyChallengeBox');
        if (!c || !box) return;

        let saved = null;
        try { saved = JSON.parse(storeGet('dcAnswered_' + dcDate(c)) || 'null'); } catch (e) { saved = null; }
        const answer = dcAnswerLetter(c);
        const letters = ['A', 'B', 'C', 'D'];

        const options = (c.options || []).slice(0, 4).map((o, i) => {
            let cls = 'dc-option';
            if (saved) {
                if (letters[i] === answer) cls += ' correct';
                else if (letters[i] === saved.pick) cls += ' wrong';
            }
            return '<div class="' + cls + '"' + (saved ? '' : ' onclick="answerDailyChallenge(\'' + letters[i] + '\')"') + '>' +
                '<span class="dc-letter">' + letters[i] + '</span><span>' + escapeHtml(dcOptionText(o)) + '</span></div>';
        }).join('');

        let result = '';
        if (saved) {
            result = '<div class="dc-result ' + (saved.correct ? 'ok' : 'bad') + '">' +
                (saved.correct ? 'Correct' : 'Incorrect. The correct answer is ' + answer) + '</div>' +
                (c.explanation ? '<div class="dc-explain">' + escapeHtml(c.explanation) + '</div>' : '') +
                '<div class="dc-note">You have used today\'s attempt. A new question is available tomorrow.</div>';
        }

        box.innerHTML =
            '<div class="dc-header"><span class="dc-label">DAILY CHALLENGE</span><span class="dc-date">' + escapeHtml(String(c.date || dcToday())) + '</span></div>' +
            (c.subject ? '<div class="dc-subject">' + escapeHtml(c.subject) + '</div>' : '') +
            '<div class="dc-question">' + escapeHtml(c.question) + '</div>' + options + result;
    }

    function answerDailyChallenge(letter) {
        const c = dailyChallengeData;
        if (!c) return;
        const key = 'dcAnswered_' + dcDate(c);
        if (storeGet(key)) return; // one attempt per day

        const correct = letter === dcAnswerLetter(c);
        storeSet(key, JSON.stringify({ pick: letter, correct }));
        if (correct && currentUser) {
            currentUser.total_score = (currentUser.total_score || 0) + POINTS_PER_CORRECT;
            saveSession();
        }
        recordQuizResult({ subject: c.subject || 'Daily Challenge', topic: 'Daily Challenge', score: correct ? 1 : 0, total: 1, points: correct ? POINTS_PER_CORRECT : 0 });
        incrementDailyGoal();
        renderDailyChallenge();
        updateDashboard();
    }

    // ============================================================
    //  TEXTBOOK: JSS / SSS toggle, each subject has Learn and Quiz
    // ============================================================
    let textbookLevel = 'JSS';

    function initTextbookSubjects() { textbookSelectLevel('JSS'); }

    function textbookSelectLevel(level) {
        textbookLevel = level;
        $('tbTabJSS').classList.toggle('active', level === 'JSS');
        $('tbTabSSS').classList.toggle('active', level === 'SSS');
        const subjects = Object.values(TEXTBOOK_SUBJECTS[level]).flat();
        $('textbookSubjectList').innerHTML = subjects.map(subject => {
            const arg = JSON.stringify(subject).replace(/"/g, '&quot;');
            return '<div class="subject-row">' +
                '<span class="subject-row-name">' + escapeHtml(subject) + '</span>' +
                '<span class="subject-row-actions">' +
                    '<button class="theory-btn theory-btn-primary subject-act" onclick="textbookOpenLearn(' + arg + ', \'' + level + '\')">Learn</button>' +
                    '<button class="theory-btn theory-btn-secondary subject-act" onclick="textbookQuiz()">Quiz</button>' +
                '</span></div>';
        }).join('');
    }

    function textbookQuiz() { switchPage('quizarena'); }
    function textbookTakeQuiz() { switchPage('quizarena'); }

    // ============================================================
    //  QUIZ ARENA: one weekly quiz (POST /api/quiz-arena), same 5 questions for everyone until Monday
    // ============================================================
    let arenaWeekData = null;

    async function startArenaQuiz(btn) {
        const err = $('arenaError');
        err.classList.add('hidden');

        await withLoading(btn, 'Loading quiz...', async () => {
            const res = await apiCall('/api/quiz-arena', {});
            const payload = res && res.questions;
            const text = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload.questions : payload;
            const parsed = text ? toStructuredQuestions(text) : [];

            if (res.error || !parsed.length) {
                err.textContent = res.error || 'This week\'s quiz is not available yet. Please try again shortly.';
                err.classList.remove('hidden');
                return;
            }
            const meta = (payload && typeof payload === 'object' && !Array.isArray(payload)) ? payload : {};
            arenaWeekData = { week: meta.week || '', subject: meta.subject || '', topic: meta.topic || '', questions: parsed.slice(0, 5) };
            beginArenaAttempt();
        });
    }

    function beginArenaAttempt() {
        const d = arenaWeekData;
        if (!d) return;
        $('arenaForm').classList.add('hidden');
        $('arenaQuizPanel').classList.remove('hidden');
        $('arenaQuizSummary').classList.add('hidden');
        $('arenaQuizHeader').innerHTML =
            '<div class="arena-title">Quiz Arena — This Week</div>' +
            '<div class="arena-sub">' + escapeHtml(d.subject) + (d.topic ? ' · ' + escapeHtml(d.topic) : '') + '</div>';

        quizState = {
            questions: d.questions, index: 0, score: 0, results: [],
            subject: d.subject, topic: d.topic, week: d.week,
            source: 'arena', ids: { area: 'arenaQuizArea', summary: 'arenaQuizSummary' }
        };
        renderQuizQuestion();
        $('arenaQuizPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function finishQuiz() {
        const total = quizState.questions.length;
        const score = quizState.score;
        const earned = score * POINTS_PER_CORRECT;
        const ids = quizState.ids;

        // Everyone gets the same quiz all week, so points are awarded on the first attempt only
        const scoredKey = 'arenaScored_' + (quizState.week || (quizState.subject + '_' + quizState.topic));
        const firstAttempt = !storeGet(scoredKey);
        const points = firstAttempt ? earned : 0;

        $(ids.area).innerHTML = '';
        $(ids.summary).classList.remove('hidden');
        $(ids.summary).innerHTML =
            '<div class="arena-result">' +
                '<div class="arena-result-score">' + score + ' / ' + total + '</div>' +
                '<h3>' + (score >= total * 0.6 ? 'Well done' : 'Keep practising') + '</h3>' +
                '<p class="arena-result-sub">' + escapeHtml(quizState.subject) + (quizState.topic ? ' · ' + escapeHtml(quizState.topic) : '') + '</p>' +
                '<p class="arena-result-points">' + (firstAttempt ? points + ' points added to your score' : 'Practice attempt. Points are awarded once per week.') + '</p>' +
                '<div class="theory-actions" style="justify-content:center;">' +
                    '<button class="theory-btn theory-btn-primary" onclick="beginArenaAttempt()">Retake</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="switchPage(\'leaderboard\')">Leaderboard</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="switchPage(\'dashboard\')">Dashboard</button>' +
                '</div>' +
            '</div>';

        if (firstAttempt) {
            storeSet(scoredKey, '1');
            if (currentUser) {
                currentUser.quizzes_taken = (currentUser.quizzes_taken || 0) + 1;
                currentUser.total_score = (currentUser.total_score || 0) + points;
                saveSession();
                updateDashboard();
            }
            recordQuizResult({ subject: quizState.subject, topic: 'Quiz Arena' + (quizState.topic ? ': ' + quizState.topic : ''), score, total, points });
            incrementDailyGoal();
            addNotification('Quiz complete', quizState.subject + ': ' + score + ' / ' + total + ' (' + points + ' pts)');
        }
    }

    // ============================================================
    //  THEORY: WAEC / NECO > subject > question > answer.
    //  Questions come from the database; only the explanation is an AI call.
    // ============================================================
    const THEORY_YEARS = ['2026', '2025', '2024', '2023', '2022', '2021'];
    let theoryAll = [];
    let theoryYear = 'all';

    function theoryUpdateCrumbs() {
        let html = '<span onclick="theoryGoToBoards()">Exam Board</span>';
        if (theoryExam) html += ' <span class="chev">›</span> <span onclick="theoryGoToSubjects()">' + escapeHtml(theoryExam) + '</span>';
        if (theorySubject) html += ' <span class="chev">›</span> <span class="current">' + escapeHtml(theorySubject) + '</span>';
        $('theoryCrumbs').innerHTML = html;
    }

    function theoryGoToBoards() {
        theoryExam = ''; theorySubject = ''; theoryAll = [];
        $('theoryBoards').classList.remove('hidden');
        $('theorySubjects').classList.add('hidden');
        $('theoryQuestionResult').classList.add('hidden');
        theoryUpdateCrumbs();
    }

    function theoryGoToSubjects() {
        if (!theoryExam) { theoryGoToBoards(); return; }
        theorySubject = ''; theoryAll = [];
        $('theoryBoards').classList.add('hidden');
        $('theorySubjects').classList.remove('hidden');
        $('theoryQuestionResult').classList.add('hidden');
        theoryUpdateCrumbs();
    }

    function theorySelectBoard(exam) {
        theoryExam = exam;
        $('theorySubjectsTitle').textContent = exam + ': select a subject';
        $('theorySubjectsGrid').innerHTML = EXAM_SUBJECTS_WAEC_NECO.map(subject => {
            const av = subjectAvatar(subject);
            return '<div class="theory-subject-card" onclick="theorySelectSubject(' + JSON.stringify(subject).replace(/"/g, '&quot;') + ')">' +
                '<div class="theory-subject-avatar" style="background:' + av.color + '">' + av.abbr + '</div>' +
                '<div class="theory-subject-info"><div class="theory-subject-name">' + escapeHtml(subject) + '</div>' +
                '<span class="theory-subject-badge">' + exam + '</span></div>' +
                '<div class="theory-subject-chevron">›</div></div>';
        }).join('');
        theoryGoToSubjects();
    }

    function theorySelectSubject(subject) {
        theorySubject = subject;
        theoryUpdateCrumbs();
        theoryLoadQuestions();
    }

    async function theoryLoadQuestions() {
        if (theoryBusy) return;
        theoryBusy = true;
        $('theorySubjects').classList.add('hidden');
        $('theoryQuestionResult').classList.remove('hidden');
        $('theoryQuestionTitle').textContent = theorySubject + ' Theory Questions';
        $('theoryMeta').textContent = theoryExam + ' · loading questions...';
        $('theoryYearChips').innerHTML = '';
        $('theoryQuestionBox').innerHTML = '<div class="card dc-loading">Loading questions...</div>';

        const res = await apiCall('/api/generate-theory-question', { exam: theoryExam, subject: theorySubject });
        theoryBusy = false;

        let list = res && (res.questions || res.question || []);
        if (typeof list === 'string') list = [{ year: '', question: list }];
        list = Array.isArray(list)
            ? list.map(q => typeof q === 'string' ? { year: '', question: q } : { year: String(q.year || ''), question: q.question || q.text || '' }).filter(q => q.question)
            : [];

        if (res.error || !list.length) {
            $('theoryMeta').textContent = theoryExam + ' · ' + theorySubject;
            $('theoryQuestionBox').innerHTML = '<div class="card dc-loading">' + escapeHtml(res.error || 'No questions are available for this subject yet.') + '</div>';
            return;
        }
        theoryAll = list;
        theoryYear = 'all';
        theoryRenderYears();
        theoryRenderQuestions();
    }

    function theoryRenderYears() {
        const chips = [['all', 'All Years']].concat(THEORY_YEARS.map(y => [y, y]));
        $('theoryYearChips').innerHTML = chips.map(c =>
            '<button class="year-chip' + (theoryYear === c[0] ? ' active' : '') + '" onclick="theorySetYear(\'' + c[0] + '\')">' + c[1] + '</button>'
        ).join('');
    }

    function theorySetYear(year) {
        theoryYear = year;
        theoryRenderYears();
        theoryRenderQuestions();
    }

    function theoryRenderQuestions() {
        const items = theoryAll.map((q, i) => ({ q, i })).filter(o => theoryYear === 'all' || o.q.year === theoryYear);
        items.sort((a, b) => (parseInt(b.q.year, 10) || 0) - (parseInt(a.q.year, 10) || 0));
        $('theoryMeta').textContent = theoryExam + ' · ' + theorySubject + ' · ' + items.length + (items.length === 1 ? ' question' : ' questions');

        if (!items.length) {
            $('theoryQuestionBox').innerHTML = '<div class="card dc-loading">No ' + theoryExam + ' questions found for ' + (theoryYear === 'all' ? 'this subject' : theoryYear) + '.</div>';
            return;
        }
        $('theoryQuestionBox').innerHTML = items.map(o => {
            const q = o.q;
            const open = !!q.explanation && q.open;
            return '<div class="card theory-q-card">' +
                '<div class="theory-q-head"><span class="detail-badge detail-badge-blue">' + escapeHtml((q.year ? q.year + ' ' : '') + theoryExam) + '</span></div>' +
                '<div class="theory-q-text">' + escapeHtml(q.question) + '</div>' +
                '<div class="theory-actions">' +
                    '<button class="theory-btn theory-btn-primary" id="theoryBtn' + o.i + '" onclick="theoryToggleExplanation(' + o.i + ')">' + (q.explanation ? (open ? 'Hide Explanation' : 'Show Explanation') : 'Get Explanation') + '</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="theoryAskFollowUp(' + o.i + ')">Ask a Follow-up</button>' +
                '</div>' +
                '<div class="theory-explain-panel' + (open ? ' open' : '') + '" id="theoryPanel' + o.i + '">' +
                    (q.explanation ? '<div class="rich">' + formatRichText(q.explanation) + '</div>' + explainVoiceActionsHtml() : '') +
                '</div>' +
            '</div>';
        }).join('');
    }

    async function theoryToggleExplanation(i) {
        const q = theoryAll[i];
        const panel = $('theoryPanel' + i);
        const btn = $('theoryBtn' + i);
        if (!q || !panel || !btn) return;

        if (q.explanation) {
            q.open = !panel.classList.contains('open');
            panel.classList.toggle('open', q.open);
            btn.textContent = q.open ? 'Hide Explanation' : 'Show Explanation';
            return;
        }

        btn.disabled = true;
        panel.classList.add('open');
        panel.innerHTML = '<div class="dc-loading">Generating explanation...</div>';

        const res = await apiCall('/api/explain-theory-question', { exam: theoryExam, subject: theorySubject, question: q.question });
        btn.disabled = false;
        const text = res && (res.explanation || res.response || res.answer);

        if (res.error || !text || !String(text).trim()) {
            panel.innerHTML = '<div class="dc-loading" style="color: var(--danger);">' + escapeHtml(res.error || 'Could not generate an explanation. Please try again.') + '</div>';
            return;
        }
        q.explanation = String(text);
        q.open = true;
        panel.innerHTML = '<div class="rich">' + formatRichText(q.explanation) + '</div>' + explainVoiceActionsHtml();
        btn.textContent = 'Hide Explanation';

        recordStudyEntry({ subject: theorySubject, topic: 'Theory' + (q.year ? ' ' + q.year : ''), level: theoryExam });
        incrementDailyGoal();
        updateDashboard();
    }

    function theoryAskFollowUp(i) {
        const q = theoryAll[i];
        if (!q) return;
        switchPage('chat');
        const input = $('chatInput');
        input.value = 'I have a follow-up question about this ' + theoryExam + ' ' + theorySubject + ' theory question' + (q.year ? ' (' + q.year + ')' : '') + ': "' + q.question + '" ';
        autoGrowChatInput(input);
        input.focus();
    }

    // ============================================================
    //  SMART SEARCH
    // ============================================================
    function quickSearch(text) {
        $('searchQuery').value = text;
        performWebSearch($('searchBtn'));
    }

    function findYoutubeVideos() {
        const q = $('ytQuery').value.trim();
        if (!q) { showError('Enter what you want to watch'); return; }
        window.open('https://www.youtube.com/results?search_query=' + encodeURIComponent(q), '_blank', 'noopener');
    }

    // ============================================================
    //  START UP
    // ============================================================
    (function init() {
        if (darkMode) document.body.classList.add('dark-mode');
        setThemeIcons();

        initTextbookSubjects();
        pqPopulateSubjects();

        onEnter('loginEmail', () => handleLogin($('loginBtn')));
        onEnter('loginPass', () => handleLogin($('loginBtn')));
        onEnter('signupName', () => handleSignup($('signupBtn')));
        onEnter('signupEmail', () => handleSignup($('signupBtn')));
        onEnter('signupPass', () => handleSignup($('signupBtn')));
        onEnter('topicInput', () => generateTextbook($('genTextbookBtn')));
        onEnter('pqSubject', () => generatePastQuestions($('pqBtn')));
        onEnter('searchQuery', () => performWebSearch($('searchBtn')));
        onEnter('ytQuery', findYoutubeVideos);

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
