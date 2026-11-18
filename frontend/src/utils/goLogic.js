export const BOARD_SIZE = 9;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

// Standard Go column labels (skips 'I' to avoid confusion with '1' or 'J')
export const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];

export function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(EMPTY),
  );
}

export function cloneBoard(board) {
  return board.map((row) => [...row]);
}

export function toCoordString(row, col) {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE)
    return 'PASS';
  return `${COL_LABELS[col]}${BOARD_SIZE - row}`;
}

export function fromCoordString(coord) {
  if (!coord || coord.toUpperCase() === 'PASS') return null;
  const colChar = coord[0].toUpperCase();
  const col = COL_LABELS.indexOf(colChar);
  const rowNum = parseInt(coord.slice(1), 10);
  const row = BOARD_SIZE - rowNum;
  if (col === -1 || Number.isNaN(row) || row < 0 || row >= BOARD_SIZE)
    return null;
  return { row, col };
}

function getNeighbors(row, col) {
  const neighbors = [];
  if (row > 0) neighbors.push([row - 1, col]);
  if (row < BOARD_SIZE - 1) neighbors.push([row + 1, col]);
  if (col > 0) neighbors.push([row, col - 1]);
  if (col < BOARD_SIZE - 1) neighbors.push([row, col + 1]);
  return neighbors;
}

/**
 * Flood-fill to collect all connected stones of the same color and count unique liberties.
 */
export function getGroupAndLiberties(board, startRow, startCol) {
  const color = board[startRow][startCol];
  if (color === EMPTY) return { stones: [], liberties: 0 };

  const visited = new Set();
  const libertySet = new Set();
  const stones = [];
  const stack = [[startRow, startCol]];

  visited.add(`${startRow},${startCol}`);

  while (stack.length > 0) {
    const [r, c] = stack.pop();
    stones.push([r, c]);

    for (const [nr, nc] of getNeighbors(r, c)) {
      const key = `${nr},${nc}`;
      const cell = board[nr][nc];
      if (cell === EMPTY) {
        libertySet.add(key);
      } else if (cell === color && !visited.has(key)) {
        visited.add(key);
        stack.push([nr, nc]);
      }
    }
  }

  return { stones, liberties: libertySet.size };
}

/**
 * Attempts to play a move at (row, col) for `color`.
 * Returns { valid: true, board, capturedCount, koPoint } or { valid: false, reason }.
 */
export function applyMove(board, row, col, color, koPoint = null) {
  if (row < 0 || row >= BOARD_SIZE || col < 0 || col >= BOARD_SIZE) {
    return { valid: false, reason: 'Out of bounds.' };
  }
  if (board[row][col] !== EMPTY) {
    return { valid: false, reason: 'Intersection is already occupied.' };
  }
  if (koPoint && koPoint.row === row && koPoint.col === col) {
    return {
      valid: false,
      reason: 'Illegal Ko recapture — play elsewhere first.',
    };
  }

  const nextBoard = cloneBoard(board);
  nextBoard[row][col] = color;
  const opponent = color === BLACK ? WHITE : BLACK;

  let capturedStones = [];

  // 1. Check adjacent opponent groups for zero liberties (captures happen before suicide check)
  for (const [nr, nc] of getNeighbors(row, col)) {
    if (nextBoard[nr][nc] === opponent) {
      const group = getGroupAndLiberties(nextBoard, nr, nc);
      if (group.liberties === 0) {
        for (const [sr, sc] of group.stones) {
          nextBoard[sr][sc] = EMPTY;
          capturedStones.push([sr, sc]);
        }
      }
    }
  }

  // 2. Check suicide rule on the newly placed stone's group
  const selfGroup = getGroupAndLiberties(nextBoard, row, col);
  if (selfGroup.liberties === 0) {
    return { valid: false, reason: 'Illegal suicide move (0 liberties).' };
  }

  // 3. Detect simple Ko: single stone captured by a single-stone group with 1 liberty
  let nextKoPoint = null;
  if (
    capturedStones.length === 1 &&
    selfGroup.stones.length === 1 &&
    selfGroup.liberties === 1
  ) {
    nextKoPoint = { row: capturedStones[0][0], col: capturedStones[0][1] };
  }

  return {
    valid: true,
    board: nextBoard,
    capturedCount: capturedStones.length,
    koPoint: nextKoPoint,
  };
}

/**
 * Quick Chinese-style area count (stones on board + surrounded empty intersections + komi).
 */
export function estimateAreaScore(board, komi = 5.5) {
  let blackScore = 0;
  let whiteScore = komi;
  const visited = new Set();

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const cell = board[r][c];
      if (cell === BLACK) {
        blackScore += 1;
      } else if (cell === WHITE) {
        whiteScore += 1;
      } else if (!visited.has(`${r},${c}`)) {
        // Flood-fill empty region to see which color borders it exclusively
        const region = [];
        const borders = new Set();
        const stack = [[r, c]];
        visited.add(`${r},${c}`);

        while (stack.length > 0) {
          const [cr, cc] = stack.pop();
          region.push([cr, cc]);
          for (const [nr, nc] of getNeighbors(cr, cc)) {
            const nCell = board[nr][nc];
            if (nCell === EMPTY && !visited.has(`${nr},${nc}`)) {
              visited.add(`${nr},${nc}`);
              stack.push([nr, nc]);
            } else if (nCell !== EMPTY) {
              borders.add(nCell);
            }
          }
        }

        if (borders.size === 1) {
          if (borders.has(BLACK)) blackScore += region.length;
          if (borders.has(WHITE)) whiteScore += region.length;
        }
      }
    }
  }

  const diff = +(blackScore - whiteScore).toFixed(1);
  return {
    black: blackScore,
    white: whiteScore,
    winner: diff > 0 ? 'Black' : 'White',
    margin: Math.abs(diff),
  };
}
