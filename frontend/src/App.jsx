import { useState, useEffect, useCallback } from 'react';
import Goban9x9 from './components/Goban9x9';
import {
  BLACK,
  WHITE,
  createInitialBoard,
  applyMove,
  toCoordString,
  estimateAreaScore,
} from './utils/goLogic';
import './App.css';

const API_BASE = 'http://127.0.0.1:8000/api';

const RANK_OPTIONS = [
  { value: '30k', label: '30 Kyu — Beginner' },
  { value: '25k', label: '25 Kyu — Novice' },
  { value: '20k', label: '20 Kyu — Casual' },
  { value: '15k', label: '15 Kyu — Developing' },
  { value: '10k', label: '10 Kyu — Intermediate' },
  { value: '5k', label: '5 Kyu — Strong Kyu' },
  { value: '1d', label: '1 Dan — Shodan' },
];

const HANDICAP_OPTIONS = [
  { id: 'even', label: 'Even (6.5 Komi)', stones: 0, komi: 6.5 },
  { id: '0.5', label: 'No Komi (0.5)', stones: 0, komi: 0.5 },
  { id: 'h2', label: '2 Stones (0.5)', stones: 2, komi: 0.5 },
  { id: 'h3', label: '3 Stones (0.5)', stones: 3, komi: 0.5 },
  { id: 'h4', label: '4 Stones (0.5)', stones: 4, komi: 0.5 },
];

export default function App() {
  const [handicapId, setHandicapId] = useState('even');
  const [board, setBoard] = useState(() => createInitialBoard(0));
  const [currentTurn, setCurrentTurn] = useState(BLACK);
  const [captures, setCaptures] = useState({ [BLACK]: 0, [WHITE]: 0 });
  const [koPoint, setKoPoint] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [consecutivePasses, setConsecutivePasses] = useState(0);
  const [statusBanner, setStatusBanner] = useState(
    'Black to play. Click an intersection to place a stone.',
  );
  const [gameResult, setGameResult] = useState(null);

  // AI Sensei Opponent Controls
  const [vsAi, setVsAi] = useState(true);
  const [humanColor, setHumanColor] = useState(BLACK);
  const [aiRank, setAiRank] = useState('25k');
  const [aiThinking, setAiThinking] = useState(false);
  const [engineStatus, setEngineStatus] = useState('Checking engine...');

  const activeHandicap =
    HANDICAP_OPTIONS.find((h) => h.id === handicapId) || HANDICAP_OPTIONS[0];
  const lastMove =
    moveHistory.length > 0 ? moveHistory[moveHistory.length - 1] : null;
  const lastBlackMove =
    [...moveHistory].reverse().find((m) => m.color === BLACK && m.row >= 0) ||
    null;
  const lastWhiteMove =
    [...moveHistory].reverse().find((m) => m.color === WHITE && m.row >= 0) ||
    null;
  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data) => setEngineStatus(`Engine: ${data.engine}`))
      .catch(() => setEngineStatus('Backend offline'));
  }, []);

  const triggerAiTurn = useCallback(
    async (
      activeBoard,
      botColor,
      activeHumanColor,
      activeKo,
      activeCaptures,
      activePasses,
      komiVal,
    ) => {
      setAiThinking(true);
      setStatusBanner(`AI Sensei (${aiRank.toUpperCase()}) is reading...`);

      try {
        const res = await fetch(`${API_BASE}/ai-move`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            board: activeBoard,
            color: botColor,
            koPoint: activeKo ? [activeKo.row, activeKo.col] : null,
            rank: aiRank,
          }),
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.move === 'PASS') {
          const nextPasses = activePasses + 1;
          const snapshot = {
            board: activeBoard,
            nextBoard: activeBoard,
            currentTurn: botColor,
            nextTurn: activeHumanColor,
            captures: { ...activeCaptures },
            nextCaptures: { ...activeCaptures },
            koPoint: activeKo,
            nextKoPoint: null,
            row: -1,
            col: -1,
            coord: 'PASS',
            color: botColor,
            captured: 0,
          };
          setMoveHistory((prev) => [...prev, snapshot]);
          setKoPoint(null);

          if (nextPasses >= 2) {
            const score = estimateAreaScore(activeBoard, komiVal);
            setGameResult(score);
            setStatusBanner(
              `Game Over (Two Passes). ${score.winner} wins by ${score.margin} pts (B: ${score.black} | W: ${score.white}).`,
            );
          } else {
            setConsecutivePasses(nextPasses);
            setCurrentTurn(activeHumanColor);
            setStatusBanner(
              `AI Sensei (${data.rankLabel}) passed — Your turn.`,
            );
          }
        } else {
          const nextKo = data.koPoint
            ? { row: data.koPoint[0], col: data.koPoint[1] }
            : null;
          const updatedCaptures = {
            ...activeCaptures,
            [botColor]: activeCaptures[botColor] + data.capturedCount,
          };
          const snapshot = {
            board: activeBoard,
            nextBoard: data.board,
            currentTurn: botColor,
            nextTurn: activeHumanColor,
            captures: { ...activeCaptures },
            nextCaptures: updatedCaptures,
            koPoint: activeKo,
            nextKoPoint: nextKo,
            row: data.row,
            col: data.col,
            coord: data.move,
            color: botColor,
            captured: data.capturedCount,
          };

          const capNote =
            data.capturedCount > 0 ? ` (Captured ${data.capturedCount})` : '';
          setBoard(data.board);
          setCaptures(updatedCaptures);
          setKoPoint(nextKo);
          setMoveHistory((prev) => [...prev, snapshot]);
          setConsecutivePasses(0);
          setCurrentTurn(activeHumanColor);
          setStatusBanner(
            `AI Sensei (${data.rankLabel}) played ${data.move}${capNote} — Your turn.`,
          );
        }
      } catch (err) {
        setStatusBanner(
          `AI Sensei offline: ${err.message}. Verify FastAPI on port 8000.`,
        );
      } finally {
        setAiThinking(false);
      }
    },
    [aiRank],
  );

  const startFreshMatch = useCallback(
    async ({
      nextVsAi = vsAi,
      nextHumanColor = humanColor,
      nextHandicapId = handicapId,
    } = {}) => {
      const hSpec =
        HANDICAP_OPTIONS.find((h) => h.id === nextHandicapId) ||
        HANDICAP_OPTIONS[0];
      const freshBoard = createInitialBoard(hSpec.stones);
      // In handicap games (stones >= 2), Black's handicap stones are already placed so White moves first
      const firstTurn = hSpec.stones >= 2 ? WHITE : BLACK;
      const freshCaptures = { [BLACK]: 0, [WHITE]: 0 };

      setVsAi(nextVsAi);
      setHumanColor(nextHumanColor);
      setHandicapId(nextHandicapId);
      setBoard(freshBoard);
      setCurrentTurn(firstTurn);
      setCaptures(freshCaptures);
      setKoPoint(null);
      setMoveHistory([]);
      setRedoStack([]);
      setConsecutivePasses(0);
      setGameResult(null);

      const botColor = nextHumanColor === BLACK ? WHITE : BLACK;
      if (nextVsAi && firstTurn === botColor) {
        await triggerAiTurn(
          freshBoard,
          botColor,
          nextHumanColor,
          null,
          freshCaptures,
          0,
          hSpec.komi,
        );
      } else {
        setStatusBanner(
          `${firstTurn === BLACK ? 'Black' : 'White'} to play (${hSpec.label}).`,
        );
      }
    },
    [vsAi, humanColor, handicapId, triggerAiTurn],
  );

  const handleIntersectionClick = async (row, col) => {
    if (gameResult || aiThinking) return;
    if (vsAi && currentTurn !== humanColor) return;

    const result = applyMove(board, row, col, currentTurn, koPoint);
    if (!result.valid) {
      setStatusBanner(`Invalid move: ${result.reason}`);
      return;
    }

    const coord = toCoordString(row, col);
    const updatedCaptures = {
      ...captures,
      [currentTurn]: captures[currentTurn] + result.capturedCount,
    };
    const nextTurn = currentTurn === BLACK ? WHITE : BLACK;

    const snapshot = {
      board,
      nextBoard: result.board,
      currentTurn,
      nextTurn,
      captures: { ...captures },
      nextCaptures: updatedCaptures,
      koPoint,
      nextKoPoint: result.koPoint,
      row,
      col,
      coord,
      color: currentTurn,
      captured: result.capturedCount,
    };

    const captureNote =
      result.capturedCount > 0 ? ` (Captured ${result.capturedCount})` : '';

    setBoard(result.board);
    setCaptures(updatedCaptures);
    setKoPoint(result.koPoint);
    setMoveHistory((prev) => [...prev, snapshot]);
    setRedoStack([]);
    setConsecutivePasses(0);
    setCurrentTurn(nextTurn);
    setStatusBanner(
      `${currentTurn === BLACK ? 'Black' : 'White'} played ${coord}${captureNote}.`,
    );

    const botColor = humanColor === BLACK ? WHITE : BLACK;
    if (vsAi && nextTurn === botColor) {
      await triggerAiTurn(
        result.board,
        botColor,
        humanColor,
        result.koPoint,
        updatedCaptures,
        0,
        activeHandicap.komi,
      );
    }
  };

  const handlePass = async () => {
    if (gameResult || aiThinking) return;
    if (vsAi && currentTurn !== humanColor) return;

    const nextPasses = consecutivePasses + 1;
    const playerLabel = currentTurn === BLACK ? 'Black' : 'White';
    const nextTurn = currentTurn === BLACK ? WHITE : BLACK;

    const snapshot = {
      board,
      nextBoard: board,
      currentTurn,
      nextTurn,
      captures: { ...captures },
      nextCaptures: { ...captures },
      koPoint,
      nextKoPoint: null,
      row: -1,
      col: -1,
      coord: 'PASS',
      color: currentTurn,
      captured: 0,
    };

    setMoveHistory((prev) => [...prev, snapshot]);
    setRedoStack([]);
    setKoPoint(null);

    if (nextPasses >= 2) {
      const score = estimateAreaScore(board, activeHandicap.komi);
      setGameResult(score);
      setStatusBanner(
        `Game Over (Two Passes). ${score.winner} wins by ${score.margin} pts (B: ${score.black} | W: ${score.white}).`,
      );
      return;
    }

    setConsecutivePasses(nextPasses);
    setCurrentTurn(nextTurn);
    setStatusBanner(`${playerLabel} passed.`);

    const botColor = humanColor === BLACK ? WHITE : BLACK;
    if (vsAi && nextTurn === botColor) {
      await triggerAiTurn(
        board,
        botColor,
        humanColor,
        null,
        captures,
        nextPasses,
        activeHandicap.komi,
      );
    }
  };

  const handleUndo = () => {
    if (moveHistory.length === 0 || aiThinking) return;
    const stepsBack =
      vsAi && moveHistory.length >= 2 && currentTurn === humanColor ? 2 : 1;
    const targetIdx = moveHistory.length - stepsBack;
    const targetSnapshot = moveHistory[targetIdx];
    const undoneMoves = moveHistory.slice(targetIdx);

    setBoard(targetSnapshot.board);
    setCurrentTurn(targetSnapshot.currentTurn);
    setCaptures(targetSnapshot.captures);
    setKoPoint(targetSnapshot.koPoint);
    setMoveHistory((prev) => prev.slice(0, targetIdx));
    setRedoStack((prev) => [...undoneMoves, ...prev]);
    setConsecutivePasses(0);
    setGameResult(null);
    setStatusBanner(`Rewound to Move #${targetIdx + 1}.`);
  };

  const handleRedo = () => {
    if (redoStack.length === 0 || aiThinking) return;
    const stepsForward = vsAi && redoStack.length >= 2 ? 2 : 1;
    const restoredMoves = redoStack.slice(0, stepsForward);
    const latestRestored = restoredMoves[restoredMoves.length - 1];

    setBoard(latestRestored.nextBoard);
    setCurrentTurn(latestRestored.nextTurn);
    setCaptures(latestRestored.nextCaptures);
    setKoPoint(latestRestored.nextKoPoint);
    setMoveHistory((prev) => [...prev, ...restoredMoves]);
    setRedoStack((prev) => prev.slice(stepsForward));
    setConsecutivePasses(0);
    setGameResult(null);
    setStatusBanner(`Restored to ${latestRestored.coord}.`);
  };

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <span className="brand-dot" />
          <h1>AI Sensei 9x9</h1>
          <span className="badge">{engineStatus}</span>
        </div>
        <div className="status-pill">{statusBanner}</div>
      </header>

      <main className="workspace">
        <section className="board-pane">
          <Goban9x9
            board={board}
            currentTurn={currentTurn}
            lastMove={lastMove && lastMove.row >= 0 ? lastMove : null}
            lastBlackMove={lastBlackMove}
            lastWhiteMove={lastWhiteMove}
            koPoint={koPoint}
            onIntersectionClick={handleIntersectionClick}
            disabled={Boolean(gameResult) || aiThinking}
          />
        </section>

        <aside className="control-pane">
          <div className="panel-card">
            <h2>Dojo Setup</h2>
            <div className="sym-grid-2">
              <button
                className={vsAi ? 'active' : ''}
                onClick={() => startFreshMatch({ nextVsAi: true })}
                disabled={aiThinking}
              >
                AI Sensei
              </button>
              <button
                className={!vsAi ? 'active' : ''}
                onClick={() => startFreshMatch({ nextVsAi: false })}
                disabled={aiThinking}
              >
                Local 2P
              </button>
            </div>

            {vsAi && (
              <div className="sym-grid-2 mt-10">
                <button
                  className={humanColor === BLACK ? 'active' : ''}
                  onClick={() => startFreshMatch({ nextHumanColor: BLACK })}
                  disabled={aiThinking}
                >
                  Play Black
                </button>
                <button
                  className={humanColor === WHITE ? 'active' : ''}
                  onClick={() => startFreshMatch({ nextHumanColor: WHITE })}
                  disabled={aiThinking}
                >
                  Play White
                </button>
              </div>
            )}

            <div className="sym-grid-2 mt-10">
              {vsAi && (
                <label className="field-label">
                  Sensei Rank
                  <select
                    value={aiRank}
                    onChange={(e) => setAiRank(e.target.value)}
                    disabled={aiThinking}
                  >
                    {RANK_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label
                className="field-label"
                style={!vsAi ? { gridColumn: '1 / -1' } : undefined}
              >
                Komi / Handicap
                <select
                  value={handicapId}
                  onChange={(e) =>
                    startFreshMatch({ nextHandicapId: e.target.value })
                  }
                  disabled={aiThinking}
                >
                  {HANDICAP_OPTIONS.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="panel-card">
            <h2>Match Telemetry</h2>
            <div className="turn-row">
              <span
                className={`stone-indicator ${currentTurn === BLACK ? 'black' : 'white'}`}
              />
              <strong>
                {gameResult
                  ? 'Match Complete'
                  : aiThinking
                    ? 'Sensei Reading...'
                    : `${currentTurn === BLACK ? 'Black' : 'White'}'s Turn`}
              </strong>
              <span className="move-count">Move #{moveHistory.length + 1}</span>
            </div>

            <div className="sym-grid-2">
              <div className="capture-box">
                <span className="label">Black Captures</span>
                <span className="value">{captures[BLACK]}</span>
              </div>
              <div className="capture-box">
                <span className="label">White Captures</span>
                <span className="value">{captures[WHITE]}</span>
              </div>
            </div>

            <div className="sym-grid-4 mt-10">
              <button
                onClick={handleUndo}
                disabled={moveHistory.length === 0 || aiThinking}
                title="Undo"
              >
                &lt; Undo
              </button>
              <button
                onClick={handleRedo}
                disabled={redoStack.length === 0 || aiThinking}
                title="Redo"
              >
                Redo &gt;
              </button>
              <button
                onClick={handlePass}
                disabled={Boolean(gameResult) || aiThinking}
              >
                Pass
              </button>
              <button
                className="danger"
                onClick={() => startFreshMatch()}
                disabled={aiThinking}
              >
                Reset
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
