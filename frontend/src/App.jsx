// frontend\src\App.jsx
import { useState, useRef, useCallback, useEffect } from 'react';
import Goban9x9 from './components/Goban9x9';
import { useMatchEngine, HANDICAP_OPTIONS } from './hooks/useMatchEngine';
import { useDojoCurriculum } from './hooks/useDojoCurriculum';
import { useSenseiCoach } from './hooks/useSenseiCoach';
import {
  BLACK,
  WHITE,
  estimateAreaScore,
  computeTerritoryMap,
  computeChainLiberties,
} from './utils/goLogic';
import './App.css';

const API_BASE = 'http://127.0.0.1:8000/api';

const RANK_OPTIONS = [
  { value: '30k', label: '30 Kyu — Beginner' },
  { value: '27k', label: '27 Kyu — Foundations' },
  { value: '24k', label: '24 Kyu — Novice' },
  { value: '21k', label: '21 Kyu — Developing' },
  { value: '18k', label: '18 Kyu — Club Entry' },
  { value: '15k', label: '15 Kyu — Solid Kyu' },
  { value: '12k', label: '12 Kyu — Intermediate' },
  { value: '9k', label: '9 Kyu — Single-Digit Kyu' },
  { value: '6k', label: '6 Kyu — Strong Kyu' },
  { value: '3k', label: '3 Kyu — Pre-Dan' },
  { value: '1d', label: '1 Dan — Shodan' },
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
  const [statusBanner, setStatusBanner] = useState(
    'Black to play. Click an intersection to place a stone.',
  );
  const [aiRank, setAiRank] = useState('25k');
  const [activeTab, setActiveTab] = useState('match');
  const [showTerritory, setShowTerritory] = useState(false);
  const [showLiberties, setShowLiberties] = useState(false);

  const clearCoachingRef = useRef(() => {});
  const switchModelRef = useRef(() => {});
  const clearCoaching = useCallback(() => clearCoachingRef.current(), []);

  const dojo = useDojoCurriculum({
    apiBase: API_BASE,
    clearCoaching,
    setStatusBanner,
  });

  const match = useMatchEngine({
    apiBase: API_BASE,
    aiRank,
    userRankLabel: dojo.progressStats.estimatedRank,
    setStatusBanner,
    clearCoaching,
    onProgressUpdate: dojo.setProgressStats,
    onSwitchToMatchTab: () => setActiveTab('match'),
    onSgfImported: () => switchModelRef.current('qwen2.5-coder:3b'),
  });

  const coach = useSenseiCoach({
    apiBase: API_BASE,
    aiRank,
    activeTab,
    board: match.board,
    currentTurn: match.currentTurn,
    koPoint: match.koPoint,
    gameResult: match.gameResult,
    aiThinking: match.aiThinking,
    lastMove: match.lastMove,
    puzzleBoard: dojo.puzzleBoard,
    currentPuzzle: dojo.currentPuzzle,
    onPlayMatchMove: match.handleIntersectionClick,
    onPlayPuzzleMove: dojo.handlePuzzleIntersectionClick,
    setStatusBanner,
  });

  useEffect(() => {
    clearCoachingRef.current = coach.clearCoaching;
    switchModelRef.current = coach.setSenseiModel;
  }, [coach.clearCoaching, coach.setSenseiModel]);

  const liveAdvantage =
    activeTab === 'match'
      ? estimateAreaScore(match.board, match.activeHandicap.komi)
      : null;

  const activeBoardForOverlay =
    activeTab === 'dojo'
      ? dojo.puzzleBoard
      : activeTab === 'joseki'
        ? dojo.josekiState.board
        : match.board;
  const territoryOverlay = showTerritory
    ? computeTerritoryMap(activeBoardForOverlay)
    : null;
  const libertiesOverlay = showLiberties
    ? computeChainLiberties(activeBoardForOverlay)
    : [];

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
            onClick={match.handleExportSgf}
            disabled={match.moveHistory.length === 0}
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

  const renderModelToggles = () => (
    <div className="model-toggle-group">
      <button
        type="button"
        className={`mini-toggle ${coach.senseiModel === 'katago-instant' ? 'active' : ''}`}
        onClick={() => coach.setSenseiModel('katago-instant')}
        disabled={coach.senseiLoading}
        title="Zero-CPU instant GPU evaluation & tactical scan"
      >
        GPU
      </button>
      <button
        type="button"
        className={`mini-toggle ${coach.senseiModel === 'qwen2.5-coder:3b' ? 'active' : ''}`}
        onClick={() => coach.setSenseiModel('qwen2.5-coder:3b')}
        disabled={coach.senseiLoading}
        title="Fast tactical prose via Ollama qwen2.5-coder:3b"
      >
        3B
      </button>
      <button
        type="button"
        className={`mini-toggle ${coach.senseiModel === 'qwen2.5-coder:7b' ? 'active' : ''}`}
        onClick={() => coach.setSenseiModel('qwen2.5-coder:7b')}
        disabled={coach.senseiLoading}
        title="Deep SGF review prose via Ollama qwen2.5-coder:7b"
      >
        7B
      </button>
    </div>
  );

  return (
    <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <img src="/logo.jpg" alt="AI Sensei 9x9" className="brand-logo" />
          <h1>AI Sensei 9x9</h1>
          <span className="badge">
            {match.lastEngineUsed
              ? `Active: ${match.lastEngineUsed}`
              : dojo.engineStatus}
          </span>
          <span className="badge">
            Rank: {dojo.progressStats.estimatedRank}
          </span>
        </div>

        <nav className="top-nav">
          <button
            className={activeTab === 'match' ? 'active' : ''}
            onClick={() => {
              clearCoaching();
              setActiveTab('match');
              setStatusBanner(
                match.gameResult
                  ? `Match complete — ${match.gameResult.winner} won by ${match.gameResult.margin} pts.`
                  : `${match.currentTurn === BLACK ? 'Black' : 'White'} to play.`,
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
              if (dojo.currentPuzzle)
                dojo.selectPuzzle(dojo.activePackIdx, dojo.activePuzzleIdx);
            }}
          >
            Puzzle Dojo ({dojo.progressStats.totalSolved})
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
                `Dojo Rubric: ${dojo.progressStats.estimatedRank} (${dojo.progressStats.totalSolved} drills mastered).`,
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
                    onChange={match.handleImportSgfFile}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
              <div className="progress-grid">
                <div className="capture-box">
                  <span className="label">Estimated Rank</span>
                  <span className="value" style={{ color: 'var(--accent)' }}>
                    {dojo.progressStats.estimatedRank}
                  </span>
                </div>
                <div className="capture-box">
                  <span className="label">Drills Mastered</span>
                  <span className="value">
                    {dojo.progressStats.totalSolved}
                  </span>
                </div>
                <div className="capture-box">
                  <span className="label">Total Puzzle Reps</span>
                  <span className="value">{dojo.progressStats.totalReps}</span>
                </div>
                <div className="capture-box">
                  <span className="label">All-Time Win Rate</span>
                  <span className="value">
                    {dojo.progressStats.matchWins} /{' '}
                    {dojo.progressStats.totalMatches} (
                    {dojo.progressStats.winRate ?? 0}%)
                  </span>
                </div>
              </div>

              <h2>Skill Category Breakdown</h2>
              <div className="sym-grid-2">
                {dojo.puzzlePacks.map((pack) => {
                  const catStats = dojo.progressStats.byCategory?.[
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
              {dojo.progressStats.recentMatches?.length === 0 ? (
                <p className="muted">
                  Complete a game (two consecutive passes) to record match
                  telemetry here.
                </p>
              ) : (
                <div className="move-log">
                  {dojo.progressStats.recentMatches.map((m, i) => (
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
                board={dojo.josekiState.board}
                currentTurn={dojo.josekiState.turn}
                lastMove={dojo.josekiState.lastMove}
                hints={dojo.josekiState.nextMarkers}
                territoryMap={territoryOverlay}
                chainLiberties={libertiesOverlay}
                onHintClick={(marker) => {
                  clearCoaching();
                  dojo.setJosekiPath((prev) => [...prev, marker.node]);
                  setStatusBanner(`${marker.node.move} — ${marker.node.term}`);
                }}
                onIntersectionClick={(r, c) => {
                  const found = dojo.josekiState.nextMarkers.find(
                    (m) => m.row === r && m.col === c,
                  );
                  if (found) {
                    clearCoaching();
                    dojo.setJosekiPath((prev) => [...prev, found.node]);
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
                    Move #{dojo.josekiPath.length} (
                    {dojo.josekiState.turn === BLACK ? 'Black' : 'White'} Next)
                  </span>
                </div>

                <div className="drill-strip">
                  <button
                    className={`drill-chip ${dojo.josekiPath.length === 0 ? 'active' : ''}`}
                    onClick={() => {
                      clearCoaching();
                      dojo.setJosekiPath([]);
                    }}
                  >
                    Root
                  </button>
                  {dojo.josekiPath.map((node, idx) => (
                    <button
                      key={`${node.move}-${idx}`}
                      className={`drill-chip ${idx === dojo.josekiPath.length - 1 ? 'active' : ''}`}
                      onClick={() => {
                        clearCoaching();
                        dojo.setJosekiPath((prev) => prev.slice(0, idx + 1));
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
                      dojo.setJosekiPath((prev) => prev.slice(0, -1));
                    }}
                    disabled={dojo.josekiPath.length === 0}
                  >
                    &lt; Step Back
                  </button>
                  <button
                    className="danger"
                    onClick={() => {
                      clearCoaching();
                      dojo.setJosekiPath([]);
                    }}
                    disabled={dojo.josekiPath.length === 0}
                  >
                    Reset Tree
                  </button>
                </div>
              </div>

              <div className="panel-card">
                <div className="sensei-header">
                  <h2>
                    {dojo.josekiState.currentNode.move
                      ? `${dojo.josekiState.currentNode.move} — ${dojo.josekiState.currentNode.term}`
                      : dojo.josekiState.currentNode.term}
                  </h2>
                </div>
                <p
                  style={{
                    fontSize: '0.84rem',
                    margin: '0 0 12px 0',
                    lineHeight: 1.45,
                  }}
                >
                  {dojo.josekiState.currentNode.summary}
                </p>

                {dojo.josekiState.nextMarkers.length > 0 ? (
                  <>
                    <h2>
                      Next Continuations (
                      {dojo.josekiState.turn === BLACK ? 'Black' : 'White'})
                    </h2>
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                      }}
                    >
                      {dojo.josekiState.nextMarkers.map((m) => (
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
                            dojo.setJosekiPath((prev) => [...prev, m.node]);
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
                  {renderModelToggles()}
                </div>

                <button
                  style={{ width: '100%' }}
                  onClick={() => {
                    if (!dojo.josekiState.currentNode.move) return;
                    const playedColor =
                      dojo.josekiState.turn === BLACK ? WHITE : BLACK;
                    coach.requestHintExplanation(
                      dojo.josekiState.board,
                      playedColor,
                      dojo.josekiState.currentNode.move,
                      [],
                      null,
                      'last_move',
                    );
                  }}
                  disabled={
                    !dojo.josekiState.currentNode.move || coach.senseiLoading
                  }
                >
                  Ask Sensei About This Shape
                </button>

                <div className="sensei-output mt-10">
                  {coach.senseiLoading ? (
                    <p className="muted">Consulting Sensei...</p>
                  ) : coach.explanationData ? (
                    <div className="explain-body">
                      {renderFormattedSenseiText(
                        coach.explanationData.explanation,
                      )}
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
                board={dojo.puzzleBoard}
                currentTurn={dojo.currentPuzzle?.turn || BLACK}
                lastMove={dojo.puzzleLastMove}
                hints={coach.hints}
                selectedHintCoord={coach.selectedHint?.move || null}
                territoryMap={territoryOverlay}
                chainLiberties={libertiesOverlay}
                onIntersectionClick={dojo.handlePuzzleIntersectionClick}
                onHintClick={coach.handleHintClick}
                disabled={dojo.puzzleSolved}
              />
              {renderOverlayStrip()}
            </section>

            <aside className="control-pane">
              <div className="panel-card">
                <h2>Curriculum Pack</h2>
                <label className="field-label">
                  Skill Module
                  <select
                    value={dojo.activePackIdx}
                    onChange={(e) =>
                      dojo.selectPuzzle(Number(e.target.value), 0)
                    }
                  >
                    {dojo.puzzlePacks.map((pack, idx) => (
                      <option key={pack.category} value={idx}>
                        {pack.title}
                      </option>
                    ))}
                  </select>
                </label>

                {dojo.currentPack && (
                  <div className="drill-strip mt-10">
                    {dojo.currentPack.puzzles.map((p, idx) => {
                      const isDone = dojo.progressStats.solvedIds?.includes(
                        p.id,
                      );
                      return (
                        <button
                          key={p.id}
                          className={`drill-chip ${dojo.activePuzzleIdx === idx ? 'active' : ''}`}
                          onClick={() =>
                            dojo.selectPuzzle(dojo.activePackIdx, idx)
                          }
                          title={`${p.title} (${p.rank.toUpperCase()})`}
                        >
                          #{idx + 1} {isDone ? '✓' : ''}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {dojo.currentPuzzle && (
                <div className="panel-card">
                  <div className="sensei-header">
                    <h2>
                      {dojo.currentPuzzle.title} (
                      {dojo.currentPuzzle.rank.toUpperCase()})
                    </h2>
                    <span className="model-tag">
                      {dojo.currentPuzzle.turn === BLACK
                        ? 'Black to Play'
                        : 'White to Play'}
                    </span>
                  </div>

                  {dojo.currentPuzzle.concept && (
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
                      <strong>Sensei Principle:</strong>{' '}
                      {dojo.currentPuzzle.concept}
                    </div>
                  )}

                  <p style={{ fontSize: '0.84rem', margin: '0 0 12px 0' }}>
                    {dojo.currentPuzzle.prompt}
                  </p>

                  {dojo.puzzleFeedback && (
                    <div
                      className={`puzzle-feedback ${dojo.puzzleFeedback.status}`}
                    >
                      <strong>
                        {dojo.puzzleFeedback.status === 'solved'
                          ? '✓ Solved'
                          : dojo.puzzleFeedback.status === 'step'
                            ? '⚡ Step Clear'
                            : '✕ Retry'}
                        ({dojo.puzzleFeedback.move}):{' '}
                      </strong>
                      {dojo.puzzleFeedback.text}
                    </div>
                  )}

                  <div className="sym-grid-4 mt-10">
                    <button onClick={() => dojo.stepPuzzle(-1)}>
                      &lt; Prev
                    </button>
                    <button
                      onClick={() =>
                        dojo.selectPuzzle(
                          dojo.activePackIdx,
                          dojo.activePuzzleIdx,
                        )
                      }
                    >
                      Retry
                    </button>
                    <button
                      className={dojo.puzzleSolved ? 'active' : ''}
                      onClick={() => dojo.stepPuzzle(1)}
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
                  {renderModelToggles()}
                </div>

                <div className="sym-grid-2">
                  <button
                    className={coach.hints.length > 0 ? 'active' : ''}
                    onClick={coach.handleRequestHints}
                    disabled={dojo.puzzleSolved || coach.hintsLoading}
                  >
                    {coach.hints.length > 0
                      ? 'Refresh Hints'
                      : 'Ask Sensei (4)'}
                  </button>
                  <button
                    onClick={clearCoaching}
                    disabled={
                      coach.hints.length === 0 && !coach.explanationData
                    }
                  >
                    Clear Hints
                  </button>
                </div>

                <div className="sensei-output mt-10">
                  {coach.senseiLoading ? (
                    <p className="muted">Consulting Sensei...</p>
                  ) : coach.explanationData ? (
                    <>
                      <div className="explain-meta">
                        <strong>Focus: {coach.explanationData.move}</strong>
                      </div>
                      <div className="explain-body">
                        {renderFormattedSenseiText(
                          coach.explanationData.explanation,
                        )}
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
                board={match.board}
                currentTurn={match.currentTurn}
                lastMove={
                  match.lastMove && match.lastMove.row >= 0
                    ? match.lastMove
                    : null
                }
                lastBlackMove={match.lastBlackMove}
                lastWhiteMove={match.lastWhiteMove}
                koPoint={match.koPoint}
                hints={coach.hints}
                selectedHintCoord={coach.selectedHint?.move || null}
                territoryMap={territoryOverlay}
                chainLiberties={libertiesOverlay}
                onIntersectionClick={match.handleIntersectionClick}
                onHintClick={coach.handleHintClick}
                disabled={Boolean(match.gameResult) || match.aiThinking}
              />
              {renderOverlayStrip()}
            </section>

            <aside className="control-pane">
              <div className="panel-card">
                <h2>Dojo Setup</h2>
                <div className="sym-grid-2">
                  <button
                    className={match.vsAi ? 'active' : ''}
                    onClick={() => match.startFreshMatch({ nextVsAi: true })}
                    disabled={match.aiThinking}
                  >
                    AI Sensei
                  </button>
                  <button
                    className={!match.vsAi ? 'active' : ''}
                    onClick={() => match.startFreshMatch({ nextVsAi: false })}
                    disabled={match.aiThinking}
                  >
                    Local 2P
                  </button>
                </div>

                {match.vsAi && (
                  <div className="sym-grid-2 mt-10">
                    <button
                      className={match.humanColor === BLACK ? 'active' : ''}
                      onClick={() =>
                        match.startFreshMatch({ nextHumanColor: BLACK })
                      }
                      disabled={match.aiThinking}
                    >
                      Play Black
                    </button>
                    <button
                      className={match.humanColor === WHITE ? 'active' : ''}
                      onClick={() =>
                        match.startFreshMatch({ nextHumanColor: WHITE })
                      }
                      disabled={match.aiThinking}
                    >
                      Play White
                    </button>
                  </div>
                )}

                <div className="sym-grid-2 mt-10">
                  {match.vsAi && (
                    <label className="field-label">
                      Sensei Rank
                      <select
                        value={aiRank}
                        onChange={(e) => setAiRank(e.target.value)}
                        disabled={match.aiThinking}
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
                    style={!match.vsAi ? { gridColumn: '1 / -1' } : undefined}
                  >
                    Komi / Handicap
                    <select
                      value={match.handicapId}
                      onChange={(e) =>
                        match.startFreshMatch({
                          nextHandicapId: e.target.value,
                        })
                      }
                      disabled={match.aiThinking}
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
                    className={`stone-indicator ${match.currentTurn === BLACK ? 'black' : 'white'}`}
                  />
                  <strong>
                    {match.gameResult
                      ? 'Match Complete'
                      : match.aiThinking
                        ? 'Sensei Reading...'
                        : `${match.currentTurn === BLACK ? 'Black' : 'White'}'s Turn`}
                  </strong>
                  <span className="move-count">
                    Move #{match.moveHistory.length + 1}
                  </span>
                </div>

                <div className="sym-grid-2">
                  <div className="capture-box">
                    <span className="label">Black Captures</span>
                    <span className="value">{match.captures[BLACK]}</span>
                  </div>
                  <div className="capture-box">
                    <span className="label">White Captures</span>
                    <span className="value">{match.captures[WHITE]}</span>
                  </div>
                </div>

                <div className="sym-grid-4 mt-10">
                  <button
                    onClick={match.handleUndo}
                    disabled={
                      match.moveHistory.length === 0 || match.aiThinking
                    }
                    title="Undo"
                  >
                    &lt; Undo
                  </button>
                  <button
                    onClick={match.handleRedo}
                    disabled={match.redoStack.length === 0 || match.aiThinking}
                    title="Redo"
                  >
                    Redo &gt;
                  </button>
                  <button
                    onClick={match.handlePass}
                    disabled={Boolean(match.gameResult) || match.aiThinking}
                  >
                    Pass
                  </button>
                  <button
                    className="danger"
                    onClick={() => match.startFreshMatch()}
                    disabled={match.aiThinking}
                  >
                    Reset
                  </button>
                </div>
              </div>

              <div className="panel-card sensei-card">
                <div className="sensei-header">
                  <h2>Sensei Coaching</h2>
                  {renderModelToggles()}
                </div>

                <div className="sym-grid-2">
                  <button
                    className={coach.hints.length > 0 ? 'active' : ''}
                    onClick={coach.handleRequestHints}
                    disabled={
                      Boolean(match.gameResult) ||
                      match.aiThinking ||
                      coach.hintsLoading
                    }
                  >
                    {coach.hints.length > 0
                      ? 'Refresh Hints'
                      : 'Ask Sensei (4)'}
                  </button>
                  <button
                    onClick={coach.handleExplainLastMove}
                    disabled={
                      !match.lastMove ||
                      match.lastMove.row < 0 ||
                      match.aiThinking ||
                      coach.senseiLoading
                    }
                  >
                    Explain Last
                  </button>
                </div>

                {coach.hints.length > 0 && (
                  <div className="sym-grid-4 mt-10">
                    {coach.hints.map((h) => (
                      <button
                        key={h.move}
                        className={
                          coach.selectedHint?.move === h.move ? 'active' : ''
                        }
                        onClick={() => coach.handleHintClick(h)}
                        title={`Winrate ${h.winrate}% (${h.scoreLead >= 0 ? '+' : ''}${h.scoreLead})`}
                      >
                        #{h.rank} {h.move}
                      </button>
                    ))}
                  </div>
                )}

                <div className="sensei-output mt-10">
                  {coach.senseiLoading ? (
                    <p className="muted">
                      Consulting {aiRank.toUpperCase()} Sensei...
                    </p>
                  ) : coach.explanationData ? (
                    <>
                      <div className="explain-meta">
                        <strong>Focus: {coach.explanationData.move}</strong>
                        {coach.selectedHint && (
                          <span>
                            Win {coach.selectedHint.winrate}% (
                            {coach.selectedHint.scoreLead >= 0 ? '+' : ''}
                            {coach.selectedHint.scoreLead})
                          </span>
                        )}
                      </div>
                      <div className="explain-body">
                        {renderFormattedSenseiText(
                          coach.explanationData.explanation,
                        )}
                      </div>
                      {coach.selectedHint && (
                        <button
                          className="active mt-10"
                          style={{ width: '100%' }}
                          onClick={() =>
                            match.handleIntersectionClick(
                              coach.selectedHint.row,
                              coach.selectedHint.col,
                            )
                          }
                          disabled={
                            Boolean(match.gameResult) || match.aiThinking
                          }
                        >
                          Play Hint #{coach.selectedHint.rank} (
                          {coach.selectedHint.move})
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
                {match.sgfMeta && (
                  <div className="explain-meta" style={{ marginBottom: '8px' }}>
                    <span>
                      <strong>B:</strong> {match.sgfMeta.blackName}{' '}
                      {match.sgfMeta.blackRank &&
                        `[${match.sgfMeta.blackRank}]`}{' '}
                      • <strong>W:</strong> {match.sgfMeta.whiteName}{' '}
                      {match.sgfMeta.whiteRank &&
                        `[${match.sgfMeta.whiteRank}]`}
                    </span>
                    {match.sgfMeta.result && (
                      <strong>{match.sgfMeta.result}</strong>
                    )}
                  </div>
                )}
                <div className="move-log">
                  {match.moveHistory.length === 0 ? (
                    <p className="muted">No stones played yet.</p>
                  ) : (
                    [...match.moveHistory].reverse().map((m, revIdx) => {
                      const moveNum = match.moveHistory.length - revIdx;
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
