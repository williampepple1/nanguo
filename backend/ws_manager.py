from fastapi import WebSocket
from typing import Optional
from backend.database import SessionLocal
from backend.models import Task


class AgentConnection:
    def __init__(self, ws: WebSocket):
        self.ws = ws
        self.current_task_id: Optional[str] = None

    async def send(self, data: dict):
        try:
            await self.ws.send_json(data)
        except Exception:
            pass


class WSManager:
    def __init__(self):
        self.agent: Optional[AgentConnection] = None
        self.dashboards: dict[str, WebSocket] = {}  # user_id -> ws

    async def connect_agent(self, ws: WebSocket):
        await ws.accept()
        self.agent = AgentConnection(ws)

    def disconnect_agent(self):
        self.agent = None

    async def connect_dashboard(self, user_id: str, ws: WebSocket):
        await ws.accept()
        self.dashboards[user_id] = ws

    def disconnect_dashboard(self, user_id: str):
        self.dashboards.pop(user_id, None)

    def has_agent(self) -> bool:
        return self.agent is not None

    async def send_to_agent(self, data: dict):
        if self.agent:
            await self.agent.send(data)

    async def send_to_dashboard(self, user_id: str, data: dict):
        ws = self.dashboards.get(user_id)
        if ws:
            try:
                await ws.send_json(data)
            except Exception:
                self.dashboards.pop(user_id, None)

    async def broadcast_task_update(self, user_id: str, task_id: str, **kwargs):
        db = SessionLocal()
        try:
            task = db.query(Task).filter(Task.id == task_id).first()
            if task:
                payload = {
                    "type": "task_update",
                    "task": {
                        "id": task.id,
                        "command": task.command,
                        "status": task.status,
                        "result": task.result,
                        "progress": task.progress,
                        "created_at": task.created_at.isoformat() if task.created_at else None,
                    },
                }
                await self.send_to_dashboard(user_id, payload)
        finally:
            db.close()


ws_manager = WSManager()
