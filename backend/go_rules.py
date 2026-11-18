from typing import List, Optional, Tuple, Dict, Any

BOARD_SIZE = 9
EMPTY = 0
BLACK = 1
WHITE = 2

COL_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H", "J"]


def create_empty_board() -> List[List[int]]:
    return [[EMPTY for _ in range(BOARD_SIZE)] for _ in range(BOARD_SIZE)]


def clone_board(board: List[List[int]]) -> List[List[int]]:
    return [row[:] for row in board]


def to_coord(row: int, col: int) -> str:
    if row < 0 or row >= BOARD_SIZE or col < 0 or col >= BOARD_SIZE:
        return "PASS"
    return f"{COL_LABELS[col]}{BOARD_SIZE - row}"


def from_coord(coord: str) -> Optional[Tuple[int, int]]:
    if not coord or coord.strip().upper() == "PASS":
        return None
    c_str = coord.strip().upper()
    col_char = c_str[0]
    if col_char not in COL_LABELS:
        return None
    try:
        row_num = int(c_str[1:])
    except ValueError:
        return None
    row = BOARD_SIZE - row_num
    col = COL_LABELS.index(col_char)
    if row < 0 or row >= BOARD_SIZE:
        return None
    return (row, col)


def get_neighbors(row: int, col: int) -> List[Tuple[int, int]]:
    out = []
    if row > 0:
        out.append((row - 1, col))
    if row < BOARD_SIZE - 1:
        out.append((row + 1, col))
    if col > 0:
        out.append((row, col - 1))
    if col < BOARD_SIZE - 1:
        out.append((row, col + 1))
    return out


def get_group_and_liberties(
    board: List[List[int]], start_row: int, start_col: int
) -> Tuple[List[Tuple[int, int]], int]:
    color = board[start_row][start_col]
    if color == EMPTY:
        return ([], 0)

    visited = {(start_row, start_col)}
    liberties = set()
    stones: List[Tuple[int, int]] = []
    stack = [(start_row, start_col)]

    while stack:
        r, c = stack.pop()
        stones.append((r, c))
        for nr, nc in get_neighbors(r, c):
            cell = board[nr][nc]
            if cell == EMPTY:
                liberties.add((nr, nc))
            elif cell == color and (nr, nc) not in visited:
                visited.add((nr, nc))
                stack.append((nr, nc))

    return (stones, len(liberties))


def apply_move(
    board: List[List[int]],
    row: int,
    col: int,
    color: int,
    ko_point: Optional[Tuple[int, int]] = None,
) -> Dict[str, Any]:
    if row < 0 or row >= BOARD_SIZE or col < 0 or col >= BOARD_SIZE:
        return {"valid": False, "reason": "Out of bounds"}
    if board[row][col] != EMPTY:
        return {"valid": False, "reason": "Intersection already occupied"}
    if ko_point is not None and ko_point == (row, col):
        return {"valid": False, "reason": "Illegal Ko recapture"}

    next_board = clone_board(board)
    next_board[row][col] = color
    opponent = WHITE if color == BLACK else BLACK
    captured: List[Tuple[int, int]] = []

    for nr, nc in get_neighbors(row, col):
        if next_board[nr][nc] == opponent:
            stones, libs = get_group_and_liberties(next_board, nr, nc)
            if libs == 0:
                for sr, sc in stones:
                    next_board[sr][sc] = EMPTY
                    captured.append((sr, sc))

    self_stones, self_libs = get_group_and_liberties(next_board, row, col)
    if self_libs == 0:
        return {"valid": False, "reason": "Illegal suicide move"}

    next_ko = None
    if len(captured) == 1 and len(self_stones) == 1 and self_libs == 1:
        next_ko = captured[0]

    return {
        "valid": True,
        "board": next_board,
        "captured_count": len(captured),
        "ko_point": next_ko,
    }


def get_legal_moves(
    board: List[List[int]],
    color: int,
    ko_point: Optional[Tuple[int, int]] = None,
) -> List[Tuple[int, int]]:
    legal = []
    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            if board[r][c] == EMPTY:
                res = apply_move(board, r, c, color, ko_point)
                if res["valid"]:
                    legal.append((r, c))
    return legal


def estimate_area_score(board: List[List[int]], komi: float = 5.5) -> Dict[str, Any]:
    black_score = 0.0
    white_score = float(komi)
    visited = set()

    for r in range(BOARD_SIZE):
        for c in range(BOARD_SIZE):
            cell = board[r][c]
            if cell == BLACK:
                black_score += 1.0
            elif cell == WHITE:
                white_score += 1.0
            elif (r, c) not in visited:
                region = []
                borders = set()
                stack = [(r, c)]
                visited.add((r, c))
                while stack:
                    cr, cc = stack.pop()
                    region.append((cr, cc))
                    for nr, nc in get_neighbors(cr, cc):
                        ncell = board[nr][nc]
                        if ncell == EMPTY and (nr, nc) not in visited:
                            visited.add((nr, nc))
                            stack.append((nr, nc))
                        elif ncell != EMPTY:
                            borders.add(ncell)
                if len(borders) == 1:
                    if BLACK in borders:
                        black_score += len(region)
                    elif WHITE in borders:
                        white_score += len(region)

    diff = round(black_score - white_score, 1)
    return {
        "black": black_score,
        "white": white_score,
        "winner": "Black" if diff > 0 else "White",
        "margin": abs(diff),
    }
