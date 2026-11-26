import json
from contextlib import asynccontextmanager
from typing import List, Optional, Tuple
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from pathlib import Path

from go_rules import (
    BOARD_SIZE,
    BLACK,
    WHITE,
    apply_move,
    create_empty_board,
    from_coord,
)
from engine_bridge import (
    choose_ai_move,
    evaluate_candidates,
    detect_engine_backend,
    rank_label_to_strength,
)
from katago_gtp import katago_session

from metrics_db import (
    init_db,
    record_puzzle_result,
    record_match_result,
    get_progress_summary,
    recalculate_honest_rank,
)
from sensei_agent import explain_move_with_sensei

PUZZLES_DIR = Path(__file__).parent / "puzzles"
JOSEKI_DIR = Path(__file__).parent / "joseki"
init_db()


def _validate_board(board: List[List[int]]) -> int:
    size = len(board)
    if size not in (9, 13) or any(len(r) != size for r in board):
        raise HTTPException(status_code=400, detail="Board must be 9x9 or 13x13")
    return size


def _load_all_packs() -> List[dict]:
    packs = []
    if not PUZZLES_DIR.exists():
        return packs
    for fpath in sorted(PUZZLES_DIR.glob("*.json")):
        with open(fpath, "r", encoding="utf-8") as f:
            pack = json.load(f)
            pack_size = pack.get("boardSize", 9)
            for p in pack.get("puzzles", []):
                b_size = p.get("boardSize", pack_size)
                b = create_empty_board(b_size)
                for st in p.get("stones", []):
                    rc = from_coord(st["coord"], b_size)
                    if rc:
                        b[rc[0]][rc[1]] = st["color"]
                p["board"] = b
                p["boardSize"] = b_size
            packs.append(pack)
    return packs


def _build_console_banner() -> str:
    packs = _load_all_packs()
    drill_count = sum(len(p.get("puzzles", [])) for p in packs)
    stats = get_progress_summary()
    engine = detect_engine_backend()

    return rf"""
  ___  _____   _____                      _   _____       _____
 / _ \|_   _| /  ___|                    (_) |  _  |     |  _  |
/ /_\ \ | |   \ `--.  ___ _ __  ___  ___  _  | |_| |_  __| |_| |
|  _  | | |    `--. \/ _ \ '_ \/ __|/ _ \| | \____ \ \/ /\____ |
| | | |_| |_  /\__/ /  __/ | | \__ \  __/| | .___/ />  < .___/ /
\_| |_/\___/  \____/ \___|_| |_|___/\___||_| \____//_/\_\\____/

       =[ AI Sensei Dojo // Multi-Goban Framework v0.3.0     ]
+ -- --=[ Engine  : {engine:<41} ]
+ -- --=[ Boards  : 9x9 & 13x13 Goban | Ranks: 30 Kyu -> 1 Dan  ]
+ -- --=[ Dojo    : {len(packs)} Curriculum Packs ({drill_count} tactical drills)      ]
+ -- --=[ Profile : {stats['estimatedRank']:<10} | Record: {stats['matchWins']}W-{stats['totalMatches'] - stats['matchWins']}L ({stats['winRate']}%)     ]
+ -- --=[ Sensei  : GPU Instant Default + Ollama SGF Review   ]
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    katago_session.start()
    print(_build_console_banner(), flush=True)
    yield
    katago_session.stop()


app = FastAPI(title="Baduk Trainer API", version="0.3.0", lifespan=lifespan)

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
    model: str = "katago-instant"


@app.get("/api/health")
def health_check():
    return {
        "status": "ok",
        "engine": detect_engine_backend(),
        "boardSize": BOARD_SIZE,
        "supportedSizes": [9, 13],
    }


@app.post("/api/ai-move")
def get_ai_move(req: MoveRequest):
    _validate_board(req.board)

    ko_tuple: Optional[Tuple[int, int]] = (
        (req.koPoint[0], req.koPoint[1])
        if req.koPoint and len(req.koPoint) == 2
        else None
    )

    choice = choose_ai_move(req.board, req.color, ko_tuple, rank=req.rank)
    profile = rank_label_to_strength(req.rank)
    engine_used = (
        "KataGo GPU"
        if any("KataGo" in t for t in choice.get("tags", []))
        else "Python MCTS"
    )

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
            "engineUsed": engine_used,
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
            "engineUsed": engine_used,
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
        "engineUsed": engine_used,
    }


@app.post("/api/hints")
def get_hints(req: MoveRequest):
    _validate_board(req.board)

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
    _validate_board(req.board)

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
        model=req.model,
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


@app.get("/api/puzzles")
def list_puzzles():
    return {
        "packs": _load_all_packs(),
        "progress": get_progress_summary(),
    }


@app.get("/api/joseki")
def get_joseki_tree(size: int = 9):
    fname = "13x13_openings.json" if size == 13 else "9x9_openings.json"
    jfile = JOSEKI_DIR / fname
    if not jfile.exists():
        return {
            "title": f"{size}x{size} Joseki Explorer",
            "boardSize": size,
            "root": {"move": None, "children": []},
        }
    with open(jfile, "r", encoding="utf-8") as f:
        data = json.load(f)
        data.setdefault("boardSize", size)
        return data


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


@app.post("/api/metrics/recalculate")
def recalc_metrics():
    return {"progress": recalculate_honest_rank()}


@app.get("/api/system/banner")
def system_banner():
    packs = _load_all_packs()
    return {
        "banner": _build_console_banner(),
        "engine": detect_engine_backend(),
        "packsCount": len(packs),
        "drillsCount": sum(len(p.get("puzzles", [])) for p in packs),
        "progress": get_progress_summary(),
    }
