# Windows 작업 스케줄러 등록: 매주 월 09:00 입고일정담당 예약 실행 (PC가 켜져 있어야 함)
$root=Split-Path $PSScriptRoot -Parent
$act="powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$root\scripts\weekly_inbound.ps1`""
schtasks /Create /F /SC WEEKLY /D MON /ST 09:00 /TN "MT빌더_입고점검_주간" /TR $act
"등록 완료. 지금 1회 실행: schtasks /Run /TN MT빌더_입고점검_주간 · 확인: schtasks /Query /TN MT빌더_입고점검_주간 /V /FO LIST"
