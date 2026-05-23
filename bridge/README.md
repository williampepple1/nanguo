# Bridge Integration Instructions

## What this adds
The bridge adds **remote control** capability to the DeepSeek Browser Agent Chrome extension. Once integrated, you can send tasks from your phone (via the Nanguo web dashboard) to the extension running on your PC.

## Files to copy into the extension repo

Copy these files into the existing `deepseek-browser-agent` repo:

```
bridge/ws-client.js  →  deepseek-browser-agent/src/bridge/ws-client.js
```

## Modifications needed

### 1. manifest.json — add `alarms` permission

```json
"permissions": ["activeTab", "scripting", "storage", "sidePanel", "tabs", "alarms"],
```

Also update the version to `"1.1.0"`.

### 2. service-worker.js — add import + init at end of file

Add this import at the top (after the existing imports):
```js
import { initWebSocketBridge } from '../bridge/ws-client.js';
```

Add this at the very end of the file (after the `chrome.runtime.onConnect` listener):
```js
// Initialize remote control bridge
initWebSocketBridge(runAgentTask);
```

### 3. sidebar.html — add backend URL setting (optional)

Add a new input field in the settings screen for the backend URL so users can configure which server the agent connects to. This is stored in `chrome.storage.sync` under key `backendUrl`.

## How it works

```
Phone browser                 Backend (FastAPI)              Chrome Extension
   │                              │                              │
   │ POST /api/tasks              │                              │
   ├─────────────────────────────►│                              │
   │                              │ WS: {type:"run_task", ...}   │
   │                              ├─────────────────────────────►│
   │                              │                              │ runs agent loop
   │                              │                              │ calls DeepSeek API
   │                              │                              │ controls browser tab
   │                              │ WS: {type:"progress", ...}   │
   │                              │◄─────────────────────────────┤
   │                              │ WS: {type:"result", ...}     │
   │                              │◄─────────────────────────────┤
   │ WS dashboard update         │                              │
   │◄─────────────────────────────┤                              │
```

## Settings in chrome.storage.sync

| Key | Default | Description |
|---|---|---|
| `backendUrl` | `ws://localhost:8000/ws/agent` | WebSocket URL of Nanguo backend |
| `agentAuthToken` | (empty) | Optional auth token |

## Running the full system

1. Start backend:
```bash
cd nanguo
pip install -r backend/requirements.txt
python -m backend.main
```

2. Expose with ngrok (for phone access):
```bash
ngrok http 8000
```

3. Load the Chrome extension:
   - Go to `chrome://extensions`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `deepseek-browser-agent` folder

4. Open the dashboard on your phone:
```
https://your-ngrok-url.ngrok-free.app
```

5. Login → create a task → the agent executes it on your PC
