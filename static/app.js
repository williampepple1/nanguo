const API = "";

function getToken() {
  return localStorage.getItem("nanguo_token");
}

function setToken(t) {
  localStorage.setItem("nanguo_token", t);
}

async function api(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) {
    localStorage.removeItem("nanguo_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || "Request failed");
  return data;
}

// ── App state ──
let tasks = [];
let agentOnline = false;

// ── DOM ──
const cmdInput = document.getElementById("command-input");
const sendBtn = document.getElementById("send-btn");
const formError = document.getElementById("form-error");
const agentBadge = document.getElementById("agent-badge");
const tasksContainer = document.getElementById("tasks-container");

// ── Agent status polling ──
async function checkAgent() {
  try {
    const data = await api("GET", "/api/agent/status");
    agentOnline = data.connected;
    updateAgentBadge();
  } catch (e) {
    agentOnline = false;
    updateAgentBadge();
  }
}

function updateAgentBadge() {
  agentBadge.textContent = agentOnline ? "agent online" : "agent offline";
  agentBadge.className = "badge " + (agentOnline ? "online" : "offline");
  sendBtn.disabled = !agentOnline || !cmdInput.value.trim();
}

// ── Render tasks ──
function renderTasks() {
  if (tasks.length === 0) {
    tasksContainer.innerHTML = '<p class="empty-state">No tasks yet</p>';
    return;
  }
  tasksContainer.innerHTML = tasks.map(t => {
    const statusClass = "status-" + t.status;
    let statusLabel = t.status;
    if (t.status === "running") statusLabel = '<span class="spinner"></span> running';
    let resultHtml = "";
    let progressHtml = "";
    if (t.result) {
      resultHtml = `<div class="result">${escapeHtml(t.result)}</div>`;
    }
    if (t.progress && t.status === "running") {
      try {
        const prog = JSON.parse(t.progress);
        progressHtml = `<div class="progress-text">${escapeHtml(prog.tool || prog.status || "")}</div>`;
      } catch(e) {}
    }
    return `
      <div class="task-card" data-id="${t.id}">
        <div class="cmd">${escapeHtml(t.command)}</div>
        <div class="meta">
          <span class="${statusClass}">${statusLabel}</span>
          <span>${timeAgo(t.created_at)}</span>
        </div>
        ${progressHtml}
        ${resultHtml}
      </div>
    `;
  }).join("");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function timeAgo(iso) {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Load tasks ──
async function loadTasks() {
  try {
    const data = await api("GET", "/api/tasks");
    tasks = data.tasks;
    renderTasks();
  } catch (e) {
    console.error("Failed to load tasks", e);
  }
}

// ── Send task ──
async function sendTask() {
  const command = cmdInput.value.trim();
  if (!command) return;
  formError.classList.add("hidden");
  sendBtn.disabled = true;
  try {
    const data = await api("POST", "/api/tasks", { command });
    cmdInput.value = "";
    sendBtn.disabled = false;
    loadTasks();
  } catch (e) {
    formError.textContent = e.message;
    formError.classList.remove("hidden");
    sendBtn.disabled = false;
  }
}

// ── WebSocket for real-time updates ──
function connectDashboardWS() {
  const token = getToken();
  if (!token) return;
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${proto}//${location.host}/ws/dashboard?token=${token}`;
  let ws;
  function connect() {
    ws = new WebSocket(wsUrl);
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "task_update") {
        const t = msg.task;
        const idx = tasks.findIndex(x => x.id === t.id);
        if (idx >= 0) {
          tasks[idx] = t;
        } else {
          tasks.unshift(t);
        }
        renderTasks();
      }
    };
    ws.onclose = () => setTimeout(connect, 3000);
    ws.onerror = () => ws.close();
  }
  connect();
}

// ── Init ──
cmdInput.addEventListener("input", () => {
  sendBtn.disabled = !agentOnline || !cmdInput.value.trim();
});
sendBtn.addEventListener("click", sendTask);
cmdInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendTask(); }
});
document.getElementById("logout-btn").addEventListener("click", () => {
  localStorage.removeItem("nanguo_token");
  window.location.href = "/login";
});

if (!getToken()) {
  window.location.href = "/login";
} else {
  checkAgent();
  loadTasks();
  connectDashboardWS();
  setInterval(checkAgent, 10000); // Poll agent status every 10s
}
