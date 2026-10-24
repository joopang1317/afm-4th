# 예약 실행: 매주 월 09:00 — 입고일정담당 주간 입고점검 (멈출 장치: 자료 없음·중복 실행·턴/시간 한도)
$root=Split-Path $PSScriptRoot -Parent; Set-Location $root
$log="$root/로그/예약실행.log"; $now=Get-Date; $stamp=$now.ToString('yyMMdd HH:mm')
$week="{0}{1:D2}" -f $now.ToString('yy'), [int](Get-Date -UFormat %V)
$file="자료/입고/inbound_$week.csv"; $lock="$root/로그/.ran_$($now.ToString('yyMMdd'))"
if(Test-Path $lock){ Add-Content $log "[$stamp] 건너뜀 · 오늘 이미 실행 (한도 1회/일)" -Encoding UTF8; exit 0 }
if(-not (Test-Path "$root/$file")){ Add-Content $log "[$stamp] 멈춤 · 자료 없음 ($file) — 지어내지 않음" -Encoding UTF8; exit 0 }
New-Item $lock -ItemType File -Force | Out-Null
Add-Content $log "[$stamp] 시작 · $week 주 · 입력 $file" -Encoding UTF8
$claude="$env:USERPROFILE\.local\bin\claude.exe"
$prompt="주간 입고점검 $week 예약 실행 — 이번 주 $file, 전주 자료/입고/inbound_$($week.Substring(0,2))$([int]$week.Substring(2)-1).csv, 기준일 $($now.ToString('yyyy-MM-dd')). 완료 후 로그/예약실행.log 에 한 줄 남겨."
$p=Start-Process -FilePath $claude -ArgumentList @('-p',"`"$prompt`"",'--max-turns','40','--permission-mode','acceptEdits','--allowedTools','Read,Glob,Grep,Write,Edit,Bash,PowerShell,Agent,Task') -NoNewWindow -PassThru -RedirectStandardOutput "$root/로그/예약실행_$($now.ToString('yyMMdd_HHmm')).out.txt"
if(-not $p.WaitForExit(900000)){ $p.Kill(); Add-Content $log "[$(Get-Date -Format 'yyMMdd HH:mm')] 중단 · 15분 한도 초과" -Encoding UTF8; exit 1 }
Add-Content $log "[$(Get-Date -Format 'yyMMdd HH:mm')] 종료 · exit $($p.ExitCode) · 출력 로그/예약실행_$($now.ToString('yyMMdd_HHmm')).out.txt" -Encoding UTF8
