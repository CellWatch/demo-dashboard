# CellWatch Dashboard

CellWatch Dashboard is a map-based measurement explorer built from three pieces:

- A React + Vite frontend in `demo-dashboard/`
- A Flask API in `backend/`
- A Supabase-backed data layer queried through RPCs

The dashboard renders cellular/network measurements as points or H3 hex bins, supports provider/connection/date/type filtering, and can export filtered results from the UI.

## Repo Layout

```text
.
|- backend/                 Flask API and Supabase repo layer
|- demo-dashboard/          React/Vite frontend
|- supabase/                Supabase config and migrations
`- .github/workflows/       GitHub Pages deploy workflow
```

Key files:

- `backend/app.py` - Flask app, CORS config, and API routes
- `backend/repos/supabase.py` - Supabase RPC integration and paged measurement fetches
- `demo-dashboard/src/components/HexMap.jsx` - main map UI and viewport fetch behavior
- `demo-dashboard/src/utils/hexMapData.js` - testable map/filter/query helper logic
- `.github/workflows/deploy.yml` - GitHub Pages build and deploy pipeline

## Architecture

### Frontend

The frontend is a Vite app that:

- fetches viewport data from the Flask API
- pushes active filters into `/api/map/points`
- renders either raw points or H3 hex aggregations
- supports search, filtering, detail panels, and CSV export

### Backend

The Flask API exposes:

- `GET /health`
- `GET /api/map/points`
- `GET /api/map/hex`
- `GET /api/hex/<h3_index>/groups`
- `GET /api/group/<group_id>`

The backend currently uses the Supabase repo by default when `ENABLE_SUPABASE=1`.

### Data Layer

Supabase is queried through RPC endpoints. The backend pages `rpc_map_points` requests so the dashboard is not limited by the default 1000-row RPC response cap.

## Local Development

### Prerequisites

- Node.js 20+
- Python 3.10+

### 1. Start the backend

From `backend/`:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

The API runs at `http://localhost:5000`.

### 2. Start the frontend

From `demo-dashboard/`:

```powershell
cd demo-dashboard
npm install
npm run dev
```

Open the Vite URL shown in the terminal, typically `http://localhost:5173`.

## Environment Variables

### Backend

Create `backend/.env` with values like:

```dotenv
ENABLE_SUPABASE=1
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
DASHBOARD_SECRET=...
SUPABASE_RPC_PAGE_SIZE=1000
PORT=5000
```

Notes:

- `SUPABASE_SERVICE_ROLE_KEY` is preferred. `SUPABASE_ANON_KEY` also works if needed.
- `SUPABASE_RPC_PAGE_SIZE` is optional and defaults to `1000`.
- `DASHBOARD_SECRET` is read by both the Flask app and the Supabase repo helper.

### Frontend

Create `demo-dashboard/.env.local` for local development:

```dotenv
VITE_API_BASE=http://localhost:5000
VITE_MAPBOX_TOKEN=...
VITE_DASHBOARD_SECRET=...
VITE_DEBUG_MAP=true
```

Important variables:

- `VITE_API_BASE` - Flask backend base URL
- `VITE_MAPBOX_TOKEN` - Mapbox token used by the map UI
- `VITE_DASHBOARD_SECRET` - sent as `x-dashboard-secret` on API requests
- `VITE_DEBUG_MAP` - enables extra fetch/debug logging in the browser

## Testing

### Backend tests

```powershell
cd backend
python -m unittest discover -s tests -v
```

### Frontend tests

```powershell
cd demo-dashboard
npm test
```

### Frontend production build

```powershell
cd demo-dashboard
npm run build
```

## Deployment

### Frontend

The frontend is deployed to GitHub Pages by `.github/workflows/deploy.yml`.

- Trigger: push to the `dashboard` branch
- Build root: `demo-dashboard/`
- Publish output: `demo-dashboard/dist`

The workflow currently builds the frontend against:

- `VITE_API_BASE=https://cellwatch-dashboard-backend-flask.onrender.com`
- `VITE_BASE=/demo-dashboard/`

### Backend

The backend is deployed separately on Render as a Web Service.

Recommended Render settings for this repo:

- Branch: `dashboard`
- Root Directory: `backend`
- Build Command: `pip install -r requirements.txt`
- Start Command: `gunicorn app:app --worker-class gthread --threads 4 --timeout 120 --bind 0.0.0.0:$PORT`
- Health Check Path: `/health`

## Operational Notes

- The frontend and backend deploy independently. A GitHub Pages deploy does not deploy the Flask backend.
- Local development uses `demo-dashboard/.env.local`, which should normally point at `http://localhost:5000`.
- The backend CORS config allows `localhost`/`127.0.0.1` Vite ports plus `https://cellwatch.github.io`.
- The request-secret check exists in `backend/app.py`, but `_require_dashboard_secret(app)` is currently commented out.
- Because request-secret enforcement is currently disabled, the GitHub Pages workflow intentionally builds without `VITE_DASHBOARD_SECRET` to avoid unnecessary browser preflights.

## Current Production URLs

- Frontend: `https://cellwatch.github.io/demo-dashboard/`
- Backend: `https://cellwatch-dashboard-backend-flask.onrender.com`
