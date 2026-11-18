import math
import os
import random
from pathlib import Path
from typing import List, Optional, Tuple, Dict, Any

from go_rules import (
    BOARD_SIZE,
    EMPTY,
    BLACK,
    WHITE,
    apply_move,
    get_legal_moves,
    get_group_and_liberties,
    get_neighbors,
    estimate_area_score,
    to_coord,
)

ENGINE_DIR = Path(__file__).parent / "engine"

# Strategic positional priors for 9x9 (rewards 3-3/3-4/4-4 points & center tengen, penalizes 1st-line crawls)
POSITION_WEIGHTS = [
    [0.1, 0.3, 0.5, 0.5, 0.5, 0.5, 0.5, 0.3, 0.1],
    [0.3, 0.7, 1.0, 1.0, 1.0, 1.0, 1.0, 0.7, 0.3],
    [0.5, 1.0, 1.5, 1.3, 1.3, 1.3, 1.5, 1.0, 0.5],
    [0.5, 1.0, 1.3, 1.4, 1.4, 1.4, 1.3, 1.0, 0.5],
    [0.5, 1.0, 1.3, 1.4, 1.6, 1.4, 1.3, 1.0, 0.5],
    [0.5, 1.0, 1.3, 1.4, 1.4, 1.4, 1.3, 1.0, 0.5],
    [0.5, 1.0, 1.5, 1.3, 1.3, 1.3, 1.5, 1.0, 0.5],
    [0.3, 0.7, 1.0, 1.0, 1.0, 1.0, 1.0, 0.7, 0.3],
    [0.1, 0.3, 0.5, 0.5, 0.5, 0.5, 0.5, 0.3, 0.1],
]


def detect_engine_backend() -> str:
    katago_bin = ENGINE_DIR / "katago.exe"
    gnugo_bin = ENGINE_DIR / "gnugo.exe"
    if katago_bin.exists():
        return "katago-local"
    if gnugo_bin.exists():
        return "gnugo-local"
    return "python-mcts-calibrated"


def rank_label_to_strength(rank: str) -> Dict[str, Any]:
    """
    Maps user-facing rank string (e.g., '30k', '20k', '10k', '5k', '1d')
    to rollout simulations, tactical awareness weight, and noise temperature.
    """
    r = rank.strip().lower()
    if r.endswith("d"):
        dan = max(1, min(9, int(r[:-1] or 1)))
        return {
            "label": f"{dan} Dan",
            "rollouts": 90 + dan * 15,
            "noise": 0.05,
            "tactical_mult": 1.4,
        }

    kyu = 20
    if r.endswith("k"):
        try:
            kyu = max(1, min(30, int(r[:-1])))
        except ValueError:
            kyu = 20

    # 30k -> high randomness, minimal reading; 1k -> focused reading, low noise
    skill = (31 - kyu) / 30.0  # 0.033 at 30k -> 1.0 at 1k
    return {
        "label": f"{kyu} Kyu",
        "rollouts": int(6 + skill * 74),
        "noise": round(max(0.08, (1.0 - skill) * 2.8), 2),
        "tactical_mult": round(0.4 + skill * 0.9, 2),
    }


def _is_true_eye(board: List[List[int]], row: int, col: int, color: int) -> bool:
    """Prevents AI from filling its own single-point eyes unless capturing."""
    for nr, nc in get_neighbors(row, col):
        if board[nr][nc] != color:
            return False
    diag_friendly = 0
    diag_total = 0
    for dr in (-1, 1):
        for dc in (-1, 1):
            rr, cc = row + dr, col + dc
            if 0 <= rr < BOARD_SIZE and 0 <= cc < BOARD_SIZE:
                diag_total += 1
                if board[rr][cc] == color:
                    diag_friendly += 1
    return diag_friendly >= max(1, diag_total - 1)


def _evaluate_tactical_move(
    board: List[List[int]],
    row: int,
    col: int,
    color: int,
    ko_point: Optional[Tuple[int, int]],
) -> Tuple[float, List[str]]:
    """Scores a legal move using tactical Go principles and returns reason tags."""
    res = apply_move(board, row, col, color, ko_point)
    if not res["valid"]:
        return (-999.0, [])

    next_board = res["board"]
    opponent = WHITE if color == BLACK else BLACK
    tags: List[str] = []
    score = POSITION_WEIGHTS[row][col]

    # 1. Capture bonus
    if res["captured_count"] > 0:
        score += 4.5 * res["captured_count"]
        tags.append(f"captures {res['captured_count']} stone(s)")

    # 2. Avoid filling own eye
    if _is_true_eye(board, row, col, color) and res["captured_count"] == 0:
        score -= 8.0
        tags.append("fills own eye")

    # 3. Check self-group liberties (avoid self-atari)
    _, self_libs = get_group_and_liberties(next_board, row, col)
    if self_libs == 1 and res["captured_count"] == 0:
        score -= 3.2
        tags.append("self-atari risk")
    elif self_libs >= 3:
        score += 0.6

    # 4. Check if move puts adjacent enemy groups into Atari (1 liberty) or reduces liberties
    for nr, nc in get_neighbors(row, col):
        if next_board[nr][nc] == opponent:
            opp_stones, opp_libs = get_group_and_liberties(next_board, nr, nc)
            if opp_libs == 1:
                score += 2.2 + 0.5 * len(opp_stones)
                tags.append("puts opponent in atari")
            elif opp_libs == 2:
                score += 0.8
                tags.append("pressures opponent liberties")
        elif board[nr][nc] == color:
            # Check if we rescued an allied group that was in atari
            _, old_libs = get_group_and_liberties(board, nr, nc)
            if old_libs == 1 and self_libs > 1:
                score += 3.5
                tags.append("defends group in atari")

    # 5. Opening positional tags
    move_count = sum(1 for r in board for c in r if c != EMPTY)
    if move_count < 10:
        if (row, col) == (4, 4):
            tags.append("controls center (tengen)")
        elif (row, col) in {(2, 2), (2, 6), (6, 2), (6, 6)}:
            tags.append("occupies 3-3 corner star point")
        elif row in {0, 8} or col in {0, 8}:
            tags.append("first-line edge play (low territory)")

    if not tags:
        tags.append("develops shape and territory")

    return (score, list(dict.fromkeys(tags)))


def _quick_rollout(
    board: List[List[int]],
    turn: int,
    ko_point: Optional[Tuple[int, int]],
    max_steps: int = 38,
) -> float:
    """Fast stochastic playout returning +1 if `turn` wins, 0 otherwise."""
    sim_board = [r[:] for r in board]
    curr = turn
    ko = ko_point
    passes = 0

    for _ in range(max_steps):
        candidates = []
        for _attempt in range(14):
            r = random.randrange(BOARD_SIZE)
            c = random.randrange(BOARD_SIZE)
            if sim_board[r][c] == EMPTY and not _is_true_eye(sim_board, r, c, curr):
                res = apply_move(sim_board, r, c, curr, ko)
                if res["valid"]:
                    candidates.append((r, c, res))
                    break
        if candidates:
            _, _, res = candidates[0]
            sim_board = res["board"]
            ko = res["ko_point"]
            passes = 0
        else:
            passes += 1
            ko = None
            if passes >= 2:
                break
        curr = WHITE if curr == BLACK else BLACK

    score = estimate_area_score(sim_board, komi=5.5)
    winner_color = BLACK if score["winner"] == "Black" else WHITE
    return 1.0 if winner_color == turn else 0.0


def evaluate_candidates(
    board: List[List[int]],
    color: int,
    ko_point: Optional[Tuple[int, int]] = None,
    rank: str = "15k",
    top_k: int = 4,
) -> List[Dict[str, Any]]:
    profile = rank_label_to_strength(rank)
    legal = get_legal_moves(board, color, ko_point)
    if not legal:
        return []

    scored = []
    for r, c in legal:
        heur_score, tags = _evaluate_tactical_move(
            board, r, col=c, color=color, ko_point=ko_point
        )
        scored.append((heur_score, r, c, tags))

    scored.sort(key=lambda x: x[0], reverse=True)

    # Run Monte Carlo rollouts on top shortlist for win-rate calibration
    shortlist = scored[: max(top_k + 4, 8)]
    rollouts_per_move = max(2, profile["rollouts"] // len(shortlist))

    candidates = []
    for heur_score, r, c, tags in shortlist:
        res = apply_move(board, r, c, color, ko_point)
        next_turn = WHITE if color == BLACK else BLACK
        wins = 0.0
        for _ in range(rollouts_per_move):
            opp_win = _quick_rollout(res["board"], next_turn, res["ko_point"])
            wins += 1.0 - opp_win

        mc_winrate = wins / rollouts_per_move
        sigmoid_prior = 1.0 / (
            1.0 + math.exp(-0.35 * heur_score * profile["tactical_mult"])
        )
        blended_wr = 0.55 * sigmoid_prior + 0.45 * mc_winrate
        noise = random.gauss(0, 0.04 * profile["noise"])
        final_score = blended_wr + noise

        candidates.append(
            {
                "row": r,
                "col": c,
                "move": to_coord(r, c),
                "winrate": round(max(0.02, min(0.98, blended_wr)) * 100, 1),
                "scoreLead": round((blended_wr - 0.5) * 18.0, 1),
                "tags": tags,
                "_sort": final_score,
            }
        )

    candidates.sort(key=lambda x: x["_sort"], reverse=True)
    for idx, item in enumerate(candidates[:top_k], start=1):
        item["rank"] = idx
        item.pop("_sort", None)

    return candidates[:top_k]


def choose_ai_move(
    board: List[List[int]],
    color: int,
    ko_point: Optional[Tuple[int, int]] = None,
    rank: str = "15k",
) -> Dict[str, Any]:
    candidates = evaluate_candidates(board, color, ko_point, rank=rank, top_k=5)
    if not candidates:
        return {
            "move": "PASS",
            "row": -1,
            "col": -1,
            "winrate": 50.0,
            "tags": ["no legal moves"],
        }

    # Pass in late endgame if best move has very low value
    stone_count = sum(1 for r in board for c in r if c != EMPTY)
    if stone_count > 52 and candidates[0]["tags"] == ["fills own eye"]:
        return {
            "move": "PASS",
            "row": -1,
            "col": -1,
            "winrate": candidates[0]["winrate"],
            "tags": ["endgame pass"],
        }

    return candidates[0]
