# Printer bridge — slow cashier printing fix (seconds to minutes → sub-second)

**Status:** Implemented (2026-06-04)  
**Last reviewed:** 2026-06-04  
**Scope:** `printer-service-new/` (PrinterBridge), minor admin poll interval

---

## Executive summary

Cashiers reported ticket printing taking **up to 5 minutes** after clicking Print. The admin app and ESC/POS encoding were fast; the bottleneck was the **local PrinterBridge** on Windows when it fell back to PowerShell (common when the native `printer` npm module fails inside a `pkg`-built exe).

The fix keeps the same architecture (browser → localhost bridge → Windows spooler → thermal printer) but removes repeated expensive work from the hot path:

| Before | After |
|--------|--------|
| New `powershell.exe` + `Add-Type` C# compile **per print** | **One** persistent PowerShell worker; `Add-Type` once per process |
| `Get-Printer` (all queues) on **every print** and **every status poll** | Scoped `Get-Printer -Name <queue>`; connection cached 30s |
| Status polled every **7s**, each probe re-resolving the queue | Probe serves cache when recently verified; poll **15s** |

Measured on a dev PC (native module unavailable, PowerShell path only): first print ~3–6s (worker cold start), subsequent prints **~90–400ms** in bridge logs.

---

## Architecture (unchanged)

```
Cashier browser (admin app at https://admin.asmatbet.com)
  → encodeTicketAsync() → ESC/POS bytes
  → POST http://127.0.0.1:3005/print (Base64 body)
PrinterBridge.exe (Node / pkg)
  → PrintQueue (serial)
  → PrinterManager.write()
  → Windows spooler RAW (POS80 or configured queue name)
Thermal printer
```

The admin app does **not** need redeploy for the performance win — only **PrinterBridge** on each cashier machine. Redeploy admin only if you want the 15s status poll interval.

---

## Files changed (this repo)

| File | Change |
|------|--------|
| `printer-service-new/powershellPrinter.js` | **New** — persistent worker |
| `printer-service-new/windowsPrinters.js` | Shared C# constant; `getWindowsPrinterByName` (`MICHOTBET_PRINTER_NAME`); removed per-print spawn |
| `printer-service-new/printerManager.js` | Worker routing, `ensureConnected`, cheap `probe`, TTLs |
| `printer-service-new/index.js` | Shutdown dispose |
| `printer-service-new/install/INSTALL.md` | AV exclusion guidance |
| `admin/src/services/localPrinter.js` | Status poll 15s |

**Not changed:** legacy `printer-service/` (serial/COM bridge).

---

## Build and deploy (this project)

```bash
cd printer-service-new
npm install
npm run build:exe
```

Output: `printer-service-new/dist/PrinterBridge.exe`, `config.json`, `node_modules/`, `install/`, `Install-PrinterBridge.bat`.

**Cashier PC — full reinstall:**

1. Copy entire `dist/` folder to the machine.
2. Run `Install-PrinterBridge.bat` (installs to `C:\AsmatBet\PrinterBridge\`, restarts bridge).

**Already installed with custom `config.json`:**

- Back up `config.json`, run installer, restore settings, **or**
- Stop `PrinterBridge.exe`, replace only `PrinterBridge.exe`, start again.

Default API key: `michotbet-local-print-v1`

---

## Verification

Bridge logs should show:

```json
{"event":"ps_worker_ready"}
{"event":"print_success","durationMs":90}
```

Defender exclusions (elevated PowerShell):

```powershell
Add-MpPreference -ExclusionPath "C:\AsmatBet\PrinterBridge"
Add-MpPreference -ExclusionProcess "PrinterBridge.exe"
Add-MpPreference -ExclusionProcess "powershell.exe"
```

---

## Related docs

- `printer-service-new/install/INSTALL.md` — cashier install + AV exclusions
- `printer-service-new/README.md` — API endpoints
- Ported from AsmatBet `updatesdoc/printer-bridge-performance-fix.md`
