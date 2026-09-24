# AsmatBet Printer Service / PrinterBridge

Local Node print bridge for cashier thermal receipts. Receives pre-encoded ESC/POS bytes from the admin cashier UI (`https://admin.asmatbet.com`) and writes them to the **POS80** Windows print queue via RAW spooler (PowerShell `WritePrinter` fallback).

Ticket APIs are served by **`https://api.asmatbet.com`** — the bridge only handles localhost printing; it does not proxy API traffic.

**Production deployment:** cashiers install via **`Install-PrinterBridge.bat`** in the build `dist/` folder — see [install/INSTALL.md](install/INSTALL.md).

## Prerequisites

1. Install POS80 driver: `POS80Setup_20200118.exe`
2. Connect the thermal printer via USB
3. Verify the Windows queue name is exactly **POS80** (Settings → Printers)

## Developer setup

```bash
cd printer-service-new
npm install
npm start
```

## Build Windows exe

```bash
npm run build:exe
```

Produces:

- `dist/PrinterBridge.exe` — self-contained, no Node required on cashier PC
- `dist/config.json` — copy beside exe on install
- `dist/Install-PrinterBridge.bat` — one-click cashier installer
- `dist/install/` — VBS launcher, PowerShell installer, install guide

Requires Windows build host with Node.js installed (build machine only).

## Configuration

Settings are stored in `config.json` beside the exe (or source folder in dev):

```json
{
  "comPort": "",
  "baudRate": 115200,
  "printerName": "POS80",
  "apiKey": "michotbet-local-print-v1"
}
```

**Precedence:** `config.json` → env overrides (`PRINTER_NAME`, `PRINTER_API_KEY`) → strict match on `printerName` (no silent fallback to another queue).

Update at runtime via authenticated `POST /config`:

```json
{
  "printerName": "POS80"
}
```

## Security

- Binds to **127.0.0.1 only** — never exposed on LAN
- All routes except `/health` and `/version` require header: `X-Printer-Key: michotbet-local-print-v1`
- CORS allows localhost and `https://admin.asmatbet.com` (override via `CASHIER_ORIGINS` env)

## API

### `GET /version` (no auth)

```json
{ "version": "1.0.0", "protocolVersion": "1" }
```

### `GET /health` (no auth)

```json
{
  "ok": true,
  "uptimeSec": 3600,
  "connected": true,
  "queueLength": 0,
  "processing": false
}
```

### `GET /status` (auth required)

```json
{
  "success": true,
  "connected": true,
  "port": "POS80",
  "message": "Printer ready",
  "queueLength": 0,
  "processing": false,
  "lastError": null,
  "reconnectAttempts": 0,
  "lastSuccessfulPrintAt": "2026-05-22T12:00:00.000Z"
}
```

### `GET /printers` (auth required)

Lists Windows print queues.

### `POST /print` (auth required)

Body: `{ "data": "<base64 ESC/POS bytes>" }`

Success: `{ "success": true, "port": "POS80", "jobId": "uuid" }`

### Auth header

```
X-Printer-Key: michotbet-local-print-v1
```

## Cashier UI

The admin app at **https://admin.asmatbet.com** posts to `http://localhost:3005` (auto-probes 3005–3010) with the API key header. Production build env:

```
VITE_PRINTER_API_KEY=michotbet-local-print-v1
# optional: VITE_PRINT_SERVICE_URL=http://localhost:3005
```

The cashier page polls `/status` every 7 seconds.

## Features

- FIFO print queue (one spooler write at a time)
- Auto-reconnect every 5s after disconnect
- Write timeout protection (60s default)
- Port fallback 3005–3010 on bridge and client
- Structured JSON logs
- Protocol version handshake via `/version`

## Production startup

See [install/INSTALL.md](install/INSTALL.md) for cashier-facing steps (Startup folder + hidden VBS launcher).
