import math
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
from katago_gtp import is_katago_ready, katago_session

ENGINE_DIR = Path(__file__).parent / "engine"

POSITION_WEIGHTS_9X9 = [
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


def _positional_prior(size: int, row: int, col: int) -> float:
    if size == 9:
        return POSITION_WEIGHTS_9X9[row][col]
    edge_dist = min(row, size - 1 - row, col, size - 1 - col)
    if edge_dist == 0:
        return 0.1
    if edge_dist == 1:
        return 0.4
    if edge_dist in (2, 3):
        return 1.45
    return 1.2


def detect_engine_backend() -> str:
    gnugo_bin = ENGINE_DIR / "gnugo.exe"
    if is_katago_ready():
        return "hybrid (mcts + katago-gpu)"
    if gnugo_bin.exists():
        return "gnugo-local"
    return "python-mcts-calibrated"


def _katago_blend_probability(rank: str, board_size: int = BOARD_SIZE) -> float:
    """
    Smooth Tower Ramp:
    - 30k–15k (9x9): 0% KataGo (100% Python MCTS tactical rhythm)
    - 12k: 25% KataGo soft / 75% MCTS
    - 9k:  55% KataGo soft / 45% MCTS
    - 6k:  85% KataGo / 15% MCTS
    - 3k–1d+ (and 13x13): 100% KataGo GPU
    """
    if not is_katago_ready():
        return 0.0
    if board_size > 9:
        return 1.0
    r = rank.strip().lower()
    if r.endswith("d"):
        return 1.0
    if r.endswith("k"):
        try:
            kyu = int(r[:-1])
        except ValueError:
            return 0.0
        if kyu <= 3:
            return 1.0
        if kyu <= 6:
            return 0.85
        if kyu <= 9:
            return 0.55
        if kyu <= 12:
            return 0.25
    return 0.0


def _should_use_katago(rank: str, board_size: int = BOARD_SIZE) -> bool:
    prob = _katago_blend_probability(rank, board_size)
    if prob <= 0.0:
        return False
    if prob >= 1.0:
        return True
    return random.random() < prob


def rank_label_to_strength(rank: str) -> Dict[str, Any]:
    r = rank.strip().lower()
    if r.endswith("d"):
        dan = max(1, min(9, int(r[:-1] or 1)))
        return {
            "label": f"{dan} Dan",
            "shortlist_size": 3,
            "rollouts": 115 + dan * 15,
            "noise": 0.03,
            "tactical_mult": 1.45,
            "blunder_rate": 0.0,
        }

    kyu = 20
    if r.endswith("k"):
        try:
            kyu = max(1, min(30, int(r[:-1])))
        except ValueError:
            kyu = 20

    skill = (31 - kyu) / 30.0
    shortlist_size = int(36 - skill * 32)
    return {
        "label": f"{kyu} Kyu",
        "shortlist_size": max(3, shortlist_size),
        "rollouts": int(6 + (skill**1.25) * 100),
        "noise": round(max(0.05, (1.0 - skill) * 4.5), 2),
        "tactical_mult": round(0.25 + skill * 1.15, 2),
        "blunder_rate": round(max(0.0, (kyu - 18) / 20.0), 2),
    }


def _is_true_eye(board: List[List[int]], row: int, col: int, color: int) -> bool:
    size = len(board)
    for nr, nc in get_neighbors(row, col, size):
        if board[nr][nc] != color:
            return False
    diag_friendly = 0
    diag_total = 0
    for dr in (-1, 1):
        for dc in (-1, 1):
            rr, cc = row + dr, col + dc
            if 0 <= rr < size and 0 <= cc < size:
                diag_total += 1
                if board[rr][cc] == color:
                    diag_friendly += 1
    return diag_friendly >= max(1, diag_total - 1)


def _all_borders_sealed(board: List[List[int]]) -> bool:
    size = len(board)
    has_black = any(cell == BLACK for row in board for cell in row)
    has_white = any(cell == WHITE for row in board for cell in row)
    if not (has_black and has_white):
        return False

    visited = set()
    for r in range(size):
        for c in range(size):
            if board[r][c] == EMPTY and (r, c) not in visited:
                borders = set()
                stack = [(r, c)]
                visited.add((r, c))
                while stack:
                    cr, cc = stack.pop()
                    for nr, nc in get_neighbors(cr, cc, size):
                        cell = board[nr][nc]
                        if cell == EMPTY and (nr, nc) not in visited:
                            visited.add((nr, nc))
                            stack.append((nr, nc))
                        elif cell in (BLACK, WHITE):
                            borders.add(cell)
                if len(borders) != 1:
                    return False
    return True


def _evaluate_tactical_move(
    board: List[List[int]],
    row: int,
    col: int,
    color: int,
    ko_point: Optional[Tuple[int, int]],
) -> Tuple[float, List[str]]:
    size = len(board)
    res = apply_move(board, row, col, color, ko_point)
    if not res["valid"]:
        return (-999.0, [])

    next_board = res["board"]
    opponent = WHITE if color == BLACK else BLACK
    tags: List[str] = []
    score = _positional_prior(size, row, col)

    if res["captured_count"] > 0:
        score += 4.5 * res["captured_count"]
        tags.append(f"captures {res['captured_count']} stone(s)")

    if _is_true_eye(board, row, col, color) and res["captured_count"] == 0:
        score -= 8.0
        tags.append("fills own eye")

    self_stones, self_libs = get_group_and_liberties(next_board, row, col)
    if self_libs == 1 and res["captured_count"] == 0:
        can_capture_next = any(
            next_board[nr][nc] == opponent
            and get_group_and_liberties(next_board, nr, nc)[1] == 1
            for nr, nc in get_neighbors(row, col, size)
        )
        if not can_capture_next:
            score -= 9.5 + 1.2 * len(self_stones)
            tags.append("hopeless self-atari throw-in")
        else:
            score -= 3.5 + 0.6 * len(self_stones)
            tags.append("snapback / atari gamble")
    elif self_libs == 2 and len(self_stones) >= 3 and res["captured_count"] == 0:
        score -= 1.6 + 0.35 * len(self_stones)
        tags.append("low-liberty group risk")
    elif self_libs >= 3:
        score += 0.6
        for nr, nc in get_neighbors(row, col, size):
            if board[nr][nc] == color:
                old_stones, old_libs = get_group_and_liberties(board, nr, nc)
                if old_libs == 2 and len(old_stones) >= 2:
                    score += 1.8 + 0.3 * len(old_stones)
                    tags.append("extends 2-liberty group")
                    break

    for nr, nc in get_neighbors(row, col, size):
        if next_board[nr][nc] == opponent:
            opp_stones, opp_libs = get_group_and_liberties(next_board, nr, nc)
            if opp_libs == 1:
                score += 2.2 + 0.5 * len(opp_stones)
                tags.append("puts opponent in atari")
            elif opp_libs == 2:
                score += 0.8
                tags.append("pressures opponent liberties")
        elif board[nr][nc] == color:
            _, old_libs = get_group_and_liberties(board, nr, nc)
            if old_libs == 1 and self_libs >= 2:
                score += 3.5
                tags.append("defends group in atari")

    move_count = sum(1 for r in board for c in r if c != EMPTY)
    if move_count < 10:
        center = size // 2
        if (row, col) == (center, center):
            tags.append("controls center (tengen)")
        elif row in {0, size - 1} or col in {0, size - 1}:
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
    size = len(board)
    sim_board = [r[:] for r in board]
    curr = turn
    ko = ko_point
    passes = 0
    last_pt: Optional[Tuple[int, int]] = None

    for _ in range(max_steps):
        chosen_res = None
        chosen_pt = None

        if last_pt is not None:
            lr, lc = last_pt
            local_targets = [(lr, lc)] + get_neighbors(lr, lc, size)
            for tr, tc in local_targets:
                if sim_board[tr][tc] != EMPTY:
                    stones, libs = get_group_and_liberties(sim_board, tr, tc)
                    if libs == 1:
                        for sr, sc in stones:
                            for nr, nc in get_neighbors(sr, sc, size):
                                if sim_board[nr][nc] == EMPTY and not _is_true_eye(
                                    sim_board, nr, nc, curr
                                ):
                                    res = apply_move(sim_board, nr, nc, curr, ko)
                                    if res["valid"]:
                                        chosen_res = res
                                        chosen_pt = (nr, nc)
                                        break
                            if chosen_res:
                                break
                if chosen_res:
                    break

        if chosen_res is None:
            for _attempt in range(14):
                r = random.randrange(size)
                c = random.randrange(size)
                if sim_board[r][c] == EMPTY and not _is_true_eye(sim_board, r, c, curr):
                    res = apply_move(sim_board, r, c, curr, ko)
                    if res["valid"]:
                        chosen_res = res
                        chosen_pt = (r, c)
                        break

        if chosen_res is not None:
            sim_board = chosen_res["board"]
            ko = chosen_res["ko_point"]
            last_pt = chosen_pt
            passes = 0
        else:
            passes += 1
            ko = None
            last_pt = None
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
    size = len(board)
    if _should_use_katago(rank, size):
        try:
            kg_hints = katago_session.analyze_position(
                board, color, rank=rank, top_k=top_k
            )
            if kg_hints:
                valid_kg = []
                for h in kg_hints:
                    if h["move"] == "PASS":
                        valid_kg.append(h)
                    else:
                        chk = apply_move(board, h["row"], h["col"], color, ko_point)
                        if chk["valid"]:
                            valid_kg.append(h)
                if valid_kg:
                    for idx, item in enumerate(valid_kg[:top_k], start=1):
                        item["rank"] = idx
                    return valid_kg[:top_k]
        except Exception:
            pass

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
    borders_sealed = _all_borders_sealed(board)

    pool_limit = profile["shortlist_size"]
    if profile["blunder_rate"] > 0 and len(scored) > 10:
        broad_pool = scored[:pool_limit]
        random.shuffle(broad_pool)
        shortlist = broad_pool[: max(top_k + 4, 8)]
    else:
        shortlist = scored[: max(top_k, pool_limit)]

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
        noise = random.gauss(0, 0.05 * profile["noise"])
        final_score = blended_wr + noise
        final_tags = (
            ["all borders sealed — pass recommended"] + tags if borders_sealed else tags
        )
        candidates.append(
            {
                "row": r,
                "col": c,
                "move": to_coord(r, c, size),
                "winrate": round(max(0.02, min(0.98, blended_wr)) * 100, 1),
                "scoreLead": round((blended_wr - 0.5) * 18.0, 1),
                "tags": final_tags,
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
    size = len(board)
    stone_count = sum(1 for r in board for c in r if c != EMPTY)
    if _all_borders_sealed(board):
        return {
            "move": "PASS",
            "row": -1,
            "col": -1,
            "winrate": 50.0,
            "tags": ["all borders sealed — endgame pass"],
        }

    if _should_use_katago(rank, size):
        try:
            kg_choice = katago_session.genmove(board, color, rank=rank)
            if kg_choice is not None:
                if kg_choice["move"] == "PASS":
                    return kg_choice
                chk = apply_move(
                    board, kg_choice["row"], kg_choice["col"], color, ko_point
                )
                if chk["valid"]:
                    return kg_choice
        except Exception:
            pass

    candidates = evaluate_candidates(board, color, ko_point, rank=rank, top_k=5)
    if not candidates:
        return {
            "move": "PASS",
            "row": -1,
            "col": -1,
            "winrate": 50.0,
            "tags": ["no legal moves"],
        }

    pass_threshold = 115 if size == 13 else 52
    if stone_count > pass_threshold and "fills own eye" in candidates[0]["tags"]:
        return {
            "move": "PASS",
            "row": -1,
            "col": -1,
            "winrate": candidates[0]["winrate"],
            "tags": ["all borders sealed — endgame pass"],
        }

    return candidates[0]
