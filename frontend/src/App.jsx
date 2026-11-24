import { useState, useEffect, useCallback } from 'react';
import Goban9x9 from './components/Goban9x9';
import {
  BLACK,
  WHITE,
  createInitialBoard,
  applyMove,
  toCoordString,
  fromCoordString,
  estimateAreaScore,
  computeTerritoryMap,
  computeChainLiberties,
  exportToSgf,
  parseSgfMoves,
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

function renderFormattedSenseiText(text) {
  if (!text) return null;
  return text.split('\n').map((line, lineIdx) => {
    const cleaned = line.replace(/^\s*[-*]\s+/, '• ');
    const segments = cleaned.split(/(\*\*[^*]+\*\*)/g);
    return (
      <div key={lineIdx} className="explain-line">
        {segments.map((seg, segIdx) => {
          if (seg.startsWith('**') && seg.endsWith('**')) {
            return <strong key={segIdx}>{seg.slice(2, -2)}</strong>;
          }
          return <span key={segIdx}>{seg}</span>;
        })}
      </div>
    );
  });
}

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

  // Sensei Hints & Ollama Explanation State
  const [hints, setHints] = useState([]);
  const [selectedHint, setSelectedHint] = useState(null);
  const [hintsLoading, setHintsLoading] = useState(false);
  const [senseiLoading, setSenseiLoading] = useState(false);
  const [explanationData, setExplanationData] = useState(null);
  const [senseiModel, setSenseiModel] = useState('qwen2.5-coder:3b');

  // Navigation & Curriculum State ('match' | 'dojo' | 'joseki' | 'progress')
  const [activeTab, setActiveTab] = useState('match');
  const [puzzlePacks, setPuzzlePacks] = useState([]);
  const [activePackIdx, setActivePackIdx] = useState(0);
  const [activePuzzleIdx, setActivePuzzleIdx] = useState(0);
  const [puzzleBoard, setPuzzleBoard] = useState(() => createInitialBoard(0));
  const [puzzleLastMove, setPuzzleLastMove] = useState(null);
  const [puzzleFeedback, setPuzzleFeedback] = useState(null);
  const [puzzleSolved, setPuzzleSolved] = useState(false);
  const [puzzleStepIndex, setPuzzleStepIndex] = useState(0);

  // Milestone 8: 9x9 Opening & Joseki Explorer
  const [josekiData, setJosekiData] = useState(null);
  const [josekiPath, setJosekiPath] = useState([]);

  const [progressStats, setProgressStats] = useState({
    solvedIds: [],
    totalSolved: 0,
    firstTryAccuracy: 0,
    totalReps: 0,
    byCategory: {},
    recentMatches: [],
    totalMatches: 0,
    matchWins: 0,
    winRate: 0,
    avgWinMargin: 0,
    estimatedRank: '30.0 Kyu',
  });

  // Milestone 6: Goban Visual Overlays
  const [showTerritory, setShowTerritory] = useState(false);
  const [showLiberties, setShowLiberties] = useState(false);

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
  const liveAdvantage =
    activeTab === 'match'
      ? estimateAreaScore(board, activeHandicap.komi)
      : null;

  // Compute current Joseki Explorer board & next candidate markers (1..N)
  const josekiState = (() => {
    let simBoard = createInitialBoard(0);
    let simTurn = BLACK;
    let lastPt = null;
    for (const node of josekiPath) {
      const parsed = fromCoordString(node.move);
      if (parsed) {
        const res = applyMove(simBoard, parsed.row, parsed.col, simTurn, null);
        if (res.valid) {
          simBoard = res.board;
          lastPt = { row: parsed.row, col: parsed.col };
          simTurn = simTurn === BLACK ? WHITE : BLACK;
        }
      }
    }
    const currentNode =
      josekiPath.length > 0
        ? josekiPath[josekiPath.length - 1]
        : josekiData?.root || {
            move: null,
            term: 'Empty 9x9 Goban (Fuseki)',
            summary: 'Select a starting point.',
            children: [],
          };
    const nextMarkers = (currentNode.children || [])
      .map((child, idx) => {
        const parsed = fromCoordString(child.move);
        if (!parsed) return null;
        return {
          rank: idx + 1,
          move: child.move,
          row: parsed.row,
          col: parsed.col,
          node: child,
        };
      })
      .filter(Boolean);

    return {
      board: simBoard,
      turn: simTurn,
      lastMove: lastPt,
      currentNode,
      nextMarkers,
    };
  })();

  const activeBoardForOverlay =
    activeTab === 'dojo'
      ? puzzleBoard
      : activeTab === 'joseki'
        ? josekiState.board
        : board;
  const territoryOverlay = showTerritory
    ? computeTerritoryMap(activeBoardForOverlay)
    : null;
  const libertiesOverlay = showLiberties
    ? computeChainLiberties(activeBoardForOverlay)
    : [];

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data) => setEngineStatus(`Engine: ${data.engine}`))
      .catch(() => setEngineStatus('Backend offline'));

    fetch(`${API_BASE}/puzzles`)
      .then((res) => res.json())
      .then((data) => {
        const packs = data.packs || [];
        setPuzzlePacks(packs);
        if (data.progress) setProgressStats(data.progress);
        if (packs.length > 0 && packs[0].puzzles?.length > 0) {
          setPuzzleBoard(packs[0].puzzles[0].board);
        }
      })
      .catch(() => {});

    fetch(`${API_BASE}/joseki`)
      .then((res) => res.json())
      .then((data) => setJosekiData(data))
      .catch(() => {});
  }, []);

  const clearCoaching = useCallback(() => {
    setHints([]);
    setSelectedHint(null);
    setExplanationData(null);
  }, []);

  const logCompletedMatch = useCallback(
    (score, totalMoves) => {
      if (!vsAi) return;
      fetch(`${API_BASE}/metrics/match`, {
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
        .then((d) => d.progress && setProgressStats(d.progress))
        .catch(() => {});
    },
    [vsAi, aiRank, humanColor],
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
            logCompletedMatch(score, currentMoveCount + 1);
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
    [aiRank, logCompletedMatch],
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
    [vsAi, humanColor, handicapId, clearCoaching, triggerAiTurn],
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
    const sgf = exportToSgf(
      moveHistory,
      activeHandicap.komi,
      activeHandicap.stones,
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
      const parsed = parseSgfMoves(String(reader.result || ''));
      if (parsed.length === 0) {
        setStatusBanner('No valid 9x9 moves found in SGF file.');
        return;
      }
      let simBoard = createInitialBoard(0);
      let simTurn = BLACK;
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

      clearCoaching();
      setVsAi(false);
      setBoard(simBoard);
      setCurrentTurn(simTurn);
      setCaptures(simCaps);
      setKoPoint(simKo);
      setMoveHistory(rebuiltHistory);
      setRedoStack([]);
      setGameResult(null);
      setActiveTab('match');
      setStatusBanner(
        `Loaded ${rebuiltHistory.length} moves from ${file.name} (Local 2P / Sensei Review mode).`,
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const requestHintExplanation = async (
    targetBoard,
    targetColor,
    targetCoord,
    candidateList,
    activeKo,
    mode = 'hint',
  ) => {
    setSenseiLoading(true);
    try {
      const res = await fetch(`${API_BASE}/explain`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: targetBoard,
          color: targetColor,
          targetMove: targetCoord,
          candidates: candidateList,
          koPoint: activeKo ? [activeKo.row, activeKo.col] : null,
          mode,
          rank: aiRank,
          model: senseiModel,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setExplanationData(data);
    } catch (err) {
      setExplanationData({
        move: targetCoord,
        explanation: `Sensei explanation unavailable: ${err.message}`,
        model: 'offline',
      });
    } finally {
      setSenseiLoading(false);
    }
  };

  const handleRequestHints = async () => {
    if (hintsLoading) return;
    if (activeTab === 'match' && (gameResult || aiThinking)) return;

    const targetBoard = activeTab === 'dojo' ? puzzleBoard : board;
    const targetColor =
      activeTab === 'dojo' ? currentPuzzle?.turn || BLACK : currentTurn;
    const targetKo = activeTab === 'match' ? koPoint : null;

    setHintsLoading(true);
    setStatusBanner('Computing top 4 candidate moves...');
    try {
      const res = await fetch(`${API_BASE}/hints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          board: targetBoard,
          color: targetColor,
          koPoint: targetKo ? [targetKo.row, targetKo.col] : null,
          rank: '1d',
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const topHints = data.hints || [];
      setHints(topHints);
      setHintsLoading(false);

      if (topHints.length > 0) {
        setSelectedHint(topHints[0]);
        setStatusBanner(
          `Top ${topHints.length} hints ready — click any marker to inspect or play immediately.`,
        );
        // Generate Ollama explanation asynchronously without blocking board clicks
        requestHintExplanation(
          targetBoard,
          targetColor,
          topHints[0].move,
          topHints,
          targetKo,
          'hint',
        );
      }
    } catch (err) {
      setStatusBanner(`Hint error: ${err.message}`);
      setHintsLoading(false);
    }
  };

  const handleHintClick = async (hint) => {
    if (selectedHint?.move === hint.move) {
      if (activeTab === 'dojo') {
        await handlePuzzleIntersectionClick(hint.row, hint.col);
      } else if (activeTab === 'match') {
        await handleIntersectionClick(hint.row, hint.col);
      }
      return;
    }
    const targetBoard = activeTab === 'dojo' ? puzzleBoard : board;
    const targetColor =
      activeTab === 'dojo' ? currentPuzzle?.turn || BLACK : currentTurn;
    const targetKo = activeTab === 'match' ? koPoint : null;

    setSelectedHint(hint);
    requestHintExplanation(
      targetBoard,
      targetColor,
      hint.move,
      hints,
      targetKo,
      'hint',
    );
  };

  const handleExplainLastMove = async () => {
    if (!lastMove || lastMove.row < 0 || senseiLoading || aiThinking) return;
    setHints([]);
    setSelectedHint(null);
    await requestHintExplanation(
      lastMove.board,
      lastMove.color,
      lastMove.coord,
      [],
      lastMove.koPoint,
      'last_move',
    );
  };

  // --- Puzzle Dojo Helpers ---
  const currentPack = puzzlePacks[activePackIdx] || null;
  const currentPuzzle = currentPack?.puzzles?.[activePuzzleIdx] || null;

  const selectPuzzle = (pIdx, qIdx) => {
    const pack = puzzlePacks[pIdx];
    const puzz = pack?.puzzles?.[qIdx];
    if (!puzz) return;
    clearCoaching();
    setActivePackIdx(pIdx);
    setActivePuzzleIdx(qIdx);
    setPuzzleBoard(puzz.board);
    setPuzzleLastMove(null);
    setPuzzleFeedback(null);
    setPuzzleSolved(false);
    setPuzzleStepIndex(0);
    setStatusBanner(`Drill [${puzz.rank.toUpperCase()}]: ${puzz.title}`);
  };

  const handlePuzzleIntersectionClick = async (row, col) => {
    if (!currentPuzzle || puzzleSolved) return;
    const res = applyMove(puzzleBoard, row, col, currentPuzzle.turn, null);
    if (!res.valid) {
      setStatusBanner(`Illegal move: ${res.reason}`);
      return;
    }

    const coord = toCoordString(row, col);
    clearCoaching();
    setPuzzleBoard(res.board);
    setPuzzleLastMove({ row, col });

    try {
      const apiRes = await fetch(`${API_BASE}/puzzles/attempt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          puzzleId: currentPuzzle.id,
          category: currentPack.category,
          move: coord,
          stepIndex: puzzleStepIndex,
        }),
      });
      const data = await apiRes.json();
      if (data.progress) setProgressStats(data.progress);

      if (data.solved) {
        setPuzzleSolved(true);
        setPuzzleFeedback({
          status: 'solved',
          text: data.feedback,
          move: coord,
        });
        setStatusBanner(`Solved ${currentPuzzle.title} with ${coord}!`);
      } else if (data.stepComplete) {
        const nextIdx = data.nextStepIndex ?? puzzleStepIndex + 1;
        setPuzzleStepIndex(nextIdx);
        setPuzzleFeedback({
          status: 'step',
          text: data.feedback,
          move: coord,
        });
        setStatusBanner(`Step ${nextIdx} complete — Opponent responding...`);

        if (data.reply) {
          const replyCoord = fromCoordString(data.reply);
          if (replyCoord) {
            const oppColor = currentPuzzle.turn === BLACK ? WHITE : BLACK;
            setTimeout(() => {
              const afterReply = applyMove(
                res.board,
                replyCoord.row,
                replyCoord.col,
                oppColor,
                null,
              );
              if (afterReply.valid) {
                setPuzzleBoard(afterReply.board);
                setPuzzleLastMove({ row: replyCoord.row, col: replyCoord.col });
                setStatusBanner(
                  `Opponent played ${data.reply} — Play Step ${nextIdx + 1}!`,
                );
              }
            }, 420);
          }
        }
      } else {
        setPuzzleFeedback({
          status: 'retry',
          text: data.feedback,
          move: coord,
        });
        setStatusBanner(`Try again — ${coord} didn't solve the drill.`);
        setTimeout(() => {
          setPuzzleBoard(currentPuzzle.board);
          setPuzzleLastMove(null);
          setPuzzleStepIndex(0);
        }, 850);
      }
    } catch (err) {
      setStatusBanner(`Puzzle check error: ${err.message}`);
    }
  };

  const stepPuzzle = (delta) => {
    if (!currentPack) return;
    const total = currentPack.puzzles.length;
    const nextIdx = (activePuzzleIdx + delta + total) % total;
    selectPuzzle(activePackIdx, nextIdx);
  };

  const renderOverlayStrip = () => (
    <>
      <div className="overlay-strip">
        <button
          className={showTerritory ? 'active' : ''}
          onClick={() => setShowTerritory((v) => !v)}
          title="Highlight surrounded Black and White territory regions"
        >
          Territory: {showTerritory ? 'ON' : 'OFF'}
        </button>
        <button
          className={showLiberties ? 'active' : ''}
          onClick={() => setShowLiberties((v) => !v)}
          title="Show remaining liberties on every connected stone chain"
        >
          Liberties: {showLiberties ? 'ON' : 'OFF'}
        </button>
        {activeTab === 'match' ? (
          <button
            onClick={handleExportSgf}
            disabled={moveHistory.length === 0}
            title="Download current game as a standard .sgf file"
          >
            Export SGF
          </button>
        ) : (
          <button
            onClick={() => {
              setShowTerritory(false);
              setShowLiberties(false);
            }}
          >
            Clear Overlays
          </button>
        )}
      </div>

      {activeTab === 'match' && liveAdvantage && (
        <div
          className="board-advantage-bar"
          title="Live Area Territory Lead (Includes Komi)"
        >
          <span className="adv-label">Live Area Advantage</span>
          <span className="adv-value">
            {liveAdvantage.winner} +{liveAdvantage.margin} pts
          </span>
          <span className="adv-split">
            (B: {liveAdvantage.black} | W: {liveAdvantage.white})
          </span>
        </div>
      )}
    </>
  );

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <img src="/logo.jpg" alt="AI Sensei 9x9" className="brand-logo" />
          <h1>AI Sensei 9x9</h1>
          <span className="badge">{engineStatus}</span>
          <span className="badge">Rank: {progressStats.estimatedRank}</span>
        </div>

        <nav className="top-nav">
          <button
            className={activeTab === 'match' ? 'active' : ''}
            onClick={() => {
              clearCoaching();
              setActiveTab('match');
              setStatusBanner(
                gameResult
                  ? `Match complete — ${gameResult.winner} won by ${gameResult.margin} pts.`
                  : `${currentTurn === BLACK ? 'Black' : 'White'} to play.`,
              );
            }}
          >
            Match Play
          </button>
          <button
            className={activeTab === 'dojo' ? 'active' : ''}
            onClick={() => {
              clearCoaching();
              setActiveTab('dojo');
              if (currentPuzzle) selectPuzzle(activePackIdx, activePuzzleIdx);
            }}
          >
            Puzzle Dojo ({progressStats.totalSolved})
          </button>
          <button
            className={activeTab === 'joseki' ? 'active' : ''}
            onClick={() => {
              clearCoaching();
              setActiveTab('joseki');
              setStatusBanner(
                'Joseki & Opening Explorer: Click any numbered marker (1–4) to step through 9x9 variations.',
              );
            }}
          >
            Joseki Explorer
          </button>
          <button
            className={activeTab === 'progress' ? 'active' : ''}
            onClick={() => {
              setActiveTab('progress');
              setStatusBanner(
                `Dojo Rubric: ${progressStats.estimatedRank} (${progressStats.totalSolved} drills mastered).`,
              );
            }}
          >
            Progress
          </button>
        </nav>

        <div className="status-pill">{statusBanner}</div>
      </header>

      <main className="workspace">
        {activeTab === 'progress' ? (
          <section className="progress-wide">
            <div className="panel-card">
              <div className="sensei-header">
                <h2>Dojo Milestone Telemetry (SQLite)</h2>
                <label
                  style={{
                    cursor: 'pointer',
                    padding: '6px 12px',
                    background: '#252a34',
                    border: '1px solid #363d4c',
                    borderRadius: '6px',
                    fontSize: '0.78rem',
                    fontWeight: 600,
                  }}
                >
                  Import SGF Game
                  <input
                    type="file"
                    accept=".sgf"
                    onChange={handleImportSgfFile}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
              <div className="progress-grid">
                <div className="capture-box">
                  <span className="label">Estimated Rank</span>
                  <span className="value" style={{ color: 'var(--accent)' }}>
                    {progressStats.estimatedRank}
                  </span>
                </div>
                <div className="capture-box">
                  <span className="label">Drills Mastered</span>
                  <span className="value">{progressStats.totalSolved}</span>
                </div>
                <div className="capture-box">
                  <span className="label">Total Puzzle Reps</span>
                  <span className="value">{progressStats.totalReps}</span>
                </div>
                <div className="capture-box">
                  <span className="label">All-Time Win Rate</span>
                  <span className="value">
                    {progressStats.matchWins} / {progressStats.totalMatches} (
                    {progressStats.winRate ?? 0}%)
                  </span>
                </div>
              </div>

              <h2>Skill Category Breakdown</h2>
              <div className="sym-grid-2">
                {puzzlePacks.map((pack) => {
                  const catStats = progressStats.byCategory?.[
                    pack.category
                  ] || {
                    solved: 0,
                    reps: 0,
                  };
                  const totalInPack = pack.puzzles?.length || 0;
                  return (
                    <div key={pack.category} className="capture-box">
                      <span className="label">{pack.title}</span>
                      <span className="value" style={{ fontSize: '1rem' }}>
                        {catStats.solved} / {totalInPack} Solved (
                        {catStats.reps} reps)
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="panel-card mt-10">
              <h2>Last 10 AI Match Results</h2>
              {progressStats.recentMatches?.length === 0 ? (
                <p className="muted">
                  Complete a game (two consecutive passes) to record match
                  telemetry here.
                </p>
              ) : (
                <div className="move-log">
                  {progressStats.recentMatches.map((m, i) => (
                    <div key={i} className="log-entry">
                      <span className="idx">#{i + 1}</span>
                      <span>vs {m.opponent_rank.toUpperCase()}</span>
                      <span>Played {m.human_color}</span>
                      <span className="cap-tag">
                        {m.winner} +{m.margin} ({m.moves_count} moves)
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        ) : activeTab === 'joseki' ? (
          <>
            <section className="board-pane">
              <Goban9x9
                board={josekiState.board}
                currentTurn={josekiState.turn}
                lastMove={josekiState.lastMove}
                hints={josekiState.nextMarkers}
                territoryMap={territoryOverlay}
                chainLiberties={libertiesOverlay}
                onHintClick={(marker) => {
                  clearCoaching();
                  setJosekiPath((prev) => [...prev, marker.node]);
                  setStatusBanner(`${marker.node.move} — ${marker.node.term}`);
                }}
                onIntersectionClick={(r, c) => {
                  const found = josekiState.nextMarkers.find(
                    (m) => m.row === r && m.col === c,
                  );
                  if (found) {
                    clearCoaching();
                    setJosekiPath((prev) => [...prev, found.node]);
                    setStatusBanner(`${found.node.move} — ${found.node.term}`);
                  }
                }}
              />
              {renderOverlayStrip()}
            </section>

            <aside className="control-pane">
              <div className="panel-card">
                <div className="sensei-header">
                  <h2>Opening Sequence Path</h2>
                  <span className="model-tag">
                    Move #{josekiPath.length} (
                    {josekiState.turn === BLACK ? 'Black' : 'White'} Next)
                  </span>
                </div>

                <div className="drill-strip">
                  <button
                    className={`drill-chip ${josekiPath.length === 0 ? 'active' : ''}`}
                    onClick={() => {
                      clearCoaching();
                      setJosekiPath([]);
                    }}
                  >
                    Root
                  </button>
                  {josekiPath.map((node, idx) => (
                    <button
                      key={`${node.move}-${idx}`}
                      className={`drill-chip ${idx === josekiPath.length - 1 ? 'active' : ''}`}
                      onClick={() => {
                        clearCoaching();
                        setJosekiPath((prev) => prev.slice(0, idx + 1));
                      }}
                    >
                      {idx + 1}. {node.move}
                    </button>
                  ))}
                </div>

                <div className="sym-grid-2 mt-10">
                  <button
                    onClick={() => {
                      clearCoaching();
                      setJosekiPath((prev) => prev.slice(0, -1));
                    }}
                    disabled={josekiPath.length === 0}
                  >
                    &lt; Step Back
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      clearCoaching();
                      setJosekiPath([]);
                    }}
                    disabled={josekiPath.length === 0}
                  >
                    Reset Tree
                  </button>
                </div>
              </div>

              <div className="panel-card">
                <div className="sensei-header">
                  <h2>
                    {josekiState.currentNode.move
                      ? `${josekiState.currentNode.move} — ${josekiState.currentNode.term}`
                      : josekiState.currentNode.term}
                  </h2>
                </div>
                <p
                  style={{
                    fontSize: '0.84rem',
                    margin: '0 0 12px 0',
                    lineHeight: 1.45,
                  }}
                >
                  {josekiState.currentNode.summary}
                </p>

                {josekiState.nextMarkers.length > 0 ? (
                  <>
                    <h2>
                      Next Continuations (
                      {josekiState.turn === BLACK ? 'Black' : 'White'})
                    </h2>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      {josekiState.nextMarkers.map((m) => (
                        <button
                          key={m.move}
                          style={{
                            height: 'auto',
                            padding: '8px 10px',
                            textAlign: 'left',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                          }}
                          onClick={() => {
                            clearCoaching();
                            setJosekiPath((prev) => [...prev, m.node]);
                            setStatusBanner(`${m.node.move} — ${m.node.term}`);
                          }}
                        >
                          <span>
                            <strong style={{ color: 'var(--accent)' }}>
                              #{m.rank} {m.move}
                            </strong>{' '}
                            — {m.node.term}
                          </span>
                          <span
                            style={{
                              color: 'var(--muted)',
                              fontSize: '0.74rem',
                            }}
                          >
                            &gt;
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <p className="muted">
                    End of this book line — step back to explore an alternate
                    branch or ask Sensei below!
                  </p>
                )}
              </div>

              <div className="panel-card sensei-card">
                <div className="sensei-header">
                  <h2>Sensei Position Read</h2>
                  <div className="model-toggle-group">
                    <button
                      type="button"
                      className={`mini-toggle ${senseiModel === 'qwen2.5-coder:3b' ? 'active' : ''}`}
                      onClick={() => setSenseiModel('qwen2.5-coder:3b')}
                      disabled={senseiLoading}
                    >
                      3B Fast
                    </button>
                    <button
                      type="button"
                      className={`mini-toggle ${senseiModel === 'qwen2.5-coder:7b' ? 'active' : ''}`}
                      onClick={() => setSenseiModel('qwen2.5-coder:7b')}
                      disabled={senseiLoading}
                    >
                      7B Deep
                    </button>
                  </div>
                </div>

                <button
                  style={{ width: '100%' }}
                  onClick={() => {
                    if (!josekiState.currentNode.move) return;
                    const playedColor =
                      josekiState.turn === BLACK ? WHITE : BLACK;
                    requestHintExplanation(
                      josekiState.board,
                      playedColor,
                      josekiState.currentNode.move,
                      [],
                      null,
                      'last_move',
                    );
                  }}
                  disabled={!josekiState.currentNode.move || senseiLoading}
                >
                  Ask Sensei About This Shape
                </button>

                <div className="sensei-output mt-10">
                  {senseiLoading ? (
                    <p className="muted">Consulting Sensei via Ollama...</p>
                  ) : explanationData ? (
                    <div className="explain-body">
                      {renderFormattedSenseiText(explanationData.explanation)}
                    </div>
                  ) : (
                    <p className="muted">
                      Step into any opening variation and click{' '}
                      <strong>Ask Sensei About This Shape</strong> for a
                      tactical breakdown.
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </>
        ) : activeTab === 'dojo' ? (
          <>
            <section className="board-pane">
              <Goban9x9
                board={puzzleBoard}
                currentTurn={currentPuzzle?.turn || BLACK}
                lastMove={puzzleLastMove}
                hints={hints}
                selectedHintCoord={selectedHint?.move || null}
                territoryMap={territoryOverlay}
                chainLiberties={libertiesOverlay}
                onIntersectionClick={handlePuzzleIntersectionClick}
                onHintClick={handleHintClick}
                disabled={puzzleSolved}
              />
              {renderOverlayStrip()}
            </section>

            <aside className="control-pane">
              <div className="panel-card">
                <h2>Curriculum Pack</h2>
                <label className="field-label">
                  Skill Module
                  <select
                    value={activePackIdx}
                    onChange={(e) => selectPuzzle(Number(e.target.value), 0)}
                  >
                    {puzzlePacks.map((pack, idx) => (
                      <option key={pack.category} value={idx}>
                        {pack.title}
                      </option>
                    ))}
                  </select>
                </label>

                {currentPack && (
                  <div className="drill-strip mt-10">
                    {currentPack.puzzles.map((p, idx) => {
                      const isDone = progressStats.solvedIds?.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          className={`drill-chip ${activePuzzleIdx === idx ? 'active' : ''}`}
                          onClick={() => selectPuzzle(activePackIdx, idx)}
                          title={`${p.title} (${p.rank.toUpperCase()})`}
                        >
                          #{idx + 1} {isDone ? '✓' : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {currentPuzzle && (
                <div className="panel-card">
                  <div className="sensei-header">
                    <h2>
                      {currentPuzzle.title} ({currentPuzzle.rank.toUpperCase()})
                    </h2>
                    <span className="model-tag">
                      {currentPuzzle.turn === BLACK
                        ? 'Black to Play'
                        : 'White to Play'}
                    </span>
                  </div>

                  {currentPuzzle.concept && (
                    <div
                      style={{
                        background: 'rgba(234, 179, 8, 0.08)',
                        borderLeft: '3px solid var(--accent)',
                        padding: '7px 10px',
                        borderRadius: '4px',
                        fontSize: '0.78rem',
                        color: '#fef08a',
                        marginBottom: '10px',
                        lineHeight: 1.4,
                      }}
                    >
                      <strong>Sensei Principle:</strong> {currentPuzzle.concept}
                    </div>
                  )}

                  <p style={{ fontSize: '0.84rem', margin: '0 0 12px 0' }}>
                    {currentPuzzle.prompt}
                  </p>

                  {puzzleFeedback && (
                    <div className={`puzzle-feedback ${puzzleFeedback.status}`}>
                      <strong>
                        {puzzleFeedback.status === 'solved'
                          ? '✓ Solved'
                          : puzzleFeedback.status === 'step'
                            ? '⚡ Step Clear'
                            : '✕ Retry'}
                        ({puzzleFeedback.move}):{' '}
                      </strong>
                      {puzzleFeedback.text}
                    </div>
                  )}

                  <div className="sym-grid-4 mt-10">
                    <button onClick={() => stepPuzzle(-1)}>&lt; Prev</button>
                    <button
                      onClick={() =>
                        selectPuzzle(activePackIdx, activePuzzleIdx)
                      }
                    >
                      Retry
                    </button>
                    <button
                      className={puzzleSolved ? 'active' : ''}
                      onClick={() => stepPuzzle(1)}
                      style={{ gridColumn: 'span 2' }}
                    >
                      Next Drill &gt;
                    </button>
                  </div>
                </div>
              )}

              <div className="panel-card sensei-card">
                <div className="sensei-header">
                  <h2>Sensei Coaching</h2>
                  <div className="model-toggle-group">
                    <button
                      type="button"
                      className={`mini-toggle ${senseiModel === 'qwen2.5-coder:3b' ? 'active' : ''}`}
                      onClick={() => setSenseiModel('qwen2.5-coder:3b')}
                      disabled={senseiLoading}
                      title="Fast ~2s tactical reads via qwen2.5-coder:3b"
                    >
                      3B Fast
                    </button>
                    <button
                      type="button"
                      className={`mini-toggle ${senseiModel === 'qwen2.5-coder:7b' ? 'active' : ''}`}
                      onClick={() => setSenseiModel('qwen2.5-coder:7b')}
                      disabled={senseiLoading}
                      title="Deeper analysis via qwen2.5-coder:7b"
                    >
                      7B Deep
                    </button>
                  </div>
                </div>

                <div className="sym-grid-2">
                  <button
                    className={hints.length > 0 ? 'active' : ''}
                    onClick={handleRequestHints}
                    disabled={puzzleSolved || hintsLoading}
                  >
                    {hints.length > 0 ? 'Refresh Hints' : 'Ask Sensei (4)'}
                  </button>
                  <button
                    onClick={clearCoaching}
                    disabled={hints.length === 0 && !explanationData}
                  >
                    Clear Hints
                  </button>
                </div>

                <div className="sensei-output mt-10">
                  {senseiLoading ? (
                    <p className="muted">Consulting Sensei via Ollama...</p>
                  ) : explanationData ? (
                    <>
                      <div className="explain-meta">
                        <strong>Focus: {explanationData.move}</strong>
                      </div>
                      <div className="explain-body">
                        {renderFormattedSenseiText(explanationData.explanation)}
                      </div>
                    </>
                  ) : (
                    <p className="muted">
                      Stuck on a drill? Click <strong>Ask Sensei (4)</strong> to
                      inspect candidate moves on the puzzle board.
                    </p>
                  )}
                </div>
              </div>
            </aside>
          </>
        ) : (
          <>
            <section className="board-pane">
              <Goban9x9
                board={board}
                currentTurn={currentTurn}
                lastMove={lastMove && lastMove.row >= 0 ? lastMove : null}
                lastBlackMove={lastBlackMove}
                lastWhiteMove={lastWhiteMove}
                koPoint={koPoint}
                hints={hints}
                selectedHintCoord={selectedHint?.move || null}
                territoryMap={territoryOverlay}
                chainLiberties={libertiesOverlay}
                onIntersectionClick={handleIntersectionClick}
                onHintClick={handleHintClick}
                disabled={Boolean(gameResult) || aiThinking}
              />
              {renderOverlayStrip()}
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
                  <span className="move-count">
                    Move #{moveHistory.length + 1}
                  </span>
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

              <div className="panel-card sensei-card">
                <div className="sensei-header">
                  <h2>Sensei Coaching</h2>
                  <div className="model-toggle-group">
                    <button
                      type="button"
                      className={`mini-toggle ${senseiModel === 'qwen2.5-coder:3b' ? 'active' : ''}`}
                      onClick={() => setSenseiModel('qwen2.5-coder:3b')}
                      disabled={senseiLoading}
                      title="Fast ~2s tactical reads via qwen2.5-coder:3b"
                    >
                      3B Fast
                    </button>
                    <button
                      type="button"
                      className={`mini-toggle ${senseiModel === 'qwen2.5-coder:7b' ? 'active' : ''}`}
                      onClick={() => setSenseiModel('qwen2.5-coder:7b')}
                      disabled={senseiLoading}
                      title="Deeper analysis via qwen2.5-coder:7b"
                    >
                      7B Deep
                    </button>
                  </div>
                </div>

                <div className="sym-grid-2">
                  <button
                    className={hints.length > 0 ? 'active' : ''}
                    onClick={handleRequestHints}
                    disabled={Boolean(gameResult) || aiThinking || hintsLoading}
                  >
                    {hints.length > 0 ? 'Refresh Hints' : 'Ask Sensei (4)'}
                  </button>
                  <button
                    onClick={handleExplainLastMove}
                    disabled={
                      !lastMove ||
                      lastMove.row < 0 ||
                      aiThinking ||
                      senseiLoading
                    }
                  >
                    Explain Last
                  </button>
                </div>

                {hints.length > 0 && (
                  <div className="sym-grid-4 mt-10">
                    {hints.map((h) => (
                      <button
                        key={h.move}
                        className={
                          selectedHint?.move === h.move ? 'active' : ''
                        }
                        onClick={() => handleHintClick(h)}
                        title={`Winrate ${h.winrate}% (${h.scoreLead >= 0 ? '+' : ''}${h.scoreLead})`}
                      >
                        #{h.rank} {h.move}
                      </button>
                    ))}
                  </div>
                )}

                <div className="sensei-output mt-10">
                  {senseiLoading ? (
                    <p className="muted">
                      Consulting {aiRank.toUpperCase()} Sensei via Ollama...
                    </p>
                  ) : explanationData ? (
                    <>
                      <div className="explain-meta">
                        <strong>Focus: {explanationData.move}</strong>
                        {selectedHint && (
                          <span>
                            Win {selectedHint.winrate}% (
                            {selectedHint.scoreLead >= 0 ? '+' : ''}
                            {selectedHint.scoreLead})
                          </span>
                        )}
                      </div>
                      <div className="explain-body">
                        {renderFormattedSenseiText(explanationData.explanation)}
                      </div>
                      {selectedHint && (
                        <button
                          className="active mt-10"
                          style={{ width: '100%' }}
                          onClick={() =>
                            handleIntersectionClick(
                              selectedHint.row,
                              selectedHint.col,
                            )
                          }
                          disabled={Boolean(gameResult) || aiThinking}
                        >
                          Play Hint #{selectedHint.rank} ({selectedHint.move})
                        </button>
                      )}
                    </>
                  ) : (
                    <p className="muted">
                      Click <strong>Ask Sensei (4)</strong> to project candidate
                      silhouettes onto the board, then click any number to
                      inspect its purpose.
                    </p>
                  )}
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
          </>
        )}
      </main>
    </div>
  );
}
