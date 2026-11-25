![AI Sensei 9x9](/frontend/public/banner.jpg)

# AI Sensei 9x9 — Local-First Baduk Dojo

An interactive 9x9 Go (Baduk) trainer pairing a calibrated 30 Kyu – 1 Dan engine, spatial-grounded local Ollama coaching, and a progressive High School-to-College puzzle curriculum.

---

## Demo Walkthrough

<div align="center">
  <video src="https://github.com/user-attachments/assets/6931e71e-6064-4750-8016-1a387d926f95" width="100%" controls autoplay loop muted></video>
</div>

---

## Why AI Sensei 9x9?

> **TL;DR:** A local-first 9x9 Go dojo built to take a player from **30 Kyu → 1 Dan** through visual board overlays (`Territory + Early-Game Influence` & `Chain Liberties`), an interactive **9x9 Opening & Joseki Explorer**, toggleable **3B Fast / 7B Deep** local Ollama coaching, metadata-rich SGF game review, and a 7-module High School-to-College puzzle curriculum backed by an AGA/Glicko-weighted SQLite skill rubric.

Most Go apps treat **20 Kyu** as "beginner" and drop 30-Kyu newcomers straight into cryptic life-and-death puzzles without explaining _how to build from an empty board_ or _why_ a move works. **AI Sensei 9x9** bridges that gap through visual feedback, immediate tactical explanations, and weighted progression metrics:

- **Calibrated AI Opponent (`30 Kyu` → `1 Dan`) & Endgame Pass Detection:** Scales candidate pool breadth, tactical reading depth, and Monte Carlo rollouts so novice ranks play genuine exploratory shapes while single-digit Kyu and Dan ranks punish overplays—and automatically detects when all territory borders are sealed (zero neutral _dame_ left) to recommend passing instead of eye-filling.
- **Interactive Rank 1–4 Hint Silhouettes & `3B Fast` / `7B Deep` Toggle:** Project the engine's top 4 candidate moves onto the SVG Goban in <150 ms without blocking board interaction. Switch on the fly between **`3B Fast`** (`qwen2.5-coder:3b`, ~2s tactical reads for rapid puzzle reps on CPU/RAM) and **`7B Deep`** (`qwen2.5-coder:7b`, deeper post-game analysis), and click any selected silhouette again to place the stone.
- **9x9 Opening & Joseki Explorer:** Interactive move-tree explorer covering **Tengen (`E5`)**, **San-San (`3-3`)**, **Komoku (`3-4`)**, and **Hoshi (`4-4`)** 9x9 opening frameworks with clickable numbered continuations (`#1`–`#4`), breadcrumb navigation, Japanese/English Go terminology, and one-click Sensei shape reads.
- **Spatial-Grounded Sensei Explanations:** Serializes exact stone inventories, orthogonal neighbor states, and Atari chain scans before prompting the local LLM—eliminating coordinate hallucinations.
- **Visual Goban Overlays & Board-Footer Advantage Bar:** Toggle **`Territory: ON`** (displaying both 100% sealed territory squares and early-game Manhattan influence dots before walls close) and **`Liberties: ON`** (inward-aligned liberty badges on every connected stone chain with crimson Atari alerts), paired with a live `#349259` emerald **Area Advantage Bar** right beneath the board.
- **High School → College Puzzle Dojo (7 Modules, 51+ Drills):** Auto-discovering JSON curriculum packs covering empty-board openings, multi-stone chain liberties, post-move-5 midgame awareness, cuts/connections, two-eye life/death, ladders/nets, and endgame _Yose_—complete with pre-drill **Sensei Principle** callouts and multi-step interactive opponent replies.
- **SGF Header Metadata & AGA/Glicko-Weighted SQLite Rubric (`backend/data/metrics.db`):** Export matches to standard `.sgf` files complete with `PB`, `PW`, `BR`, `WR`, `RE`, and `DT` header tags—or import external SGFs with destructured player/rank badges in the Move Log—while SQLite tracks continuous floating-point Kyu/Dan rating via dynamic upset volatility, a 2-win peer-floor anchor, warm-up filtering, and one-click history recalculation (`/api/metrics/recalculate`).

### Roadmap

- **1 Dan Milestone & 13x13 Board Size Expansion:** Lock in **1 Dan** mastery on 9x9, then introduce a `9x9` / `13x13` board size toggle built cleanly on top of the modularized React hook architecture (`useMatchEngine`, `useDojoCurriculum`, `useSenseiCoach`) to bridge compact tactical reading into side-territory frameworks (_moyo_) and invasion timing.
- **Curriculum & Opening Tree Expansion:** Continual addition of single-digit Kyu and Dan multi-step _semeai_ / _ko_ JSON drills and deeper 9x9 _Joseki_ variations.
- **KataGo / GNU Go Engine Hook:** Drop-in neural policy/value integration via `backend/engine_bridge.py` for high-Dan sparring and deep post-game winrate graphs.

---

## Architecture

```text
baduk-trainer/
├── backend/
│   ├── main.py              # FastAPI REST endpoints (/ai-move, /hints, /explain, /joseki, /puzzles, /metrics)
│   ├── go_rules.py          # 9x9 rules engine, liberty flood-fill, Ko validation, area scoring
│   ├── engine_bridge.py     # 30k–1d calibrated MCTS/heuristic engine (+ sealed-border pass & KataGo hook)
│   ├── sensei_agent.py      # Spatial-grounded Ollama client (qwen2.5-coder:7b / 3b toggle)
│   ├── metrics_db.py        # SQLite persistence for AGA/Glicko-weighted rank rubric & match history
│   ├── joseki/              # Interactive 9x9 opening & joseki variation tree (9x9_openings.json)
│   └── puzzles/             # Auto-loaded JSON curriculum packs (01_opening -> 07_endgame_yose)
└── frontend/
    └── src/
        ├── components/
        │   └── Goban9x9.jsx          # Responsive SVG 9x9 board with influence heatmap, liberties & hint overlays
        ├── hooks/
        │   ├── useMatchEngine.js     # Match state, AI turn execution, undo/redo stacks & SGF import/export
        │   ├── useDojoCurriculum.js  # Multi-step puzzle progression, Joseki tree traversal & SQLite metrics
        │   └── useSenseiCoach.js     # Candidate evaluation, Ollama explanations & 3B/7B model switching
        ├── utils/
        │   └── goLogic.js            # Client-side Go rules, SGF header serializer/parser & territory estimator
        └── App.jsx                   # Slim UI layout shell for Match Play, Dojo, Joseki & Progress views
```

---

## Local Setup & Run

**1. Prerequisites**

- Python 3.11+
- Node.js 20+
- Ollama running locally with qwen2.5-coder:7b (and optional qwen2.5-coder:3b fast fallback):

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:3b
```

**2. Start the FastAPI Backend**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

**3. Start the Vite React Frontend**

```powershell
cd frontend
npm install
npm run dev
```

> Open http://localhost:5173 in your browser.
