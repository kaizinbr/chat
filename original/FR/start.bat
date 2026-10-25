@echo off
start chrome.exe --disable-web-security --disable-first-run-ui --app-shell-host-window-size=800,600 --user-data-dir="%userprofile%\Chrome\Ghostbuster" --app="%~dp0\index.html"
exit