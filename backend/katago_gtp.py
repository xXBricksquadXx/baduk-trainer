import re
import subprocess
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from go_rules import BLACK, WHITE, EMPTY, from_coord, to_coord

ENGINE_DIR = Path(__file__).parent / "engine"
KATAGO_BIN = ENGINE_DIR / "katago.exe"
KATAGO_CFG = ENGINE_DIR / "gtp.cfg"


def _find_model_path() -> Optional[Path]:
    for name in ("model.bin.gz", "model.txt"):
        p = ENGINE_DIR / name
        if p.exists():
            return p
    for pattern in ("*.bin.gz", "*.txt"):
        matches = [m for m in ENGINE_DIR.glob(pattern) if m.name not in ("gtp.cfg",)]
        if matches:
            return matches[0]
    return None


def is_katago_ready() -> bool:
    return (
        KATAGO_BIN.exists() and KATAGO_CFG.exists() and (_find_model_path() is not None)
    )


def _rank_to_visits(rank: str) -> int:
    """Calibrates KataGo maxVisits so 3k feels human-beatable while 1d+ pushes hard."""
    r = rank.strip().lower()
    if r.endswith("d"):
        dan = max(1, min(9, int(r[:-1] or 1)))
        return min(150, 35 + dan * 20)
    if r.endswith("k"):
        try:
            kyu = max(1, min(30, int(r[:-1])))
        except ValueError:
            kyu = 6
        if kyu <= 3:
            return 18
        if kyu <= 6:
            return 8
        return 4
    return 25


class KataGoSession:
    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._cmd_id = 0

    def start(self) -> bool:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                return True
            model_path = _find_model_path()
            if not (KATAGO_BIN.exists() and KATAGO_CFG.exists() and model_path):
                return False
            self._proc = subprocess.Popen(
                [
                    str(KATAGO_BIN),
                    "gtp",
                    "-model",
                    str(model_path),
                    "-config",
                    str(KATAGO_CFG),
                ],
                cwd=str(ENGINE_DIR),
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                bufsize=1,
            )
            self._send_locked("name")
            return True

    def stop(self) -> None:
        with self._lock:
            if self._proc is not None and self._proc.poll() is None:
                try:
                    self._send_locked("quit")
                except Exception:
                    pass
                self._proc.terminate()
            self._proc = None

    def _send_locked(self, command: str) -> str:
        if self._proc is None or self._proc.poll() is not None:
            raise RuntimeError("KataGo process not running")
        assert self._proc.stdin is not None and self._proc.stdout is not None

        self._cmd_id += 1
        cid = self._cmd_id
        self._proc.stdin.write(f"{cid} {command}\n")
        self._proc.stdin.flush()

        lines: List[str] = []
        prefix_ok = f"={cid}"
        prefix_err = f"?{cid}"
        while True:
            line = self._proc.stdout.readline()
            if not line:
                raise RuntimeError("KataGo EOF")
            stripped = line.rstrip("\r\n")
            if stripped == "" and lines:
                break
            if (
                stripped.startswith(prefix_ok)
                or stripped.startswith(prefix_err)
                or lines
            ):
                lines.append(stripped)

        header = lines[0]
        body = "\n".join(lines[1:]).strip()
        first_line_rest = header.split(" ", 1)[1].strip() if " " in header else ""
        full_out = "\n".join(p for p in (first_line_rest, body) if p).strip()
        if header.startswith("?"):
            raise RuntimeError(f"GTP error on '{command}': {full_out}")
        return full_out

    def _sync_board_locked(self, board: List[List[int]], komi: float = 6.5) -> int:
        size = len(board)
        self._send_locked(f"boardsize {size}")
        self._send_locked("clear_board")
        self._send_locked(f"komi {komi}")

        black_stones = []
        white_stones = []
        for r in range(size):
            for c in range(size):
                if board[r][c] == BLACK:
                    black_stones.append(to_coord(r, c))
                elif board[r][c] == WHITE:
                    white_stones.append(to_coord(r, c))

        if black_stones:
            self._send_locked(
                f"set_position {' '.join('B ' + s for s in black_stones)}"
            )
        if white_stones:
            # KataGo supports incremental set_position or play commands; use play for White after B
            for ws in white_stones:
                self._send_locked(f"play W {ws}")
        return size

    def analyze_position(
        self,
        board: List[List[int]],
        color: int,
        rank: str = "1d",
        top_k: int = 4,
        komi: float = 6.5,
    ) -> List[Dict[str, Any]]:
        if not self.start():
            return []
        visits = _rank_to_visits(rank)
        gtp_color = "B" if color == BLACK else "W"

        with self._lock:
            self._sync_board_locked(board, komi=komi)
            self._send_locked(f"kata-set-param maxVisits {visits}")
            self._send_locked(f"kata-set-param maxPlayouts {visits}")

            assert (
                self._proc is not None
                and self._proc.stdin is not None
                and self._proc.stdout is not None
            )
            self._cmd_id += 1
            cid = self._cmd_id
            self._proc.stdin.write(
                f"{cid} kata-analyze {gtp_color} 50 maxmoves {top_k}\n"
            )
            self._proc.stdin.flush()

            info_line = ""
            while True:
                line = self._proc.stdout.readline()
                if not line:
                    break
                s = line.strip()
                if s.startswith("info move "):
                    info_line = s
                    # Stop analysis as soon as KataGo reaches target visits
                    m_visits = re.search(r"visits\s+(\d+)", s)
                    if m_visits and int(m_visits.group(1)) >= max(2, visits // 2):
                        self._proc.stdin.write("\n")
                        self._proc.stdin.flush()
                elif s == "" and info_line:
                    break

        if not info_line:
            return []

        chunks = info_line.split("info move ")[1:]
        results: List[Dict[str, Any]] = []
        for idx, chunk in enumerate(chunks[:top_k], start=1):
            tokens = chunk.split()
            move_str = tokens[0].upper()
            if move_str == "PASS":
                rc: Optional[Tuple[int, int]] = (-1, -1)
            else:
                rc = from_coord(move_str)
            if rc is None:
                continue

            winrate = 50.0
            score_lead = 0.0
            if "winrate" in tokens:
                winrate = round(float(tokens[tokens.index("winrate") + 1]) * 100.0, 1)
            if "scoreLead" in tokens:
                score_lead = round(float(tokens[tokens.index("scoreLead") + 1]), 1)

            results.append(
                {
                    "rank": idx,
                    "row": rc[0],
                    "col": rc[1],
                    "move": move_str,
                    "winrate": winrate,
                    "scoreLead": score_lead,
                    "tags": [f"KataGo GPU ({rank.upper()}, {visits}v)"],
                }
            )
        return results

    def genmove(
        self,
        board: List[List[int]],
        color: int,
        rank: str = "1d",
        komi: float = 6.5,
    ) -> Optional[Dict[str, Any]]:
        if not self.start():
            return None
        visits = _rank_to_visits(rank)
        gtp_color = "B" if color == BLACK else "W"

        with self._lock:
            self._sync_board_locked(board, komi=komi)
            self._send_locked(f"kata-set-param maxVisits {visits}")
            self._send_locked(f"kata-set-param maxPlayouts {visits}")
            move_raw = self._send_locked(f"genmove {gtp_color}").strip().upper()

        if not move_raw or move_raw == "RESIGN":
            return None
        if move_raw == "PASS":
            return {
                "move": "PASS",
                "row": -1,
                "col": -1,
                "winrate": 50.0,
                "tags": ["KataGo GPU endgame pass"],
            }
        rc = from_coord(move_raw)
        if rc is None:
            return None
        return {
            "move": move_raw,
            "row": rc[0],
            "col": rc[1],
            "winrate": 55.0,
            "tags": [f"KataGo GPU ({rank.upper()})"],
        }


katago_session = KataGoSession()
