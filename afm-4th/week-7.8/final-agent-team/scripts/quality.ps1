param([Parameter(Mandatory)][string]$Csv,[ValidateSet('golden','incoming')][string]$Mode='golden')
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$F=Get-Content "$PSScriptRoot/factsheet.json" -Raw -Encoding UTF8|ConvertFrom-Json
$D=Import-Csv $Csv -Encoding UTF8
if($Mode -eq 'golden'){
  "골든샘플 $Csv · 샘플 3개 · 규칙: 치수✗1~2=조건부 · 기능✗=재샘플 · 전부○=합격 후보"
  "| 항목 | 규격 | 종류 | S1 | S2 | S3 | 판정 | 벗어난 값 |"; "|---|---|---|---|---|---|---|---|"
  $dimX=0;$funX=0
  foreach($r in $D){
    $lo=[double]$r.nominal-[double]$r.tol_minus; $hi=[double]$r.nominal+[double]$r.tol_plus
    $out=@(); foreach($s in 's1','s2','s3'){ $v=[double]$r.$s; if($v -lt $lo -or $v -gt $hi){ $out+="$($s.ToUpper())=$v" } }
    $ok= ($out.Count -eq 0); if(-not $ok){ if($r.kind -eq '기능'){$funX++}else{$dimX++} }
    "| $($r.item) | $($r.spec) $($r.unit) | $($r.kind) | $($r.s1) | $($r.s2) | $($r.s3) | $(if($ok){'○'}else{'✗'}) | $($out -join ', ') |"
  }
  $v= if($funX -gt 0 -or $dimX -ge 3){'재샘플'} elseif($dimX -gt 0){'조건부(수정 지시)'} else {'합격 후보'}
  "`n판정 후보: $v (치수✗ $dimX · 기능✗ $funX)"
}else{
  $grade=[ordered]@{'구성품누락'='치명';'로고각인'='치명';'커버결합불량'='중';'들뜸'='중';'스크래치'='경';'포장눌림'='경'}
  $n=$D.Count
  "입고검사 $Csv · 샘플 $n · 허용: 치명 $($F.aql_critical) · 중 ≤$($F.aql_major) · 경 ≤$($F.aql_minor)"
  "| 결함 항목 | 등급 | 건수 | 샘플 번호 |"; "|---|---|---|---|"
  $sum=@{'치명'=0;'중'=0;'경'=0}
  foreach($k in $grade.Keys){ $h=@($D|?{[int]$_.$k -gt 0}); $sum[$grade[$k]]+=$h.Count; "| $k | $($grade[$k]) | $($h.Count) | $(($h.sample) -join ', ') |" }
  "`n등급 합계: 치명 $($sum['치명']) · 중 $($sum['중']) · 경 $($sum['경'])"
  $v= if($sum['치명'] -le $F.aql_critical -and $sum['중'] -le $F.aql_major -and $sum['경'] -le $F.aql_minor){'입고 후보'}else{'보류'}
  "판정 후보: $v"
}
