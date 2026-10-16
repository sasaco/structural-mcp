@echo off
"%~dp0runtime\node\node.exe" "%~dp0launcher.mjs" unregister-codex %*
set "STRUCTURAL_MCP_SETUP_EXIT=%errorlevel%"
if not defined STRUCTURAL_MCP_NO_PAUSE pause
exit /b %STRUCTURAL_MCP_SETUP_EXIT%
