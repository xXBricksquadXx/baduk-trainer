import { useState, useCallback } from 'react';
import { BLACK } from '../utils/goLogic';

export function useSenseiCoach({
  apiBase,
  aiRank,
  activeTab,
  board,
  currentTurn,
  koPoint,
  gameResult,
  aiThinking,
  lastMove,
  puzzleBoard,
  currentPuzzle,
  onPlayMatchMove,
  onPlayPuzzleMove,
  setStatusBanner,
}) {
  const [hints, setHints] = useState([]);
  const [selectedHint, setSelectedHint] = useState(null);
  const [hintsLoading, setHintsLoading] = useState(false);
  const [senseiLoading, setSenseiLoading] = useState(false);
  const [explanationData, setExplanationData] = useState(null);
  const [senseiModel, setSenseiModel] = useState('katago-instant');

  const clearCoaching = useCallback(() => {
    setHints([]);
    setSelectedHint(null);
    setExplanationData(null);
  }, []);

  const requestHintExplanation = useCallback(
    async (
      targetBoard,
      targetColor,
      targetCoord,
      candidateList,
      activeKo,
      mode = 'hint',
    ) => {
      setSenseiLoading(true);
      try {
        const res = await fetch(`${apiBase}/explain`, {
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
    },
    [apiBase, aiRank, senseiModel],
  );

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
      const res = await fetch(`${apiBase}/hints`, {
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
        await onPlayPuzzleMove(hint.row, hint.col);
      } else if (activeTab === 'match') {
        await onPlayMatchMove(hint.row, hint.col);
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

  return {
    hints,
    selectedHint,
    hintsLoading,
    senseiLoading,
    explanationData,
    senseiModel,
    setSenseiModel,
    clearCoaching,
    requestHintExplanation,
    handleRequestHints,
    handleHintClick,
    handleExplainLastMove,
  };
}
