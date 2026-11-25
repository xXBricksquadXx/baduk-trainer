import { useState, useEffect, useMemo } from 'react';
import {
  BLACK,
  WHITE,
  createInitialBoard,
  applyMove,
  toCoordString,
  fromCoordString,
} from '../utils/goLogic';

export function useDojoCurriculum({ apiBase, clearCoaching, setStatusBanner }) {
  const [engineStatus, setEngineStatus] = useState('Checking engine...');
  const [puzzlePacks, setPuzzlePacks] = useState([]);
  const [activePackIdx, setActivePackIdx] = useState(0);
  const [activePuzzleIdx, setActivePuzzleIdx] = useState(0);
  const [puzzleBoard, setPuzzleBoard] = useState(() => createInitialBoard(0));
  const [puzzleLastMove, setPuzzleLastMove] = useState(null);
  const [puzzleFeedback, setPuzzleFeedback] = useState(null);
  const [puzzleSolved, setPuzzleSolved] = useState(false);
  const [puzzleStepIndex, setPuzzleStepIndex] = useState(0);

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

  useEffect(() => {
    fetch(`${apiBase}/health`)
      .then((res) => res.json())
      .then((data) => setEngineStatus(`Engine: ${data.engine}`))
      .catch(() => setEngineStatus('Backend offline'));

    fetch(`${apiBase}/puzzles`)
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

    fetch(`${apiBase}/joseki`)
      .then((res) => res.json())
      .then((data) => setJosekiData(data))
      .catch(() => {});
  }, [apiBase]);

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
      const apiRes = await fetch(`${apiBase}/puzzles/attempt`, {
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

  const josekiState = useMemo(() => {
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
  }, [josekiData, josekiPath]);

  return {
    engineStatus,
    puzzlePacks,
    activePackIdx,
    activePuzzleIdx,
    currentPack,
    currentPuzzle,
    puzzleBoard,
    puzzleLastMove,
    puzzleFeedback,
    puzzleSolved,
    selectPuzzle,
    handlePuzzleIntersectionClick,
    stepPuzzle,
    josekiPath,
    setJosekiPath,
    josekiState,
    progressStats,
    setProgressStats,
  };
}
