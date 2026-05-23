import os
import json
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from backend.database import engine, get_db, Base
from backend.models import User, Task
from backend.auth import hash_password, verify_password, create_token, get_current_user
from backend.ws_manager import ws_manager

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Nanguo Agent Controller")

# ── REST: Auth ──────────────────────────────────────────────

class LoginRequest(BaseModel):
    username: str
    password: str

class RegisterRequest(BaseModel):
    username: str = Field(min_length=2, max_length=64)
    password: str = Field(min_length=4, max_length=128)

@app.post("/api/auth/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    existing = db.query(User).filter(User.username == req.username).first()
    if existing:
        raise HTTPException(400, "Username taken")
    user = User(username=req.username, password_hash=hash_password(req.password))
    db.add(user)
    db.commit()
    return {"token": create_token(user.id), "user_id": user.id}

@app.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(401, "Invalid credentials")
    return {"token": create_token(user.id), "user_id": user.id}

# ── REST: Tasks ─────────────────────────────────────────────

class CreateTaskRequest(BaseModel):
    command: str = Field(min_length=1, max_length=4096)

@app.post("/api/tasks")
def create_task(req: CreateTaskRequest, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not ws_manager.has_agent():
        raise HTTPException(503, "No agent connected")
    task = Task(user_id=user.id, command=req.command, status="pending")
    db.add(task)
    db.commit()
    db.refresh(task)
    # Push to agent via WebSocket
    import asyncio
    asyncio.create_task(ws_manager.send_to_agent({
        "type": "run_task",
        "task_id": task.id,
        "command": task.command,
    }))
    return {"task_id": task.id, "status": "pending"}

@app.get("/api/tasks")
def list_tasks(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    tasks = db.query(Task).filter(Task.user_id == user.id).order_by(Task.created_at.desc()).limit(50).all()
    return {
        "tasks": [
            {
                "id": t.id,
                "command": t.command,
                "status": t.status,
                "result": t.result,
                "progress": t.progress,
                "created_at": t.created_at.isoformat() if t.created_at else None,
            }
            for t in tasks
        ]
    }

@app.get("/api/tasks/{task_id}")
def get_task(task_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id, Task.user_id == user.id).first()
    if not task:
        raise HTTPException(404, "Task not found")
    return {
        "id": task.id,
        "command": task.command,
        "status": task.status,
        "result": task.result,
        "progress": task.progress,
        "created_at": task.created_at.isoformat() if task.created_at else None,
    }

# ── REST: Agent status ──────────────────────────────────────

@app.get("/api/agent/status")
def agent_status(user: User = Depends(get_current_user)):
    return {"connected": ws_manager.has_agent()}

# ── WebSocket: Agent connection ─────────────────────────────

@app.websocket("/ws/agent")
async def ws_agent(websocket: WebSocket):
    await ws_manager.connect_agent(websocket)
    try:
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")

            if msg_type == "progress":
                task_id = msg.get("task_id")
                if task_id:
                    db = SessionLocal()
                    try:
                        task = db.query(Task).filter(Task.id == task_id).first()
                        if task:
                            task.status = "running"
                            task.progress = json.dumps(msg.get("data", {}))
                            db.commit()
                            await ws_manager.broadcast_task_update(task.user_id, task_id)
                    finally:
                        db.close()

            elif msg_type == "result":
                task_id = msg.get("task_id")
                if task_id:
                    db = SessionLocal()
                    try:
                        task = db.query(Task).filter(Task.id == task_id).first()
                        if task:
                            task.status = "done"
                            task.result = msg.get("data", "")
                            task.progress = None
                            db.commit()
                            await ws_manager.broadcast_task_update(task.user_id, task_id)
                    finally:
                        db.close()

            elif msg_type == "error":
                task_id = msg.get("task_id")
                if task_id:
                    db = SessionLocal()
                    try:
                        task = db.query(Task).filter(Task.id == task_id).first()
                        if task:
                            task.status = "error"
                            task.result = msg.get("data", "")
                            task.progress = None
                            db.commit()
                            await ws_manager.broadcast_task_update(task.user_id, task_id)
                    finally:
                        db.close()

            elif msg_type == "pong":
                pass  # keepalive

    except (WebSocketDisconnect, Exception):
        pass
    finally:
        ws_manager.disconnect_agent()


# ── WebSocket: Dashboard connection ─────────────────────────

@app.websocket("/ws/dashboard")
async def ws_dashboard(websocket: WebSocket):
    # Auth via token query param: /ws/dashboard?token=xxx
    token = websocket.query_params.get("token", "")
    db = SessionLocal()
    try:
        from backend.auth import SECRET_KEY, ALGORITHM
        from jose import jwt, JWTError
        try:
            payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
            user_id = payload.get("sub")
        except JWTError:
            await websocket.close(code=4001)
            return
        user = db.query(User).filter(User.id == user_id).first()
        if not user:
            await websocket.close(code=4001)
            return
    finally:
        db.close()

    await ws_manager.connect_dashboard(user_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        ws_manager.disconnect_dashboard(user_id)


# ── Static files (dashboard) ────────────────────────────────

from backend.database import SessionLocal

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/")
def serve_index():
    return FileResponse("static/index.html")

@app.get("/login")
def serve_login():
    return FileResponse("static/login.html")


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("backend.main:app", host="0.0.0.0", port=port, reload=True)
