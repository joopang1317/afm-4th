param([Parameter(Mandatory)][string]$Quotes,[Parameter(Mandatory)][int]$PriceCap,[int]$Qty=0)
[Console]::OutputEncoding=[Text.Encoding]::UTF8
$F=Get-Content "$PSScriptRoot/factsheet.json" -Raw -Encoding UTF8|ConvertFrom-Json
$Q=Import-Csv $Quotes -Encoding UTF8
$exVat=[math]::Round($PriceCap/(1+$F.vat)); $allowed=[math]::Round($exVat*$F.target_cost_ratio)
"기준: 팩트시트 환율 $($F.cny_krw) · 관세 $($F.tariff*100)% · 물류 $($F.freight_per_unit) · 패키지 $($F.pack_per_unit) · 목표 원가율 $($F.target_cost_ratio*100)% · 출처 $Quotes"
"`n## ① 허용원가"
"| 판가 상한(VAT포함) | VAT 제외 판가 | 목표 원가율 | 허용원가 |"; "|---|---|---|---|"
"| $('{0:N0}' -f $PriceCap) | $('{0:N0}' -f $exVat) | $($F.target_cost_ratio*100)% | $('{0:N0}' -f $allowed) |"
"`n## ② 견적별 랜딩원가"
"| 업체 | type | 단가CNY | 초도수량 | 금형상각/개 | 패키지/개 | 랜딩원가 | 허용 대비 | 원가율 | 리드타임 | D비용 | MOQ | 소재·비고 |"; "|---|---|---|---|---|---|---|---|---|---|---|---|---|"
foreach($q in $Q){
  $isP=($q.type -eq '제품'); $n= if($Qty -gt 0){$Qty} elseif($isP){$F.first_order_qty_product} else {$F.first_order_qty_goods}
  if([int]$q.moq -gt $n){$n=[int]$q.moq}
  $base=[double]$q.unit_cny*$F.cny_krw*(1+$F.tariff)+$F.freight_per_unit+$F.pack_per_unit
  $mold= if($isP){[double]$q.mold_cny*$F.cny_krw/$n} else {0}
  $land=[math]::Round($base+$mold); $diff=$land-$allowed; $ratio=[math]::Round($land/$exVat*100,1)
  $dcost= if([int]$q.leadtime_days -gt $F.base_leadtime_days){"+$([int]$q.leadtime_days-$F.base_leadtime_days)일"}else{"-"}
  "| $($q.supplier) | $($q.type) | $($q.unit_cny) | $n | $('{0:N0}' -f [math]::Round($mold)) | $($F.pack_per_unit) | $('{0:N0}' -f $land) | $(if($diff -gt 0){'+'})$('{0:N0}' -f $diff) | $ratio% | $($q.leadtime_days)일 | $dcost | $($q.moq) | $($q.material) · $($q.note) |"
}
"`n## ③ 안 맞을 때 옵션 재료"
"| 업체 | 허용원가 도달 초도수량 (금형 상각으로) | 현 수량에서 필요 판가(VAT포함) |"; "|---|---|---|"
foreach($q in $Q){
  $isP=($q.type -eq '제품'); $n= if($Qty -gt 0){$Qty} elseif($isP){$F.first_order_qty_product} else {$F.first_order_qty_goods}
  $base=[double]$q.unit_cny*$F.cny_krw*(1+$F.tariff)+$F.freight_per_unit+$F.pack_per_unit
  $mold= if($isP){[double]$q.mold_cny*$F.cny_krw/$n} else {0}
  $land=$base+$mold
  $need= if($isP -and $allowed -gt $base){ [math]::Ceiling([double]$q.mold_cny*$F.cny_krw/($allowed-$base)) } elseif($isP){ "불가(금형 제외해도 초과)" } else { "해당 없음(상품)" }
  $price=[math]::Ceiling($land/$F.target_cost_ratio*(1+$F.vat)/100)*100
  "| $($q.supplier) | $need | $('{0:N0}' -f $price) |"
}
