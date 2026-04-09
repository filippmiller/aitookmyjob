Set-Location C:\dev\aitookmyjob
$env:TEST_PORT = "8080"
& "C:\Program Files\nodejs\node.exe" "C:\dev\aitookmyjob\node_modules\@playwright\test\cli.js" test "C:\dev\aitookmyjob\tests\e2e-full-suite.spec.js" --project=chromium --workers=1 --reporter=list 2>&1 | Tee-Object -FilePath C:\dev\aitookmyjob\test-output.log
