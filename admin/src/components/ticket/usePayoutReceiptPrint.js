import { useCallback, useEffect, useRef, useState } from "react";
import { downloadTicketPdf } from "./pdfGenerator";
import { encodePayoutReceiptAsync } from "./payoutReceiptEscpos";
import {
  getPayoutBarcodePayload,
  renderBarcodeToDataURL,
} from "./ticketBarcode";
import { print as printViaLocalService } from "../../services/localPrinter";

function buildPayoutPdfFilename(ticket) {
  const id =
    ticket?.paymentReceiptNumber ||
    String(ticket?.couponNumber || "payment")
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "");
  const safe = String(id || "unknown").replace(/[^a-z0-9-]+/gi, "-");
  return `payment-${safe || "unknown"}.pdf`;
}

/**
 * Orchestrates payment receipt print flow (mirrors useTicketPrint).
 */
export function usePayoutReceiptPrint(
  ticket,
  {
    width = "80mm",
    preferLocalService = true,
    platformWinningsTax = null,
    contactEntries = [],
    paidByName = "",
  } = {},
) {
  const receiptRef = useRef(null);
  const [barcodeDataUrl, setBarcodeDataUrl] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [lastError, setLastError] = useState("");

  const barcodePayload = getPayoutBarcodePayload(ticket);

  useEffect(() => {
    let alive = true;
    if (!barcodePayload) {
      setBarcodeDataUrl("");
      return () => {
        alive = false;
      };
    }
    const url = renderBarcodeToDataURL(barcodePayload);
    if (alive) setBarcodeDataUrl(url);
    return () => {
      alive = false;
    };
  }, [barcodePayload]);

  const downloadPdf = useCallback(async () => {
    if (!receiptRef.current) {
      setLastError("Payment receipt not ready");
      return false;
    }
    setPdfBusy(true);
    setLastError("");
    try {
      await downloadTicketPdf({
        node: receiptRef.current,
        filename: buildPayoutPdfFilename(ticket),
        width,
      });
      return true;
    } catch (error) {
      setLastError(error?.message || "Failed to generate PDF");
      return false;
    } finally {
      setPdfBusy(false);
    }
  }, [ticket, width]);

  const print = useCallback(async () => {
    if (!ticket) return { printed: false, method: "none", fellBackToPdf: false };
    setLastError("");

    if (preferLocalService) {
      try {
        const escposData = await encodePayoutReceiptAsync(ticket, {
          width,
          platformWinningsTax,
          contactEntries,
          paidByName,
        });
        const result = await printViaLocalService(escposData);

        if (result.success) {
          return { printed: true, method: "local_service", reason: "success" };
        }

        if (result.code === "service_unreachable") {
          setLastError(
            "Local print service unreachable. Start PrinterBridge.exe on this PC.",
          );
          return {
            printed: false,
            method: "local_service",
            reason: "service_unreachable",
          };
        }

        setLastError(result.message || "Print failed");
        return {
          printed: false,
          method: "local_service",
          reason: result.code || "unknown",
        };
      } catch (error) {
        setLastError(error?.message || "Print encoding failed");
        return {
          printed: false,
          method: "local_service",
          reason: "encode_error",
        };
      }
    }

    return { printed: false, method: "none", reason: "disabled" };
  }, [
    ticket,
    width,
    preferLocalService,
    platformWinningsTax,
    contactEntries,
    paidByName,
  ]);

  return {
    receiptRef,
    barcodeDataUrl,
    downloadPdf,
    pdfBusy,
    print,
    lastError,
  };
}
