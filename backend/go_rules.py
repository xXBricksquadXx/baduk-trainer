from typing import List, Optional, Tuple, Dict, Any

BOARD_SIZE = 9
EMPTY = 0
BLACK = 1
WHITE = 2

# Standard Go column labels up to 19x19 (skips 'I' to avoid confusion with '1' or 'J')
COL_LABELS = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
]


def create_empty_board(board_size: int = BOARD_SIZE) -> List[List[int]]:
    return [[EMPTY for _ in range(board_size)] for _ in range(board_size)]


def clone_board(board: List[List[int]]) -> List[List[int]]:
    return [row[:] for row in board]


def to_coord(row: int, col: int, board_size: int = BOARD_SIZE) -> str:
    if row < 0 or row >= board_size or col < 0 or col >= board_size:
        return "PASS"
    return f"{COL_LABELS[col]}{board_size - row}"


def from_coord(coord: str, board_size: int = BOARD_SIZE) -> Optional[Tuple[int, int]]:
    if not coord or coord.strip().upper() == "PASS":
        return None
    c_str = coord.strip().upper()
    col_char = c_str[0]
    active_cols = COL_LABELS[:board_size]
    if col_char not in active_cols:
        return None
    try:
        row_num = int(c_str[1:])
    except ValueError:
        return None
    row = board_size - row_num
    col = active_cols.index(col_char)
    if row < 0 or row >= board_size:
        return None
    return (row, col)


def get_neighbors(
    row: int, col: int, board_size: int = BOARD_SIZE
) -> List[Tuple[int, int]]:
    out = []
    if row > 0:
        out.append((row - 1, col))
    if row < board_size - 1:
        out.append((row + 1, col))
    if col > 0:
        out.append((row, col - 1))
    if col < board_size - 1:
        out.append((row, col + 1))
    return out


def get_group_and_liberties(
    board: List[List[int]], start_row: int, start_col: int
) -> Tuple[List[Tuple[int, int]], int]:
    size = len(board)
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
        for nr, nc in get_neighbors(r, c, size):
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
    size = len(board)
    if row < 0 or row >= size or col < 0 or col >= size:
        return {"valid": False, "reason": "Out of bounds"}
    if board[row][col] != EMPTY:
        return {"valid": False, "reason": "Intersection already occupied"}
    if ko_point is not None and ko_point == (row, col):
        return {"valid": False, "reason": "Illegal Ko recapture"}

    next_board = clone_board(board)
    next_board[row][col] = color
    opponent = WHITE if color == BLACK else BLACK
    captured: List[Tuple[int, int]] = []

    for nr, nc in get_neighbors(row, col, size):
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
    size = len(board)
    legal = []
    for r in range(size):
        for c in range(size):
            if board[r][c] == EMPTY:
                res = apply_move(board, r, c, color, ko_point)
                if res["valid"]:
                    legal.append((r, c))
    return legal


def estimate_area_score(board: List[List[int]], komi: float = 5.5) -> Dict[str, Any]:
    size = len(board)
    black_score = 0.0
    white_score = float(komi)
    visited = set()

    for r in range(size):
        for c in range(size):
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
                    for nr, nc in get_neighbors(cr, cc, size):
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
