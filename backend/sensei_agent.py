import logging
import httpx
from typing import List, Dict, Any, Optional
from go_rules import (
    EMPTY,
    BLACK,
    WHITE,
    COL_LABELS,
    get_group_and_liberties,
    get_neighbors,
    to_coord,
    from_coord,
)

logger = logging.getLogger("uvicorn.error")

OLLAMA_URL = "http://127.0.0.1:11434/api/generate"
PRIMARY_MODEL = "qwen2.5-coder:7b"
FAST_FALLBACK_MODEL = "qwen2.5-coder:3b"


def render_ascii_board(board: List[List[int]]) -> str:
    size = len(board)
    header = "   " + " ".join(COL_LABELS[:size])
    lines = [header]
    for r in range(size):
        row_label = str(size - r)
        cells = []
        for c in range(size):
            v = board[r][c]
            cells.append("X" if v == BLACK else ("O" if v == WHITE else "."))
        lines.append(f"{row_label:>2} " + " ".join(cells))
    return "\n".join(lines)


def scan_board_tactics(board: List[List[int]]) -> Dict[str, List[str]]:
    size = len(board)
    visited = set()
    black_atari: List[str] = []
    white_atari: List[str] = []

    for r in range(size):
        for c in range(size):
            color = board[r][c]
            if color != EMPTY and (r, c) not in visited:
                stones, libs = get_group_and_liberties(board, r, c)
                for sr, sc in stones:
                    visited.add((sr, sc))
                if libs == 1:
                    rep = f"{to_coord(r, c, size)} ({len(stones)}-stone group)"
                    if color == BLACK:
                        black_atari.append(rep)
                    else:
                        white_atari.append(rep)

    return {"black_atari": black_atari, "white_atari": white_atari}


def describe_board_facts(board: List[List[int]], target_move: str) -> str:
    size = len(board)
    black_stones = []
    white_stones = []
    for r in range(size):
        for c in range(size):
            if board[r][c] == BLACK:
                black_stones.append(to_coord(r, c, size))
            elif board[r][c] == WHITE:
                white_stones.append(to_coord(r, c, size))

    neighbor_desc = "N/A"
    parsed = from_coord(target_move, size)
    if parsed:
        tr, tc = parsed
        n_parts = []
        for nr, nc in get_neighbors(tr, tc, size):
            cell = board[nr][nc]
            state = (
                "Black (X)"
                if cell == BLACK
                else ("White (O)" if cell == WHITE else "Empty")
            )
            n_parts.append(f"{to_coord(nr, nc, size)}={state}")
        neighbor_desc = ", ".join(n_parts)

    return (
        f"Black stones on board: {', '.join(black_stones) or 'None'}\n"
        f"White stones on board: {', '.join(white_stones) or 'None'}\n"
        f"Direct orthogonal neighbors of {target_move}: {neighbor_desc}"
    )


def _format_katago_instant(
    target_move: str,
    turn_label: str,
    candidate_info: Optional[Dict[str, Any]],
    top_candidates: List[Dict[str, Any]],
    tactics: Dict[str, List[str]],
    mode: str,
) -> str:
    if (
        candidate_info
        and "all borders sealed — pass recommended" in candidate_info.get("tags", [])
    ):
        return (
            f"- **Core Purpose:** All territory borders are 100% sealed (zero neutral dame left).\n"
            f"- **Tactical Read:** Playing {target_move} adds +0 net points under Area Scoring.\n"
            f"- **Action:** Click **Pass** now to lock in the score."
        )

    best = top_candidates[0] if top_candidates else None
    atari_notes = []
    if tactics["black_atari"]:
        atari_notes.append(f"Black in Atari: {', '.join(tactics['black_atari'])}")
    if tactics["white_atari"]:
        atari_notes.append(f"White in Atari: {', '.join(tactics['white_atari'])}")
    atari_line = (
        "; ".join(atari_notes)
        if atari_notes
        else "No groups in immediate 1-liberty Atari."
    )

    if candidate_info:
        wr = candidate_info.get("winrate", 50.0)
        lead = candidate_info.get("scoreLead", 0.0)
        tags_str = ", ".join(candidate_info.get("tags", ["tactical continuation"]))
        comp = (
            f"Matches KataGo's #1 choice ({wr}% winrate, {lead:+.1f} pts)."
            if not best or best["move"].upper() == target_move.upper()
            else f"#{best['rank']} **{best['move']}** ({best['winrate']}%, {best['scoreLead']:+.1f} pts) rates slightly higher."
        )
        return (
            f"- **GPU Evaluation:** **{target_move}** — {wr}% winrate ({lead:+.1f} pts) [{tags_str}].\n"
            f"- **Board Scan:** {atari_line}\n"
            f"- **Comparison:** {comp} *(Switch to 3B/7B for full prose coaching)*"
        )

    if mode == "last_move" and best:
        return (
            f"- **Played Move:** {turn_label} played **{target_move}**.\n"
            f"- **GPU Top Choice:** **{best['move']}** ({best['winrate']}% winrate, {best['scoreLead']:+.1f} pts).\n"
            f"- **Board Scan:** {atari_line}"
        )

    return f"- **GPU Read:** **{target_move}** develops local shape. {atari_line}"


def _fallback_explanation(
    target_move: str,
    turn_label: str,
    candidate_info: Optional[Dict[str, Any]],
    top_candidates: List[Dict[str, Any]],
    mode: str,
    board_size: int = 9,
) -> str:
    if (
        candidate_info
        and "all borders sealed — pass recommended" in candidate_info.get("tags", [])
    ):
        return (
            f"All territory borders are 100% sealed (zero neutral dame points left). "
            f"Playing {target_move} inside your own territory adds +0 net points under Area Scoring — click Pass now to lock in the game!"
        )

    best = top_candidates[0] if top_candidates else None
    if candidate_info:
        tags_str = ", ".join(candidate_info.get("tags", ["develops shape"]))
        rank_num = candidate_info.get("rank", "?")
        wr = candidate_info.get("winrate", 50.0)
        lead = candidate_info.get("scoreLead", 0.0)
        base = (
            f"Candidate #{rank_num} at {target_move} ({wr}% winrate, {lead:+.1f} pts) "
            f"focuses on: {tags_str}."
        )
        if best and best["move"] != target_move:
            base += (
                f" Compare this with Sensei's #1 choice at {best['move']} "
                f"({best['winrate']}%), which prioritizes {', '.join(best.get('tags', []))}."
            )
        return base

    if mode == "last_move" and best:
        return (
            f"{turn_label}'s move at {target_move} was played. "
            f"Sensei's top engine choice here was {best['move']} ({best['winrate']}% winrate) "
            f"to {', '.join(best.get('tags', []))}."
        )
    return f"Move {target_move} develops local shape on the {board_size}x{board_size} board."


async def _query_ollama(client: httpx.AsyncClient, model_name: str, prompt: str) -> str:
    resp = await client.post(
        OLLAMA_URL,
        json={
            "model": model_name,
            "prompt": prompt,
            "stream": False,
            "keep_alive": "15m",
            "options": {"temperature": 0.25, "num_predict": 240},
        },
    )
    resp.raise_for_status()
    data = resp.json()
    text = data.get("response", "").strip()
    if not text:
        raise ValueError(f"Ollama returned empty response for {model_name}")
    return text


async def explain_move_with_sensei(
    board: List[List[int]],
    turn_color: int,
    target_move: str,
    top_candidates: Optional[List[Dict[str, Any]]] = None,
    mode: str = "hint",
    user_rank: str = "25k",
    model: str = "katago-instant",
) -> Dict[str, Any]:
    size = len(board)
    top_candidates = top_candidates or []
    turn_label = "Black (X)" if turn_color == BLACK else "White (O)"
    tactics = scan_board_tactics(board)

    candidate_info = next(
        (c for c in top_candidates if c["move"].upper() == target_move.upper()), None
    )

    if model == "katago-instant":
        return {
            "move": target_move,
            "explanation": _format_katago_instant(
                target_move, turn_label, candidate_info, top_candidates, tactics, mode
            ),
            "model": "katago-instant",
            "source": "gpu-instant",
        }

    ascii_grid = render_ascii_board(board)
    board_facts = describe_board_facts(board, target_move)

    candidates_summary = "\n".join(
        [
            f"  #{c['rank']}: {c['move']} | Winrate: {c['winrate']}% | Lead: {c['scoreLead']:+.1f} | Engine Tags: {', '.join(c.get('tags', []))}"
            for c in top_candidates
        ]
    )

    atari_summary = (
        f"Black groups in Atari (1 liberty): {', '.join(tactics['black_atari']) or 'None'}\n"
        f"White groups in Atari (1 liberty): {', '.join(tactics['white_atari']) or 'None'}"
    )

    sealed_note = (
        "\nIMPORTANT ENDGAME RULE: Every empty region on this board is already 100% sealed by one color (zero neutral dame points remain). "
        "Playing inside already-sealed territory yields +0 points under Area Scoring—advise the student to click Pass now."
        if top_candidates
        and "all borders sealed — pass recommended" in top_candidates[0].get("tags", [])
        else ""
    )

    task_instruction = (
        f"The student (calibrating around {user_rank}) clicked Hint Silhouette #{candidate_info['rank']} at {target_move} for {turn_label}."
        if mode == "hint" and candidate_info
        else f"The student wants an analysis of the move just played at {target_move} by {turn_label}."
    )

    best_move_label = top_candidates[0]["move"] if top_candidates else target_move

    prompt = f"""You are a sharp, encouraging {size}x{size} Go (Baduk) Sensei coaching a student.
Ground your explanation strictly in the verified board facts and engine telemetry below. Never claim a stone exists at an empty intersection.

Verified Board Inventory:
{board_facts}

{size}x{size} Grid (X = Black, O = White, . = Empty):
{ascii_grid}

Tactical Scan:
{atari_summary}

Engine Top 4 Candidates for {turn_label}:
{candidates_summary}

Task:
{task_instruction}{sealed_note}

Respond in exactly 3 concise bullet points (under 100 words total):
- **Core Purpose:** What {target_move} accomplishes (territory, center influence, cutting/connecting, or liberty pressure).
- **Tactical Read:** Describe ONLY the direct orthogonal neighbors listed above for {target_move} (do NOT mention distant stones).
- **Comparison:** How it compares to #1 ({best_move_label}) and one concrete Go principle to remember."""

    models_to_try = [model]
    if model != FAST_FALLBACK_MODEL:
        models_to_try.append(FAST_FALLBACK_MODEL)

    timeout_cfg = httpx.Timeout(45.0, connect=5.0)
    last_error = "unknown"

    async with httpx.AsyncClient(timeout=timeout_cfg) as client:
        for candidate_model in models_to_try:
            try:
                text = await _query_ollama(client, candidate_model, prompt)
                return {
                    "move": target_move,
                    "explanation": text,
                    "model": candidate_model,
                    "source": "ollama",
                }
            except httpx.ConnectError as exc:
                last_error = f"Ollama unreachable on 127.0.0.1:11434 ({exc})"
                logger.warning(f"[SenseiAgent] {last_error}")
                break
            except httpx.TimeoutException as exc:
                last_error = f"{candidate_model} timed out ({exc})"
                logger.warning(f"[SenseiAgent] {last_error} — trying next fallback")
            except httpx.HTTPStatusError as exc:
                last_error = f"{candidate_model} HTTP {exc.response.status_code}: {exc.response.text[:120]}"
                logger.warning(f"[SenseiAgent] {last_error}")
            except Exception as exc:
                last_error = f"{candidate_model} error: {exc}"
                logger.warning(f"[SenseiAgent] {last_error}")

    return {
        "move": target_move,
        "explanation": _fallback_explanation(
            target_move, turn_label, candidate_info, top_candidates, mode, size
        ),
        "model": "engine-heuristic",
        "source": "fallback",
        "fallbackReason": last_error,
    }
