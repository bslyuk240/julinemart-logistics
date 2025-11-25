import { createClient } from '@supabase/supabase-js';
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function handler(event) {
  try {
    const { subOrderId } = JSON.parse(event.body || '{}');

    if (!subOrderId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ success: false, error: "subOrderId is required" })
      };
    }

    // Fetch sub-order details
    const { data: subOrder, error } = await supabase
      .from('sub_orders')
      .select(`
        *,
        orders:main_order_id(*),
        hubs(*),
        couriers(*)
      `)
      .eq('id', subOrderId)
      .single();

    if (error || !subOrder) {
      throw new Error("Sub-order not found");
    }

    // Generate PDF
    const doc = new PDFDocument({ margin: 40 });
    const chunks = [];
    const stream = new PassThrough();
    doc.pipe(stream);

    doc.fontSize(22).text('WAYBILL', { align: 'center' });
    doc.moveDown();

    doc.fontSize(14).text(`Tracking Number: ${subOrder.tracking_number}`);
    doc.text(`Shipment ID: ${subOrder.courier_shipment_id}`);
    doc.text(`Courier: ${subOrder.couriers?.name}`);
    doc.text(`Hub: ${subOrder.hubs?.name} - ${subOrder.hubs?.city}`);
    doc.moveDown();

    doc.text(`Customer Name: ${subOrder.orders.customer_name}`);
    doc.text(`Phone: ${subOrder.orders.customer_phone}`);
    doc.text(`Address: ${subOrder.orders.delivery_address}`);
    doc.moveDown();

    doc.text("Items:", { underline: true });
    (subOrder.items || []).forEach(item => {
      doc.text(
        `${item.quantity}x ${item.name} (${item.weight}kg) - NGN ${Number(item.price || 0).toLocaleString()}`
      );
    });

    const pdfBuffer = await new Promise((resolve, reject) => {
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks)));
      stream.on('error', reject);
      doc.end();
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="waybill-${subOrderId}.pdf"`
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true
    };

  } catch (error) {
    console.error("WAYBILL ERROR:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, error: "Failed to generate waybill" })
    };
  }
}


