param([string]$Listings="자료/시장/listings_modelY.csv",[string]$Reviews="자료/시장/reviews_modelY.csv")
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$L=Import-Csv $Listings -Encoding UTF8; $R=Import-Csv $Reviews -Encoding UTF8
"분모: 리스팅 $($L.Count)개 ($Listings) · 리뷰 $($R.Count)건 ($Reviews)"
"`n## ① 수요"
"| 카테고리 | 리스팅 | 리뷰합 | 가격대 | 리뷰100+ 상위3 가격 | 판가상한(중간값) | 세대 분포 |"
"|---|---|---|---|---|---|---|"
foreach($c in ($L.category|Sort-Object -Unique)){
  $g=$L|?{$_.category -eq $c}; $p=$g|%{[int]$_.price_krw}
  $top=@($g|?{[int]$_.reviews -ge 100}|Sort-Object {[int]$_.reviews} -Desc|Select -First 3)
  $tp=@($top|%{[int]$_.price_krw}|Sort-Object); $med= if($tp.Count -ge 2){ $tp[[math]::Floor(($tp.Count-1)/2)] } elseif($tp.Count -eq 1){ $tp[0] } else { 0 }
  $flag= if($tp.Count -lt 2){" (표본 $($tp.Count) · 잠정)"}else{""}
  $fit=($g|Group-Object fitment|%{"$($_.Name) $($_.Count)"}) -join " / "
  "| $c | $($g.Count) | $(($g|%{[int]$_.reviews}|Measure-Object -Sum).Sum) | $(($p|Measure-Object -Min).Minimum)~$(($p|Measure-Object -Max).Maximum) | $(($top|%{"$($_.price_krw)($($_.reviews))"}) -join ', ') | $med$flag | $fit |"
}
"`n## ② 빈틈 — 별점 3 이하"
$map=[ordered]@{'세대 호환(안 맞음)'='주니퍼|구형 전용|구형만|헛돌|모델Y에선';'소음·덜컹'='덜컹|소리';'렌즈 긁힘·안감'='긁|안감|자국';'고정력(접착·클립)'='접착|헐거|떨어';'커버 없음'='커버가 없|커버 없';'크기·활용'='작아|활용도';'배송·재고'='배송|재고';'들뜸·정합'='들떠|미세하게';'플로킹 내구'='플로킹';'소재 경도'='딱딱'}
foreach($c in ($R.category|Sort-Object -Unique)){
  $low=$R|?{$_.category -eq $c -and [int]$_.rating -le 3}
  "`n[$c] 3점 이하 $($low.Count)건 (전체 $(($R|?{$_.category -eq $c}).Count)건 중)"
  "| 원인 | 건수 | 리뷰 번호 |"; "|---|---|---|"
  foreach($k in $map.Keys){ $h=@($low|?{$_.text -match $map[$k]}); if($h){"| $k | $($h.Count) | $(($h.id) -join ', ') |"} }
}
"`n## 원문 (3점 이하 · 인용용)"
$R|?{[int]$_.rating -le 3}|%{"$($_.id) [$($_.listing) · $($_.rating)점] $($_.text)"}
