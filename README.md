![AI Sensei 9x9](/frontend/public/banner.jpg)

# AI Sensei 9x9 — Local-First Baduk Dojo

An interactive 9x9 Go (Baduk) trainer pairing a calibrated 30 Kyu – 1 Dan engine, spatial-grounded local Ollama coaching, and a progressive High School-to-College puzzle curriculum.

---

## Demo Walkthrough

<div align="center">
  <video src="https://github.com/user-attachments/assets/e904ebe9-c522-4089-a09d-e331189f7876" width="100%" controls autoplay loop muted></video>
</div>

---

## Why AI Sensei 9x9?

> **TL;DR:** A local-first 9x9 Go dojo built to take a pure beginner from **30 Kyu → 1 Dan** through visual board overlays (`Territory + Early-Game Influence` & `Chain Liberties`), toggleable **3B Fast / 7B Deep** local Ollama coaching, SGF game review, and a 7-module High School-to-College puzzle curriculum backed by an honest SQLite skill rubric.

Most Go apps treat **20 Kyu** as "beginner" and drop 30-Kyu newcomers straight into cryptic life-and-death puzzles without explaining _how to build from an empty board_ or _why_ a move works. **AI Sensei 9x9** bridges that gap through visual feedback, immediate tactical explanations, and weighted progression metrics:

- **Calibrated AI Opponent (`30 Kyu` → `1 Dan`):** Scales candidate pool breadth, tactical reading depth, and Monte Carlo rollouts so novice ranks play genuine exploratory shapes while Dan ranks punish overplays.
- **Interactive Rank 1–4 Hint Silhouettes & `3B Fast` / `7B Deep` Toggle:** Project the engine's top 4 candidate moves directly onto the SVG Goban. Switch on the fly between **`3B Fast`** (`qwen2.5-coder:3b`, ~2s tactical reads for rapid puzzle reps on CPU/RAM) and **`7B Deep`** (`qwen2.5-coder:7b`, deeper post-game analysis), and click any selected silhouette again to place the stone.
- **Spatial-Grounded Sensei Explanations:** Serializes exact stone inventories, orthogonal neighbor states, and Atari chain scans before prompting the local LLM—eliminating coordinate hallucinations.
- **Visual Goban Overlays & Board-Footer Advantage Bar:** Toggle **`Territory: ON`** (displaying both 100% sealed territory squares and early-game Manhattan influence dots before walls close) and **`Liberties: ON`** (live liberty badges on every connected stone chain with crimson Atari alerts), paired with a live `#349259` emerald **Area Advantage Bar** right beneath the board.
- **High School → College Puzzle Dojo (7 Modules, 42+ Drills):** Auto-discovering JSON curriculum packs covering empty-board openings, multi-stone chain liberties, post-move-5 midgame awareness, cuts/connections, two-eye life/death, ladders/nets, and endgame _Yose_—complete with pre-drill **Sensei Principle** callouts and multi-step interactive opponent replies.
- **SGF Export/Import & SQLite Teacher's Rubric (`backend/data/metrics.db`):** Export matches to standard `.sgf` files or import games for Sensei review, while SQLite tracks continuous floating-point Kyu/Dan rating weighted separately for live matches (Exam weight, with loss degradation) and puzzle drills (Lab weight & first-try accuracy).

### Roadmap

- **Curriculum Expansion:** Continual addition of High School & College JSON drills (false-eye traps, snapbacks, and endgame _sente/gote_ sequences).
- **KataGo / GNU Go Engine Hook:** Drop-in neural policy/value integration via `backend/engine_bridge.py` for high-Kyu and Dan-level sparring once foundational 30k–15k mastery is locked in.

---

## Architecture

```text
baduk-trainer/
├── backend/
│   ├── main.py              # FastAPI REST endpoints (/ai-move, /hints, /explain, /puzzles, /metrics)
│   ├── go_rules.py          # 9x9 rules engine, liberty flood-fill, Ko validation, area scoring
│   ├── engine_bridge.py     # 30k–1d calibrated MCTS/heuristic engine (+ optional KataGo/GNU Go hook)
│   ├── sensei_agent.py      # Spatial-grounded Ollama client (qwen2.5-coder:7b -> 3b fallback)
│   ├── metrics_db.py        # SQLite persistence for weighted rank rubric & match history
│   └── puzzles/             # Auto-loaded JSON curriculum packs (01_opening -> 05_life_death)
└── frontend/
    └── src/
        ├── components/
        │   └── Goban9x9.jsx # Responsive SVG 9x9 board with dual last-move rings & hint overlays
        ├── utils/
        │   └── goLogic.js   # Client-side Go rules, handicap presets, and territory estimator
        └── App.jsx          # Match Play, Puzzle Dojo, Sensei Coaching, and Progress Dashboard
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
