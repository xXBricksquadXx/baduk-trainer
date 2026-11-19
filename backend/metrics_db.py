import sqlite3
from pathlib import Path
from typing import Dict, Any, List

DB_PATH = Path(__file__).parent / "data" / "metrics.db"


def get_conn() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS puzzle_attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                puzzle_id TEXT NOT NULL,
                category TEXT NOT NULL,
                solved INTEGER NOT NULL DEFAULT 0,
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
                played_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            """)


def record_puzzle_result(puzzle_id: str, category: str, solved: bool) -> Dict[str, Any]:
    init_db()
    with get_conn() as conn:
        existing = conn.execute(
            "SELECT id, solved, attempts FROM puzzle_attempts WHERE puzzle_id = ?",
            (puzzle_id,),
        ).fetchone()

        if existing:
            new_solved = 1 if (existing["solved"] == 1 or solved) else 0
            new_attempts = existing["attempts"] + 1
            conn.execute(
                """
                UPDATE puzzle_attempts
                SET solved = ?, attempts = ?, solved_at = CURRENT_TIMESTAMP
                WHERE puzzle_id = ?
                """,
                (new_solved, new_attempts, puzzle_id),
            )
        else:
            conn.execute(
                """
                INSERT INTO puzzle_attempts (puzzle_id, category, solved, attempts)
                VALUES (?, ?, ?, 1)
                """,
                (puzzle_id, category, 1 if solved else 0),
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
        conn.execute(
            """
            INSERT INTO match_history (opponent_rank, human_color, winner, margin, moves_count)
            VALUES (?, ?, ?, ?, ?)
            """,
            (opponent_rank, human_color, winner, margin, moves_count),
        )
    return get_progress_summary()


def get_progress_summary() -> Dict[str, Any]:
    init_db()
    with get_conn() as conn:
        solved_rows = conn.execute(
            "SELECT puzzle_id, category, solved, attempts FROM puzzle_attempts"
        ).fetchall()

        solved_ids = [r["puzzle_id"] for r in solved_rows if r["solved"] == 1]
        total_reps = sum(r["attempts"] for r in solved_rows)

        by_category: Dict[str, Dict[str, int]] = {}
        for r in solved_rows:
            cat = r["category"]
            if cat not in by_category:
                by_category[cat] = {"solved": 0, "reps": 0}
            if r["solved"] == 1:
                by_category[cat]["solved"] += 1
            by_category[cat]["reps"] += r["attempts"]

        matches = conn.execute("""
            SELECT opponent_rank, human_color, winner, margin, moves_count, played_at
            FROM match_history
            ORDER BY id DESC
            LIMIT 15
            """).fetchall()

        wins = sum(1 for m in matches if m["winner"] == m["human_color"])

        # Estimate current dojo milestone rank from solved drills + match wins
        score_points = len(solved_ids) * 2 + wins * 3
        estimated_kyu = max(15, 30 - (score_points // 2))

        return {
            "solvedIds": solved_ids,
            "totalSolved": len(solved_ids),
            "totalReps": total_reps,
            "byCategory": by_category,
            "recentMatches": [dict(m) for m in matches],
            "totalMatches": len(matches),
            "matchWins": wins,
            "estimatedRank": f"{estimated_kyu} Kyu",
        }
