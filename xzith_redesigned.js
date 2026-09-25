// ============================================================
// X-ZITH LEARNING HUB - COMPLETE JAVASCRIPT
// All features: Dashboard, Textbook, Past Questions, Chat, Search
// ============================================================

const API_BASE = 'https://x-zith-backend.onrender.com';

// DATA STRUCTURE
let appState = {
  currentTab: 'dashboard',
  currentLevel: 'JSS',
  currentExam: 'WAEC',
  currentSubject: null,
  uploadedImage: null,
  chatHistory: [],
  currentQuizQuestions: [],
  currentQuizIndex: 0,
  currentNotes: null,
  subjectIcons: {
    'Mathematics': '🧮',
    'Physics': '⚛️',
    'Chemistry': '🧪',
    'Biology': '🔬',
    'English Language': '📚',
    'Literature': '📖',
    'History': '🏛️',
    'Government': '⚖️',
    'Agricultural Science': '🌾',
    'Economics': '💹',
    'Geography': '🌍',
    'Civic Education': '🏘️'
  },
  subjects: {
    JSS: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English Language', 'History', 'Government', 'Agricultural Science'],
    SSS: ['Mathematics', 'Physics', 'Chemistry', 'Biology', 'English Language', 'Literature', 'History', 'Government']
  }
};

// ============================================================
// INITIALIZATION
// ============================================================
document.addEventListener('DOMContentLoaded', function() {
  console.log('✅ X-ZITH Learning Hub loaded');
  initializeDashboard();
  initializeTextbook();
  loadAvailableData();
});

// ============================================================
// UI CONTROLS
// ============================================================
function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  sidebar.classList.toggle('open');
}

function selectTab(tabName) {
  appState.currentTab = tabName;
  
  // Hide all tab contents
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Show selected tab
  document.getElementById(tabName).classList.add('active');
  
  // Update sidebar menu
  document.querySelectorAll('.menu-item').forEach(item => {
    item.classList.remove('active');
  });
  event.target.classList.add('active');
  
  // Close sidebar on mobile
  if (window.innerWidth < 1024) {
    document.getElementById('sidebar').classList.remove('open');
  }

  if (tabName === 'past-questions') {
    loadPastQuestions();
  }
}

function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  document.getElementById(tabName).classList.add('active');
  
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
}

// ============================================================
// DASHBOARD
// ============================================================
function initializeDashboard() {
  // Recent quizzes and study history are static for now
  console.log('Dashboard initialized');
}

// ============================================================
// TEXTBOOK / LEARN SECTION
// ============================================================
function initializeTextbook() {
  renderSubjectsGrid();
}

function selectLevel(level) {
  appState.currentLevel = level;
  
  // Update buttons
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  renderSubjectsGrid();
}

function renderSubjectsGrid() {
  const grid = document.getElementById('subjectsGrid');
  const subjects = appState.subjects[appState.currentLevel];
  
  grid.innerHTML = subjects.map(subject => `
    <div class="subject-card">
      <div class="subject-icon">${appState.subjectIcons[subject] || '📚'}</div>
      <div class="subject-name">${subject}</div>
      <div class="subject-buttons">
        <button class="btn-learn" onclick="openAddTopicModal('${subject}')">Learn</button>
        <button class="btn-quiz-small" onclick="generateQuizQuestions('${subject}')">Quiz</button>
      </div>
    </div>
  `).join('');
}

function openAddTopicModal(subject) {
  appState.currentSubject = subject;
  document.getElementById('topicSubject').value = subject;
  document.getElementById('topicModal').classList.add('active');
}

function closeModal(modalId) {
  document.getElementById(modalId).classList.remove('active');
}

function generateNotes(event) {
  event.preventDefault();
  
  const title = document.getElementById('topicTitle').value;
  const subtopics = document.getElementById('topicSubtopics').value;
  
  // Call Gemini to generate notes
  callGemini(`Generate detailed study notes for ${title} in ${appState.currentSubject}. ${subtopics ? 'Cover these points: ' + subtopics : ''}`, (notes) => {
    displayNotes(title, notes);
    closeModal('topicModal');
    document.getElementById('topicTitle').value = '';
    document.getElementById('topicSubtopics').value = '';
  });
}

function displayNotes(title, content) {
  const notesHtml = `
    <div class="notes-container">
      <div class="notes-header">
        <h3>${title} - ${appState.currentSubject}</h3>
      </div>
      <div class="notes-content">
        ${formatNotes(content)}
      </div>
      <button class="btn-take-quiz" onclick="generateQuizQuestions('${appState.currentSubject}')">Take Quiz (5 Questions) 📝</button>
    </div>
  `;
  
  // Insert notes before the subjects grid
  const grid = document.getElementById('subjectsGrid');
  grid.parentElement.insertBefore(
    (new DOMParser()).parseFromString(notesHtml, 'text/html').body.firstChild,
    grid
  );
  
  appState.currentNotes = content;
}

function formatNotes(text) {
  return text
    .split('\n')
    .map(line => {
      if (line.match(/^#+\s/)) {
        const level = line.match(/^#+/)[0].length;
        return `<h${Math.min(level + 2, 6)}>${line.replace(/^#+\s/, '')}</h${Math.min(level + 2, 6)}>`;
      }
      if (line.match(/^[-•*]\s/)) {
        return `<li>${line.replace(/^[-•*]\s/, '')}</li>`;
      }
      return line ? `<p>${line}</p>` : '';
    })
    .join('');
}

function generateQuizQuestions(subject) {
  callGemini(`Generate exactly 5 multiple choice questions for ${subject} at ${appState.currentLevel} level. Format as JSON: [{"question": "...", "options": ["A) ...", "B) ...", "C) ...", "D) ..."], "correct": 0}]`, (response) => {
    try {
      const questions = JSON.parse(response);
      appState.currentQuizQuestions = questions;
      appState.currentQuizIndex = 0;
      displayQuizMode();
    } catch (e) {
      alert('Error generating questions. Try again.');
      console.error(e);
    }
  });
}

function displayQuizMode() {
  const tabContent = `
    <div class="quiz-container" id="quizContainer">
      <!-- Quiz will be rendered here -->
    </div>
  `;
  
  const textbookTab = document.getElementById('textbook');
  textbookTab.innerHTML = tabContent;
  
  displayCurrentQuestion();
}

function displayCurrentQuestion() {
  const currentQ = appState.currentQuizQuestions[appState.currentQuizIndex];
  const container = document.getElementById('quizContainer');
  
  const progress = ((appState.currentQuizIndex + 1) / appState.currentQuizQuestions.length) * 100;
  
  const html = `
    <div class="quiz-progress">
      <span>Q${appState.currentQuizIndex + 1} of ${appState.currentQuizQuestions.length}</span>
      <div class="progress-bar">
        <div class="progress-fill" style="width: ${progress}%"></div>
      </div>
    </div>
    
    <div class="quiz-question">
      <div class="question-text">${currentQ.question}</div>
      
      <div class="options">
        ${currentQ.options.map((option, index) => `
          <div class="option" onclick="selectAnswer(${index})" id="option-${index}">
            ${option}
          </div>
        `).join('')}
      </div>
    </div>
    
    <div class="quiz-buttons">
      <button class="btn-next" ${appState.currentQuizIndex === 0 ? 'disabled' : ''} onclick="previousQuestion()">← Previous</button>
      <button class="btn-next" onclick="nextQuestion()">Next →</button>
    </div>
  `;
  
  container.innerHTML = html;
}

let selectedAnswer = null;

function selectAnswer(index) {
  selectedAnswer = index;
  document.querySelectorAll('.option').forEach(opt => {
    opt.classList.remove('selected', 'correct', 'wrong');
  });
  
  const option = document.getElementById(`option-${index}`);
  const currentQ = appState.currentQuizQuestions[appState.currentQuizIndex];
  
  if (index === currentQ.correct) {
    option.classList.add('correct');
  } else {
    option.classList.add('wrong');
  }
  
  // Show explanation
  const explanation = currentQ.explanation || 'Good question!';
  option.innerHTML += `<div class="explanation-box"><strong>Explanation:</strong><p>${explanation}</p></div>`;
}

function nextQuestion() {
  if (appState.currentQuizIndex < appState.currentQuizQuestions.length - 1) {
    appState.currentQuizIndex++;
    selectedAnswer = null;
    displayCurrentQuestion();
  } else {
    showQuizResults();
  }
}

function previousQuestion() {
  if (appState.currentQuizIndex > 0) {
    appState.currentQuizIndex--;
    selectedAnswer = null;
    displayCurrentQuestion();
  }
}

function showQuizResults() {
  const container = document.getElementById('quizContainer');
  const correct = appState.currentQuizQuestions.filter((q, i) => selectedAnswer === q.correct).length;
  const score = (correct / appState.currentQuizQuestions.length) * 100;
  
  container.innerHTML = `
    <div style="text-align: center; padding: 40px;">
      <h2>Quiz Complete! 🎉</h2>
      <div style="font-size: 48px; color: #3b82f6; margin: 20px 0;">${score.toFixed(0)}%</div>
      <p style="font-size: 18px; margin-bottom: 20px;">You got ${correct} out of ${appState.currentQuizQuestions.length} correct</p>
      <button class="btn-primary" onclick="selectLevel('${appState.currentLevel}')" style="width: 200px;">Back to Subjects</button>
    </div>
  `;
}

// ============================================================
// PAST QUESTIONS
// ============================================================
async function loadAvailableData() {
  try {
    const response = await fetch(`${API_BASE}/api/available`);
    const data = await response.json();
    console.log('Available exams:', data);
  } catch (e) {
    console.error('Error loading data:', e);
  }
}

function selectExam(exam) {
  appState.currentExam = exam;
  appState.currentSubject = null;
  
  document.querySelectorAll('.exam-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  loadPastQuestions();
}

async function loadPastQuestions() {
  const subjects = appState.subjects[appState.currentLevel];
  const subjectsList = document.getElementById('pastSubjectsList');
  
  subjectsList.innerHTML = subjects.map(subject => `
    <button class="subject-btn" onclick="loadSubjectQuestions('${subject}')">
      ${subject}
    </button>
  `).join('');
}

async function loadSubjectQuestions(subject) {
  appState.currentSubject = subject;
  
  // Update active subject button
  document.querySelectorAll('.subject-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  event.target.classList.add('active');
  
  try {
    const response = await fetch(`${API_BASE}/api/questions/${appState.currentExam}/${subject}`);
    const data = await response.json();
    
    if (data.success && data.questions) {
      displayPastQuestions(data.questions, subject);
    }
  } catch (e) {
    console.error('Error loading questions:', e);
    document.getElementById('pastQuestionsDisplay').innerHTML = '<p class="error">Failed to load questions</p>';
  }
}

function displayPastQuestions(questions, subject) {
  const display = document.getElementById('pastQuestionsDisplay');
  
  display.innerHTML = questions.map((q, index) => `
    <div class="question-item">
      <div class="question-num">Question ${index + 1} - ${subject}</div>
      <div class="question-item-text">${q.question || q.text}</div>
      <div class="question-item-options">
        ${(q.options || []).map((option, i) => {
          const letter = String.fromCharCode(65 + i);
          return `
            <div class="option-item" id="opt-${index}-${i}">
              ${letter}) ${option}
            </div>
          `;
        }).join('')}
      </div>
      <button class="btn-get-explanation" onclick="getQuestionExplanation('${index}', '${q.question || q.text}', '${subject}')">
        Get Explanation 💡
      </button>
      <div id="explanation-${index}"></div>
    </div>
  `).join('');
}

function getQuestionExplanation(index, question, subject) {
  const explanationDiv = document.getElementById(`explanation-${index}`);
  explanationDiv.innerHTML = '<div class="loading">🤖 Gemini is thinking...</div>';
  
  callGemini(`Explain this ${subject} question and provide the correct answer: ${question}`, (explanation) => {
    explanationDiv.innerHTML = `
      <div class="explanation-display">
        <strong>✅ Explanation:</strong><br>${explanation}
      </div>
    `;
  });
}

// ============================================================
// AI CHAT
// ============================================================
async function sendChat() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  
  if (!message) return;
  
  // Display user message
  const chatBox = document.getElementById('chatBox');
  const userMsg = document.createElement('div');
  userMsg.className = 'chat-message user';
  userMsg.innerHTML = `<div class="message-content user">${escapeHtml(message)}</div>`;
  chatBox.appendChild(userMsg);
  
  input.value = '';
  chatBox.scrollTop = chatBox.scrollHeight;
  
  // Get AI response
  const botMsg = document.createElement('div');
  botMsg.className = 'chat-message';
  botMsg.innerHTML = `<div class="message-content bot">🔄 Thinking...</div>`;
  chatBox.appendChild(botMsg);
  
  callGemini(message, (response) => {
    botMsg.innerHTML = `
      <div class="message-content bot">
        ${response}
        <div class="message-actions">
          <button class="action-btn" onclick="speakMessage('${escapeHtml(response)}')">🔊</button>
          <button class="action-btn" onclick="copyMessage('${escapeHtml(response)}')">📋</button>
          <button class="action-btn" onclick="likeMessage(this)">👍</button>
          <button class="action-btn" onclick="dislikeMessage(this)">👎</button>
        </div>
      </div>
    `;
  });
}

function uploadImage() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = (e) => {
    const file = e.target.files[0];
    const reader = new FileReader();
    reader.onload = (event) => {
      appState.uploadedImage = event.target.result;
      const preview = document.getElementById('uploadedImagePreview');
      preview.innerHTML = `
        <div style="position: relative; display: inline-block;">
          <img src="${appState.uploadedImage}" class="uploaded-image" />
          <button class="image-remove" onclick="removeImage()">✕</button>
        </div>
      `;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function uploadFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = (e) => {
    const file = e.target.files[0];
    console.log('File selected:', file.name);
    // Handle file upload
  };
  input.click();
}

function removeImage() {
  appState.uploadedImage = null;
  document.getElementById('uploadedImagePreview').innerHTML = '';
}

function speakMessage(text) {
  if ('speechSynthesis' in window) {
    const utterance = new SpeechSynthesisUtterance(text);
    speechSynthesis.speak(utterance);
  }
}

function copyMessage(text) {
  navigator.clipboard.writeText(text);
  alert('Copied to clipboard!');
}

function likeMessage(button) {
  button.innerHTML = '❤️';
}

function dislikeMessage(button) {
  button.innerHTML = '😞';
}

// ============================================================
// SMART SEARCH
// ============================================================
let currentSearchFilter = 'all';

function setSearchFilter(filter) {
  currentSearchFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.classList.remove('active');
  });
  event.target.classList.add('active');
}

async function performSearch() {
  const query = document.getElementById('searchInput').value.trim();
  if (!query) return;
  
  const resultsDiv = document.getElementById('searchResults');
  resultsDiv.innerHTML = '<div class="loading">🔍 Searching...</div>';
  
  // Get web search results
  try {
    const response = await fetch(`${API_BASE}/api/search?q=${encodeURIComponent(query)}`);
    const data = await response.json();
    
    let html = '';
    
    // Web results
    if (data.results && data.results.length > 0) {
      html += `
        <div class="search-result-tab">
          <h3>🌐 Web Results</h3>
          <div class="search-items">
            ${data.results.slice(0, 5).map(result => `
              <div class="search-item">
                <h4>${result.title}</h4>
                <a href="${result.link}" target="_blank">Visit →</a>
                <p>${result.snippet || 'No preview available'}</p>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }
    
    // YouTube videos
    html += `
      <div class="search-result-tab">
        <h3>🎥 YouTube Videos</h3>
        <div class="search-items">
          <div class="search-item">
            <h4>Search YouTube for "${query}"</h4>
            <a href="https://www.youtube.com/results?search_query=${encodeURIComponent(query)}" target="_blank">Find Videos →</a>
            <p>Watch video lessons and tutorials related to your search</p>
          </div>
        </div>
      </div>
    `;
    
    resultsDiv.innerHTML = html;
  } catch (e) {
    resultsDiv.innerHTML = '<div class="error">Error performing search. Try again.</div>';
    console.error(e);
  }
}

// ============================================================
// API CALLS
// ============================================================
async function callGemini(prompt, callback) {
  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: prompt })
    });
    
    const data = await response.json();
    
    if (data.success) {
      callback(data.response || data.answer);
    } else {
      callback('Sorry, I encountered an error. Please try again.');
      console.error('API error:', data);
    }
  } catch (e) {
    callback('Network error. Please check your connection.');
    console.error(e);
  }
}

// ============================================================
// UTILITIES
// ============================================================
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Auto-adjust textarea height
document.addEventListener('input', function(e) {
  if (e.target.id === 'chatInput') {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px';
  }
});

// Close sidebar when clicking outside
document.addEventListener('click', function(e) {
  const sidebar = document.getElementById('sidebar');
  const menuBtn = document.querySelector('.icon-btn');
  
  if (!sidebar.contains(e.target) && !e.target.closest('.icon-btn')) {
    sidebar.classList.remove('open');
  }
});

console.log('✅ All JavaScript loaded successfully');
