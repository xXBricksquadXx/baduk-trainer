export const BOARD_SIZE = 9;
export const EMPTY = 0;
export const BLACK = 1;
export const WHITE = 2;

// Standard Go column labels up to 19x19 (skips 'I' to avoid confusion with '1' or 'J')
export const ALL_COL_LABELS = [
  'A',
  'B',
  'C',
  'D',
  'E',
  'F',
  'G',
  'H',
  'J',
  'K',
  'L',
  'M',
  'N',
  'O',
  'P',
  'Q',
  'R',
  'S',
  'T',
];
export const COL_LABELS = ALL_COL_LABELS.slice(0, BOARD_SIZE);

// Traditional 9x9 star-point (3-3) handicap placements: G7, C3, C7, G3
const HANDICAP_COORDS_9X9 = [
  [2, 6], // G7
  [6, 2], // C3
  [2, 2], // C7
  [6, 6], // G3
];

// Traditional 13x13 star-point (4-4) handicap placements: K10, D4, D10, K4
const HANDICAP_COORDS_13X13 = [
  [3, 9], // K10
  [9, 3], // D4
  [3, 3], // D10
  [9, 9], // K4
];

export function getColLabels(boardSize = BOARD_SIZE) {
  return ALL_COL_LABELS.slice(0, boardSize);
}

export function createEmptyBoard(boardSize = BOARD_SIZE) {
  return Array.from({ length: boardSize }, () => Array(boardSize).fill(EMPTY));
}

export function createInitialBoard(handicapStones = 0, boardSize = BOARD_SIZE) {
  const board = createEmptyBoard(boardSize);
  const count = Math.max(0, Math.min(4, handicapStones));
  const coords = boardSize === 13 ? HANDICAP_COORDS_13X13 : HANDICAP_COORDS_9X9;
  for (let i = 0; i < count; i++) {
    const [r, c] = coords[i];
    board[r][c] = BLACK;
  }
  return board;
}

export function cloneBoard(board) {
  return board.map((row) => [...row]);
}

export function toCoordString(row, col, boardSize = BOARD_SIZE) {
  if (row < 0 || row >= boardSize || col < 0 || col >= boardSize) return 'PASS';
  return `${ALL_COL_LABELS[col]}${boardSize - row}`;
}

export function fromCoordString(coord, boardSize = BOARD_SIZE) {
  if (!coord || coord.toUpperCase() === 'PASS') return null;
  const colChar = coord[0].toUpperCase();
  const labels = getColLabels(boardSize);
  const col = labels.indexOf(colChar);
  const rowNum = parseInt(coord.slice(1), 10);
  const row = boardSize - rowNum;
  if (col === -1 || Number.isNaN(row) || row < 0 || row >= boardSize)
    return null;
  return { row, col };
}

function getNeighbors(row, col, boardSize = BOARD_SIZE) {
  const neighbors = [];
  if (row > 0) neighbors.push([row - 1, col]);
  if (row < boardSize - 1) neighbors.push([row + 1, col]);
  if (col > 0) neighbors.push([row, col - 1]);
  if (col < boardSize - 1) neighbors.push([row, col + 1]);
  return neighbors;
}

export function getGroupAndLiberties(board, startRow, startCol) {
  const size = board.length;
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

    for (const [nr, nc] of getNeighbors(r, c, size)) {
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
  const size = board.length;
  if (row < 0 || row >= size || col < 0 || col >= size) {
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

  for (const [nr, nc] of getNeighbors(row, col, size)) {
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
  const size = board.length;
  let blackScore = 0;
  let whiteScore = komi;
  const visited = new Set();

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
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
          for (const [nr, nc] of getNeighbors(cr, cc, size)) {
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

export function computeTerritoryMap(board) {
  const size = board.length;
  const territory = Array.from({ length: size }, () => Array(size).fill(0));
  const visited = Array.from({ length: size }, () => Array(size).fill(false));

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === EMPTY && !visited[r][c]) {
        const region = [];
        const borders = new Set();
        const stack = [[r, c]];
        visited[r][c] = true;

        while (stack.length > 0) {
          const [cr, cc] = stack.pop();
          region.push([cr, cc]);
          for (const [nr, nc] of getNeighbors(cr, cc, size)) {
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

  const hasAnyStones = board.some((row) => row.some((cell) => cell !== EMPTY));
  if (!hasAnyStones) return territory;

  const influence = Array.from({ length: size }, () => Array(size).fill(0));

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const stone = board[r][c];
      if (stone === EMPTY) continue;
      const sign = stone === BLACK ? 1 : -1;

      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.abs(dr) + Math.abs(dc);
          if (dist === 0 || dist > 2) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr >= 0 && rr < size && cc >= 0 && cc < size) {
            influence[rr][cc] += sign * (dist === 1 ? 2 : 1);
          }
        }
      }
    }
  }

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (board[r][c] === EMPTY && territory[r][c] === 0) {
        if (influence[r][c] >= 2) territory[r][c] = -BLACK;
        else if (influence[r][c] <= -2) territory[r][c] = -WHITE;
      }
    }
  }

  return territory;
}

export function computeChainLiberties(board) {
  const size = board.length;
  const visited = Array.from({ length: size }, () => Array(size).fill(false));
  const chains = [];

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const color = board[r][c];
      if (color !== EMPTY && !visited[r][c]) {
        const { stones, liberties } = getGroupAndLiberties(board, r, c);
        for (const [sr, sc] of stones) {
          visited[sr][sc] = true;
        }
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

const SGF_ALPHA = 'abcdefghijklmnopqrs';

function escapeSgfText(val) {
  return String(val ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\]/g, '\\]');
}

function formatKyuTag(rankStr) {
  if (!rankStr) return '';
  const match = String(rankStr)
    .trim()
    .match(/^(\d+(?:\.\d+)?)\s*(k|kyu|d|dan)/i);
  if (!match) return String(rankStr).trim();
  const num = Math.max(1, Math.round(parseFloat(match[1])));
  const unit = match[2].toLowerCase().startsWith('d') ? 'd' : 'k';
  return `${num}${unit}`;
}

export function exportToSgf(
  moveHistory,
  komi = 6.5,
  handicapStones = 0,
  meta = {},
  boardSize = BOARD_SIZE,
) {
  const dateStr = meta.date || new Date().toISOString().slice(0, 10);
  const tags = [
    'FF[4]',
    'GM[1]',
    `SZ[${boardSize}]`,
    `KM[${komi}]`,
    `HA[${handicapStones}]`,
    `AP[AI-Sensei-${boardSize}x${boardSize}]`,
    `DT[${dateStr}]`,
  ];

  if (meta.blackName) tags.push(`PB[${escapeSgfText(meta.blackName)}]`);
  if (meta.whiteName) tags.push(`PW[${escapeSgfText(meta.whiteName)}]`);
  if (meta.blackRank)
    tags.push(`BR[${escapeSgfText(formatKyuTag(meta.blackRank))}]`);
  if (meta.whiteRank)
    tags.push(`WR[${escapeSgfText(formatKyuTag(meta.whiteRank))}]`);
  if (meta.result) tags.push(`RE[${escapeSgfText(meta.result)}]`);

  const nodes = moveHistory.map((m) => {
    const tag = m.color === BLACK ? 'B' : 'W';
    if (m.row < 0 || m.col < 0) return `;${tag}[]`;
    return `;${tag}[${SGF_ALPHA[m.col]}${SGF_ALPHA[m.row]}]`;
  });

  return `(;${tags.join('')}${nodes.join('')})`;
}

export function parseSgf(sgfText) {
  const extractTag = (tag) => {
    const m = sgfText.match(new RegExp(`${tag}\\[((?:\\\\.|[^\\]])*)\\]`));
    return m ? m[1].replace(/\\([\]\\])/g, '$1').trim() : null;
  };

  const parsedSize = extractTag('SZ') ? parseInt(extractTag('SZ'), 10) : 9;
  const boardSize = parsedSize === 13 ? 13 : 9;

  const meta = {
    boardSize,
    blackName: extractTag('PB') || 'Black',
    whiteName: extractTag('PW') || 'White',
    blackRank: extractTag('BR') || '',
    whiteRank: extractTag('WR') || '',
    result: extractTag('RE') || '',
    date: extractTag('DT') || '',
    komi: extractTag('KM') ? parseFloat(extractTag('KM')) : 6.5,
    handicap: extractTag('HA') ? parseInt(extractTag('HA'), 10) : 0,
  };

  const moves = [];
  const tokenRegex = /;([BW])\[([a-s]{0,2})\]/gi;
  let match;
  while ((match = tokenRegex.exec(sgfText)) !== null) {
    const color = match[1].toUpperCase() === 'B' ? BLACK : WHITE;
    const raw = match[2].toLowerCase();
    if (raw.length === 2) {
      const col = SGF_ALPHA.indexOf(raw[0]);
      const row = SGF_ALPHA.indexOf(raw[1]);
      if (row >= 0 && row < boardSize && col >= 0 && col < boardSize) {
        moves.push({
          color,
          row,
          col,
          coord: toCoordString(row, col, boardSize),
        });
      }
    } else {
      moves.push({ color, row: -1, col: -1, coord: 'PASS' });
    }
  }

  return { moves, meta };
}

export function parseSgfMoves(sgfText) {
  return parseSgf(sgfText).moves;
}
