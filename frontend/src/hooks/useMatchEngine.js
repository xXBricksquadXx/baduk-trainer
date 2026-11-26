import { useState, useCallback } from 'react';
import {
  BLACK,
  WHITE,
  createInitialBoard,
  applyMove,
  toCoordString,
  estimateAreaScore,
  exportToSgf,
  parseSgf,
} from '../utils/goLogic';

export const HANDICAP_OPTIONS = [
  { id: 'even', label: 'Even (6.5 Komi)', stones: 0, komi: 6.5 },
  { id: '0.5', label: 'No Komi (0.5)', stones: 0, komi: 0.5 },
  { id: 'h2', label: '2 Stones (0.5)', stones: 2, komi: 0.5 },
  { id: 'h3', label: '3 Stones (0.5)', stones: 3, komi: 0.5 },
  { id: 'h4', label: '4 Stones (0.5)', stones: 4, komi: 0.5 },
];

export function useMatchEngine({
  apiBase,
  aiRank,
  userRankLabel,
  setStatusBanner,
  clearCoaching,
  onProgressUpdate,
  onSwitchToMatchTab,
  onSgfImported,
}) {
  const [handicapId, setHandicapId] = useState('even');
  const [board, setBoard] = useState(() => createInitialBoard(0));
  const [currentTurn, setCurrentTurn] = useState(BLACK);
  const [captures, setCaptures] = useState({ [BLACK]: 0, [WHITE]: 0 });
  const [koPoint, setKoPoint] = useState(null);
  const [moveHistory, setMoveHistory] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [consecutivePasses, setConsecutivePasses] = useState(0);
  const [gameResult, setGameResult] = useState(null);
  const [sgfMeta, setSgfMeta] = useState(null);
  const [lastEngineUsed, setLastEngineUsed] = useState(null);

  const [vsAi, setVsAi] = useState(true);
  const [humanColor, setHumanColor] = useState(BLACK);
  const [aiThinking, setAiThinking] = useState(false);

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

  const logCompletedMatch = useCallback(
    (score, totalMoves) => {
      if (!vsAi) return;
      fetch(`${apiBase}/metrics/match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          opponentRank: aiRank,
          humanColor: humanColor === BLACK ? 'Black' : 'White',
          winner: score.winner,
          margin: score.margin,
          movesCount: totalMoves,
        }),
      })
        .then((r) => r.json())
        .then((d) => d.progress && onProgressUpdate(d.progress))
        .catch(() => {});
    },
    [apiBase, vsAi, aiRank, humanColor, onProgressUpdate],
  );

  const triggerAiTurn = useCallback(
    async (
      activeBoard,
      botColor,
      activeHumanColor,
      activeKo,
      activeCaptures,
      activePasses,
      komiVal,
      currentMoveCount,
    ) => {
      setAiThinking(true);
      setStatusBanner(`AI Sensei (${aiRank.toUpperCase()}) is reading...`);

      try {
        const res = await fetch(`${apiBase}/ai-move`, {
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
        if (data.engineUsed) setLastEngineUsed(data.engineUsed);
        const engineTag = data.engineUsed ? ` • ${data.engineUsed}` : '';

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
            logCompletedMatch(score, currentMoveCount + 1);
          } else {
            setConsecutivePasses(nextPasses);
            setCurrentTurn(activeHumanColor);
            setStatusBanner(
              `AI Sensei (${data.rankLabel}${engineTag}) passed — Your turn.`,
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
            `AI Sensei (${data.rankLabel}${engineTag}) played ${data.move}${capNote} — Your turn.`,
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
    [apiBase, aiRank, logCompletedMatch, setStatusBanner],
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
      const firstTurn = hSpec.stones >= 2 ? WHITE : BLACK;
      const freshCaptures = { [BLACK]: 0, [WHITE]: 0 };

      clearCoaching();
      setSgfMeta(null);
      setLastEngineUsed(null);
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
          0,
        );
      } else {
        setStatusBanner(
          `${firstTurn === BLACK ? 'Black' : 'White'} to play (${hSpec.label}).`,
        );
      }
    },
    [
      vsAi,
      humanColor,
      handicapId,
      clearCoaching,
      triggerAiTurn,
      setStatusBanner,
    ],
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
    const nextMoveTotal = moveHistory.length + 1;

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

    clearCoaching();
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
        nextMoveTotal,
      );
    }
  };

  const handlePass = async () => {
    if (gameResult || aiThinking) return;
    if (vsAi && currentTurn !== humanColor) return;

    const nextPasses = consecutivePasses + 1;
    const playerLabel = currentTurn === BLACK ? 'Black' : 'White';
    const nextTurn = currentTurn === BLACK ? WHITE : BLACK;
    const nextMoveTotal = moveHistory.length + 1;

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

    clearCoaching();
    setMoveHistory((prev) => [...prev, snapshot]);
    setRedoStack([]);
    setKoPoint(null);

    if (nextPasses >= 2) {
      const score = estimateAreaScore(board, activeHandicap.komi);
      setGameResult(score);
      setStatusBanner(
        `Game Over (Two Passes). ${score.winner} wins by ${score.margin} pts (B: ${score.black} | W: ${score.white}).`,
      );
      logCompletedMatch(score, nextMoveTotal);
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
        nextMoveTotal,
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

    clearCoaching();
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

    clearCoaching();
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

  const handleExportSgf = () => {
    const userLabel = 'Colby Cardell';
    const botLabel = `AI Sensei (${aiRank.toUpperCase()})`;
    const resultTag = gameResult
      ? `${gameResult.winner === 'Black' ? 'B' : 'W'}+${gameResult.margin}`
      : '';

    const meta = sgfMeta || {
      blackName: vsAi
        ? humanColor === BLACK
          ? userLabel
          : botLabel
        : 'Player 1 (Black)',
      whiteName: vsAi
        ? humanColor === WHITE
          ? userLabel
          : botLabel
        : 'Player 2 (White)',
      blackRank: vsAi ? (humanColor === BLACK ? userRankLabel : aiRank) : '',
      whiteRank: vsAi ? (humanColor === WHITE ? userRankLabel : aiRank) : '',
      result: resultTag,
    };

    const sgf = exportToSgf(
      moveHistory,
      activeHandicap.komi,
      activeHandicap.stones,
      meta,
    );
    const blob = new Blob([sgf], { type: 'application/x-go-sgf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ai-sensei-9x9-move-${moveHistory.length}.sgf`;
    a.click();
    URL.revokeObjectURL(url);
    setStatusBanner(`Exported ${moveHistory.length}-move game to SGF.`);
  };

  const handleImportSgfFile = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const { moves: parsed, meta } = parseSgf(String(reader.result || ''));
      if (parsed.length === 0) {
        setStatusBanner('No valid 9x9 moves found in SGF file.');
        return;
      }
      let simBoard = createInitialBoard(meta.handicap || 0);
      let simTurn = (meta.handicap || 0) >= 2 ? WHITE : BLACK;
      let simKo = null;
      const simCaps = { [BLACK]: 0, [WHITE]: 0 };
      const rebuiltHistory = [];

      for (const m of parsed) {
        if (m.row < 0) {
          const nextT = m.color === BLACK ? WHITE : BLACK;
          rebuiltHistory.push({
            board: simBoard,
            nextBoard: simBoard,
            currentTurn: m.color,
            nextTurn: nextT,
            captures: { ...simCaps },
            nextCaptures: { ...simCaps },
            koPoint: simKo,
            nextKoPoint: null,
            row: -1,
            col: -1,
            coord: 'PASS',
            color: m.color,
            captured: 0,
          });
          simKo = null;
          simTurn = nextT;
        } else {
          const res = applyMove(simBoard, m.row, m.col, m.color, simKo);
          if (!res.valid) break;
          const nextCaps = {
            ...simCaps,
            [m.color]: simCaps[m.color] + res.capturedCount,
          };
          const nextT = m.color === BLACK ? WHITE : BLACK;
          rebuiltHistory.push({
            board: simBoard,
            nextBoard: res.board,
            currentTurn: m.color,
            nextTurn: nextT,
            captures: { ...simCaps },
            nextCaptures: nextCaps,
            koPoint: simKo,
            nextKoPoint: res.koPoint,
            row: m.row,
            col: m.col,
            coord: m.coord,
            color: m.color,
            captured: res.capturedCount,
          });
          simBoard = res.board;
          simKo = res.koPoint;
          simCaps[BLACK] = nextCaps[BLACK];
          simCaps[WHITE] = nextCaps[WHITE];
          simTurn = nextT;
        }
      }

      const bHeader = `${meta.blackName}${meta.blackRank ? ` (${meta.blackRank})` : ''}`;
      const wHeader = `${meta.whiteName}${meta.whiteRank ? ` (${meta.whiteRank})` : ''}`;
      const resNote = meta.result ? ` • Result: ${meta.result}` : '';

      clearCoaching();
      setVsAi(false);
      setSgfMeta(meta);
      setLastEngineUsed(null);
      setBoard(simBoard);
      setCurrentTurn(simTurn);
      setCaptures(simCaps);
      setKoPoint(simKo);
      setMoveHistory(rebuiltHistory);
      setRedoStack([]);
      setGameResult(null);
      onSwitchToMatchTab();
      onSgfImported?.();
      setStatusBanner(
        `Loaded ${file.name}: ${bHeader} vs ${wHeader}${resNote} (${rebuiltHistory.length} moves — 3B Sensei Review active).`,
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return {
    handicapId,
    activeHandicap,
    board,
    currentTurn,
    captures,
    koPoint,
    moveHistory,
    redoStack,
    gameResult,
    sgfMeta,
    lastEngineUsed,
    vsAi,
    humanColor,
    aiThinking,
    lastMove,
    lastBlackMove,
    lastWhiteMove,
    startFreshMatch,
    handleIntersectionClick,
    handlePass,
    handleUndo,
    handleRedo,
    handleExportSgf,
    handleImportSgfFile,
  };
}
