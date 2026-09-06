# Twelve Labs — Text to Speech

Neural text-to-speech web app.

## Execution

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
