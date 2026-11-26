![AI Sensei Dojo](/frontend/public/banner.jpg)

# AI Sensei Dojo — Local-First 9x9 & 13x13 Baduk Trainer

An interactive **9x9 & 13x13** Go (Baduk) dojo pairing a hybrid **Python MCTS + KataGo OpenCL GPU** engine (`30 Kyu` → `1 Dan+`), zero-CPU **GPU Instant** evaluations with local Ollama **3B / 7B** prose reviews, dual-board **Opening & Joseki Explorers**, and an 8-module puzzle curriculum backed by an AGA/Glicko-weighted SQLite skill rubric.

## Demo Walkthrough

<div align="center">
  <video src="https://github.com/user-attachments/assets/05bf8cdf-7a16-4c3c-a1f8-bea311139dd1" width="100%" controls autoplay loop muted></video>
</div>

---

## Why AI Sensei Dojo?

> **TL;DR:** A local-first **9x9 & 13x13** Go dojo built to take a player from **30 Kyu → 1 Dan** through visual board overlays (`Territory + Early-Game Influence` & `Chain Liberties`), a hybrid **Python MCTS + KataGo OpenCL GPU** engine, toggleable **GPU / 3B / 7B** coaching, interactive **9x9 & 13x13 Opening & Joseki Explorers**, metadata-rich SGF game review with **Resume vs AI**, and an 8-module puzzle curriculum (57+ drills) backed by an AGA/Glicko-weighted SQLite rubric.

Most Go apps treat **20 Kyu** as "beginner" and drop 30-Kyu newcomers straight into cryptic life-and-death puzzles without explaining _how to build from an empty board_ or _why_ a move works. **AI Sensei Dojo** bridges that gap through visual feedback, immediate tactical explanations, and weighted progression metrics:

- **One-Click `9x9` / `13x13` Goban Toggle:** Switch seamlessly between compact **9x9** close-quarters fighting and **13x13** corner-and-side framework play—automatically scaling the responsive SVG Goban, star points (_hoshi_), handicap placements, and SGF headers (`SZ[9]` / `SZ[13]`).
- **Hybrid Engine (`30 Kyu` → `6 Kyu` Python MCTS + `3 Kyu` → `1 Dan+` KataGo GPU):** Novice and mid-Kyu ranks on 9x9 run on a calibrated Python MCTS engine that plays recoverable, shape-teaching patterns, while `3 Kyu`, `1 Dan`, candidate evaluations, and `13x13` matches route to a persistent **KataGo OpenCL GPU** GTP session (`katago_gtp.py`) with live `[KataGo GPU]` / `[Python MCTS]` telemetry.
- **Interactive Rank 1–4 Hint Silhouettes & `GPU` / `3B` / `7B` Toggle:** Project KataGo's top 4 candidate moves onto the SVG Goban in <150 ms without blocking board interaction. Defaults to zero-CPU **`GPU Instant`** telemetry reads during live play, with one-click switching to **`3B`** (`qwen2.5-coder:3b`) or **`7B`** (`qwen2.5-coder:7b`) local Ollama coaching (auto-engaged when importing an SGF for post-game review).
- **9x9 & 13x13 Opening & Joseki Explorers:** Interactive move-tree explorers synced to your active board size—covering **Tengen (`E5`)**, **San-San (`3-3`)**, **Komoku (`3-4`)**, and **Hoshi (`4-4`)** on 9x9 alongside **3-4 Knight's Approaches**, **3-3 Invasions**, and **Two-Space Extensions** on 13x13 with clickable numbered continuations (`#1`–`#4`) and one-click Sensei shape reads.
- **Visual Goban Overlays & Board-Footer Advantage Bar:** Toggle **`Territory: ON`** (displaying both 100% sealed territory squares and early-game Manhattan influence dots before walls close) and **`Liberties: ON`** (inward-aligned liberty badges on every connected stone chain with crimson Atari alerts), paired with a live `#349259` emerald **Area Advantage Bar** right beneath the board.
- **Progressive Puzzle Dojo (8 Modules, 57+ Drills):** Auto-discovering JSON curriculum packs spanning 9x9 tactical foundations (`01`–`07`) plus **13x13 Frameworks & Corners (`08`)**—complete with pre-drill **Sensei Principle** callouts and multi-step interactive opponent replies.
- **SGF Metadata Review (`Resume vs AI`) & SQLite Telemetry (`backend/data/metrics.db`):** Export matches to standard `.sgf` files complete with `SZ`, `PB`, `PW`, `BR`, `WR`, `RE`, and `DT` header tags—or import external 9x9/13x13 SGFs with destructured player/rank badges and one-click **`Resume vs AI`** variation sparring—while SQLite tracks continuous floating-point Kyu/Dan rating and per-match `[9x9]` / `[13x13]` history.

### Roadmap

- **Per-Board-Size Rating Split (`9x9` vs `13x13`):** Surface independent 9x9 and 13x13 rank estimates derived directly from the `board_size` column in `match_history`.
- **19x19 Goban Support:** Extend the parameterized `go_rules.py`, `goLogic.js`, and SVG Goban scaler to full-board 19x19 play on KataGo GPU.
- **Multi-Move SGF Mistake Review:** Batch-scan imported SGF games with KataGo winrate drops to flag top blunders automatically for Ollama `3B`/`7B` coaching.

---

## Architecture

```text
baduk-trainer/
├── backend/
│   ├── main.py              # FastAPI REST endpoints, multi-size loaders & ASCII telemetry banner
│   ├── go_rules.py          # 9x9 & 13x13 rules engine, liberty flood-fill, Ko validation, area scoring
│   ├── engine_bridge.py     # Hybrid router: 30k–6k Python MCTS + 3k–1d / 13x13 KataGo GPU delegation
│   ├── katago_gtp.py        # Persistent OpenCL GPU KataGo GTP subprocess & kata-analyze parser
│   ├── sensei_agent.py      # GPU Instant telemetry formatter + spatial-grounded Ollama client (3B/7B)
│   ├── metrics_db.py        # SQLite persistence for AGA/Glicko rank rubric & 9x9/13x13 match history
│   ├── engine/              # Local KataGo OpenCL binary, b10c128 weights (gitignored) & gtp.cfg
│   ├── joseki/              # Interactive 9x9 & 13x13 opening variation trees (9x9_openings, 13x13_openings)
│   └── puzzles/             # Auto-loaded JSON curriculum packs (01_opening -> 08_13x13_foundations)
└── frontend/
    └── src/
        ├── components/
        │   └── Goban9x9.jsx          # Responsive SVG 9x9 & 13x13 board with influence, liberties & hints
        ├── hooks/
        │   ├── useMatchEngine.js     # Multi-goban match state, AI turn loop, SGF import/export & Resume vs AI
        │   ├── useDojoCurriculum.js  # Multi-step puzzle progression, 9x9/13x13 Joseki trees & SQLite metrics
        │   └── useSenseiCoach.js     # Candidate evaluation, GPU/3B/7B model switching & explanations
        ├── utils/
        │   └── goLogic.js            # Client-side 9x9 & 13x13 rules, SGF serializer/parser & territory map
        └── App.jsx                   # Slim UI layout shell for Match Play, Dojo, Joseki & Progress views

```

## Local Setup & Run

**1. Prerequisites**

- Python 3.11+
- Node.js 20+
- _(Optional — for 3B/7B natural-language Sensei prose & SGF reviews)_ Ollama running locally:

```bash
ollama pull qwen2.5-coder:7b
ollama pull qwen2.5-coder:3b
```

- _(Optional — for `3 Kyu` / `1 Dan` GPU sparring & instant GPU evaluations)_ Drop local KataGo OpenCL binaries into `backend/engine/` (auto-falls back to Python MCTS if omitted):
  - **Binary:** Download `-opencl-windows-x64.zip` from [KataGo Releases](https://github.com/lightvector/KataGo/releases) and extract `katago.exe` into `backend/engine/`.
  - **Network:** Download a lightweight `b10c128` `.bin.gz` weight file from [KataGo Networks](https://katagotraining.org/networks/) and save as `backend/engine/model.bin.gz` (or `.txt`) alongside `backend/engine/gtp.cfg`.

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
