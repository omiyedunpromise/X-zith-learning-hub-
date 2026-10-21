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

    // ===== READ ALOUD =====
    // Answers are read aloud automatically, in short pieces so long answers keep going.
    // Stop (the bar at the bottom of the screen, or a Stop button) ends it.
    let speechChunks = [];
    let speechRun = 0;

    function speechPlainText(text) {
        return String(text || '')
            .replace(/\$\$?|\\\(|\\\)|\\\[|\\\]/g, ' ')
            .replace(/\\times/g, ' times ')
            .replace(/[*_#`|>~]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function speechPieces(text) {
        const sentences = text.match(/[^.!?;:]+[.!?;:]*/g) || [text];
        const pieces = [];
        let cur = '';
        sentences.forEach(sentence => {
            const s = sentence.trim();
            if (!s) return;
            if (cur && (cur + ' ' + s).length > 200) { pieces.push(cur); cur = s; }
            else cur = cur ? cur + ' ' + s : s;
        });
        if (cur) pieces.push(cur);
        return pieces;
    }

    function setSpeakingBar(on) {
        const old = $('ttsBar');
        if (!on) { if (old) old.remove(); return; }
        if (old) return;
        const bar = document.createElement('div');
        bar.id = 'ttsBar';
        bar.className = 'tts-bar';
        bar.innerHTML = '<span>Reading aloud...</span><button onclick="stopAllSpeech()">Stop</button>';
        document.body.appendChild(bar);
    }

    function stopAllSpeech() {
        speechRun++;
        speechChunks = [];
        if ('speechSynthesis' in window) speechSynthesis.cancel();
        setSpeakingBar(false);
    }

    function autoSpeak(text) {
        if (!('speechSynthesis' in window)) return;
        const clean = speechPlainText(text).substring(0, 20000);
        stopAllSpeech();
        if (!clean) return;
        const run = speechRun;
        speechChunks = speechPieces(clean);
        const playNext = () => {
            if (run !== speechRun) return;
            const piece = speechChunks.shift();
            if (!piece) { setSpeakingBar(false); return; }
            setSpeakingBar(true);
            const u = new SpeechSynthesisUtterance(piece);
            u.rate = 0.95;
            u.onend = playNext;
            u.onerror = playNext;
            speechSynthesis.speak(u);
        };
        playNext();
    }

    function speakText(elementId, btn) {
        const el = $(elementId);
        const text = el ? el.innerText.trim() : '';
        if (!text) { showError('Nothing to read'); return; }
        autoSpeak(text);
    }

    function speakExplainBox(btn) {
        const box = btn.closest('.theory-explain-box, .theory-explain-panel');
        if (!box) return;
        const clone = box.cloneNode(true);
        clone.querySelectorAll('.gpt-msg-actions').forEach(n => n.remove());
        autoSpeak(clone.textContent.trim());
    }

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

    // Turns LaTeX-style and chemical notation into readable text with real subscripts and superscripts
    function prettyMath(s) {
        let t = s
            .replace(/\\\(|\\\)|\\\[|\\\]/g, ' ')
            .replace(/\$\$/g, '')
            .replace(/\$([^$\n]*?[\\^_{][^$\n]*?)\$/g, '$1');
        const symbols = { '\\times': '×', '\\div': '÷', '\\cdot': '·', '\\pm': '±', '\\leq': '≤', '\\geq': '≥',
            '\\neq': '≠', '\\approx': '≈', '\\rightarrow': '→', '\\to': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒',
            '\\rightleftharpoons': '⇌', '\\infty': '∞', '\\pi': 'π', '\\theta': 'θ', '\\alpha': 'α', '\\beta': 'β',
            '\\lambda': 'λ', '\\mu': 'μ', '\\Delta': 'Δ', '\\sum': 'Σ', '\\circ': '°', '\\degree': '°' };
        Object.keys(symbols).forEach(k => { t = t.split(k).join(symbols[k]); });
        t = t.replace(/\\(?:text|mathrm|mathbf|textbf|mathit)\{([^{}]*)\}/g, '$1')
            .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, '($1)/($2)')
            .replace(/\\sqrt\{([^{}]+)\}/g, '√($1)')
            .replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>')
            .replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>')
            .replace(/([A-Za-z\)])_(\d+)/g, '$1<sub>$2</sub>')
            .replace(/\^(-?[0-9a-zA-Z])/g, '<sup>$1</sup>')
            .replace(/\b((?:[A-Z][a-z]?\d{0,2}){2,})\b/g, m => /\d/.test(m) ? m.replace(/(\d+)/g, '<sub>$1</sub>') : m);
        return t;
    }

    function inlineFormat(escaped) {
        return prettyMath(escaped)
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
        return '<div class="copy-box"><div class="copy-box-bar"><span>Table</span><button class="copy-box-btn" onclick="copyBoxContent(this)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg> Copy</button></div><div class="md-table-wrap">' + t + '</div></div>';
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
                    html += wrapCodeBox(codeBuf.join('\n'));
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
        if (inCode && codeBuf.length) html += wrapCodeBox(codeBuf.join('\n'));
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

    function togglePassword(inputId, btn) {
        const input = $(inputId);
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.innerHTML = show ? '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17.9 17.9A10.9 10.9 0 0112 19c-6.5 0-10-7-10-7a18.5 18.5 0 015.1-5.9"/><path d="M9.9 4.2A10.7 10.7 0 0112 4c6.5 0 10 7 10 7a18.6 18.6 0 01-2.2 3.2"/><path d="M14.1 14.1a3 3 0 11-4.2-4.2"/><path d="M1 1l22 22"/></svg>' : '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
        btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        btn.title = show ? 'Hide password' : 'Show password';
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
        mergeLocalProgress();
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
        resetChat();
        updateDashboard();
        loadDailyChallenge();
        loadDailyGoal();
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
            loadDailyGoal();
        } else if (pageId === 'chat') {
            openChatPage();
        }
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
    function formatHistoryDate(iso) {
        try {
            const d = new Date(iso);
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' • ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return ''; }
    }

    // ============================================================
    //  DAILY GOAL (Dashboard)
    // ============================================================
    function todayStr() { return new Date().toISOString().slice(0, 10); }

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
            lastTextbookTopic = topic;
            autoSpeak(typeof content === 'string' ? content : '');
            $('textbookResult').classList.remove('hidden');
            $('takeQuizBtn').classList.remove('hidden');
            $('textbookResult').scrollIntoView({ behavior: 'smooth', block: 'start' });
            addNotification('Textbook Generated', 'Your study notes on "' + topic + '" are ready! ');
            recordStudyEntry({ type: 'textbook', title: topic, subject: selectedSubject, level: selectedLevel });
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

        speakQuizQuestion();
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
        if (!quizState) return;
        const q = quizState.questions[quizState.index];
        if (!q) return;
        autoSpeak(q.question + '. ' + q.options.map(o => o.label + '. ' + o.text).join('. '));
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
        const spoken = !selectedLabel ? 'Time is up. The correct answer is ' + q.correctLabel + '. '
            : (correct ? 'Correct. ' : 'Not quite. The correct answer is ' + q.correctLabel + '. ');
        autoSpeak(spoken + (q.explanation || ''));
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
    function autoGrowChatInput(el) {
        el.style.height = 'auto';
        const h = el.scrollHeight;
        // a hidden page measures 0px; leave the height to CSS in that case
        el.style.height = h > 0 ? Math.min(h, 160) + 'px' : '';
    }

    function stopChatMessage() { stopAllSpeech(); }

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
                '<button onclick="clearChatImage()" title="Remove image"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg></button>';
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
        try { saved = JSON.parse(storeGet(dcKey(c)) || 'null'); } catch (e) { saved = null; }
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
        const key = dcKey(c);
        if (storeGet(key)) return; // one attempt per day

        const correct = letter === dcAnswerLetter(c);
        storeSet(key, JSON.stringify({ pick: letter, correct }));
        awardProgress(correct ? POINTS_PER_CORRECT : 0, true);
        recordQuizResult({ subject: c.subject || 'Daily Challenge', topic: 'Daily Challenge', score: correct ? 1 : 0, total: 1, points: correct ? POINTS_PER_CORRECT : 0, kind: 'daily' });
        bumpDailyGoal();
        renderDailyChallenge();
        updateDashboard();
    }

    // ============================================================
    //  TEXTBOOK: JSS / SSS toggle, each subject has Learn and Quiz
    // ============================================================
    let textbookLevel = 'JSS';

    function initTextbookSubjects() { textbookSelectLevel('JSS'); }

    function textbookQuiz() { switchPage('quizarena'); }
    let lastTextbookTopic = '';

    // "Take Quiz" opens Quiz Arena with this subject, level and topic already filled in
    function textbookTakeQuiz() {
        arenaBackToForm();
        $('arenaSubject').value = selectedSubject || '';
        $('arenaLevel').value = selectedLevel === 'SSS' ? 'SSS' : 'JSS';
        $('arenaTopic').value = lastTextbookTopic || '';
        switchPage('quizarena');
    }

    // ============================================================
    //  QUIZ ARENA
    // ============================================================
    let arenaParams = null;
    let arenaQuestions = [];

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
                '<div class="theory-subject-avatar" style="background:' + av.color + '">' + subjectIconSvg(subject) + '</div>' +
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
        theoryOpenIdx = null;
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
        theoryOpenIdx = null;
        theoryRenderYears();
        theoryRenderQuestions();
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
    //  PER-USER STORAGE (recent quizzes, recent study, goals, daily answers, progress)
    // ============================================================
    function userKey() {
        return String((currentUser && (currentUser.email || currentUser.username)) || 'guest').toLowerCase();
    }

    function goalKey() { return GOAL_KEY + ':' + userKey(); }
    function dcKey(c) { return 'dcAnswered_' + dcDate(c) + ':' + userKey(); }

    // ============================================================
    //  SCORE, QUIZZES AND STREAK (shared by every scored activity)
    // ============================================================
    function ymd(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function saveProgressLocal() {
        if (!currentUser) return;
        storeSet('xzith_progress:' + userKey(), JSON.stringify({
            total_score: currentUser.total_score || 0, quizzes_taken: currentUser.quizzes_taken || 0,
            streak: currentUser.streak || 0, streak_date: currentUser.streak_date || ''
        }));
    }

    // On login, keep the higher of the server's and this device's progress so nothing is lost
    function mergeLocalProgress() {
        try {
            const local = JSON.parse(storeGet('xzith_progress:' + userKey()) || 'null');
            if (!local) return;
            if ((local.total_score || 0) > (currentUser.total_score || 0)) {
                currentUser.total_score = local.total_score;
                currentUser.streak = local.streak || 0;
                currentUser.streak_date = local.streak_date || '';
            }
            currentUser.quizzes_taken = Math.max(currentUser.quizzes_taken || 0, local.quizzes_taken || 0);
        } catch (e) { /* ignore */ }
    }

    // A streak only starts counting once the user has 5,000 points; after that it is one day per day of activity
    function updateStreakOnActivity() {
        if (!currentUser || (currentUser.total_score || 0) < STREAK_UNLOCK_SCORE) return;
        const today = ymd(new Date());
        if (currentUser.streak_date === today) return;
        const y = new Date(); y.setDate(y.getDate() - 1);
        if (!currentUser.streak_date) currentUser.streak = Math.max(1, currentUser.streak || 0);
        else currentUser.streak = currentUser.streak_date === ymd(y) ? (currentUser.streak || 0) + 1 : 1;
        currentUser.streak_date = today;
    }

    let syncTimer = null;
    function syncProgress() {
        if (!currentUser) return;
        clearTimeout(syncTimer);
        syncTimer = setTimeout(() => {
            apiCall('/api/update-score', {
                userId: chatUserId(), email: currentUser.email, username: currentUser.username,
                total_score: currentUser.total_score || 0, quizzes_taken: currentUser.quizzes_taken || 0,
                streak: displayStreak()
            });
        }, 1200);
    }

    function awardProgress(points, countQuiz) {
        if (!currentUser) return;
        currentUser.total_score = (currentUser.total_score || 0) + points;
        if (countQuiz) currentUser.quizzes_taken = (currentUser.quizzes_taken || 0) + 1;
        updateStreakOnActivity();
        saveSession();
        saveProgressLocal();
        updateDashboard();
        syncProgress();
    }

    // ============================================================
    //  LEADERBOARD: ranked by score
    // ============================================================
    async function loadLeaderboard() {
        const tbody = $('leaderboardBody');
        leaderboardMessage('Loading leaderboard...', 'var(--text-light)');

        let res = await apiCall('/api/leaderboard', null, 'GET');
        if (res.error && [404, 405, 422].includes(res.status)) {
            res = await apiCall('/api/leaderboard', {}, 'POST');
        }
        if (res.error) {
            leaderboardMessage('Could not load the leaderboard: ' + escapeHtml(res.error), 'var(--danger)');
            return;
        }

        let list = Array.isArray(res) ? res : (res.leaderboard || res.users || res.data || []);
        list = Array.isArray(list) ? list.map(u => Object.assign({}, u)) : [];

        const isMe = u => currentUser && ((u.email && u.email === currentUser.email) || u.username === currentUser.username);
        if (currentUser) {
            const mine = list.find(isMe);
            if (mine) {
                mine.total_score = Math.max(mine.total_score || 0, currentUser.total_score || 0);
                mine.streak = Math.max(mine.streak || 0, currentUser.streak || 0);
            } else {
                list.push({ username: currentUser.username, email: currentUser.email, total_score: currentUser.total_score || 0, streak: currentUser.streak || 0 });
            }
        }
        list.sort((a, b) => (b.total_score || 0) - (a.total_score || 0));

        if (!list.length) {
            leaderboardMessage('No users on the leaderboard yet. Start learning to appear here.', 'var(--text-light)');
            return;
        }

        const cell = 'padding: 15px; border-bottom: 1px solid var(--border);';
        const row = (user, rank) => {
            const me = isMe(user);
            const streak = (user.total_score || 0) >= STREAK_UNLOCK_SCORE ? (user.streak || 0) : 0;
            return '<tr' + (me ? ' style="background: rgba(102, 126, 234, 0.12);"' : '') + '>' +
                '<td style="' + cell + ' text-align: center;"><span style="font-size: 18px; font-weight: 700;">' + rank + '</span></td>' +
                '<td style="' + cell + ' font-weight: 600;">' + escapeHtml(user.username || 'Anonymous') + (me ? ' <small style="color: var(--primary);">(you)</small>' : '') + '</td>' +
                '<td style="' + cell + ' color: var(--primary); font-weight: 600;">' + escapeHtml(user.total_score || 0) + ' <small>pts</small></td>' +
                '<td style="' + cell + ' color: var(--success); font-weight: 600;">' + escapeHtml(streak) + '</td></tr>';
        };

        let html = list.slice(0, 10).map((u, i) => row(u, i + 1)).join('');
        const myIndex = list.findIndex(isMe);
        if (myIndex >= 10) {
            html += '<tr><td colspan="4" style="text-align: center; color: var(--text-light); padding: 6px;">...</td></tr>' + row(list[myIndex], myIndex + 1);
        }
        tbody.innerHTML = html;
    }

    // ============================================================
    //  SUBJECT ICONS (textbook, quick study, theory)
    // ============================================================
    const SUBJECT_ICON_RULES = [
        [/physics/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1.5"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/></svg>'], [/chem|basic science/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6"/><path d="M10 3v6L4.5 19a2 2 0 001.8 3h11.4a2 2 0 001.8-3L14 9V3"/></svg>'], [/biolog/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 20A7 7 0 019.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z"/><path d="M2 21c0-3 1.9-5.4 5-6"/></svg>'],
        [/agric/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 20h10"/><path d="M12 20v-9"/><path d="M12 11c0-3-2-5-5-5 0 3 2 5 5 5z"/><path d="M12 13c0-3 2-5 5-5 0 3-2 5-5 5z"/></svg>'], [/math|account/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8"/><path d="M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 18h.01M12 18h.01M16 18h.01"/></svg>'], [/comput|ict|technology/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/></svg>'],
        [/geograph/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 010 20 15 15 0 010-20z"/></svg>'], [/histor|government/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 21h18"/><path d="M5 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="M19 21V10"/><path d="M12 3L3 9h18z"/></svg>'], [/econom/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/></svg>'],
        [/commerce|market|insurance|office|store|business/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 01-8 0"/></svg>'], [/civic|social/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.9"/><path d="M16 3.1a4 4 0 010 7.8"/></svg>'],
        [/art|creative/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2a10 10 0 100 20 2 2 0 002-2c0-.6-.3-1.1-.6-1.5-.3-.4-.4-.8-.4-1.5a2 2 0 012-2h2.3a4 4 0 004-4C21 5.6 17 2 12 2z"/></svg>'], [/music/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>'], [/health|physical|home|security/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 00-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 000-7.8z"/></svg>'],
        [/food|nutrition|cater/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3v8a2 2 0 002 2h1a2 2 0 002-2V3"/><path d="M7 3v18"/><path d="M17 3c-2 2-3 5-3 8h3v10"/></svg>'], [/drawing|wood|metal|building|electr|mechanic/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2.2-2.2z"/></svg>'],
        [/english|literature|yoruba|igbo|hausa|french|arabic/i, '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/></svg>']
    ];

    function subjectIconSvg(subject) {
        for (const rule of SUBJECT_ICON_RULES) if (rule[0].test(subject)) return rule[1];
        return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h6a3 3 0 013 3v13a2 2 0 00-2-2H4z"/><path d="M20 4h-6a3 3 0 00-3 3v13a2 2 0 012-2h7z"/></svg>';
    }

    function renderQuickSubjects() {
        const box = $('quickSubjectsGrid');
        if (!box) return;
        box.innerHTML = QUICK_SUBJECTS.map(subject => {
            const av = subjectAvatar(subject);
            return '<div class="quick-subject-card" onclick="dashboardQuickLearn(' + JSON.stringify(subject).replace(/"/g, '&quot;') + ')">' +
                '<div class="quick-subject-avatar" style="background:' + av.color + '">' + subjectIconSvg(subject) + '</div>' +
                '<div class="quick-subject-name">' + escapeHtml(subject) + '</div>' +
            '</div>';
        }).join('');
    }

    function textbookSelectLevel(level) {
        textbookLevel = level;
        $('tbTabJSS').classList.toggle('active', level === 'JSS');
        $('tbTabSSS').classList.toggle('active', level === 'SSS');
        const subjects = Object.values(TEXTBOOK_SUBJECTS[level]).flat();
        $('textbookSubjectList').innerHTML = subjects.map(subject => {
            const arg = JSON.stringify(subject).replace(/"/g, '&quot;');
            const av = subjectAvatar(subject);
            return '<div class="subject-row">' +
                '<span class="subject-row-name"><span class="subject-row-icon" style="background:' + av.color + '">' + subjectIconSvg(subject) + '</span>' + escapeHtml(subject) + '</span>' +
                '<span class="subject-row-actions">' +
                    '<button class="theory-btn theory-btn-primary subject-act" onclick="textbookOpenLearn(' + arg + ', \'' + level + '\')">Learn</button>' +
                    '<button class="theory-btn theory-btn-secondary subject-act" onclick="textbookQuiz()">Quiz</button>' +
                '</span></div>';
        }).join('');
    }

    // ============================================================
    //  COPY BUTTONS for tables, diagrams and examples inside AI answers
    // ============================================================
    function wrapCodeBox(code) {
        return '<div class="copy-box"><div class="copy-box-bar"><span>Diagram / Example</span>' +
            '<button class="copy-box-btn" onclick="copyBoxContent(this)"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg> Copy</button></div>' +
            '<pre><code>' + code + '</code></pre></div>';
    }

    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (e) {
            try {
                const ta = document.createElement('textarea');
                ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                document.body.appendChild(ta); ta.select();
                const ok = document.execCommand('copy');
                document.body.removeChild(ta);
                return ok;
            } catch (e2) { return false; }
        }
    }

    async function copyBoxContent(btn) {
        const box = btn.closest('.copy-box');
        if (!box) return;
        const table = box.querySelector('table');
        const text = table
            ? Array.from(table.rows).map(r => Array.from(r.cells).map(c => c.innerText.trim()).join('\t')).join('\n')
            : (box.querySelector('pre') ? box.querySelector('pre').innerText : box.innerText);
        const original = btn.innerHTML;
        const ok = await copyText(text);
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => { btn.innerHTML = original; }, 1500);
    }

    // ============================================================
    //  AI CHAT: plain AI text, saved history from the server, working voice input
    // ============================================================
    let pendingChatPrompt = '';
    let chatHistorySeq = 0;
    let chatRecognition = null;
    let chatListening = false;
    const CHAT_PLACEHOLDER = 'Ask anything about your studies...';

    function chatUserId() {
        return currentUser ? (currentUser.id ?? currentUser._id ?? currentUser.user_id) : undefined;
    }

    function chatInitial() {
        const name = (currentUser && currentUser.username) || 'U';
        return name.trim().charAt(0).toUpperCase() || 'U';
    }

    function chatTimeLabel(t) {
        const d = t ? new Date(t) : new Date();
        if (isNaN(d.getTime())) return '';
        return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    }

    function updateChatCounter() {
        const input = $('chatInput');
        const el = $('chatCounter');
        if (!input || !el) return;
        el.textContent = input.value.length + ' / 500';
        el.classList.toggle('over', input.value.length > 500);
    }

    function chatGreetingHtml() {
        return '<div class="chat-row chat-row-ai"><div class="chat-ai-text rich"><p>Hello, I\'m your AI tutor. Ask me anything about Mathematics, Science, English, or any subject. I\'m here to help.</p></div></div>';
    }

    function resetChat() {
        $('chatBox').innerHTML = chatGreetingHtml();
        chatBusy = false;
        clearChatImage();
        const input = $('chatInput');
        if (input) { input.value = ''; autoGrowChatInput(input); updateChatCounter(); }
    }

    function normalizeChatHistory(res) {
        let list = Array.isArray(res) ? res : (res.history || res.messages || res.chats || res.data || []);
        if (!Array.isArray(list)) return [];
        const out = [];
        list.forEach(m => {
            if (!m) return;
            const time = m.created_at || m.timestamp || m.time || m.createdAt || m.date || null;
            if (m.role) {
                const text = m.content || m.message || m.text || '';
                if (text) out.push({ role: /user|human/i.test(m.role) ? 'user' : 'ai', text: String(text), time });
            } else {
                const userText = m.user_message || m.question || m.message;
                const aiText = m.ai_response || m.response || m.reply || m.answer;
                if (userText) out.push({ role: 'user', text: String(userText), time });
                if (aiText) out.push({ role: 'ai', text: String(aiText), time });
            }
        });
        if (out.length && out.every(m => m.time && !isNaN(new Date(m.time).getTime()))) {
            out.sort((a, b) => new Date(a.time) - new Date(b.time));
        }
        return out;
    }

    // Called every time the AI Tutor page opens
    async function loadChatHistoryFromServer() {
        const id = chatUserId();
        if (id === undefined || id === null || chatBusy) return;
        const seq = ++chatHistorySeq;
        const res = await apiCall('/api/chat-history/' + encodeURIComponent(id), null, 'GET');
        if (seq !== chatHistorySeq || chatBusy || res.error) return;
        const messages = normalizeChatHistory(res);
        if (!messages.length) return;
        const box = $('chatBox');
        box.innerHTML = '';
        messages.forEach(m => addChatBubble(m.role, m.text, null, m.time));
        box.scrollTop = box.scrollHeight;
    }

    async function openChatPage() {
        autoGrowChatInput($('chatInput'));
        await loadChatHistoryFromServer();
        const box = $('chatBox');
        box.scrollTop = box.scrollHeight;
        if (pendingChatPrompt) {
            const prompt = pendingChatPrompt;
            pendingChatPrompt = '';
            const input = $('chatInput');
            input.value = prompt;
            autoGrowChatInput(input);
            updateChatCounter();
            sendChat();
        }
    }

    async function copyChatMessage(btn) {
        const el = btn.closest('.chat-row').querySelector('.chat-ai-text');
        const original = btn.innerHTML;
        const ok = await copyText(el ? el.innerText : '');
        btn.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => { btn.innerHTML = original; }, 1500);
    }

    function speakChatMessage(btn) {
        const el = btn.closest('.chat-row').querySelector('.chat-ai-text');
        const text = el ? el.innerText.trim() : '';
        if (text) autoSpeak(text);
    }

    function addChatBubble(role, text, imageDataUrl, time) {
        const box = $('chatBox');
        const div = document.createElement('div');
        const stamp = chatTimeLabel(time);

        if (role === 'user') {
            div.className = 'chat-row chat-row-user';
            div.innerHTML = '<span class="chat-time">' + stamp + '</span><div class="chat-user-bubble"></div>' +
                '<div class="chat-user-avatar">' + escapeHtml(chatInitial()) + '</div>';
            const bubble = div.querySelector('.chat-user-bubble');
            if (imageDataUrl) {
                const img = document.createElement('img');
                img.src = imageDataUrl; img.className = 'gpt-chat-image'; img.alt = 'attached image';
                bubble.appendChild(img);
            }
            if (text) bubble.appendChild(document.createTextNode(text));
        } else if (role === 'error') {
            div.className = 'chat-row chat-row-ai';
            div.innerHTML = '<div class="chat-ai-text chat-error"></div>';
            div.querySelector('.chat-ai-text').textContent = text;
        } else if (role === 'typing') {
            div.className = 'chat-row chat-row-ai';
            div.innerHTML = '<div class="gpt-typing"><span></span><span></span><span></span></div>';
        } else {
            div.className = 'chat-row chat-row-ai';
            div.innerHTML = '<div class="chat-ai-text rich">' + formatRichText(text) + '</div>' +
                '<div class="chat-time">' + stamp + '</div>' +
                '<div class="chat-actions">' +
                    '<button onclick="speakChatMessage(this)" title="Read aloud"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg> Speak</button>' +
                    '<button onclick="stopChatMessage()" title="Stop reading"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg> Stop</button>' +
                    '<button onclick="copyChatMessage(this)" title="Copy"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/></svg> Copy</button>' +
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

        if (chatListening && chatRecognition) chatRecognition.stop();
        chatBusy = true;
        $('sendChatBtn').disabled = true;
        addChatBubble('user', msg, image ? image.dataUrl : null);
        input.value = '';
        autoGrowChatInput(input);
        updateChatCounter();
        clearChatImage();
        const typing = addChatBubble('typing');

        try {
            const payload = { message: msg };
            const id = chatUserId();
            if (id !== undefined && id !== null) payload.userId = id;
            if (image) payload.image = image.dataUrl;
            const res = await apiCall('/api/chat', payload);
            typing.remove();
            const reply = res.response || res.message || res.reply || res.answer;
            if (res.error || !reply) {
                addChatBubble('error', res.error || 'I could not generate a response. Please try again.');
            } else {
                addChatBubble('ai', typeof reply === 'string' ? reply : JSON.stringify(reply));
                autoSpeak(typeof reply === 'string' ? reply : '');
            }
        } finally {
            chatBusy = false;
            $('sendChatBtn').disabled = false;
            input.focus();
        }
    }

    // Voice input: tap the microphone, speak, the words appear in the box; tap Send when ready
    function stopChatVoice() {
        try { if (chatRecognition) chatRecognition.abort(); } catch (e) { /* ignore */ }
        chatListening = false;
        const mic = $('chatMicBtn');
        if (mic) mic.classList.remove('listening');
        const input = $('chatInput');
        if (input) input.placeholder = CHAT_PLACEHOLDER;
    }

    // Tap the microphone, speak, tap again (or just pause): what you said is sent to the AI Tutor
    function startVoiceChat() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) { showError('Voice input is not supported in this browser. Please open the site in Chrome.'); return; }
        if (window.isSecureContext === false) { showError('Voice input needs a secure (https) connection.'); return; }

        if (chatListening) {
            try { chatRecognition.stop(); } catch (e) { /* ignore */ }
            setTimeout(() => { if (chatListening) stopChatVoice(); }, 1500);
            return;
        }
        if ('speechSynthesis' in window) speechSynthesis.cancel();

        const input = $('chatInput');
        const mic = $('chatMicBtn');
        const base = input.value ? input.value.trim() + ' ' : '';
        const lang = /^en/i.test(navigator.language || '') ? navigator.language : 'en-US';
        let finalText = '';
        let failed = false;

        const rec = new SR();
        chatRecognition = rec;
        rec.lang = lang;
        rec.interimResults = true;
        rec.continuous = false;
        rec.maxAlternatives = 1;

        rec.onstart = () => {
            chatListening = true;
            mic.classList.add('listening');
            input.placeholder = 'Listening... speak now';
        };
        rec.onresult = e => {
            let interim = '';
            for (let i = e.resultIndex; i < e.results.length; i++) {
                const t = e.results[i][0].transcript;
                if (e.results[i].isFinal) finalText += t; else interim += t;
            }
            input.value = (base + finalText + interim).slice(0, 500);
            autoGrowChatInput(input);
            updateChatCounter();
        };
        rec.onerror = e => {
            failed = true;
            const messages = {
                'not-allowed': 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.',
                'service-not-allowed': 'Microphone access is blocked. Allow the microphone for this site in your browser settings, then try again.',
                'no-speech': 'No speech was detected. Tap the microphone and speak clearly.',
                'audio-capture': 'No microphone was found on this device.',
                'network': 'Voice input needs an internet connection.',
                'language-not-supported': 'Your browser does not support voice input for this language.'
            };
            if (e.error !== 'aborted') showError(messages[e.error] || 'Voice input stopped unexpectedly. Please try again.');
        };
        rec.onend = () => {
            const heard = (finalText || '').trim();
            stopChatVoice();
            if (!failed && heard) sendChat();
            else input.focus();
        };
        try { rec.start(); } catch (err) { stopChatVoice(); showError('Could not start the microphone. Please try again.'); }
    }

    // ============================================================
    //  QUIZ ARENA: subject + level + topic -> POST /api/generate-quiz
    // ============================================================
    function startArenaQuiz(btn) {
        const subject = $('arenaSubject').value.trim();
        if (!subject) { showError('Please enter a subject'); return; }
        fetchArenaQuiz({ subject, level: $('arenaLevel').value, topic: $('arenaTopic').value.trim() }, btn);
    }

    function retakeArenaQuiz(btn) {
        if (arenaParams) fetchArenaQuiz(arenaParams, btn);
    }

    function arenaBackToForm() {
        stopQuizTimer();
        $('arenaQuizPanel').classList.add('hidden');
        $('arenaForm').classList.remove('hidden');
    }

    async function fetchArenaQuiz(params, btn) {
        const err = $('arenaError');
        err.classList.add('hidden');

        await withLoading(btn, 'Generating quiz...', async () => {
            const res = await apiCall('/api/generate-quiz', { subject: params.subject, level: params.level, topic: params.topic, count: 5 });
            const parsed = toStructuredQuestions(res.raw || res.questions || res.quiz || res.response || res.content);

            if (res.error || !parsed.length) {
                const msg = res.error || 'Could not generate a quiz. Please try again.';
                if (!$('arenaForm').classList.contains('hidden')) { err.textContent = msg; err.classList.remove('hidden'); }
                else showError(msg);
                return;
            }
            arenaParams = params;
            arenaQuestions = parsed.slice(0, 5);
            beginArenaAttempt();
        });
    }

    function beginArenaAttempt() {
        if (!arenaParams || !arenaQuestions.length) return;
        $('arenaForm').classList.add('hidden');
        $('arenaQuizPanel').classList.remove('hidden');
        $('arenaQuizSummary').classList.add('hidden');
        $('arenaQuizHeader').innerHTML =
            '<div class="arena-title">Quiz Arena</div>' +
            '<div class="arena-sub">' + escapeHtml(arenaParams.subject) + ' · ' + escapeHtml(arenaParams.level) + (arenaParams.topic ? ' · ' + escapeHtml(arenaParams.topic) : '') + '</div>';

        quizState = {
            questions: arenaQuestions, index: 0, score: 0, results: [],
            subject: arenaParams.subject, topic: arenaParams.topic,
            source: 'arena', ids: { area: 'arenaQuizArea', summary: 'arenaQuizSummary' }
        };
        renderQuizQuestion();
        $('arenaQuizPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function finishQuiz() {
        const total = quizState.questions.length;
        const score = quizState.score;
        const points = score * POINTS_PER_CORRECT;
        const ids = quizState.ids;

        $(ids.area).innerHTML = '';
        $(ids.summary).classList.remove('hidden');
        $(ids.summary).innerHTML =
            '<div class="arena-result">' +
                '<div class="arena-result-score">' + score + ' / ' + total + '</div>' +
                '<h3>' + (score >= total * 0.6 ? 'Well done' : 'Keep practising') + '</h3>' +
                '<p class="arena-result-sub">' + escapeHtml(quizState.subject) + (quizState.topic ? ' · ' + escapeHtml(quizState.topic) : '') + '</p>' +
                '<p class="arena-result-points">' + points + ' points added to your score</p>' +
                '<div class="theory-actions" style="justify-content:center;">' +
                    '<button class="theory-btn theory-btn-primary" onclick="retakeArenaQuiz(this)">Retake</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="arenaBackToForm()">New Quiz</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="switchPage(\'leaderboard\')">Leaderboard</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="switchPage(\'dashboard\')">Dashboard</button>' +
                '</div>' +
            '</div>';

        awardProgress(points, true);
        recordQuizResult({ subject: quizState.subject, topic: 'Quiz Arena' + (quizState.topic ? ': ' + quizState.topic : ''), score, total, points, kind: 'quiz' });
        bumpDailyGoal();
        addNotification('Quiz complete', quizState.subject + ': ' + score + ' / ' + total + ' (' + points + ' pts)');
    }

    // ============================================================
    //  THEORY: tap a question to reveal its actions
    // ============================================================
    function theoryBtnLabel(q) {
        return '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 00-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0012 2z"/></svg> ' + (q.explanation ? (q.open ? 'Hide Explanation' : 'Show Explanation') : 'Get Explanation');
    }

    // Theory opens one question at a time: first a list, then only the question tapped
    let theoryOpenIdx = null;

    function theoryOpenQuestion(i) {
        theoryOpenIdx = i;
        theoryRenderQuestions();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    function theoryBackToList() {
        stopAllSpeech();
        theoryOpenIdx = null;
        theoryRenderQuestions();
    }

    function theoryRenderQuestions() {
        const items = theoryAll.map((q, i) => ({ q, i })).filter(o => theoryYear === 'all' || o.q.year === theoryYear);
        items.sort((a, b) => (parseInt(b.q.year, 10) || 0) - (parseInt(a.q.year, 10) || 0));

        if (!items.length) {
            theoryOpenIdx = null;
            $('theoryMeta').textContent = theoryExam + ' · ' + theorySubject;
            $('theoryQuestionBox').innerHTML = '<div class="card dc-loading">No ' + theoryExam + ' questions found for ' + (theoryYear === 'all' ? 'this subject' : theoryYear) + '.</div>';
            return;
        }

        const active = theoryOpenIdx !== null ? items.find(o => o.i === theoryOpenIdx) : null;
        if (!active) {
            theoryOpenIdx = null;
            $('theoryMeta').textContent = theoryExam + ' · ' + theorySubject + ' · ' + items.length + (items.length === 1 ? ' question' : ' questions') + ' · tap a question to open it';
            $('theoryQuestionBox').innerHTML = '<div class="card theory-list-card">' + items.map(o => {
                const q = o.q;
                return '<button class="theory-list-item" onclick="theoryOpenQuestion(' + o.i + ')">' +
                    '<span class="theory-list-year">' + escapeHtml((q.year ? q.year + ' ' : '') + theoryExam) + '</span>' +
                    '<span class="theory-list-text">' + escapeHtml(q.question) + '</span>' +
                    '<span class="theory-q-chev"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg></span>' +
                '</button>';
            }).join('') + '</div>';
            return;
        }

        const q = active.q;
        const panelOpen = !!q.explanation && q.open;
        $('theoryMeta').textContent = theoryExam + ' · ' + theorySubject + (q.year ? ' · ' + q.year : '');
        $('theoryQuestionBox').innerHTML =
            '<button class="theory-back" onclick="theoryBackToList()">&lsaquo; Back to questions</button>' +
            '<div class="card theory-q-card expanded" id="theoryCard' + active.i + '">' +
                '<div class="theory-q-head"><span class="detail-badge detail-badge-blue">' + escapeHtml((q.year ? q.year + ' ' : '') + theoryExam) + '</span></div>' +
                '<div class="theory-q-text">' + escapeHtml(q.question) + '</div>' +
                '<div class="theory-q-actions">' +
                    '<button class="theory-btn theory-btn-primary" id="theoryBtn' + active.i + '" onclick="theoryToggleExplanation(' + active.i + ')">' + theoryBtnLabel(q) + '</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="theoryAskFollowUp(' + active.i + ')"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a2 2 0 01-2 2H8l-5 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Ask a Follow-up</button>' +
                '</div>' +
                '<div class="theory-explain-panel' + (panelOpen ? ' open' : '') + '" id="theoryPanel' + active.i + '">' +
                    (q.explanation ? '<div class="rich">' + formatRichText(q.explanation) + '</div>' + explainVoiceActionsHtml() : '') +
                '</div>' +
            '</div>';
    }

    // Opening one question closes the others
    async function theoryToggleExplanation(i) {
        const q = theoryAll[i];
        const panel = $('theoryPanel' + i);
        const btn = $('theoryBtn' + i);
        if (!q || !panel || !btn) return;

        if (q.explanation) {
            q.open = !panel.classList.contains('open');
            panel.classList.toggle('open', q.open);
            btn.innerHTML = theoryBtnLabel(q);
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
        autoSpeak(q.explanation);
        q.open = true;
        panel.innerHTML = '<div class="rich">' + formatRichText(q.explanation) + '</div>' + explainVoiceActionsHtml();
        btn.innerHTML = theoryBtnLabel(q);

        recordStudyEntry({ type: 'theory', title: theorySubject + ' theory', subject: theorySubject, level: theoryExam });
        updateDashboard();
    }

    // Opens the AI Tutor with this question already sent as the first message
    function theoryAskFollowUp(i) {
        const q = theoryAll[i];
        if (!q) return;
        pendingChatPrompt = 'Explain this question in more detail: ' + q.question;
        switchPage('chat');
    }

    // ============================================================
    //  DASHBOARD + MENU SUMMARY
    // ============================================================
    function updateDashboard() {
        if (!currentUser) return;
        $('dashScore').textContent = currentUser.total_score || 0;
        $('dashQuizzes').textContent = currentUser.quizzes_taken || 0;
        $('dashStreak').textContent = displayStreak();
        $('dashStreakHint').textContent = streakHintText();
        if ($('menuScore')) {
            $('menuScore').textContent = currentUser.total_score || 0;
            $('menuStreak').textContent = displayStreak();
            $('menuQuizzes').textContent = currentUser.quizzes_taken || 0;
            $('menuName').textContent = currentUser.username || 'Student';
            $('menuAvatar').textContent = (currentUser.username || 'S').trim().charAt(0).toUpperCase();
        }
        renderDailyGoal();
        renderQuickSubjects();
    }

    // ============================================================
    //  DAILY GOAL: quizzes completed today come from the server
    // ============================================================
    let dailyGoalServer = { quizzes: 0, date: '' };

    function goalTarget() {
        const t = parseInt(storeGet('xzith_goal_target:' + userKey()), 10);
        return [5, 10, 20].includes(t) ? t : 5;
    }

    function setDailyGoal(target) {
        storeSet('xzith_goal_target:' + userKey(), String(target));
        renderDailyGoal();
    }

    async function loadDailyGoal() {
        const id = chatUserId();
        if (id === undefined || id === null) { renderDailyGoal(); return; }
        const res = await apiCall('/api/user/daily-goal/' + encodeURIComponent(id), null, 'GET');
        if (!res.error && res.quizzes !== undefined) {
            dailyGoalServer = { quizzes: Number(res.quizzes) || 0, date: res.date || '' };
        }
        renderDailyGoal();
    }

    // Called after every completed quiz
    async function bumpDailyGoal() {
        const id = chatUserId();
        if (id === undefined || id === null) return;
        const res = await apiCall('/api/user/daily-goal/bump', { userId: id });
        if (!res.error && res.quizzes !== undefined) dailyGoalServer.quizzes = Number(res.quizzes) || 0;
        else dailyGoalServer.quizzes += 1;
        renderDailyGoal();
    }

    function renderDailyGoal() {
        const countEl = $('dailyGoalCount');
        if (!countEl) return;
        const count = dailyGoalServer.quizzes;
        const target = goalTarget();
        const circumference = 2 * Math.PI * 52;
        const ring = $('dailyGoalRing');
        if (ring) {
            ring.style.strokeDasharray = circumference;
            ring.style.strokeDashoffset = circumference * (1 - Math.min(1, count / target));
        }
        countEl.textContent = count;
        $('dailyGoalOf').textContent = 'of ' + target + ' quizzes';
        $('dailyGoalProgress').textContent = count >= target ? 'Goal reached for today' : (target - count) + ' more to reach today\'s goal';
        document.querySelectorAll('.goal-option-btn').forEach(b => b.classList.toggle('active', parseInt(b.dataset.goal, 10) === target));
    }

    // ============================================================
    //  RECENT ACTIVITY + STUDY: saved on the server, same on every device
    // ============================================================
    let profileActivity = [];
    let profileStudy = [];

    function recordQuizResult(entry) {
        const id = chatUserId();
        if (id === undefined || id === null) return;
        apiCall('/api/user/activity', {
            userId: id, topic: entry.topic || '', subject: entry.subject || '',
            score: entry.score || 0, total: entry.total || 0, kind: entry.kind || 'quiz'
        });
    }

    function recordStudyEntry(entry) {
        const id = chatUserId();
        if (id === undefined || id === null) return;
        apiCall('/api/user/study', {
            userId: id, type: entry.type || 'textbook', title: entry.title || '',
            subject: entry.subject || '', level: entry.level || ''
        });
    }

    function listFrom(res, keys) {
        if (Array.isArray(res)) return res;
        for (const k of keys) if (res && Array.isArray(res[k])) return res[k];
        return [];
    }

    async function loadProfileHistory() {
        const boxes = ['profileRecentActivity', 'profileRecentQuizzes', 'profileRecentStudy'].map($);
        boxes.forEach(b => { if (b) b.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">Loading...</p>'; });

        const id = chatUserId();
        if (id === undefined || id === null) { profileActivity = []; profileStudy = []; renderProfileHistory(); return; }

        const [a, st] = await Promise.all([
            apiCall('/api/user/activity/' + encodeURIComponent(id), null, 'GET'),
            apiCall('/api/user/study/' + encodeURIComponent(id), null, 'GET')
        ]);
        if (a.error && st.error) {
            boxes.forEach(b => { if (b) b.innerHTML = '<p style="color: var(--danger); font-size: 14px;">Could not load your history. Please try again.</p>'; });
            return;
        }
        profileActivity = a.error ? [] : listFrom(a, ['activity', 'items', 'data', 'recent']);
        profileStudy = st.error ? [] : listFrom(st, ['study', 'items', 'data', 'sessions', 'recent']);
        renderProfileHistory();
    }

    function renderProfileHistory() {
        renderRecentActivity();
        renderRecentQuizzes();
        renderRecentStudy();
    }

    const ACTIVITY_KIND_LABEL = { quiz: 'Quiz', 'past-question': 'Past Questions', daily: 'Daily Challenge' };

    function formatHistoryDate(iso) {
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return '';
            return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
        } catch (e) { return ''; }
    }

    function renderRecentQuizzes() {
        const box = $('profileRecentQuizzes');
        if (!box) return;
        if (!profileActivity.length) {
            box.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">No quizzes taken yet. Try the Quiz Arena or Past Questions.</p>';
            return;
        }
        box.innerHTML = profileActivity.slice(0, 20).map(q =>
            '<div class="activity-row"><div><strong>' + escapeHtml(q.subject || '') + '</strong>' +
            '<span style="color: var(--text-light); font-size: 13px;"> · ' + escapeHtml(q.topic || '') + '</span>' +
            '<div style="color: var(--text-light); font-size: 12px;">' + escapeHtml(ACTIVITY_KIND_LABEL[q.kind] || 'Quiz') + ' · ' + formatHistoryDate(q.created_at) + '</div></div>' +
            '<div style="font-weight: 700; color: ' + ((q.score || 0) >= (q.total || 1) * 0.6 ? 'var(--success)' : 'var(--warning)') + ';">' + (q.score ?? 0) + ' / ' + (q.total ?? 0) + '</div></div>'
        ).join('');
    }

    function renderRecentStudy() {
        const box = $('profileRecentStudy');
        if (!box) return;
        if (!profileStudy.length) {
            box.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">No study sessions yet. Visit Textbook or Theory to get started.</p>';
            return;
        }
        box.innerHTML = profileStudy.slice(0, 20).map(x =>
            '<div class="activity-row"><div><span class="activity-tag study">' + escapeHtml(x.type === 'theory' ? 'Theory' : 'Textbook') + '</span> ' +
            '<strong>' + escapeHtml(x.title || x.subject || '') + '</strong>' +
            '<div style="color: var(--text-light); font-size: 12px;">' + escapeHtml([x.subject, x.level].filter(Boolean).join(' · ')) + ' · ' + formatHistoryDate(x.created_at) + '</div></div></div>'
        ).join('');
    }

    function renderRecentActivity() {
        const box = $('profileRecentActivity');
        if (!box) return;
        const merged = [
            ...profileActivity.map(q => ({ type: 'quiz', ...q })),
            ...profileStudy.map(x => ({ type: 'study', ...x }))
        ].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, 8);

        if (!merged.length) {
            box.innerHTML = '<p style="color: var(--text-light); font-size: 14px;">No activity yet. Take a quiz or generate study notes to get started.</p>';
            return;
        }
        box.innerHTML = merged.map(item => {
            const isQuiz = item.type === 'quiz';
            const title = isQuiz ? (item.subject || '') : (item.title || item.subject || '');
            const sub = isQuiz ? (item.topic || '') : [item.subject, item.level].filter(Boolean).join(' · ');
            const detail = isQuiz ? (item.score ?? 0) + ' / ' + (item.total ?? 0) : '';
            return '<div class="activity-row">' +
                '<div><span class="activity-tag ' + item.type + '">' + (isQuiz ? 'Quiz' : 'Study') + '</span> <strong>' + escapeHtml(title) + '</strong>' +
                '<span style="color: var(--text-light); font-size: 13px;"> · ' + escapeHtml(sub) + '</span></div>' +
                '<div style="color: var(--text-light); font-size: 12px; white-space: nowrap;">' + escapeHtml(detail) + '</div></div>';
        }).join('');
    }

    function populateProfile() {
        if (!currentUser) return;
        $('profileUsername').value = currentUser.username || '';
        $('profileEmail').value = currentUser.email || '';
        $('profileScore').textContent = currentUser.total_score || 0;
        $('profileQuizzes').textContent = currentUser.quizzes_taken || 0;
        $('profileStreak').textContent = displayStreak();
        $('profileStreakHint').textContent = streakHintText();
        loadProfileHistory();
    }

    // ============================================================
    //  PAST QUESTIONS: 30 questions in 3 stacked levels (Easy, Medium, Hard)
    // ============================================================
    const PQ_LEVEL_INFO = [
        { n: 1, label: 'Level 1 — Easy', cls: 'easy' },
        { n: 2, label: 'Level 2 — Medium', cls: 'medium' },
        { n: 3, label: 'Level 3 — Hard', cls: 'hard' }
    ];
    let pqLevels = {};
    let pqMeta = { exam: '', subject: '' };

    async function generatePastQuestions(btn) {
        const subject = $('pqSubject').value.trim();
        if (!subject) { showError('Please select a subject'); return; }

        await withLoading(btn, 'Generating questions...', async () => {
            const res = await apiCall('/api/generate-past-questions', { exam: currentExam, subject, topic: '' });

            let levels = [res.level1, res.level2, res.level3].map(t => t ? toStructuredQuestions(t).slice(0, 10) : []);
            if (!levels.some(l => l.length) && res.full) {
                const all = toStructuredQuestions(res.full);
                levels = [all.slice(0, 10), all.slice(10, 20), all.slice(20, 30)];
            }
            if (res.error || !levels.some(l => l.length)) {
                showError(res.error || 'Could not generate questions. Please try again.');
                return;
            }

            pqMeta = { exam: currentExam, subject };
            pqLevels = {};
            let number = 0;
            $('pqSections').innerHTML = PQ_LEVEL_INFO.map((info, idx) => {
                const qs = levels[idx];
                if (!qs.length) return '';
                pqLevels[info.n] = { total: qs.length, correct: 0, wrong: 0, answered: 0 };
                const cards = qs.map(q => {
                    number++;
                    const options = q.options.map(o => mcqOptionHtml(o.label, o.text, "pqAnswer(this, '" + q.correctLabel + "')")).join('');
                    return '<div class="pq-question" data-level="' + info.n + '" data-question="' + escapeHtml(q.question).replace(/"/g, '&quot;') + '" data-explanation="' + escapeHtml(q.explanation || '').replace(/"/g, '&quot;') + '">' +
                        '<div class="pq-q-top"><div class="pq-q-text">Q' + number + '. ' + escapeHtml(q.question) + '</div>' +
                        '<button class="voice-btn" onclick="speakPqCard(this)" title="Read question aloud"><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg></button></div>' +
                        options + '<div class="pq-explain theory-explain-box"></div></div>';
                }).join('');
                return '<section class="card pq-level' + (info.n === 1 ? '' : ' hidden') + '" id="pqLevel' + info.n + '">' +
                    '<div class="pq-level-head"><span class="pq-level-dot ' + info.cls + '"></span><h3>' + info.label + '</h3>' +
                    '<span class="pq-level-count" id="pqLevelCount' + info.n + '">0 / ' + qs.length + ' answered</span></div>' +
                    cards + '<div class="pq-level-result hidden" id="pqLevelResult' + info.n + '"></div></section>';
            }).join('');

            $('questionsMeta').textContent = currentExam + ' · ' + subject + ' · ' + number + ' questions in 3 levels';
            $('pqFinal').classList.add('hidden');
            $('pqPanel').classList.remove('hidden');
            pqUpdateStats();
            $('pqPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
            addNotification('Questions ready', currentExam + ' ' + subject + ': ' + number + ' questions');
        });
    }

    function pqTotals() {
        return Object.values(pqLevels).reduce((t, l) => ({
            total: t.total + l.total, correct: t.correct + l.correct, wrong: t.wrong + l.wrong, answered: t.answered + l.answered
        }), { total: 0, correct: 0, wrong: 0, answered: 0 });
    }

    function pqUpdateStats() {
        const t = pqTotals();
        $('pqStatsBar').innerHTML =
            '<span class="pq-stat"><span class="pq-dot pq-dot-correct"></span>' + t.correct + ' correct</span>' +
            '<span class="pq-stat"><span class="pq-dot pq-dot-wrong"></span>' + t.wrong + ' wrong</span>' +
            '<span class="pq-stat pq-stat-count">' + t.answered + ' of ' + t.total + ' answered</span>';
        PQ_LEVEL_INFO.forEach(info => {
            const st = pqLevels[info.n];
            const el = $('pqLevelCount' + info.n);
            if (st && el) el.textContent = st.answered + ' / ' + st.total + ' answered';
        });
    }

    function pqAnswer(el, correctLabel) {
        const card = el.closest('.pq-question');
        if (!card || card.dataset.answered === '1') return;
        card.dataset.answered = '1';

        const level = parseInt(card.dataset.level, 10);
        const st = pqLevels[level];
        const correct = el.dataset.label === correctLabel;
        st.answered++;
        if (correct) st.correct++; else st.wrong++;

        card.querySelectorAll('.quiz-option').forEach(opt => {
            opt.onclick = null;
            if (opt.dataset.label === correctLabel) opt.classList.add('correct');
            else if (opt === el) opt.classList.add('incorrect');
        });

        const explanation = card.dataset.explanation;
        const box = card.querySelector('.pq-explain');
        const msg = correct ? 'Correct! +' + POINTS_PER_CORRECT + ' pts' : 'Not quite — correct answer: ' + correctLabel;
        box.classList.add('show');
        box.innerHTML = '<strong style="color: ' + (correct ? 'var(--success)' : 'var(--danger)') + ';">' + msg + '</strong>' +
            (explanation ? '<p style="margin-top: 8px;">' + escapeHtml(explanation) + '</p>' : '') +
            explainVoiceActionsHtml();
        autoSpeak(msg + '. ' + (explanation || ''));

        if (correct) awardProgress(POINTS_PER_CORRECT, false);
        pqUpdateStats();
        if (st.answered === st.total) pqFinishLevel(level);
    }

    // Question numbers covered by a level, e.g. Level 2 = 11 to 20
    function pqRange(level) {
        const start = Object.keys(pqLevels).filter(k => +k < level).reduce((sum, k) => sum + pqLevels[k].total, 0) + 1;
        return { start: start, end: start + pqLevels[level].total - 1 };
    }

    function pqLevelBreakdown() {
        return Object.keys(pqLevels).map(k => 'Level ' + k + ': ' + pqLevels[k].correct + ' / ' + pqLevels[k].total).join(' · ');
    }

    // Shows one level at a time
    function pqGoToLevel(n) {
        document.querySelectorAll('.pq-level').forEach(s => s.classList.toggle('hidden', s.id !== 'pqLevel' + n));
        const sec = $('pqLevel' + n);
        if (sec) sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    function pqFinishLevel(level) {
        const st = pqLevels[level];
        const info = PQ_LEVEL_INFO[level - 1];
        const points = st.correct * POINTS_PER_CORRECT;
        const range = pqRange(level);
        const next = PQ_LEVEL_INFO.find(l => l.n > level && pqLevels[l.n]);

        let html = '<strong>Level ' + level + ' results (Questions ' + range.start + ' to ' + range.end + ')</strong>' +
            '<p style="margin: 6px 0 0;">' + st.correct + ' correct, ' + st.wrong + ' wrong, ' + points + ' points</p>';
        if (next) {
            const nr = pqRange(next.n);
            html += '<div style="margin-top: 12px;"><button class="theory-btn theory-btn-primary" onclick="pqGoToLevel(' + next.n + ')">' +
                'Continue to Level ' + next.n + ' (Questions ' + nr.start + ' to ' + nr.end + ')</button></div>';
        }
        const res = $('pqLevelResult' + level);
        res.classList.remove('hidden');
        res.innerHTML = html;

        awardProgress(0, true);
        recordQuizResult({ subject: pqMeta.subject, topic: pqMeta.exam + ' Past Questions — ' + info.label, score: st.correct, total: st.total, kind: 'past-question' });
        bumpDailyGoal();
        addNotification(info.label + ' complete', pqMeta.subject + ': ' + st.correct + ' / ' + st.total);

        res.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (Object.values(pqLevels).every(l => l.answered === l.total)) pqShowFinal();
    }

    function pqShowFinal() {
        const t = pqTotals();
        const box = $('pqFinal');
        box.classList.remove('hidden');
        box.innerHTML =
            '<div class="arena-result">' +
                '<div class="arena-result-score">' + t.correct + ' / ' + t.total + '</div>' +
                '<h3>Total results</h3>' + '<p class="arena-result-sub">' + pqLevelBreakdown() + '</p>' +
                '<p class="arena-result-sub">' + escapeHtml(pqMeta.exam + ' · ' + pqMeta.subject) + '</p>' +
                '<p class="arena-result-points">' + t.correct + ' correct, ' + t.wrong + ' wrong, ' + (t.correct * POINTS_PER_CORRECT) + ' points earned</p>' +
                '<div class="theory-actions" style="justify-content:center;">' +
                    '<button class="theory-btn theory-btn-primary" onclick="generatePastQuestions(this)">Retake</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="switchPage(\'leaderboard\')">Leaderboard</button>' +
                    '<button class="theory-btn theory-btn-secondary" onclick="switchPage(\'dashboard\')">Dashboard</button>' +
                '</div>' +
            '</div>';
        box.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    function speakPqCard(btn) {
        const card = btn.closest('.pq-question');
        if (!card) return;
        const options = Array.from(card.querySelectorAll('.quiz-option')).map(o => o.innerText.replace(/\s+/g, ' ').trim()).join('. ');
        autoSpeak(card.dataset.question + '. ' + options);
    }

    // ============================================================
    //  THEORY: each card opens and closes on its own
    // ============================================================
    function theoryToggleCard(i) {
        const q = theoryAll[i];
        const card = $('theoryCard' + i);
        if (!q || !card) return;
        q.expanded = !q.expanded;
        card.classList.toggle('expanded', q.expanded);
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
            chatInputEl.addEventListener('input', () => { autoGrowChatInput(chatInputEl); updateChatCounter(); });
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
