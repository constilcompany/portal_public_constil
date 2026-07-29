const payload = {
  "specversion": "1.0",
  "type": "message.created",
  "source": "/nylas/webhooks/v1",
  "id": "test-webhook-id",
  "time": 1696282869,
  "webhook_delivery_attempt": 1,
  "data": {
    "application_id": "app-id",
    "object": {
      "id": "test-msg-id-123",
      "grant_id": "test-grant-id"
    }
  }
};

fetch('http://127.0.0.1:54321/functions/v1/nylas-webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(payload)
})
.then(res => res.text())
.then(console.log)
.catch(console.error);
