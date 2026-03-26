# bz-mailinator

Lightweight email test server for Boozang test automation. Receives emails via SMTP, stores them in memory, and exposes a REST API + web UI.

## Quick Start

```bash
npm install
npm start
```

- **SMTP**: `localhost:2525`
- **API + UI**: `http://localhost:3025`

## Configuration

| Env var | Default | Description |
|---------|---------|-------------|
| `SMTP_PORT` | 2525 | SMTP listen port |
| `API_PORT` | 3025 | API/UI listen port |
| `MAX_EMAILS` | 1000 | Max emails per inbox |
| `TTL_MS` | 3600000 | Email TTL (1 hour) |

## API

### Inboxes

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/inboxes` | List all inboxes with email counts |
| `GET` | `/api/inbox/:address` | Get all emails for an address |
| `GET` | `/api/inbox/:address/latest` | Get most recent email |
| `GET` | `/api/email/:id` | Get email by ID |
| `DELETE` | `/api/inbox/:address` | Delete an inbox |
| `DELETE` | `/api/inboxes` | Delete all inboxes |
| `GET` | `/api/health` | Health check |

### Assertions

Wait for a matching email (useful for test automation):

```
GET /api/assert/:address?subject=Welcome&from=admin&contains=click+here&timeout=10000
```

| Param | Description |
|-------|-------------|
| `subject` | Match substring in subject |
| `from` | Match substring in from address |
| `contains` | Match substring in text or HTML body |
| `timeout` | Max wait in ms (default: 5000) |

Returns `200` with the matching email, or `408` on timeout.

Assert email count:

```
GET /api/assert/:address/count?min=1&max=5
```

Returns `200` if count is within range, `417` if not.

### Example: Boozang test flow

1. Configure your app SMTP to `testmail.boozang.com:2525`
2. Trigger the action that sends email (signup, password reset, etc.)
3. Assert the email arrived:
   ```
   GET http://testmail.boozang.com/api/assert/user@test.com?subject=Password+Reset&timeout=10000
   ```
4. Verify content in the response

## Testing

```bash
npm test              # Server + API tests
npm run test:assert   # Assertion API tests
npm run test:dns      # DNS record validation
npm run test:all      # All tests
```

## Deployment

Deployed to staging via Ansible:

```bash
cd ../bz-deploy
ansible-playbook mailinator.yml -i inventories/staging-bh --tags=deploy
```
