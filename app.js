// ⚠️ IMPORTANT: REPLACE THIS WITH YOUR ACTUAL RENDER BACKEND URL
const API_URL = "https://zith-backend.onrender.com";
let currentUser = null;

// --- AUTHENTICATION FUNCTIONS ---
function showLogin() {
    document.getElementById('loginModal').style.display = 'flex';
    document.getElementById('signupModal').style.display = 'none';
}

function showSignup() {
    document.getElementById('signupModal').style.display = 'flex';
    document.getElementById('loginModal').style.display = 'none';
}

function closeModals() {
    document.querySelectorAll('.auth-modal').forEach(m => m.style.display = 'none');
}

async function apiCall(endpoint, data) {
    try {
        const res = await fetch(API_URL + endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        return await res.json();
    } catch (err) {
        console.error("API Error:", err);
        return { error: "Connection failed" };
    }
}

async function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    const res = await apiCall('/api/login', { email, password });
    
    if (res.status === 'success') {
        currentUser = res.user;
        showDashboard();
    } else {
        alert(res.detail || 'Login failed');
    }
}

async function signup() {
    const username = document.getElementById('signupUsername').value;
    const email = document.getElementById('signupEmail').value;
    const password = document.getElementById('signupPassword').value;
    const res = await apiCall('/api/register', { username, email, password });
    
    if (res.status === 'success') {
        alert('Account created! Please login.');
        showLogin();
    } else {
        alert(res.detail || 'Signup failed');
    }
}

function showDashboard() {
    document.getElementById('landingPage').style.display = 'none';
    document.getElementById('dashboardPage').style.display = 'block';
    document.getElementById('userNameDisplay').textContent = currentUser.username;
    document.getElementById('welcomeName').textContent = currentUser.username;
    document.getElementById('statScore').textContent = currentUser.total_score || 0;
    document.getElementById('statQuizzes').textContent = currentUser.quizzes_taken || 0;
    document.getElementById('statStreak').textContent = currentUser.streak || 0;
    document.getElementById('profileUsername').textContent = currentUser.username;
    document.getElementById('profileEmail').textContent = currentUser.email;
    document.getElementById('profileScore').textContent = currentUser.total_score || 0;
    loadLeaderboard();
}

function logout() {
    currentUser = null;
    document.getElementById('dashboardPage').style.display = 'none';
    document.getElementById('landingPage').style.display = 'block';
}

function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
    document.getElementById(sectionId).classList.add('active');
    document.querySelectorAll('.sidebar button').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    if (sectionId === 'leaderboard') loadLeaderboard();
}

// --- FEATURE FUNCTIONS ---
async function generateTextbook() {
    const level = document.getElementById('tbLevel').value;
    const subject = document.getElementById('tbSubject').value;
    const topic = document.getElementById('tbTopic').value;
    const btn = event.target;
    btn.textContent = 'Generating...';
    
    const res = await apiCall('/api/textbook', { level, subject, topic });
    btn.textContent = 'Generate 📚';
    
    if (res.note) {
        document.getElementById('tbContent').innerHTML = res.note.replace(/\n/g, '<br>');
        document.getElementById('tbResult').classList.remove('hidden');
    } else {
        alert('Failed to generate textbook');
    }
}

async function sendChat() {
    const input = document.getElementById('chatInput');
    const box = document.getElementById('chatBox');
    const message = input.value;
    if (!message) return;
    
    box.innerHTML += `<div class="message user-message">${message}</div>`;
    input.value = '';
    
    const res = await apiCall('/api/chat', { prompt: message });
    box.innerHTML += `<div class="message ai-message">${res.response || 'Error'}</div>`;
    box.scrollTop = box.scrollHeight;
}

async function generatePastQuestions() {
    const exam = document.getElementById('pqExam').value;
    const year = document.getElementById('pqYear').value;
    const subject = document.getElementById('pqSubject').value;
    const btn = event.target;
    btn.textContent = 'Generating...';
    
    const res = await apiCall('/api/past-questions', { exam, year, subject, q_type: 'Objective' });
    btn.textContent = 'Generate Questions';
    
    if (res.questions) {
        let html = '<h3>Questions:</h3>';
        res.questions.forEach((q, i) => {
            html += `<div style="margin: 15px 0; padding: 15px; background: #f9f9f9; border-radius: 8px;">
                <p><strong>Q${i+1}:</strong> ${q.q}</p>
                <p><strong>Answer:</strong> ${q.answer}</p>
                <p><em>${q.explanation}</em></p>
            </div>`;
        });
        document.getElementById('pqResult').innerHTML = html;
        document.getElementById('pqResult').classList.remove('hidden');
    } else {
        alert('Failed to generate questions');
    }
}

async function webSearch() {
    const query = document.getElementById('searchQuery').value;
    const res = await apiCall('/api/search', { query });
    if (res.results) {
        document.getElementById('searchResult').innerHTML = res.results.replace(/\n/g, '<br>');
        document.getElementById('searchResult').classList.remove('hidden');
    }
}

async function loadLeaderboard() {
    const tbody = document.getElementById('leaderboardBody');
    tbody.innerHTML = `
        <tr><td>1</td><td>${currentUser?.username || 'You'}</td><td>${currentUser?.total_score || 0}</td><td>${currentUser?.streak || 0}</td></tr>
        <tr><td>2</td><td>Student A</td><td>150</td><td>5</td></tr>
        <tr><td>3</td><td>Student B</td><td>120</td><td>3</td></tr>
    `;
}

// Close modals when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('auth-modal')) {
        closeModals();
    }
}
