$BASE = 'http://localhost:3000'
$MA = 'd9b04245-c1e1-455f-bb54-df25c3453b3f'
$MB = 'e39c4a55-0818-47e2-8959-1e18cfbf44a1'
$CA = 'a1c87a55-27a3-4889-8d7a-7db69b4e3112'
$CB = 'b38a7ccb-449e-4e4c-8bb2-901d1d8cf4b1'

$passed=0; $failed=0; $notImpl=0; $blocked_=0

function Rec($name, $result, $detail='') {
  if ($result -eq 'PASS') {
    $script:passed++
    Write-Host "  [PASS] $name $detail" -ForegroundColor Green
  } elseif ($result -eq 'FAIL') {
    $script:failed++
    Write-Host "  [FAIL] $name $detail" -ForegroundColor Red
  } elseif ($result -eq 'NOT_IMPL') {
    $script:notImpl++
    Write-Host "  [NOT_IMPL] $name $detail" -ForegroundColor Yellow
  } else {
    $script:blocked_++
    Write-Host "  [BLOCKED] $name $detail" -ForegroundColor Magenta
  }
}

function Req($method, $path, $body=$null, $mid=$null) {
  $headers = @{ 'Content-Type'='application/json' }
  if ($mid) { $headers['x-merchant-id'] = $mid }
  try {
    if ($body) {
      $json = $body | ConvertTo-Json -Depth 10
      $r = Invoke-WebRequest -Uri "$BASE$path" -Method $method -Headers $headers -Body $json -ErrorAction Stop
    } else {
      $r = Invoke-WebRequest -Uri "$BASE$path" -Method $method -Headers $headers -ErrorAction Stop
    }
    return @{ status=$r.StatusCode; body=($r.Content | ConvertFrom-Json) }
  } catch {
    $code = $_.Exception.Response.StatusCode.value__
    $content = ''
    try { $content = $_.Exception.Response.GetResponseStream() | % { $sr=[System.IO.StreamReader]::new($_); $sr.ReadToEnd() } } catch {}
    try { $parsed = $content | ConvertFrom-Json } catch { $parsed = $content }
    return @{ status=$code; body=$parsed }
  }
}

function DbQ($sql) {
  $r = docker exec recoverai-postgres psql -U postgres -d recoverai -t -A -c $sql
  return $r
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " STEP 9: RecoverAI E2E Test Suite" -ForegroundColor Cyan
Write-Host " Live Docker+PostgreSQL Stack" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# --- SECTION 1: Health & DB -----------------------------------
Write-Host "
--- SECTION 1: Stack Verification ---"
$h = Req 'GET' '/health'
if ($h.status -eq 200 -and $h.body.dependencies.database -eq 'healthy') { Rec 'S1 Health endpoint' 'PASS' "status=$($h.status) db=$($h.body.dependencies.database)" }
else { Rec 'S1 Health endpoint' 'FAIL' "status=$($h.status) body=$($h.body | ConvertTo-Json -Compress)" }

$tc = (DbQ "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'").Trim()
if ($tc -eq '19') { Rec 'S1 19 tables' 'PASS' } else { Rec 'S1 19 tables' 'FAIL' "Got $tc" }

$mc = (DbQ "SELECT count(*) FROM merchants").Trim()
if ($mc -eq '2') { Rec 'S1 2 merchants seeded' 'PASS' } else { Rec 'S1 2 merchants' 'FAIL' "Got $mc" }

$sc = (DbQ "SELECT strategy_id FROM recovery_strategies ORDER BY strategy_id").Trim()
$expected = "CUSTOMER_REMINDER
DELAYED_RETRY
MANUAL_REVIEW
RECOVERY_LINK"
if ($sc -eq $expected) { Rec 'S1 4 strategies seeded' 'PASS' } else { Rec 'S1 4 strategies' 'FAIL' "Got: $sc" }

$polR = (DbQ "SELECT is_active,auto_recovery_enabled,quiet_hours_enabled FROM merchant_policies WHERE merchant_id='d9b04245-c1e1-455f-bb54-df25c3453b3f'").Trim()
if ($polR -match 't\|t\|t') { Rec 'S1 Acme policy active+auto+quiet' 'PASS' } else { Rec 'S1 Acme policy' 'FAIL' "Got: $polR" }

# --- SECTION 2: Merchant API ----------------------------------
Write-Host "
--- SECTION 2: Merchant API Workflows ---"
$dash = Req 'GET' '/api/merchant/dashboard' -mid $MA
if ($dash.status -eq 200 -and $dash.body.success -and $null -ne $dash.body.data.totalPayments) { Rec 'S2 Dashboard' 'PASS' "totalPayments=$($dash.body.data.totalPayments)" }
else { Rec 'S2 Dashboard' 'FAIL' "status=$($dash.status) body=$($dash.body | ConvertTo-Json -Compress)" }

$pays = Req 'GET' '/api/merchant/payments' -mid $MA
if ($pays.status -eq 200 -and $pays.body.success -and $pays.body.data) { Rec 'S2 Payments list' 'PASS' "count=$($pays.body.data.Count)" }
else { Rec 'S2 Payments list' 'FAIL' "status=$($pays.status)" }

$recs = Req 'GET' '/api/merchant/recoveries' -mid $MA
if ($recs.status -eq 200 -and $recs.body.success -and $recs.body.data) { Rec 'S2 Recoveries list' 'PASS' "count=$($recs.body.data.Count)" }
else { Rec 'S2 Recoveries list' 'FAIL' "status=$($recs.status)" }

$pol = Req 'GET' '/api/merchant/policy' -mid $MA
if ($pol.status -eq 200 -and $pol.body.success -and $pol.body.data.policy_id) { Rec 'S2 Policy fetch' 'PASS' "id=$($pol.body.data.policy_id.Substring(0,8))" }
else { Rec 'S2 Policy fetch' 'FAIL' "status=$($pol.status) body=$($pol.body | ConvertTo-Json -Compress)" }

$np = Req 'POST' '/api/merchant/policy' @{ name='E2E Test Policy'; is_active=$true; auto_recovery_enabled=$true; quiet_hours_enabled=$false; failureRules=@(@{failureTypeId='INSUFFICIENT_FUNDS';isEligible=$true}) } $MA
if ($np.status -eq 201 -and $np.body.success) { Rec 'S2 Policy create' 'PASS' } else { Rec 'S2 Policy create' 'FAIL' "status=$($np.status) body=$($np.body | ConvertTo-Json -Compress)" }

$noMid = Req 'GET' '/api/merchant/payments'
if ($noMid.status -eq 400 -or $noMid.status -eq 401) { Rec 'S2 Missing merchantId rejected' 'PASS' "status=$($noMid.status)" }
else { Rec 'S2 Missing merchantId rejected' 'FAIL' "status=$($noMid.status)" }

# --- SECTION 3: Successful Payment ---------------------------
Write-Host "
--- SECTION 3: Successful Payment (no recovery) ---"
$simS = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='CARD'; amount='500.00'; simulateOutcome='SUCCESS' }
if ($simS.status -eq 200 -and $simS.body.success) {
  $pid = $simS.body.data.paymentId
  $dbStatus = (DbQ "SELECT status FROM payments WHERE payment_id='$pid'").Trim()
  if ($dbStatus -eq 'SUCCESSFUL') { Rec 'S3 Payment SUCCESSFUL in DB' 'PASS' } else { Rec 'S3 Payment SUCCESSFUL in DB' 'FAIL' "DB=$dbStatus" }
  if ($simS.body.data.recoveryId -eq $null) { Rec 'S3 No recovery for success' 'PASS' } else { Rec 'S3 No recovery for success' 'FAIL' "Got rid=$($simS.body.data.recoveryId)" }
} else { Rec 'S3 Successful payment simulator' 'FAIL' "status=$($simS.status) body=$($simS.body | ConvertTo-Json -Compress)" }

# --- SECTION 4: Failed Payment -> Recovery --------------------
Write-Host "
--- SECTION 4: Failed Payment -> Recovery Creation ---"
$simF = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='UPI'; amount='1500.00'; simulateOutcome='INSUFFICIENT_FUNDS' }
$recId = $null
if ($simF.status -eq 200 -and $simF.body.success) {
  $fpid = $simF.body.data.paymentId
  $recId = $simF.body.data.recoveryId
  $dbFStatus = (DbQ "SELECT status,failure_type_id FROM payments WHERE payment_id='$fpid'").Trim()
  if ($dbFStatus -like '*FAILED*') { Rec 'S4 Payment FAILED in DB' 'PASS' "db=$dbFStatus" } else { Rec 'S4 Payment FAILED in DB' 'FAIL' "db=$dbFStatus" }
  if ($recId) { Rec 'S4 Recovery campaign created' 'PASS' "recId=$($recId.Substring(0,8))" } else { Rec 'S4 Recovery campaign created' 'FAIL' 'No recoveryId' }
  if ($recId) {
    $dbRec = (DbQ "SELECT payment_status FROM recoveries WHERE recovery_id='$recId'").Trim()
    if ($dbRec -eq 'FAILED') { Rec 'S4 Recovery payment_status=FAILED' 'PASS' } else { Rec 'S4 Recovery payment_status=FAILED' 'FAIL' "db=$dbRec" }
    $apiRec = Req 'GET' "/api/merchant/recoveries/$recId" -mid $MA
    if ($apiRec.status -eq 200 -and $apiRec.body.success -and $apiRec.body.data.recovery) { Rec 'S4 Merchant can view recovery' 'PASS' } else { Rec 'S4 Merchant can view recovery' 'FAIL' "status=$($apiRec.status)" }
  }
} else { Rec 'S4 Failed payment simulator' 'FAIL' "status=$($simF.status) body=$($simF.body | ConvertTo-Json -Compress)" }

# --- SECTION 5: RECOVERY_LINK E2E ----------------------------
Write-Host "
--- SECTION 5: RECOVERY_LINK Full E2E Path ---"
if ($recId) {
  $paySucc = Req 'POST' '/api/demo/recovery-simulator/run' @{ recoveryId=$recId; simulateAction='CUSTOMER_PAY_SUCCESS' }
  if ($paySucc.body.data.recoveryStatus -eq 'RECOVERED') { Rec 'S5 Campaign RECOVERED' 'PASS' }
  else { Rec 'S5 Campaign RECOVERED' 'FAIL' "status=$($paySucc.body.data.recoveryStatus)" }
  $dbR5 = (DbQ "SELECT status,completed_at FROM recoveries WHERE recovery_id='$recId'").Trim()
  if ($dbR5 -like '*RECOVERED*') { Rec 'S5 DB RECOVERED+completed_at' 'PASS' "db=$dbR5" } else { Rec 'S5 DB RECOVERED+completed_at' 'FAIL' "db=$dbR5" }
  if ($paySucc.body.data.attemptId) {
    $atId = $paySucc.body.data.attemptId
    $dbAt = (DbQ "SELECT status FROM recovery_payment_attempts WHERE attempt_id='$atId'").Trim()
    if ($dbAt -eq 'SUCCESSFUL') { Rec 'S5 Attempt SUCCESSFUL in DB' 'PASS' } else { Rec 'S5 Attempt SUCCESSFUL in DB' 'FAIL' "db=$dbAt" }
  }
  $dbOrig = (DbQ "SELECT p.status FROM payments p JOIN recoveries r ON r.payment_id=p.payment_id WHERE r.recovery_id='$recId'").Trim()
  if ($dbOrig -eq 'FAILED') { Rec 'S5 Original payment still FAILED' 'PASS' } else { Rec 'S5 Original payment still FAILED' 'FAIL' "status=$dbOrig" }
  $linkStatus = (DbQ "SELECT status FROM recovery_links WHERE recovery_id='$recId'").Trim()
  if ($linkStatus -like '*USED*') { Rec 'S5 Recovery link consumed USED' 'PASS' } else { Rec 'S5 Recovery link consumed USED' 'NOT_IMPL' "status=$linkStatus" }
} else { Rec 'S5 RECOVERY_LINK' 'BLOCKED' 'No recovery ID from S4' }

# --- SECTION 6: Expired Link Rejection -----------------------
Write-Host "
--- SECTION 6: Expired Link Rejection ---"
$simExp = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CB; paymentMethodId='CARD'; amount='800.00'; simulateOutcome='CARD_DECLINED' }
if ($simExp.body.data.recoveryId) {
  $eid = $simExp.body.data.recoveryId
  $expR = Req 'POST' '/api/demo/recovery-simulator/run' @{ recoveryId=$eid; simulateAction='EXPIRE_LINK' }
  if ($expR.body.data.recoveryStatus -eq 'EXPIRED') { Rec 'S6 Campaign expired' 'PASS' } else { Rec 'S6 Campaign expired' 'FAIL' "status=$($expR.body.data.recoveryStatus)" }
  $tok = (DbQ "SELECT secure_token FROM recovery_links WHERE recovery_id='$eid' AND status='EXPIRED'").Trim()
  if ($tok) {
    $getL = Req 'GET' "/api/customer/recovery/$tok"
    if ($getL.status -eq 200 -and $getL.body.data.status -eq 'EXPIRED') { Rec 'S6 GET expired token returns EXPIRED' 'PASS' } else { Rec 'S6 GET expired returns EXPIRED' 'FAIL' "status=$($getL.status) data=$($getL.body.data | ConvertTo-Json -Compress)" }
    $idemKey = "idem_exp_$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())"
    $postL = Req 'POST' "/api/customer/recovery/$tok/payment" @{ paymentMethod='CARD'; idempotencyKey=$idemKey }
    if ($postL.status -eq 400 -and $postL.body.error.code -eq 'LINK_EXPIRED') { Rec 'S6 POST on expired -> LINK_EXPIRED' 'PASS' } else { Rec 'S6 POST on expired -> LINK_EXPIRED' 'FAIL' "status=$($postL.status) code=$($postL.body.error.code)" }
  } else { Rec 'S6 Get expired token from DB' 'FAIL' 'No expired link found' }
  $inv = Req 'GET' '/api/customer/recovery/totally_invalid_xyz_token'
  if ($inv.status -eq 404) { Rec 'S6 Invalid token -> 404' 'PASS' } else { Rec 'S6 Invalid token -> 404' 'FAIL' "status=$($inv.status)" }
} else { Rec 'S6 Setup' 'BLOCKED' "No recovery from simulator" }

# --- SECTION 7: DELAYED_RETRY ---------------------------------
Write-Host "
--- SECTION 7: DELAYED_RETRY Strategy ---"
$simDR = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='NET_BANKING'; amount='2000.00'; simulateOutcome='TEMPORARY_BANK_ISSUE' }
if ($simDR.body.data.recoveryId) {
  $drid = $simDR.body.data.recoveryId
  $aiStrat = (DbQ "SELECT ai_recommended_strategy_id FROM recoveries WHERE recovery_id='$drid'").Trim()
  if ($aiStrat -eq 'DELAYED_RETRY') { Rec 'S7 AI selects DELAYED_RETRY' 'PASS' } else { Rec 'S7 AI selects DELAYED_RETRY' 'FAIL' "AI said: $aiStrat" }
  $drPay = Req 'POST' '/api/demo/recovery-simulator/run' @{ recoveryId=$drid; simulateAction='CUSTOMER_PAY_SUCCESS' }
  if ($drPay.body.data.recoveryStatus -eq 'RECOVERED') { Rec 'S7 DELAYED_RETRY campaign RECOVERED' 'PASS' } else { Rec 'S7 DELAYED_RETRY campaign RECOVERED' 'FAIL' "$($drPay.body.data.recoveryStatus)" }
} else { Rec 'S7 DELAYED_RETRY setup' 'BLOCKED' 'No recovery' }

# --- SECTION 8: CUSTOMER_REMINDER ----------------------------
Write-Host "
--- SECTION 8: CUSTOMER_REMINDER Strategy ---"
$notifCh = (DbQ "SELECT DISTINCT channel FROM customer_notifications").Trim()
if ($notifCh -like '*SMS*' -and $notifCh -like '*WHATSAPP*') { Rec 'S8 SMS+WHATSAPP seeded' 'PASS' } else { Rec 'S8 SMS+WHATSAPP seeded' 'FAIL' "channels=$notifCh" }
$simCR = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CB; paymentMethodId='UPI'; amount='750.00'; simulateOutcome='AUTHENTICATION_FAILED' }
if ($simCR.body.data.recoveryId) {
  $crid = $simCR.body.data.recoveryId
  $crPay = Req 'POST' '/api/demo/recovery-simulator/run' @{ recoveryId=$crid; simulateAction='CUSTOMER_PAY_SUCCESS' }
  if ($crPay.body.data.recoveryStatus -eq 'RECOVERED') { Rec 'S8 CUSTOMER_REMINDER RECOVERED' 'PASS' } else { Rec 'S8 CUSTOMER_REMINDER RECOVERED' 'FAIL' "$($crPay.body.data.recoveryStatus)" }
  Rec 'S8 Real notification dispatch' 'NOT_IMPL' 'Mock only - no live SMS/WhatsApp gateway'
} else { Rec 'S8 CUSTOMER_REMINDER setup' 'BLOCKED' 'No recovery' }

# --- SECTION 9: MANUAL_REVIEW / FRAUD_BLOCK ------------------
Write-Host "
--- SECTION 9: MANUAL_REVIEW / FRAUD_BLOCK ---"
$simFB = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='CARD'; amount='3000.00'; simulateOutcome='FRAUD_BLOCK' }
if ($simFB.body.data.recoveryId -eq $null) { Rec 'S9 FRAUD_BLOCK excluded by policy' 'PASS' } else { Rec 'S9 FRAUD_BLOCK excluded by policy' 'FAIL' "Got rid=$($simFB.body.data.recoveryId)" }
$fraudRule = (DbQ "SELECT is_eligible FROM policy_failure_rules WHERE failure_type_id='FRAUD_BLOCK' AND policy_id='f5b9d311-6677-4402-990a-a829f0322ba1'").Trim()
if ($fraudRule -eq 'f') { Rec 'S9 DB FRAUD_BLOCK is_eligible=false' 'PASS' } else { Rec 'S9 DB FRAUD_BLOCK is_eligible=false' 'FAIL' "DB=$fraudRule" }
Rec 'S9 MANUAL_REVIEW escalation endpoint' 'NOT_IMPL' 'No human escalation API endpoint'

# --- SECTION 10: Attempt Limit / Terminal State ---------------
Write-Host "
--- SECTION 10: Attempt Limit -> Terminal State ---"
$simAL = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='UPI'; amount='600.00'; simulateOutcome='UPI_TIMEOUT' }
if ($simAL.body.data.recoveryId) {
  $alid = $simAL.body.data.recoveryId
  $lastStatus = ''
  for ($i=1; $i -le 3; $i++) {
    $fRes = Req 'POST' '/api/demo/recovery-simulator/run' @{ recoveryId=$alid; simulateAction='CUSTOMER_PAY_FAILED' }
    $lastStatus = $fRes.body.data.recoveryStatus
    Write-Host "    Attempt $i fail -> $lastStatus"
  }
  if ($lastStatus -eq 'FAILED') { Rec 'S10 Terminal FAILED after 3 attempts' 'PASS' } else { Rec 'S10 Terminal FAILED after 3 attempts' 'FAIL' "Final=$lastStatus" }
  $termAttempt = Req 'POST' '/api/demo/recovery-simulator/run' @{ recoveryId=$alid; simulateAction='CUSTOMER_PAY_FAILED' }
  if ($termAttempt.status -eq 400 -and $termAttempt.body.error.code -eq 'CAMPAIGN_TERMINAL') { Rec 'S10 Terminal rejects further actions' 'PASS' } else { Rec 'S10 Terminal rejects further actions' 'FAIL' "status=$($termAttempt.status) code=$($termAttempt.body.error.code)" }
} else { Rec 'S10 Attempt limit setup' 'BLOCKED' 'No recovery' }

# --- SECTION 11: Webhook Idempotency -------------------------
Write-Host "
--- SECTION 11: Webhook Idempotency ---"
$ts = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$evtId = "idem_evt_$ts"
$extRef = "ref_idem_$ts"
$w1 = Req 'POST' '/api/webhooks/mock' @{ event='payment.failed'; eventId=$evtId; txnId="txn_$ts"; externalReference=$extRef; amount='1000.00'; currency='INR'; failureCode='NETWORK_ERROR'; failureMessage='Network timeout' }
if ($w1.status -eq 202 -and $w1.body.success) { Rec 'S11 First webhook 202 accepted' 'PASS' } else { Rec 'S11 First webhook 202 accepted' 'FAIL' "status=$($w1.status)" }
$w2 = Req 'POST' '/api/webhooks/mock' @{ event='payment.failed'; eventId=$evtId; txnId="txn2_$ts"; externalReference=$extRef; amount='1000.00'; currency='INR'; failureCode='NETWORK_ERROR' }
if ($w2.status -eq 200 -and $w2.body.success) { Rec 'S11 Duplicate webhook 200 idempotent' 'PASS' } else { Rec 'S11 Duplicate webhook 200 idempotent' 'FAIL' "status=$($w2.status) body=$($w2.body | ConvertTo-Json -Compress)" }
$wMal = Req 'POST' '/api/webhooks/mock' @{ garbage=$true }
if ($wMal.status -eq 400 -or $wMal.status -eq 422) { Rec 'S11 Malformed webhook rejected' 'PASS' "status=$($wMal.status)" } else { Rec 'S11 Malformed webhook rejected' 'FAIL' "status=$($wMal.status)" }

# --- SECTION 12: Retry Idempotency (DB constraint) -----------
Write-Host "
--- SECTION 12: Retry Idempotency (DB UNIQUE constraint) ---"
$simRI = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='CARD'; amount='1200.00'; simulateOutcome='CARD_DECLINED' }
if ($simRI.body.data.recoveryId) {
  $riRid = $simRI.body.data.recoveryId
  $idemKey = "idem_dup_test_$ts"
  docker exec recoverai-postgres psql -U postgres -d recoverai -c "INSERT INTO recovery_payment_attempts (recovery_id,customer_id,payment_method_id,amount,idempotency_key) VALUES ('$riRid','$CA','CARD',100.00,'$idemKey')" 2>&1 | Out-Null
  $dupOut = docker exec recoverai-postgres psql -U postgres -d recoverai -c "INSERT INTO recovery_payment_attempts (recovery_id,customer_id,payment_method_id,amount,idempotency_key) VALUES ('$riRid','$CA','CARD',100.00,'$idemKey')" 2>&1
  if ($dupOut -like '*duplicate key*' -or $dupOut -like '*unique*') { Rec 'S12 DB unique idempotency_key enforced' 'PASS' } else { Rec 'S12 DB unique idempotency_key enforced' 'FAIL' "got: $dupOut" }
} else { Rec 'S12 Retry idempotency setup' 'BLOCKED' 'No recovery' }

# --- SECTION 13: Tenant Isolation ----------------------------
Write-Host "
--- SECTION 13: Tenant Isolation ---"
$spA = (DbQ "SELECT payment_id FROM payments WHERE merchant_id='$MA' LIMIT 1").Trim()
if ($spA) {
  $crossP = Req 'GET' "/api/merchant/payments/$spA" -mid $MB
  if ($crossP.status -eq 404) { Rec 'S13 Cross-tenant payment blocked 404' 'PASS' } else { Rec 'S13 Cross-tenant payment blocked' 'FAIL' "status=$($crossP.status)" }
}
$srA = (DbQ "SELECT recovery_id FROM recoveries WHERE merchant_id='$MA' LIMIT 1").Trim()
if ($srA) {
  $crossR = Req 'GET' "/api/merchant/recoveries/$srA" -mid $MB
  if ($crossR.status -eq 404) { Rec 'S13 Cross-tenant recovery blocked 404' 'PASS' } else { Rec 'S13 Cross-tenant recovery blocked' 'FAIL' "status=$($crossR.status)" }
}
$polB = Req 'GET' '/api/merchant/policy' -mid $MB
if ($polB.body.data.policy_id -ne 'f5b9d311-6677-4402-990a-a829f0322ba1') { Rec 'S13 Merchant B has own policy scope' 'PASS' "polId=$($polB.body.data.policy_id)" } else { Rec 'S13 Merchant B own policy' 'FAIL' 'Got Merchant A policy' }
$dA2 = Req 'GET' '/api/merchant/dashboard' -mid $MA
$dB2 = Req 'GET' '/api/merchant/dashboard' -mid $MB
$aT = $dA2.body.data.totalPayments; $bT = $dB2.body.data.totalPayments
if ($aT -gt $bT) { Rec 'S13 Dashboard analytics isolated' 'PASS' "A=$aT B=$bT" } else { Rec 'S13 Dashboard analytics isolated' 'FAIL' "A=$aT B=$bT" }

# --- SECTION 14: Security - customer API ----------------------
Write-Host "
--- SECTION 14: Security Boundaries ---"
$activeLink = (DbQ "SELECT secure_token FROM recovery_links WHERE status='ACTIVE' LIMIT 1").Trim()
if (-not $activeLink) {
  $simSec = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='CARD'; amount='900.00'; simulateOutcome='INSUFFICIENT_FUNDS' }
  if ($simSec.body.data.recoveryId) {
    $secRid = $simSec.body.data.recoveryId
    Req 'POST' '/api/demo/recovery-simulator/run' @{ recoveryId=$secRid; simulateAction='CUSTOMER_PAY_FAILED' } | Out-Null
    $activeLink = (DbQ "SELECT secure_token FROM recovery_links WHERE recovery_id='$secRid' AND status='ACTIVE'").Trim()
  }
}
if ($activeLink) {
  $cRes = Req 'GET' "/api/customer/recovery/$activeLink"
  if ($cRes.status -eq 200 -and $cRes.body.success) {
    $cData = $cRes.body.data
    $keys = $cData | Get-Member -MemberType NoteProperty | Select-Object -ExpandProperty Name
    Write-Host "    Customer response keys: $($keys -join ', ')"
    $sensFields = @('ai_confidence_score','ai_explanation','ai_failure_classification','confidence','explanation','policyEvaluation','failure_type_id','merchant_id','recovery_id')
    $leaked = $sensFields | Where-Object { $keys -contains $_ }
    if (-not $leaked) { Rec 'S14 No AI/policy fields leaked' 'PASS' } else { Rec 'S14 No AI/policy fields leaked' 'FAIL' "Leaked: $($leaked -join ', ')" }
    $required = @('status','merchantName','amount','expiresAt','supportedPaymentMethods')
    $missing = $required | Where-Object { $keys -notcontains $_ }
    if (-not $missing) { Rec 'S14 Required customer fields present' 'PASS' } else { Rec 'S14 Required customer fields present' 'FAIL' "Missing: $($missing -join ', ')" }
  } else { Rec 'S14 Customer landing loads' 'FAIL' "status=$($cRes.status)" }
} else { Rec 'S14 Security boundary test' 'BLOCKED' 'No active link available' }

# --- SECTION 15: DB Integrity ---------------------------------
Write-Host "
--- SECTION 15: Database Integrity Constraints ---"
$checkFail = docker exec recoverai-postgres psql -U postgres -d recoverai -c "INSERT INTO payments (merchant_id,customer_id,payment_method_id,amount,status,failed_at,external_reference) VALUES ('$MA','$CA','CARD',100.00,'FAILED',NOW(),'ref_chk_$ts')" 2>&1
if ($checkFail -like '*violates check constraint*' -or $checkFail -like '*chk_payment_failure*') { Rec 'S15 chk_payment_failure_state enforced' 'PASS' } else { Rec 'S15 chk_payment_failure_state enforced' 'FAIL' "got: $checkFail" }

$dupRef = "ref_dup_$ts"
docker exec recoverai-postgres psql -U postgres -d recoverai -c "INSERT INTO payments (merchant_id,customer_id,payment_method_id,amount,status,external_reference) VALUES ('$MA','$CA','CARD',100.00,'INITIATED','$dupRef')" 2>&1 | Out-Null
$dupOut2 = docker exec recoverai-postgres psql -U postgres -d recoverai -c "INSERT INTO payments (merchant_id,customer_id,payment_method_id,amount,status,external_reference) VALUES ('$MA','$CA','UPI',200.00,'INITIATED','$dupRef')" 2>&1
if ($dupOut2 -like '*duplicate key*' -or $dupOut2 -like '*unique*') { Rec 'S15 Duplicate external_reference rejected' 'PASS' } else { Rec 'S15 Duplicate external_reference rejected' 'FAIL' "got: $dupOut2" }

$fkOut = docker exec recoverai-postgres psql -U postgres -d recoverai -c "INSERT INTO payments (merchant_id,customer_id,payment_method_id,amount,status,external_reference) VALUES ('00000000-0000-0000-0000-000000000000','$CA','CARD',100.00,'INITIATED','ref_fk_$ts')" 2>&1
if ($fkOut -like '*violates foreign key*') { Rec 'S15 FK merchant_id constraint' 'PASS' } else { Rec 'S15 FK merchant_id constraint' 'FAIL' "got: $fkOut" }

$simOne = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='UPI'; amount='100.00'; simulateOutcome='NETWORK_ERROR' }
if ($simOne.body.data.paymentId) {
  $upid = $simOne.body.data.paymentId
  $dupRec = docker exec recoverai-postgres psql -U postgres -d recoverai -c "INSERT INTO recoveries (merchant_id,customer_id,payment_id,payment_status,amount) VALUES ('$MA','$CA','$upid','FAILED',100.00)" 2>&1
  if ($dupRec -like '*duplicate key*' -or $dupRec -like '*unique*') { Rec 'S15 UNIQUE recoveries.payment_id' 'PASS' } else { Rec 'S15 UNIQUE recoveries.payment_id' 'FAIL' "got: $dupRec" }
}

# --- SECTION 16: Provider Failure Modes ----------------------
Write-Host "
--- SECTION 16: Provider Failure Modes ---"
$provTests = @(
  @{out='SUCCESS'; expStatus='SUCCESSFUL'},
  @{out='INSUFFICIENT_FUNDS'; expStatus='FAILED'},
  @{out='NETWORK_ERROR'; expStatus='FAILED'},
  @{out='UPI_TIMEOUT'; expStatus='FAILED'},
  @{out='CARD_DECLINED'; expStatus='FAILED'}
)
foreach ($t in $provTests) {
  $pr = Req 'POST' '/api/demo/payment-simulator/run' @{ merchantId=$MA; customerId=$CA; paymentMethodId='CARD'; amount='400.00'; simulateOutcome=$t.out }
  $got = $pr.body.data.status
  if ($got -eq $t.expStatus) { Rec "S16 Provider $($t.out) -> $($t.expStatus)" 'PASS' } else { Rec "S16 Provider $($t.out) -> $($t.expStatus)" 'FAIL' "got=$got" }
}

# --- SECTION 17: Analytics / Dashboard -----------------------
Write-Host "
--- SECTION 17: Analytics/Dashboard Correctness ---"
$dashF = Req 'GET' '/api/merchant/dashboard' -mid $MA
if ($dashF.status -eq 200) {
  $d = $dashF.body.data
  $fields = @('totalPayments','failedPayments','successfulPayments','paymentSuccessRate','recoveryRate','activeRecoveries','strategyPerformance','recentActivity')
  $missingF = $fields | Where-Object { $null -eq $d.$_ }
  if (-not $missingF) { Rec 'S17 Dashboard fields complete' 'PASS' } else { Rec 'S17 Dashboard fields complete' 'FAIL' "Missing: $($missingF -join ', ')" }
  $sr = $d.paymentSuccessRate
  if ($sr -ge 0 -and $sr -le 100) { Rec 'S17 paymentSuccessRate in [0,100]' 'PASS' "$sr" } else { Rec 'S17 paymentSuccessRate in [0,100]' 'FAIL' "$sr" }
  $stP = $d.strategyPerformance
  if ($stP -is [array] -or $stP -is [System.Collections.ArrayList]) { Rec 'S17 strategyPerformance is array' 'PASS' "count=$($stP.Count)" } else { Rec 'S17 strategyPerformance is array' 'FAIL' "type=$($stP.GetType().Name)" }
} else { Rec 'S17 Dashboard loads' 'FAIL' "status=$($dashF.status)" }

# --- SUMMARY -------------------------------------------------
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " STEP 9 RESULTS SUMMARY" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " PASS     : $passed" -ForegroundColor Green
Write-Host " FAIL     : $failed" -ForegroundColor Red
Write-Host " NOT_IMPL : $notImpl" -ForegroundColor Yellow
Write-Host " BLOCKED  : $blocked_" -ForegroundColor Magenta
Write-Host " TOTAL    : $($passed+$failed+$notImpl+$blocked_)"
Write-Host ""
if ($failed -eq 0) { Write-Host "RECOMMENDATION: READY FOR FRONTEND (with noted gaps)" -ForegroundColor Green }
else { Write-Host "RECOMMENDATION: NOT READY FOR FRONTEND -- $failed failures require fixes" -ForegroundColor Red }
