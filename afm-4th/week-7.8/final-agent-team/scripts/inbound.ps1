param([Parameter(Mandatory)][string]$This,[string]$Prev,[string]$Base=(Get-Date -Format yyyy-MM-dd))
[Console]::OutputEncoding=[Text.Encoding]::UTF8
if(-not (Test-Path $This)){ "자료 없음 · 멈춤: $This"; exit 2 }
$F=Get-Content "$PSScriptRoot/factsheet.json" -Raw -Encoding UTF8|ConvertFrom-Json
$T=Import-Csv $This -Encoding UTF8; $P=@{}; if($Prev -and (Test-Path $Prev)){ Import-Csv $Prev -Encoding UTF8|%{ $P[$_.code]=$_ } }
$b=[datetime]$Base; $rows=@()
foreach($r in $T){
  $pe= if($P[$r.code]){$P[$r.code].eta}else{""}
  $j=""; $d=""
  if(-not $r.eta){$j="⚪확인 필요"}
  elseif(-not $pe){$j="🟢(전주 없음)"}
  else{ $d=([datetime]$r.eta-[datetime]$pe).Days; $j= if($d -ge $F.delay_days){"🔴지연"} elseif($d -ge 1){"🟡변동"} else {"🟢"} }
  $dd= if($r.eta){([datetime]$r.eta-$b).Days}else{$null}
  $notify= ($dd -ne $null -and $dd -ge 0 -and $dd -le $F.notify_days)
  $rows+=[pscustomobject]@{j=$j;code=$r.code;item=$r.item;sup=$r.supplier;pe=$pe;eta=$r.eta;d=$d;dd=$dd;notify=$notify;shoot=$r.content_shoot;status=$r.status;pair=$r.pair}
}
"기준일 $Base · 이번 주 $This ($($T.Count)건) · 전주 $Prev"
"`n## ① 요약"
"| 전체 | 🔴지연 | 🟡변동 | 🟢정상 | ⚪확인 필요 | 통보 대상 |"; "|---|---|---|---|---|---|"
"| $($rows.Count) | $(($rows|?{$_.j -like '🔴*'}).Count) | $(($rows|?{$_.j -like '🟡*'}).Count) | $(($rows|?{$_.j -like '🟢*'}).Count) | $(($rows|?{$_.j -like '⚪*'}).Count) | $(($rows|?{$_.notify}).Count) |"
"`n## ② 통보 대상 (0~$($F.notify_days)일 · 촬영 Y 먼저)"
"| 코드 | 품목 | ETA | D-일 | 촬영 | 상태 |"; "|---|---|---|---|---|---|"
$rows|?{$_.notify}|Sort-Object @{e={$_.shoot -ne 'Y'}},dd|%{"| $($_.code) | $($_.item) | $($_.eta) | D-$($_.dd) | $($_.shoot) | $($_.status) |"}
"`n## ③ 지연 · 변동 · 확인 필요"
"| 판정 | 코드 | 품목 | 업체 | 전주 ETA | 이번 주 ETA | 차이 |"; "|---|---|---|---|---|---|---|"
$rows|?{$_.j -notlike '🟢*'}|%{"| $($_.j) | $($_.code) | $($_.item) | $($_.sup) | $($_.pe) | $($_.eta) | $(if($_.d -ne ''){"+$($_.d)일"}) |"}
"`n## ④ 짝 확인 (상품 ↔ 패키지)"
"| 상품 코드 | 상품 ETA | 패키지 코드 | 패키지 ETA | 여유(일) | 판정 |"; "|---|---|---|---|---|---|"
foreach($r in ($rows|?{$_.pair -and $_.item -notmatch '패키지'})){
  $pk=$rows|?{$_.code -eq $r.pair}|Select -First 1
  if($pk -and $r.eta -and $pk.eta){ $gap=([datetime]$r.eta-[datetime]$pk.eta).Days; $v= if($gap -lt 0){"🔴 패키지가 늦음"} elseif($gap -le 1){"🟡 여유 없음"} else {"🟢"} ; "| $($r.code) | $($r.eta) | $($pk.code) | $($pk.eta) | $gap | $v |" }
  elseif($pk){ "| $($r.code) | $($r.eta) | $($pk.code) | $($pk.eta) | - | ⚪확인 필요 |" }
}
