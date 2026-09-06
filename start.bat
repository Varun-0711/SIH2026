@echo off
REM Starts the FastAPI backend and Vite frontend in separate terminal windows.

start "SIH2026 Backend" cmd /k "cd /d D:\SIH2026\backend && uvicorn main:app --reload"
start "SIH2026 Frontend" cmd /k "cd /d D:\SIH2026\frontend && npm run dev"

exit /b 0
