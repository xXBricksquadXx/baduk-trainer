export const BOARD_SIZE = 9;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

// Standard Go column labels (skips 'I' to avoid confusion with '1' or 'J')
export const COL_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J'];

// Traditional 9x9 star-point (3-3) handicap placements: G7, C3, C7, G3
const HANDICAP_COORDS_9X9 = [
  [2, 6], // G7
  [6, 2], // C3
  [2, 2], // C7
  [6, 6], // G3
];

export function createEmptyBoard() {
  return Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(EMPTY),
  );
}

export function createInitialBoard(handicapStones = 0) {
  const board = createEmptyBoard();
  const count = Math.max(0, Math.min(4, handicapStones));
  for (let i = 0; i < count; i++) {
    const [r, c] = HANDICAP_COORDS_9X9[i];
    board[r][c] = BLACK;
  }
  return board;
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

  const selfGroup = getGroupAndLiberties(nextBoard, row, col);
  if (selfGroup.liberties === 0) {
    return { valid: false, reason: 'Illegal suicide move (0 liberties).' };
  }

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

export function estimateAreaScore(board, komi = 6.5) {
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

/**
 * Maps every empty intersection to:
 *   1  = Sealed Black Territory
 *   2  = Sealed White Territory
 *  -1  = Unsealed Black Sphere of Influence (early/midgame radiation)
 *  -2  = Unsealed White Sphere of Influence (early/midgame radiation)
 *   0  = Contested / Neutral
 */
export function computeTerritoryMap(board) {
  const territory = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(0),
  );
  const visited = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(false),
  );

  // 1. Pass 1: Identify 100% sealed territory regions
  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === EMPTY && !visited[r][c]) {
        const region = [];
        const borders = new Set();
        const stack = [[r, c]];
        visited[r][c] = true;

        while (stack.length > 0) {
          const [cr, cc] = stack.pop();
          region.push([cr, cc]);
          for (const [nr, nc] of getNeighbors(cr, cc)) {
            const cell = board[nr][nc];
            if (cell === EMPTY && !visited[nr][nc]) {
              visited[nr][nc] = true;
              stack.push([nr, nc]);
            } else if (cell === BLACK || cell === WHITE) {
              borders.add(cell);
            }
          }
        }

        const owner =
          borders.size === 1 ? (borders.has(BLACK) ? BLACK : WHITE) : 0;
        if (owner !== 0) {
          for (const [rr, cc] of region) {
            territory[rr][cc] = owner;
          }
        }
      }
    }
  }

  // 2. Pass 2: Early/Midgame Manhattan Influence Field on unsealed intersections
  const hasAnyStones = board.some((row) => row.some((cell) => cell !== EMPTY));
  if (!hasAnyStones) return territory;

  const influence = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(0),
  );

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const stone = board[r][c];
      if (stone === EMPTY) continue;
      const sign = stone === BLACK ? 1 : -1;

      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.abs(dr) + Math.abs(dc);
          if (dist === 0 || dist > 2) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < BOARD_SIZE && cc >= 0 && cc < BOARD_SIZE) {
            // Distance 1 radiates +2, distance 2 radiates +1
            influence[rr][cc] += sign * (dist === 1 ? 2 : 1);
          }
        }
      }
    }
  }

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      if (board[r][c] === EMPTY && territory[r][c] === 0) {
        if (influence[r][c] >= 2) territory[r][c] = -BLACK;
        else if (influence[r][c] <= -2) territory[r][c] = -WHITE;
      }
    }
  }

  return territory;
}

/**
 * Returns one liberty badge per connected stone group:
 * [{ row, col, color, liberties, size }]
 */
export function computeChainLiberties(board) {
  const visited = Array.from({ length: BOARD_SIZE }, () =>
    Array(BOARD_SIZE).fill(false),
  );
  const chains = [];

  for (let r = 0; r < BOARD_SIZE; r++) {
    for (let c = 0; c < BOARD_SIZE; c++) {
      const color = board[r][c];
      if (color !== EMPTY && !visited[r][c]) {
        const { stones, liberties } = getGroupAndLiberties(board, r, c);
        for (const [sr, sc] of stones) {
          visited[sr][sc] = true;
        }
        // Anchor badge on the top-most / left-most stone of the chain
        const sorted = [...stones].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        const [anchorR, anchorC] = sorted[0];
        chains.push({
          row: anchorR,
          col: anchorC,
          color,
          liberties,
          size: stones.length,
        });
      }
    }
  }
  return chains;
}

const SGF_ALPHA = 'abcdefghi';

/**
 * Serializes current match history into standard 9x9 Smart Game Format (.sgf).
 */
export function exportToSgf(moveHistory, komi = 6.5, handicapStones = 0) {
  const header = `(;FF[4]GM[1]SZ[9]KM[${komi}]HA[${handicapStones}]AP[AI-Sensei-9x9]`;
  const nodes = moveHistory.map((m) => {
    const tag = m.color === BLACK ? 'B' : 'W';
    if (m.row < 0 || m.col < 0) return `;${tag}[]`;
    return `;${tag}[${SGF_ALPHA[m.col]}${SGF_ALPHA[m.row]}]`;
  });
  return `${header}${nodes.join('')})`;
}

/**
 * Parses a 9x9 SGF string into an array of { color, row, col, coord } moves.
 */
export function parseSgfMoves(sgfText) {
  const moves = [];
  const tokenRegex = /;([BW])\[([a-i]{0,2})\]/gi;
  let match;
  while ((match = tokenRegex.exec(sgfText)) !== null) {
    const color = match[1].toUpperCase() === 'B' ? BLACK : WHITE;
    const raw = match[2].toLowerCase();
    if (raw.length === 2) {
      const col = SGF_ALPHA.indexOf(raw[0]);
      const row = SGF_ALPHA.indexOf(raw[1]);
      if (row >= 0 && row < BOARD_SIZE && col >= 0 && col < BOARD_SIZE) {
        moves.push({ color, row, col, coord: toCoordString(row, col) });
      }
    } else {
      moves.push({ color, row: -1, col: -1, coord: 'PASS' });
    }
  }
  return moves;
}
