# RecoverAI — API Contract Documentation

This document describes the HTTP API contracts exposed by the RecoverAI backend.

## Response Formats

### Successful Response DTO
```json
{
  "success": true,
  "data": { ... }
}
```

### Error Response DTO
```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Specific error explanation"
  }
}
```

---

## 1. Merchant APIs (Requires x-merchant-id Header)

### GET `/api/merchant/dashboard`
*   **Method:** `GET`
*   **Auth / Context:** Merchant Context (`x-merchant-id` header or `merchantId` query parameter)
*   **Query Filters:**
    *   `environment` (optional): `LIVE` | `TEST` | `SIMULATION`
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "totalPayments": 25,
        "successfulPayments": 15,
        "failedPayments": 10,
        "paymentSuccessRate": 60.00,
        "totalRecoveredAmount": "5000.00",
        "recoveryRate": 40.00,
        "activeRecoveries": 3,
        "recoveryFailures": 3,
        "strategyPerformance": [
          {
            "strategyId": "RECOVERY_LINK",
            "totalCampaigns": 10,
            "recoveredCampaigns": 4,
            "successRate": 40.00
          }
        ],
        "recentActivity": [
          {
            "recovery_id": "81a95...",
            "customer_id": "cust-aarav",
            "payment_id": "pay-01",
            "status": "RECOVERED",
            "amount": "1500.00",
            "environment": "LIVE",
            "created_at": "2026-08-29T10:00:00.000Z"
          }
        ]
      }
    }
    ```

### GET `/api/merchant/payments`
*   **Method:** `GET`
*   **Auth / Context:** Merchant Context
*   **Query Filters:**
    *   `page` (optional): defaults to `1`
    *   `limit` (optional): defaults to `20`
    *   `customerId` (optional)
    *   `status` (optional)
    *   `environment` (optional)
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": [
        {
          "payment_id": "pay-01",
          "merchant_id": "merch-acme",
          "customer_id": "cust-aarav",
          "amount": "1500.00",
          "currency": "INR",
          "status": "FAILED",
          "external_reference": "ref-chk-001"
        }
      ],
      "pagination": {
        "page": 1,
        "pageSize": 20,
        "total": 1,
        "hasNext": false
      }
    }
    ```

### GET `/api/merchant/payments/:paymentId`
*   **Method:** `GET`
*   **Auth / Context:** Merchant Context
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "payment_id": "pay-01",
        "merchant_id": "merch-acme",
        "customer_id": "cust-aarav",
        "amount": "1500.00",
        "status": "FAILED",
        "recovery": {
          "recovery_id": "rec-01",
          "status": "IN_PROGRESS",
          "current_stage": "ANALYSIS"
        }
      }
    }
    ```

### GET `/api/merchant/recoveries`
*   **Method:** `GET`
*   **Auth / Context:** Merchant Context
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": [
        {
          "recovery_id": "rec-01",
          "payment_id": "pay-01",
          "customer_id": "cust-aarav",
          "status": "IN_PROGRESS",
          "amount": "1500.00"
        }
      ],
      "pagination": { ... }
    }
    ```

### GET `/api/merchant/recoveries/:recoveryId`
*   **Method:** `GET`
*   **Auth / Context:** Merchant Context
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "recovery": {
          "recovery_id": "rec-01",
          "status": "IN_PROGRESS",
          "amount": "1500.00"
        },
        "payment": {
          "payment_id": "pay-01",
          "status": "FAILED"
        },
        "actions": [],
        "attempts": [],
        "events": []
      }
    }
    ```

### GET `/api/merchant/policy`
*   **Method:** `GET`
*   **Auth / Context:** Merchant Context
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "policy_id": "policy-01",
        "name": "Acme Recovery Policy",
        "is_active": true,
        "auto_recovery_enabled": true,
        "max_amount_limit": "10000.00",
        "failure_rules": [],
        "strategies": [],
        "channels": []
      }
    }
    ```

### POST `/api/merchant/policy`
*   **Method:** `POST`
*   **Auth / Context:** Merchant Context
*   **Request Body:**
    ```json
    {
      "name": "Enterprise Policy V2",
      "is_active": true,
      "auto_recovery_enabled": true,
      "quiet_hours_enabled": false,
      "failureRules": [
        { "failureTypeId": "INSUFFICIENT_FUNDS", "isEligible": true }
      ]
    }
    ```
*   **Response (201 Created):**
    ```json
    {
      "success": true,
      "data": {
        "policy_id": "new-policy-id",
        "name": "Enterprise Policy V2"
      }
    }
    ```

---

## 2. Customer APIs (Public, Scoped by Secure token)

### GET `/api/customer/recovery/:token`
*   **Method:** `GET`
*   **Auth / Context:** Public (Secure Recovery Token)
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "status": "ACTIVE",
        "merchantName": "Acme Store",
        "amount": "1500.00",
        "expiresAt": "2026-08-30T10:00:00.000Z",
        "supportedPaymentMethods": ["CARD", "UPI", "NET_BANKING", "WALLET"]
      }
    }
    ```
*   *Note: Internal AI confidence scores, failure classifications, and explanation text are completely stripped for security and compliance.*

### POST `/api/customer/recovery/:token/payment`
*   **Method:** `POST`
*   **Auth / Context:** Public
*   **Request Body:**
    ```json
    {
      "paymentMethod": "CARD",
      "idempotencyKey": "idem_checkout_999"
    }
    ```
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "status": "SUCCESSFUL",
        "transactionId": "mock_txn_12345"
      }
    }
    ```

### GET `/api/customer/recovery/:token/status`
*   **Method:** `GET`
*   **Auth / Context:** Public
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "linkStatus": "USED",
        "recoveryStatus": "RECOVERED",
        "amount": "1500.00",
        "completedAt": "2026-08-29T10:05:00.000Z"
      }
    }
    ```

---

## 3. Webhook Ingestion API

### POST `/api/webhooks/:provider`
*   **Method:** `POST`
*   **Auth / Context:** Gateway verification checks (Provider factory)
*   **Request:** Provider payload (Mock Simulator or Razorpay)
*   **Response (202 Accepted):**
    ```json
    {
      "success": true,
      "data": { "result": "ACCEPTED" }
    }
    ```

---

## 4. Simulator/Demo APIs (Sandbox Only)

### POST `/api/demo/payment-simulator/run`
*   **Method:** `POST`
*   **Auth / Context:** Demo env check
*   **Request Body:**
    ```json
    {
      "merchantId": "merch-acme",
      "customerId": "cust-aarav",
      "paymentMethodId": "CARD",
      "amount": "1500.00",
      "simulateOutcome": "INSUFFICIENT_FUNDS"
    }
    ```
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "data": {
        "sessionId": "session-xyz",
        "paymentId": "pay-sim-01",
        "status": "FAILED",
        "webhookResult": "ACCEPTED",
        "recoveryId": "rec-sim-01",
        "recoveryStatus": "IN_PROGRESS"
      }
    }
    ```

### POST `/api/demo/recovery-simulator/run`
*   **Method:** `POST`
*   **Auth / Context:** Demo env check
*   **Request Body:**
    ```json
    {
      "recoveryId": "rec-sim-01",
      "simulateAction": "CUSTOMER_PAY_SUCCESS"
    }
    ```
*   **Response (200 OK):**
    ```json
    {
      "success": true,
      "message": "Simulated customer recovery checkout successfully completed.",
      "data": {
        "recoveryStatus": "RECOVERED",
        "attemptId": "attempt-sim-01"
      }
    }
    ```
