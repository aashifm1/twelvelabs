# Twelve Labs — Text to Speech

Neural text-to-speech web app. No API keys needed.

## Deploy to Render

1. Push this code to a GitHub repo
2. Go to [render.com](https://render.com) → **New** → **Web Service**
3. Connect your GitHub repo
4. Render will auto-detect `render.yaml`, or set manually:
   - **Build Command:** `pip install -r requirements.txt`
   - **Start Command:** `gunicorn app:app --bind 0.0.0.0:$PORT --workers 2 --timeout 120`
5. Click **Deploy**

Your app will be live at `https://your-app-name.onrender.com`

## Run Locally

```bash
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5000`

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/voices` | GET | List voices |
| `/api/synthesize` | POST | Generate audio |
| `/api/batch` | POST | Batch generate |
