// WebSocket bridge: connects Chrome extension to Nanguo backend
// This file runs inside the service worker and adds remote control capability.
// Place in: src/bridge/ws-client.js

const DEFAULT_BACKEND = 'ws://localhost:8000/ws/agent';
let ws = null;
let reconnectTimer = null;
let currentTaskId = null;
let taskAborted = false;

export function initWebSocketBridge(runAgentTask) {
  connect();

  function connect() {
    chrome.storage.sync.get(['backendUrl', 'agentAuthToken'], (settings) => {
      const url = settings.backendUrl || DEFAULT_BACKEND;

      try {
        ws = new WebSocket(url);
      } catch (e) {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        console.log('[Nanguo] Connected to backend:', url);

        // Send auth token if configured
        const token = settings.agentAuthToken;
        if (token) {
          ws.send(JSON.stringify({ type: 'auth', token }));
        }

        // Start heartbeat
        startHeartbeat();
      };

      ws.onmessage = async (event) => {
        let msg;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case 'run_task': {
            currentTaskId = msg.task_id;
            taskAborted = false;
            const command = msg.command;
            console.log('[Nanguo] Received task:', currentTaskId, command);

            // Create a mock port that sends to WebSocket
            const mockPort = {
              postMessage: (data) => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                  ws.send(JSON.stringify({
                    ...data,
                    task_id: currentTaskId
                  }));
                }
              }
            };

            await runAgentTask(command, mockPort, () => taskAborted);
            break;
          }

          case 'cancel_task':
            taskAborted = true;
            break;

          case 'ping':
            if (ws && ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'pong' }));
            }
            break;
        }
      };

      ws.onclose = () => {
        console.log('[Nanguo] Disconnected from backend');
        stopHeartbeat();
        scheduleReconnect();
      };

      ws.onerror = () => {
        ws.close();
      };
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 5000);
  }

  let heartbeatInterval = null;
  function startHeartbeat() {
    stopHeartbeat();
    heartbeatInterval = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'pong' }));
      }
    }, 30000);
  }

  function stopHeartbeat() {
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }
}
