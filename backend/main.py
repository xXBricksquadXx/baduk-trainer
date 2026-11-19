import json
from sensei_agent import explain_move_with_sensei
from typing import List, Optional, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pathlib import Path

from go_rules import create_empty_board, from_coord
from metrics_db import (
    init_db,
    record_puzzle_result,
    record_match_result,
    get_progress_summary,
)

PUZZLES_DIR = Path(__file__).parent / "puzzles"
init_db()

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


class PuzzleAttemptRequest(BaseModel):
    puzzleId: str
    category: str
    move: str
    stepIndex: int = 0


class MatchRecordRequest(BaseModel):
    opponentRank: str
    humanColor: str
    winner: str
    margin: float
    movesCount: int


def _load_all_packs() -> List[dict]:
    packs = []
    if not PUZZLES_DIR.exists():
        return packs
    for fpath in sorted(PUZZLES_DIR.glob("*.json")):
        with open(fpath, "r", encoding="utf-8") as f:
            pack = json.load(f)
            # Hydrate each puzzle with a ready-to-render 9x9 board matrix
            for p in pack.get("puzzles", []):
                b = create_empty_board()
                for st in p.get("stones", []):
                    rc = from_coord(st["coord"])
                    if rc:
                        b[rc[0]][rc[1]] = st["color"]
                p["board"] = b
            packs.append(pack)
    return packs


@app.get("/api/puzzles")
def list_puzzles():
    return {
        "packs": _load_all_packs(),
        "progress": get_progress_summary(),
    }


@app.post("/api/puzzles/attempt")
def submit_puzzle_attempt(req: PuzzleAttemptRequest):
    packs = _load_all_packs()
    target_puzzle = None
    for pack in packs:
        for p in pack.get("puzzles", []):
            if p["id"] == req.puzzleId:
                target_puzzle = p
                break
        if target_puzzle:
            break

    if not target_puzzle:
        raise HTTPException(status_code=404, detail="Puzzle not found")

    move_upper = req.move.strip().upper()
    steps = target_puzzle.get("steps")

    # Multi-step sequential drill mode
    if steps and 0 <= req.stepIndex < len(steps):
        current_step = steps[req.stepIndex]
        accepted = [
            m.upper() for m in current_step.get("moves", [current_step.get("move", "")])
        ]
        if move_upper in accepted:
            is_final = req.stepIndex == len(steps) - 1
            if is_final:
                progress = record_puzzle_result(req.puzzleId, req.category, solved=True)
                return {
                    "solved": True,
                    "stepComplete": True,
                    "nextStepIndex": req.stepIndex + 1,
                    "feedback": current_step["feedback"],
                    "reply": None,
                    "progress": progress,
                }
            return {
                "solved": False,
                "stepComplete": True,
                "nextStepIndex": req.stepIndex + 1,
                "feedback": current_step["feedback"],
                "reply": current_step.get("reply"),
                "progress": get_progress_summary(),
            }

        progress = record_puzzle_result(req.puzzleId, req.category, solved=False)
        wrong_hints = current_step.get("wrongHints") or target_puzzle.get(
            "wrongHints", {}
        )
        feedback = wrong_hints.get(move_upper) or wrong_hints.get(
            "default", "Not quite — re-read the liberties and shape, then try again."
        )
        return {
            "solved": False,
            "stepComplete": False,
            "nextStepIndex": req.stepIndex,
            "feedback": feedback,
            "reply": None,
            "progress": progress,
        }

    # Standard 1-step solution list mode (backward compatible)
    matched = next(
        (
            s
            for s in target_puzzle.get("solutions", [])
            if s["move"].upper() == move_upper
        ),
        None,
    )

    if matched:
        progress = record_puzzle_result(req.puzzleId, req.category, solved=True)
        return {
            "solved": True,
            "stepComplete": True,
            "nextStepIndex": 1,
            "feedback": matched["feedback"],
            "reply": matched.get("reply"),
            "progress": progress,
        }

    progress = record_puzzle_result(req.puzzleId, req.category, solved=False)
    wrong_hints = target_puzzle.get("wrongHints", {})
    feedback = wrong_hints.get(move_upper) or wrong_hints.get(
        "default", "Not quite — re-read the liberties and shape, then try again."
    )
    return {
        "solved": False,
        "stepComplete": False,
        "nextStepIndex": 0,
        "feedback": feedback,
        "reply": None,
        "progress": progress,
    }


@app.get("/api/metrics")
def read_metrics():
    return get_progress_summary()


@app.post("/api/metrics/match")
def save_match_metric(req: MatchRecordRequest):
    progress = record_match_result(
        opponent_rank=req.opponentRank,
        human_color=req.humanColor,
        winner=req.winner,
        margin=req.margin,
        moves_count=req.movesCount,
    )
    return {"progress": progress}
