# AI Sports Talent Assessment Platform

Upload a short video of an exercise (push-ups, squats, pull-ups or running). The app finds
your body pose with MediaPipe, counts repetitions, and gives an experimental form score with
feedback. Each user has a private account and a history of past assessments.

> This is an experimental computer-vision tool. It is **not** a certified sports assessment
> and not medical advice. Scores are estimates from 2D video.

## What you need (Windows 10/11, 64-bit)

- Node.js 20 or 22 LTS: https://nodejs.org/
- Python 3.10, 3.11 or 3.12 (tick "Add python.exe to PATH"). Python 3.13 is NOT supported.
- Internet during setup (npm, pip and a ~9 MB pose model).

## First-time setup

Double-click `scripts\setup.bat`. It installs everything, creates `backend\.env` with a random
secret, creates the database, creates the Python environment and downloads the pose model.
It ends with "SETUP COMPLETE".

## Start the app

Double-click `scripts\start.bat`, then open http://localhost:5173 in your browser.
Press Ctrl+C in the window (then Y) to stop.

## Using it

1. Create an account and log in.
2. Choose "New assessment", pick the activity, upload a video, click "Analyse video".
3. Read the score, issues and suggestions. Past results are under "History".

## Tips for good videos

- One person only, whole body in frame, camera still, good light, plain background.
- Push-ups and squats: film from the side, 2-3 metres away.
- Pull-ups: hands, elbows and shoulders visible.
- Running: side view, 5-10 seconds or more, both legs visible.
- Record at least 3 full repetitions. Phone videos in MP4 (H.264) work best.

## Project layout

- `frontend/` React app (Vite)
- `backend/` Express API, login, SQLite database
- `ai/` Python video analysis (MediaPipe + OpenCV)
- `storage/` database file and temporary uploads (uploads are deleted after analysis)
- `scripts/` `setup.bat` and `start.bat`

## Privacy

Videos are saved only temporarily to analyse them and are deleted straight afterwards.
Only the numeric results are stored. Each user can see only their own assessments.

## Resetting

To delete all accounts and results, stop the app and delete `storage\assessments.db`
(plus the `-wal` and `-shm` files next to it if present). It is recreated on next start.