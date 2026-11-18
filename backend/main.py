from sensei_agent import explain_move_with_sensei
from typing import List, Optional, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from go_rules import BOARD_SIZE, BLACK, WHITE, apply_move, to_coord
from engine_bridge import (
    choose_ai_move,
    evaluate_candidates,
    detect_engine_backend,
    rank_label_to_strength,
)

app = FastAPI(title="Baduk Trainer 9x9 API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class MoveRequest(BaseModel):
    board: List[List[int]]
    color: int = Field(..., ge=1, le=2)
    koPoint: Optional[List[int]] = None
    rank: str = "20k"


class ExplainRequest(BaseModel):
    board: List[List[int]]
    color: int = Field(..., ge=1, le=2)
    targetMove: str
    candidates: List[dict] = []
    koPoint: Optional[List[int]] = None
    mode: str = "hint"
    rank: str = "25k"


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "engine": detect_engine_backend(),
        "boardSize": BOARD_SIZE,
    }


@app.post("/api/ai-move")
def get_ai_move(req: MoveRequest):
    if len(req.board) != BOARD_SIZE or any(len(r) != BOARD_SIZE for r in req.board):
        raise HTTPException(status_code=400, detail="Board must be 9x9")

    ko_tuple: Optional[Tuple[int, int]] = (
        (req.koPoint[0], req.koPoint[1])
        if req.koPoint and len(req.koPoint) == 2
        else None
    )

    choice = choose_ai_move(req.board, req.color, ko_tuple, rank=req.rank)
    profile = rank_label_to_strength(req.rank)

    if choice["move"] == "PASS":
        return {
            "move": "PASS",
            "row": -1,
            "col": -1,
            "board": req.board,
            "capturedCount": 0,
            "koPoint": None,
            "winrate": choice["winrate"],
            "rankLabel": profile["label"],
        }

    applied = apply_move(req.board, choice["row"], choice["col"], req.color, ko_tuple)
    if not applied["valid"]:
        return {
            "move": "PASS",
            "row": -1,
            "col": -1,
            "board": req.board,
            "capturedCount": 0,
            "koPoint": None,
            "winrate": choice["winrate"],
            "rankLabel": profile["label"],
        }

    return {
        "move": choice["move"],
        "row": choice["row"],
        "col": choice["col"],
        "board": applied["board"],
        "capturedCount": applied["captured_count"],
        "koPoint": list(applied["ko_point"]) if applied["ko_point"] else None,
        "winrate": choice["winrate"],
        "rankLabel": profile["label"],
    }


@app.post("/api/hints")
def get_hints(req: MoveRequest):
    if len(req.board) != BOARD_SIZE or any(len(r) != BOARD_SIZE for r in req.board):
        raise HTTPException(status_code=400, detail="Board must be 9x9")

    ko_tuple: Optional[Tuple[int, int]] = (
        (req.koPoint[0], req.koPoint[1])
        if req.koPoint and len(req.koPoint) == 2
        else None
    )
    hints = evaluate_candidates(req.board, req.color, ko_tuple, rank="1d", top_k=4)
    return {
        "hints": hints,
        "turnColor": "Black" if req.color == BLACK else "White",
    }


@app.post("/api/explain")
async def explain_move(req: ExplainRequest):
    if len(req.board) != BOARD_SIZE or any(len(r) != BOARD_SIZE for r in req.board):
        raise HTTPException(status_code=400, detail="Board must be 9x9")

    ko_tuple: Optional[Tuple[int, int]] = (
        (req.koPoint[0], req.koPoint[1])
        if req.koPoint and len(req.koPoint) == 2
        else None
    )

    candidates = req.candidates or evaluate_candidates(
        req.board, req.color, ko_tuple, rank="1d", top_k=4
    )

    result = await explain_move_with_sensei(
        board=req.board,
        turn_color=req.color,
        target_move=req.targetMove,
        top_candidates=candidates,
        mode=req.mode,
        user_rank=req.rank,
    )
    return result
