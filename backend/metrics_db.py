import sqlite3
from pathlib import Path
from typing import Dict, Any

DB_PATH = Path(__file__).parent / "data" / "metrics.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def _parse_rank_to_numeric(rank_str: str) -> float:
    """Converts '30k' -> 30.0, '1k' -> 1.0, '1d' -> 0.0, '2d' -> -1.0."""
    r = rank_str.strip().lower()
    if r.endswith("d"):
        dan = max(1, min(9, int(r[:-1] or 1)))
        return float(1 - dan)
    if r.endswith("k"):
        try:
            return float(max(1, min(30, int(r[:-1]))))
        except ValueError:
            return 25.0
    return 25.0


def _format_numeric_rank(val: float) -> str:
    if val <= 0.5:
        dan = max(1, int(round(1.0 - val)))
        return f"{dan}.0 Dan"
    return f"{val:.1f} Kyu"


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS player_profile (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                numeric_rank REAL NOT NULL DEFAULT 30.0
            );

            INSERT OR IGNORE INTO player_profile (id, numeric_rank) VALUES (1, 30.0);

            CREATE TABLE IF NOT EXISTS puzzle_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                puzzle_id TEXT NOT NULL UNIQUE,
                category TEXT NOT NULL,
                solved INTEGER NOT NULL DEFAULT 0,
                first_try_solved INTEGER NOT NULL DEFAULT 0,
                attempts INTEGER NOT NULL DEFAULT 1,
                solved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS match_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                opponent_rank TEXT NOT NULL,
                human_color TEXT NOT NULL,
                winner TEXT NOT NULL,
                margin REAL NOT NULL,
                moves_count INTEGER NOT NULL,
                rank_delta REAL NOT NULL DEFAULT 0.0,
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """)
        cols_p = [
            r["name"]
            for r in conn.execute("PRAGMA table_info(puzzle_attempts)").fetchall()
        ]
        if "first_try_solved" not in cols_p:
            conn.execute(
                "ALTER TABLE puzzle_attempts ADD COLUMN first_try_solved INTEGER NOT NULL DEFAULT 0"
            )

        cols_m = [
            r["name"]
            for r in conn.execute("PRAGMA table_info(match_history)").fetchall()
        ]
        if "rank_delta" not in cols_m:
            conn.execute(
                "ALTER TABLE match_history ADD COLUMN rank_delta REAL NOT NULL DEFAULT 0.0"
            )


def _get_verified_floor(conn: sqlite3.Connection) -> float | None:
    """Returns the lowest (strongest) numeric rank defeated at least twice."""
    rows = conn.execute("""
        SELECT opponent_rank, COUNT(*) AS wins
        FROM match_history
        WHERE LOWER(winner) = LOWER(human_color)
        GROUP BY LOWER(opponent_rank)
        HAVING wins >= 2
        """).fetchall()
    if not rows:
        return None
    return min(_parse_rank_to_numeric(r["opponent_rank"]) for r in rows)


def _compute_match_delta(
    curr_rank: float, opp_num: float, won: bool, margin: float
) -> float:
    """
    AGA/Glicko-inspired rank delta:
    - Gap > 0: opponent is stronger than player (volatility scales up on upsets).
    - Gap < 0: opponent is weaker than player.
    - Zero rating gain if beating an opponent > 3.0 Kyu weaker than current rating.
    """
    gap = curr_rank - opp_num

    # Warm-up filter: beating a bot more than 3 Kyu weaker yields 0 rank gain
    if won and gap < -3.0:
        return 0.0

    # Expected win probability (6.0 Kyu spread = ~90% expected win rate)
    expected_win = 1.0 / (1.0 + (10.0 ** (-gap / 6.0)))
    actual_score = 1.0 if won else 0.0

    # Dynamic K-factor: scales up when defeating stronger opponents so breakthroughs converge fast
    upset_boost = max(0.0, gap) * 0.22 if won else 0.0
    margin_mod = min(0.25, max(0.0, margin) / 80.0) if won else 0.0
    k_factor = min(2.65, 0.90 + upset_boost + margin_mod)

    # Negative delta improves Kyu (moves closer to 1.0k / Dan)
    delta = -k_factor * (actual_score - expected_win)
    return round(delta, 2)


def record_puzzle_result(puzzle_id: str, category: str, solved: bool) -> Dict[str, Any]:
    init_db()
    with get_conn() as conn:
        profile = conn.execute(
            "SELECT numeric_rank FROM player_profile WHERE id = 1"
        ).fetchone()
        curr_rank = float(profile["numeric_rank"])

        existing = conn.execute(
            "SELECT solved, first_try_solved, attempts FROM puzzle_attempts WHERE puzzle_id = ?",
            (puzzle_id,),
        ).fetchone()

        rank_shift = 0.0
        if existing:
            already_solved = existing["solved"] == 1
            new_solved = 1 if (already_solved or solved) else 0
            new_attempts = existing["attempts"] + 1
            conn.execute(
                """
                UPDATE puzzle_attempts
                SET solved = ?, attempts = ?, solved_at = CURRENT_TIMESTAMP
                WHERE puzzle_id = ?
                """,
                (new_solved, new_attempts, puzzle_id),
            )
            # Partial lab credit capped strictly at 24.0k
            if solved and not already_solved and curr_rank > 24.0:
                rank_shift = -0.10
        else:
            first_try = 1 if solved else 0
            conn.execute(
                """
                INSERT INTO puzzle_attempts (puzzle_id, category, solved, first_try_solved, attempts)
                VALUES (?, ?, ?, ?, 1)
                """,
                (puzzle_id, category, 1 if solved else 0, first_try),
            )
            # Clean first-try lab credit capped strictly at 22.0k
            if solved and curr_rank > 22.0:
                rank_shift = -0.25

        if rank_shift != 0.0:
            next_rank = max(-8.0, min(30.0, round(curr_rank + rank_shift, 2)))
            conn.execute(
                "UPDATE player_profile SET numeric_rank = ? WHERE id = 1", (next_rank,)
            )

    return get_progress_summary()


def record_match_result(
    opponent_rank: str,
    human_color: str,
    winner: str,
    margin: float,
    moves_count: int,
) -> Dict[str, Any]:
    init_db()
    with get_conn() as conn:
        profile = conn.execute(
            "SELECT numeric_rank FROM player_profile WHERE id = 1"
        ).fetchone()
        curr_rank = float(profile["numeric_rank"])
        opp_num = _parse_rank_to_numeric(opponent_rank)

        won = winner.strip().lower() == human_color.strip().lower()
        delta = _compute_match_delta(curr_rank, opp_num, won, margin)
        next_rank = max(-8.0, min(30.0, round(curr_rank + delta, 2)))

        conn.execute(
            """
            INSERT INTO match_history (opponent_rank, human_color, winner, margin, moves_count, rank_delta)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (opponent_rank, human_color, winner, margin, moves_count, delta),
        )

        # Pull rating up to within 2.0 stones of proven peer floor (defeated >= 2x)
        verified_floor = _get_verified_floor(conn)
        if verified_floor is not None and next_rank > verified_floor + 2.0:
            next_rank = round(verified_floor + 2.0, 2)

        conn.execute(
            "UPDATE player_profile SET numeric_rank = ? WHERE id = 1", (next_rank,)
        )

    return get_progress_summary()


def recalculate_honest_rank() -> Dict[str, Any]:
    """Replays existing puzzles + match_history from 30.0k under the weighted AGA/Elo rubric."""
    init_db()
    with get_conn() as conn:
        puzzles = conn.execute(
            "SELECT solved, first_try_solved FROM puzzle_attempts ORDER BY id ASC"
        ).fetchall()
        rank = 30.0
        for p in puzzles:
            if p["solved"] == 1:
                if p["first_try_solved"] == 1 and rank > 22.0:
                    rank = round(rank - 0.25, 2)
                elif rank > 24.0:
                    rank = round(rank - 0.10, 2)

        matches = conn.execute(
            "SELECT id, opponent_rank, human_color, winner, margin FROM match_history ORDER BY id ASC"
        ).fetchall()
        wins_by_opp: Dict[float, int] = {}
        for m in matches:
            opp_num = _parse_rank_to_numeric(m["opponent_rank"])
            won = m["winner"].strip().lower() == m["human_color"].strip().lower()
            delta = _compute_match_delta(rank, opp_num, won, float(m["margin"]))
            rank = max(-8.0, min(30.0, round(rank + delta, 2)))

            if won:
                wins_by_opp[opp_num] = wins_by_opp.get(opp_num, 0) + 1
                verified_ranks = [r for r, cnt in wins_by_opp.items() if cnt >= 2]
                if verified_ranks:
                    floor = min(verified_ranks)
                    if rank > floor + 2.0:
                        rank = round(floor + 2.0, 2)

            conn.execute(
                "UPDATE match_history SET rank_delta = ? WHERE id = ?",
                (delta, m["id"]),
            )

        conn.execute("UPDATE player_profile SET numeric_rank = ? WHERE id = 1", (rank,))

    return get_progress_summary()


def get_progress_summary() -> Dict[str, Any]:
    init_db()
    with get_conn() as conn:
        profile = conn.execute(
            "SELECT numeric_rank FROM player_profile WHERE id = 1"
        ).fetchone()
        curr_rank = float(profile["numeric_rank"])

        solved_rows = conn.execute(
            "SELECT puzzle_id, category, solved, first_try_solved, attempts FROM puzzle_attempts"
        ).fetchall()

        solved_ids = [r["puzzle_id"] for r in solved_rows if r["solved"] == 1]
        first_try_count = sum(1 for r in solved_rows if r["first_try_solved"] == 1)
        total_reps = sum(r["attempts"] for r in solved_rows)

        by_category: Dict[str, Dict[str, int]] = {}
        for r in solved_rows:
            cat = r["category"]
            if cat not in by_category:
                by_category[cat] = {"solved": 0, "firstTry": 0, "reps": 0}
            if r["solved"] == 1:
                by_category[cat]["solved"] += 1
            if r["first_try_solved"] == 1:
                by_category[cat]["firstTry"] += 1
            by_category[cat]["reps"] += r["attempts"]

        agg = conn.execute("""
            SELECT
                COUNT(*) AS total_matches,
                COALESCE(SUM(CASE WHEN LOWER(winner) = LOWER(human_color) THEN 1 ELSE 0 END), 0) AS total_wins,
                COALESCE(ROUND(AVG(CASE WHEN LOWER(winner) = LOWER(human_color) THEN margin END), 1), 0.0) AS avg_win_margin
            FROM match_history
            """).fetchone()

        total_matches = int(agg["total_matches"])
        total_wins = int(agg["total_wins"])
        avg_win_margin = float(agg["avg_win_margin"])
        win_rate = (
            round((total_wins / total_matches) * 100, 1) if total_matches > 0 else 0.0
        )

        # Highest bot rank defeated at least twice (Verified Benchmark)
        verified_rows = conn.execute("""
            SELECT opponent_rank, COUNT(*) AS wins
            FROM match_history
            WHERE LOWER(winner) = LOWER(human_color)
            GROUP BY LOWER(opponent_rank)
            HAVING wins >= 2
            """).fetchall()
        verified_str = "Unranked"
        if verified_rows:
            strongest_num = min(
                _parse_rank_to_numeric(r["opponent_rank"]) for r in verified_rows
            )
            verified_str = _format_numeric_rank(strongest_num).replace(".0 ", " ")

        recent_matches = conn.execute("""
            SELECT opponent_rank, human_color, winner, margin, moves_count, rank_delta, played_at
            FROM match_history
            ORDER BY id DESC
            LIMIT 10
            """).fetchall()

        accuracy = round((first_try_count / len(solved_ids)) * 100) if solved_ids else 0

        return {
            "solvedIds": solved_ids,
            "totalSolved": len(solved_ids),
            "firstTrySolved": first_try_count,
            "firstTryAccuracy": accuracy,
            "totalReps": total_reps,
            "byCategory": by_category,
            "recentMatches": [dict(m) for m in recent_matches],
            "totalMatches": total_matches,
            "matchWins": total_wins,
            "winRate": win_rate,
            "avgWinMargin": avg_win_margin,
            "numericRank": curr_rank,
            "estimatedRank": _format_numeric_rank(curr_rank),
            "verifiedRank": verified_str,
        }
