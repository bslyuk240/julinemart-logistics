// Admin inspection + refund trigger (DROP-OFF ONLY, CLEAN FLOW)
import { supabase, createWooRefund } from './services/returns-utils.js';
import { corsHeaders, preflightResponse } from './services/cors.js';
import { buildOrderDeepLink, sendPushToCustomer } from './services/pushNotifications.js';
import { sendTransactionalEmail } from './services/emailNotifications.js';

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return preflightResponse();
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: "Method not allowed" }),
    };
  }

  // Extract return_request_id from path: /api/returns/:id/inspection
  const parts = event.path.split("/");
  const idx = parts.findIndex((p) => p === "returns");
  const returnId = idx >= 0 ? parts[idx + 1] : null;

  if (!returnId) {
    return {
      statusCode: 400,
      headers: corsHeaders(),
      body: JSON.stringify({ success: false, error: "Missing return id" }),
    };
  }

  try {
    const body = event.body ? JSON.parse(event.body) : {};
    const { status, inspection_result, inspection_notes, approved_refund_amount } = body;

    // VALID STATUSES
    if (!status || !["approved", "rejected"].includes(status)) {
      return {
        statusCode: 400,
        headers: corsHeaders(),
        body: JSON.stringify({
          success: false,
          error: "status must be 'approved' or 'rejected'",
        }),
      };
    }

    // Fetch request
    const { data: request, error: fetchErr } = await supabase
      .from("return_requests")
      .select("*")
      .eq("id", returnId)
      .single();

    if (fetchErr || !request) {
      throw fetchErr || new Error("Return request not found");
    }

    // Allowed statuses before inspection
    const validInspectionStates = [
      "delivered_to_hub",
      "inspection_in_progress",
      "in_transit", // allow admin to override early
    ];

    if (!validInspectionStates.includes(request.status)) {
      console.warn(
        "⚠ Inspection triggered at unexpected status:",
        request.status
      );
    }

    // ------------------------------
    // DETERMINE NEXT STATUS
    // ------------------------------
    let nextStatus = status === "approved" ? "refund_processing" : "rejected";

    let refundPayload = null;

    // ------------------------------
    // HANDLE REFUND WHEN APPROVED
    // ------------------------------
    if (status === "approved" && request.preferred_resolution === "refund") {
      if (!approved_refund_amount) {
        return {
          statusCode: 400,
          headers: corsHeaders(),
          body: JSON.stringify({
            success: false,
            error: "approved_refund_amount is required for approved refunds",
          }),
        };
      }

      try {
        // Build reason message
        const reason = `Return approved (Return ID: ${request.id}; Reason: ${request.reason_code || ""})`;

        // Trigger Paystack Refund via Supabase order lookup
        // Prefer supabase_order_id (UUID) for new PWA orders; fall back to
        // legacy WC numeric order_id for migrated orders
        const refundOrderRef = request.supabase_order_id || request.order_id;
        const wooRefund = await createWooRefund(
          refundOrderRef,
          approved_refund_amount,
          reason
        );

        refundPayload = wooRefund;

        // Set final refund-completed state
        nextStatus = "refund_completed";

        // Update refund details
        await supabase
          .from("return_requests")
          .update({
            refund_status: "completed",
            refund_amount: approved_refund_amount,
            refund_currency: wooRefund?.currency || "NGN",
            refund_method: "original_payment",
            paystack_refund_id: wooRefund.id || wooRefund.refund_id || null,
            refund_raw: wooRefund,
            refund_completed_at: new Date().toISOString(),
          })
          .eq("id", returnId);
      } catch (err) {
        console.error("Refund failed:", err.message);

        nextStatus = "refund_failed";

        await supabase
          .from("return_requests")
          .update({
            refund_status: "failed",
            refund_raw: { error: err.message },
          })
          .eq("id", returnId);

        return {
          statusCode: 502,
          headers: corsHeaders(),
          body: JSON.stringify({
            success: false,
            error: err.message || "Refund failed",
          }),
        };
      }
    }

    // ------------------------------
    // UPDATE REQUEST WITH INSPECTION OUTCOME
    // ------------------------------
    await supabase
      .from("return_requests")
      .update({
        status: nextStatus,
        inspection_result,
        inspection_notes,
        inspected_at: new Date().toISOString(),
      })
      .eq("id", returnId);

    // ------------------------------
    // UPDATE SHIPMENT STATUS TOO
    // ------------------------------
    await supabase
      .from("return_shipments")
      .update({
        status: nextStatus,
      })
      .eq("return_request_id", returnId);

    const orderRef = request.order_number || request.order_id || returnId;
    const deepLink = buildOrderDeepLink(orderRef);
    const pushPayload =
      nextStatus === "refund_completed"
        ? {
            title: "Refund completed",
            message: `Your refund for order ${orderRef} has been completed.`,
            type: "order_update",
            data: {
              status: nextStatus,
              orderReference: String(orderRef),
              ...(deepLink ? { targetPath: deepLink } : {}),
            },
          }
        : nextStatus === "rejected"
        ? {
            title: "Return review update",
            message: `Your return request for order ${orderRef} was not approved.`,
            type: "order_update",
            data: {
              status: nextStatus,
              orderReference: String(orderRef),
              ...(deepLink ? { targetPath: deepLink } : {}),
            },
          }
        : null;

    if (pushPayload) {
      const pushResult = await sendPushToCustomer(request.wc_customer_id, pushPayload);
      if (!pushResult.success && !pushResult.skipped) {
        console.warn("Return inspection push failed:", pushResult);
      }
    }

    // Send email for refund completed or rejected
    if (request.customer_email) {
      const emailTemplate =
        nextStatus === 'refund_completed' ? 'Refund Completed' :
        nextStatus === 'rejected'         ? 'Return Rejected'  : null;

      if (emailTemplate) {
        sendTransactionalEmail({
          templateName: emailTemplate,
          to: request.customer_email,
          orderId: request.supabase_order_id || null,
          data: {
            customerName: request.customer_name || 'Customer',
            orderNumber: request.order_number || orderRef,
            returnId: request.id,
            refundAmount: refundPayload
              ? Number(refundPayload.amount || approved_refund_amount || 0).toLocaleString()
              : '',
            inspectionNotes: inspection_notes || '',
          },
        });
      }
    }

    // ------------------------------
    // RESPONSE
    // ------------------------------
    return {
      statusCode: 200,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: true,
        data: {
          status: nextStatus,
          refund: refundPayload || null,
        },
      }),
    };
  } catch (error) {
    console.error("admin-return-inspection error:", error);
    return {
      statusCode: 500,
      headers: corsHeaders(),
      body: JSON.stringify({
        success: false,
        error: error.message || "Internal error",
      }),
    };
  }
}
