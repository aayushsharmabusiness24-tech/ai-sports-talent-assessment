# Pose model

This folder must contain one file:

    pose_landmarker_full.task

`scripts\setup.bat` downloads it automatically (about 9 MB) from Google's official
MediaPipe model bucket:

    https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task

## Manual download (if setup.bat could not download it)

1. Open the URL above in your browser. The download starts automatically.
2. Save the file as `pose_landmarker_full.task` inside this folder
   (`ai\model\pose_landmarker_full.task`).
3. Run `scripts\setup.bat` again, or verify with:

       ai\venv\Scripts\python.exe ai\main.py --check

The `.task` file is not committed to git (see `.gitignore`).

## About the model

MediaPipe Pose Landmarker (full) detects 33 body landmarks per person. Model details:
https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker