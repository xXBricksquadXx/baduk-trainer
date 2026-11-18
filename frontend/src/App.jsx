import { useState } from 'react';
import Goban9x9 from './components/Goban9x9';
import {
  BLACK,
  WHITE,
  createEmptyBoard,
  applyMove,
  toCoordString,
  estimateAreaScore,
} from './utils/goLogic';
import './App.css';

export default function App() {
  const [board, setBoard] = useState(() => createEmptyBoard());
  const [currentTurn, setCurrentTurn] = useState(BLACK);
  const [captures, setCaptures] = useState({ [BLACK]: 0, [WHITE]: 0 });
  const [koPoint, setKoPoint] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [consecutivePasses, setConsecutivePasses] = useState(0);
  const [statusBanner, setStatusBanner] = useState(
    'Black to play. Click an intersection to place a stone.',
  );
  const [gameResult, setGameResult] = useState(null);

  const lastMove =
    moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;

  const handleIntersectionClick = (row, col) => {
    if (gameResult) return;

    const result = applyMove(board, row, col, currentTurn, koPoint);
    if (!result.valid) {
      setStatusBanner(`Invalid move: ${result.reason}`);
      return;
    }

    const coord = toCoordString(row, col);
    const snapshot = {
      board,
      currentTurn,
      captures: { ...captures },
      koPoint,
      row,
      col,
      coord,
      color: currentTurn,
      captured: result.capturedCount,
    };

    const nextTurn = currentTurn === BLACK ? WHITE : BLACK;
    const nextTurnLabel = nextTurn === BLACK ? 'Black' : 'White';
    const captureNote =
      result.capturedCount > 0 ? ` (Captured ${result.capturedCount})` : '';

    setBoard(result.board);
    setCaptures((prev) => ({
      ...prev,
      [currentTurn]: prev[currentTurn] + result.capturedCount,
    }));
    setKoPoint(result.koPoint);
    setMoveHistory((prev) => [...prev, snapshot]);
    setConsecutivePasses(0);
    setCurrentTurn(nextTurn);
    setStatusBanner(
      `${currentTurn === BLACK ? 'Black' : 'White'} played ${coord}${captureNote} — ${nextTurnLabel} to play.`,
    );
  };

  const handlePass = () => {
    if (gameResult) return;
    const nextPasses = consecutivePasses + 1;
    const playerLabel = currentTurn === BLACK ? 'Black' : 'White';

    const snapshot = {
      board,
      currentTurn,
      captures: { ...captures },
      koPoint,
      row: -1,
      col: -1,
      coord: 'PASS',
      color: currentTurn,
      captured: 0,
    };

    setMoveHistory((prev) => [...prev, snapshot]);
    setKoPoint(null);

    if (nextPasses >= 2) {
      const score = estimateAreaScore(board, 5.5);
      setGameResult(score);
      setStatusBanner(
        `Game Over (Two Passes). ${score.winner} wins by ${score.margin} pts (B: ${score.black} | W: ${score.white}).`,
      );
    } else {
      const nextTurn = currentTurn === BLACK ? WHITE : BLACK;
      setConsecutivePasses(nextPasses);
      setCurrentTurn(nextTurn);
      setStatusBanner(
        `${playerLabel} passed — ${nextTurn === BLACK ? 'Black' : 'White'} to play.`,
      );
    }
  };

  const handleUndo = () => {
    if (moveHistory.length === 0) return;
    const previous = moveHistory[moveHistory.length - 1];
    setBoard(previous.board);
    setCurrentTurn(previous.currentTurn);
    setCaptures(previous.captures);
    setKoPoint(previous.koPoint);
    setMoveHistory((prev) => prev.slice(0, -1));
    setConsecutivePasses(0);
    setGameResult(null);
    setStatusBanner(
      `Undid move ${previous.coord}. ${previous.currentTurn === BLACK ? 'Black' : 'White'} to play.`,
    );
  };

  const handleReset = () => {
    setBoard(createEmptyBoard());
    setCurrentTurn(BLACK);
    setCaptures({ [BLACK]: 0, [WHITE]: 0 });
    setKoPoint(null);
    setMoveHistory([]);
    setConsecutivePasses(0);
    setGameResult(null);
    setStatusBanner('Board cleared. Black to play.');
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-dot" />
          <h1>Baduk Trainer 9x9</h1>
          <span className="badge">Local Sandbox</span>
        </div>
        <div className="status-pill">{statusBanner}</div>
      </header>

      <main className="workspace">
        <section className="board-pane">
          <Goban9x9
            board={board}
            currentTurn={currentTurn}
            lastMove={lastMove && lastMove.row >= 0 ? lastMove : null}
            koPoint={koPoint}
            onIntersectionClick={handleIntersectionClick}
            disabled={Boolean(gameResult)}
          />
        </section>

        <aside className="control-pane">
          <div className="panel-card">
            <h2>Match Telemetry</h2>
            <div className="turn-row">
              <span
                className={`stone-indicator ${currentTurn === BLACK ? 'black' : 'white'}`}
              />
              <strong>
                {gameResult
                  ? 'Match Complete'
                  : `${currentTurn === BLACK ? 'Black' : 'White'}'s Turn`}
              </strong>
              <span className="move-count">Move #{moveHistory.length + 1}</span>
            </div>

            <div className="captures-grid">
              <div className="capture-box">
                <span className="label">Black Captures</span>
                <span className="value">{captures[BLACK]}</span>
              </div>
              <div className="capture-box">
                <span className="label">White Captures</span>
                <span className="value">{captures[WHITE]}</span>
              </div>
            </div>

            <div className="btn-row">
              <button onClick={handleUndo} disabled={moveHistory.length === 0}>
                Undo
              </button>
              <button onClick={handlePass} disabled={Boolean(gameResult)}>
                Pass
              </button>
              <button className="danger" onClick={handleReset}>
                New Game
              </button>
            </div>
          </div>

          <div className="panel-card history-card">
            <h2>Move Log</h2>
            <div className="move-log">
              {moveHistory.length === 0 ? (
                <p className="muted">No stones played yet.</p>
              ) : (
                [...moveHistory].reverse().map((m, revIdx) => {
                  const moveNum = moveHistory.length - revIdx;
                  return (
                    <div
                      key={moveNum}
                      className={`log-entry ${revIdx === 0 ? 'latest' : ''}`}
                    >
                      <span className="idx">{moveNum}.</span>
                      <span className="player">
                        {m.color === BLACK ? 'B' : 'W'}
                      </span>
                      <span className="coord">{m.coord}</span>
                      {m.captured > 0 && (
                        <span className="cap-tag">+{m.captured} cap</span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}
