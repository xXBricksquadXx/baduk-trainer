import { useState } from 'react';
import { BOARD_SIZE, BLACK, WHITE, EMPTY, COL_LABELS } from '../utils/goLogic';

// Star points (hoshi) on a 9x9 board: (2,2), (2,6), (4,4) tengen, (6,2), (6,6)
const STAR_POINTS = [
  [2, 2],
  [2, 6],
  [4, 4],
  [6, 2],
  [6, 6],
];

export default function Goban9x9({
  board,
  currentTurn,
  lastMove,
  koPoint,
  hints = [], // [{ row, col, rank, move, winrate, scoreLead }]
  selectedHintCoord = null,
  onIntersectionClick,
  onHintClick,
  disabled = false,
}) {
  const [hoverCell, setHoverCell] = useState(null);

  const cellSize = 64;
  const padding = 48;
  const gridSpan = (BOARD_SIZE - 1) * cellSize;
  const totalSize = gridSpan + padding * 2;
  const stoneRadius = cellSize * 0.45;

  const getXY = (row, col) => ({
    x: padding + col * cellSize,
    y: padding + row * cellSize,
  });

  const hintMap = new Map();
  hints.forEach((h) => hintMap.set(`${h.row},${h.col}`, h));

  return (
    <div className="goban-wrapper">
      <svg
        viewBox={`0 0 ${totalSize} ${totalSize}`}
        className="goban-svg"
        role="img"
        aria-label="9x9 Go Board"
      >
        <defs>
          <radialGradient id="blackStoneGrad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#4a4a4a" />
            <stop offset="55%" stopColor="#1c1c1c" />
            <stop offset="100%" stopColor="#080808" />
          </radialGradient>
          <radialGradient id="whiteStoneGrad" cx="35%" cy="30%" r="65%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="70%" stopColor="#ecebe6" />
            <stop offset="100%" stopColor="#c9c7be" />
          </radialGradient>
          <filter id="stoneShadow" x="-15%" y="-15%" width="135%" height="135%">
            <feDropShadow
              dx="1.5"
              dy="2.5"
              stdDeviation="2"
              floodOpacity="0.38"
            />
          </filter>
        </defs>

        {/* Board wood surface */}
        <rect
          x="0"
          y="0"
          width={totalSize}
          height={totalSize}
          rx="10"
          fill="#dcb35c"
          stroke="#8c6223"
          strokeWidth="3"
        />

        {/* Coordinate Labels */}
        {COL_LABELS.map((label, colIdx) => {
          const x = padding + colIdx * cellSize;
          return (
            <g key={`col-${label}`} className="coord-label">
              <text
                x={x}
                y={22}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill="#4e3612"
              >
                {label}
              </text>
              <text
                x={x}
                y={totalSize - 14}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill="#4e3612"
              >
                {label}
              </text>
            </g>
          );
        })}

        {Array.from({ length: BOARD_SIZE }).map((_, rowIdx) => {
          const y = padding + rowIdx * cellSize + 4;
          const rowLabel = BOARD_SIZE - rowIdx;
          return (
            <g key={`row-${rowLabel}`} className="coord-label">
              <text
                x={20}
                y={y}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill="#4e3612"
              >
                {rowLabel}
              </text>
              <text
                x={totalSize - 20}
                y={y}
                textAnchor="middle"
                fontSize="13"
                fontWeight="600"
                fill="#4e3612"
              >
                {rowLabel}
              </text>
            </g>
          );
        })}

        {/* Grid Lines */}
        {Array.from({ length: BOARD_SIZE }).map((_, idx) => {
          const pos = padding + idx * cellSize;
          return (
            <g key={`grid-${idx}`}>
              <line
                x1={padding}
                y1={pos}
                x2={padding + gridSpan}
                y2={pos}
                stroke="#2b1d08"
                strokeWidth={idx === 0 || idx === BOARD_SIZE - 1 ? 2 : 1.25}
              />
              <line
                x1={pos}
                y1={padding}
                x2={pos}
                y2={padding + gridSpan}
                stroke="#2b1d08"
                strokeWidth={idx === 0 || idx === BOARD_SIZE - 1 ? 2 : 1.25}
              />
            </g>
          );
        })}

        {/* Star Points (Hoshi) */}
        {STAR_POINTS.map(([r, c]) => {
          const { x, y } = getXY(r, c);
          return (
            <circle
              key={`hoshi-${r}-${c}`}
              cx={x}
              cy={y}
              r="4.2"
              fill="#2b1d08"
            />
          );
        })}

        {/* Ko Forbidden Square Indicator */}
        {koPoint &&
          (() => {
            const { x, y } = getXY(koPoint.row, koPoint.col);
            return (
              <rect
                x={x - 7}
                y={y - 7}
                width="14"
                height="14"
                fill="none"
                stroke="#b91c1c"
                strokeWidth="2"
              />
            );
          })()}

        {/* Placed Stones */}
        {board.map((rowArr, r) =>
          rowArr.map((cell, c) => {
            if (cell === EMPTY) return null;
            const { x, y } = getXY(r, c);
            const isLast = lastMove && lastMove.row === r && lastMove.col === c;
            return (
              <g key={`stone-${r}-${c}`} filter="url(#stoneShadow)">
                <circle
                  cx={x}
                  cy={y}
                  r={stoneRadius}
                  fill={
                    cell === BLACK
                      ? 'url(#blackStoneGrad)'
                      : 'url(#whiteStoneGrad)'
                  }
                  stroke={cell === WHITE ? '#999' : 'none'}
                  strokeWidth="0.8"
                />
                {isLast && (
                  <circle
                    cx={x}
                    cy={y}
                    r={stoneRadius * 0.34}
                    fill="none"
                    stroke={cell === BLACK ? '#f59e0b' : '#dc2626'}
                    strokeWidth="2.4"
                  />
                )}
              </g>
            );
          }),
        )}

        {/* Hint Silhouettes (Rank 1-4 clickable overlays) */}
        {hints.map((hint) => {
          if (board[hint.row][hint.col] !== EMPTY) return null;
          const { x, y } = getXY(hint.row, hint.col);
          const isSelected = selectedHintCoord === hint.move;
          return (
            <g
              key={`hint-${hint.move}`}
              style={{ cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                if (onHintClick) onHintClick(hint);
              }}
            >
              <circle
                cx={x}
                cy={y}
                r={stoneRadius * 0.92}
                fill={
                  currentTurn === BLACK
                    ? 'rgba(20, 20, 20, 0.55)'
                    : 'rgba(255, 255, 255, 0.72)'
                }
                stroke={
                  isSelected
                    ? '#38bdf8'
                    : hint.rank === 1
                      ? '#22c55e'
                      : '#f59e0b'
                }
                strokeWidth={isSelected ? '3.5' : '2.2'}
              />
              <text
                x={x}
                y={y + 5}
                textAnchor="middle"
                fontSize="15"
                fontWeight="700"
                fill={currentTurn === BLACK ? '#ffffff' : '#111827'}
              >
                {hint.rank}
              </text>
            </g>
          );
        })}

        {/* Hover Preview Stone */}
        {!disabled &&
          hoverCell &&
          board[hoverCell.row][hoverCell.col] === EMPTY &&
          !hintMap.has(`${hoverCell.row},${hoverCell.col}`) &&
          !(
            koPoint &&
            koPoint.row === hoverCell.row &&
            koPoint.col === hoverCell.col
          ) &&
          (() => {
            const { x, y } = getXY(hoverCell.row, hoverCell.col);
            return (
              <circle
                cx={x}
                cy={y}
                r={stoneRadius}
                fill={
                  currentTurn === BLACK
                    ? 'rgba(15, 15, 15, 0.35)'
                    : 'rgba(255, 255, 255, 0.45)'
                }
                pointerEvents="none"
              />
            );
          })()}

        {/* Invisible Interactive Hitboxes */}
        {Array.from({ length: BOARD_SIZE }).map((_, r) =>
          Array.from({ length: BOARD_SIZE }).map((__, c) => {
            const { x, y } = getXY(r, c);
            const hint = hintMap.get(`${r},${c}`);
            return (
              <rect
                key={`hit-${r}-${c}`}
                x={x - cellSize / 2}
                y={y - cellSize / 2}
                width={cellSize}
                height={cellSize}
                fill="transparent"
                style={{ cursor: disabled ? 'default' : 'pointer' }}
                onMouseEnter={() => setHoverCell({ row: r, col: c })}
                onMouseLeave={() => setHoverCell(null)}
                onClick={() => {
                  if (disabled) return;
                  if (hint && onHintClick) {
                    onHintClick(hint);
                  } else if (onIntersectionClick) {
                    onIntersectionClick(r, c);
                  }
                }}
              />
            );
          }),
        )}
      </svg>
    </div>
  );
}
