# Nanguo

Remote-controlled browser agent — send tasks from your phone and have them executed on your PC's browser via AI.

## Architecture

```
┌──────────────────┐     HTTPS      ┌──────────────────┐     WebSocket     ┌───────────────────────┐
│  Phone / Mobile  │ ──────────────►│  Nanguo Backend  │ ◄───────────────►│  Chrome Extension (PC) │
│  Dashboard        │   (ngrok)      │  FastAPI :8000   │                  │  DeepSeek Agent        │
└──────────────────┘                └────────┬─────────┘                  └───────────┬───────────┘
                                             │                                        │
                                             │  WebSocket                             │  HTTPS
                                             ▼                                        ▼
                                    ┌──────────────────┐                  ┌───────────────────────┐
                                    │  Dashboard (live) │                  │  api.deepseek.com     │
                                    └──────────────────┘                  └───────────────────────┘
```

| Component | Tech | Role |
|---|---|---|
| **Backend** | FastAPI + SQLite + WebSocket | Auth, task queue, relays commands and results |
| **Dashboard** | Vanilla HTML/CSS/JS (mobile-first) | Login, create tasks, see live results |
| **Browser Agent** | Chrome Extension (MV3) + DeepSeek API | Receives tasks, controls browser, returns results |
| **Tunnel** | ngrok | Exposes local backend to phone over HTTPS |

## Flow

1. You open the dashboard on your phone and type a task (e.g. *"Open Hacker News and upvote the top post"*)
2. Backend pushes the task to the Chrome extension via WebSocket
3. The extension's agent loop:
   - Reads the current page
   - Sends it to DeepSeek with tool definitions (click, type, scroll, navigate, etc.)
   - DeepSeek returns a tool call → extension executes it in the browser
   - Updated page is fed back → loops until task completes
4. Progress and final result stream back to your phone in real time

## Setup

### 1. Backend

```bash
cd nanguo
pip install -r backend/requirements.txt
python -m backend.main
# or: start.bat
```

Server runs on `http://localhost:8000`.

### 2. Expose with ngrok

```bash
ngrok http 8000
```

Copy the `https://xxx.ngrok-free.app` URL — this is your phone access point.

### 3. Chrome Extension

The extension lives in a separate repo (`deepseek-browser-agent`). It is already modified with a WebSocket bridge to connect to the backend.

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked** → select the `deepseek-browser-agent` folder
4. Open the extension side panel, click the gear icon, set your DeepSeek API key
5. The extension auto-connects to `ws://localhost:8000/ws/agent`

To configure a different backend URL, set the `backendUrl` key in extension storage (via the sidebar settings screen after the optional UI update in `bridge/README.md`).

### 4. Use it

1. Open the ngrok URL on your phone → `/login`
2. Register an account, then log in
3. Type a task and hit **Send**
4. Watch the agent execute it on your PC in real time

## Project structure

```
nanguo/
├── backend/
│   ├── main.py          # FastAPI app: REST + WebSocket endpoints
│   ├── auth.py           # JWT + pbkdf2 password hashing
│   ├── models.py         # SQLAlchemy: User, Task
│   ├── database.py       # SQLite connection
│   ├── ws_manager.py     # WebSocket connection manager
│   └── requirements.txt
├── static/
│   ├── index.html        # Dashboard (mobile-first)
│   ├── login.html        # Login/register page
│   ├── app.js            # Dashboard logic + WebSocket updates
│   ├── auth.js           # Auth form logic
│   └── style.css         # Dark theme styles
├── bridge/
│   ├── ws-client.js      # WebSocket bridge for Chrome extension
│   └── README.md         # Integration instructions
├── start.bat             # Windows launcher
├── .env.example
└── .gitignore
```

## API endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/api/auth/register` | No | Create account |
| `POST` | `/api/auth/login` | No | Get JWT token |
| `POST` | `/api/tasks` | Yes | Create task (requires agent online) |
| `GET` | `/api/tasks` | Yes | List user's tasks |
| `GET` | `/api/tasks/{id}` | Yes | Get task details |
| `GET` | `/api/agent/status` | Yes | Check if agent is connected |
| `WS` | `/ws/agent` | No | Agent connection |
| `WS` | `/ws/dashboard?token=` | Token param | Dashboard live updates |

## Security

- Passwords hashed with PBKDF2-SHA256 (600k iterations)
- JWT tokens for all API access (30-day expiry)
- Agent WebSocket requires no auth by default — set `agentAuthToken` in extension storage and restart if you want to restrict it
- ngrok exposes your local server; anyone with the URL can reach it. Set a strong password.
