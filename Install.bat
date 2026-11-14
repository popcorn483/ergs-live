@echo off
setlocal EnableDelayedExpansion
title Rugby Photo Enhancer - Install
cd /d "%~dp0"
echo.
echo  Rugby Photo Enhancer - installer
echo  ================================
echo.

rem ---- find a working Python 3 ----
set "PY="
py -3 -c "import sys" >nul 2>nul && set "PY=py -3"
if not defined PY ( python -c "import sys; assert sys.version_info>=(3,9)" >nul 2>nul && set "PY=python" )
if not defined PY (
  echo  Python isn't installed. Trying to install it now with winget...
  winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
  echo.
  echo  If that worked, close this window and double-click Install.bat again.
  echo  If not, install Python from https://www.python.org/downloads/
  echo  ^(tick "Add python.exe to PATH"^), then run Install.bat again.
  pause
  exit /b 1
)

echo  Using: %PY%
echo  Installing image libraries (Pillow, NumPy)...
%PY% -m pip install --user --upgrade --quiet pillow numpy
if errorlevel 1 ( echo  Could not install the libraries - check your internet connection. & pause & exit /b 1 )

rem ---- copy the app ----
set "APPDIR=%LOCALAPPDATA%\RugbyPhotoEnhancer"
if not exist "%APPDIR%" mkdir "%APPDIR%"
copy /y "rugby_photo_enhancer.py" "%APPDIR%\" >nul
if exist "app.ico" copy /y "app.ico" "%APPDIR%\" >nul

rem ---- find pythonw.exe (runs without a black console window) ----
for /f "usebackq delims=" %%i in (`%PY% -c "import sys,os;print(os.path.join(os.path.dirname(sys.executable),'pythonw.exe'))"`) do set "PYW=%%i"
if not exist "%PYW%" for /f "usebackq delims=" %%i in (`%PY% -c "import sys;print(sys.executable)"`) do set "PYW=%%i"

rem ---- shortcuts on the Desktop and in the Start menu ----
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws=New-Object -ComObject WScript.Shell;" ^
  "foreach($dir in @([Environment]::GetFolderPath('Desktop'), (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'))){" ^
  " $s=$ws.CreateShortcut((Join-Path $dir 'Rugby Photo Enhancer.lnk'));" ^
  " $s.TargetPath='%PYW%'; $s.Arguments='\"%APPDIR%\rugby_photo_enhancer.py\"';" ^
  " $s.WorkingDirectory='%APPDIR%'; $s.IconLocation='%APPDIR%\app.ico,0'; $s.Save() }"

echo.
echo  Done! Open "Rugby Photo Enhancer" from your Desktop or Start menu.
echo.
pause
