@echo off
cd /d C:\dev\aitookmyjob
set TEST_PORT=8080
"C:\Program Files\nodejs\node.exe" "C:\dev\aitookmyjob\node_modules\@playwright\test\cli.js" test e2e-full-suite.spec.js --workers=1 --reporter=list > C:\dev\aitookmyjob\test-output.log 2>&1
echo EXIT_CODE=%ERRORLEVEL% >> C:\dev\aitookmyjob\test-output.log
