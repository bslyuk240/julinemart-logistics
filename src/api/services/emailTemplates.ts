// Email template system for order notifications

interface EmailTemplate {
  subject: string;
  html: string;
  text: string;
}

interface OrderEmailData {
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  orderDate: string;
  deliveryAddress: string;
  deliveryCity: string;
  deliveryState: string;
  totalAmount: number;
  shippingFee: number;
  trackingUrl: string;
  estimatedDelivery?: string;
  subOrders?: Array<{
    trackingNumber: string;
    hubName: string;
    courierName: string;
    status: string;
  }>;
}

// Base email template with consistent styling
const getBaseTemplate = (content: string) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
    }
    .header {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      padding: 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 28px;
    }
    .content {
      padding: 30px;
    }
    .order-info {
      background-color: #f8f9fa;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .order-info h2 {
      margin-top: 0;
      color: #667eea;
      font-size: 20px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      padding: 10px 0;
      border-bottom: 1px solid #e9ecef;
    }
    .info-row:last-child {
      border-bottom: none;
    }
    .info-label {
      font-weight: 600;
      color: #6c757d;
    }
    .info-value {
      color: #333;
    }
    .button {
      display: inline-block;
      background-color: #667eea;
      color: white !important;
      padding: 14px 28px;
      text-decoration: none;
      border-radius: 6px;
      font-weight: 600;
      margin: 20px 0;
    }
    .button:hover {
      background-color: #5568d3;
    }
    .shipment-card {
      border: 2px solid #e9ecef;
      border-radius: 8px;
      padding: 15px;
      margin: 15px 0;
    }
    .tracking-number {
      font-family: 'Courier New', monospace;
      font-size: 18px;
      font-weight: bold;
      color: #667eea;
      background-color: #f8f9fa;
      padding: 8px 12px;
      border-radius: 4px;
      display: inline-block;
    }
    .status-badge {
      display: inline-block;
      padding: 6px 12px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .status-pending {
      background-color: #fff3cd;
      color: #856404;
    }
    .status-processing {
      background-color: #cfe2ff;
      color: #084298;
    }
    .status-in_transit {
      background-color: #e7d6f7;
      color: #6f42c1;
    }
    .status-delivered {
      background-color: #d1e7dd;
      color: #0f5132;
    }
    .footer {
      background-color: #f8f9fa;
      padding: 20px;
      text-align: center;
      font-size: 14px;
      color: #6c757d;
    }
    .footer a {
      color: #667eea;
      text-decoration: none;
    }
    .divider {
      height: 1px;
      background-color: #e9ecef;
      margin: 20px 0;
    }
    @media only screen and (max-width: 600px) {
      .content {
        padding: 20px;
      }
      .info-row {
        flex-direction: column;
      }
    }
  </style>
</head>
<body>
  <div class="container">
    ${content}
  </div>
</body>
</html>
`;

// 1. ORDER CONFIRMATION EMAIL
export const orderConfirmationEmail = (data: OrderEmailData): EmailTemplate => {
  const content = `
    <div class="header">
      <h1>🎉 Order Confirmed!</h1>
      <p style="margin: 10px 0 0 0; font-size: 16px;">Thank you for your order, ${data.customerName}</p>
    </div>
    
    <div class="content">
      <p>We've received your order and are getting it ready for shipment. You'll receive another email once your items are on their way.</p>
      
      <div class="order-info">
        <h2>Order Details</h2>
        <div class="info-row">
          <span class="info-label">Order Number:</span>
          <span class="info-value"><strong>#${data.orderNumber}</strong></span>
        </div>
        <div class="info-row">
          <span class="info-label">Order Date:</span>
          <span class="info-value">${data.orderDate}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Total Amount:</span>
          <span class="info-value"><strong>₦${data.totalAmount.toLocaleString()}</strong></span>
        </div>
      </div>

      <div class="order-info">
        <h2>Delivery Address</h2>
        <p style="margin: 0;">
          ${data.deliveryAddress}<br>
          ${data.deliveryCity}, ${data.deliveryState}
        </p>
      </div>

      <div style="text-align: center;">
        <a href="${data.trackingUrl}" class="button">Track Your Order</a>
      </div>

      <p style="color: #6c757d; font-size: 14px; margin-top: 30px;">
        <strong>What happens next?</strong><br>
        1. We'll prepare your order (1-2 business days)<br>
        2. Your items will be shipped from our closest hub<br>
        3. You'll receive tracking details for each shipment<br>
        4. Delivery typically takes 2-5 business days
      </p>
    </div>

    <div class="footer">
      <p>Need help? Contact us at <a href="mailto:support@julinemart.com">support@julinemart.com</a> or call +2347075825761</p>
      <p style="margin-top: 15px;">
        <a href="${data.trackingUrl}">Track Order</a> | 
        <a href="https://julinemart.com/faq">FAQs</a> | 
        <a href="https://julinemart.com/contact">Contact Us</a>
      </p>
    </div>
  `;

  return {
    subject: `Order Confirmed - #${data.orderNumber}`,
    html: getBaseTemplate(content),
    text: `
Order Confirmed!

Thank you for your order, ${data.customerName}!

Order Number: #${data.orderNumber}
Order Date: ${data.orderDate}
Total Amount: ₦${data.totalAmount.toLocaleString()}

Delivery Address:
${data.deliveryAddress}
${data.deliveryCity}, ${data.deliveryState}

Track your order: ${data.trackingUrl}

Need help? Email: support@julinemart.com | Phone: +2347075825761
    `.trim(),
  };
};

// 2. ORDER PROCESSING EMAIL
export const orderProcessingEmail = (data: OrderEmailData): EmailTemplate => {
  const content = `
    <div class="header">
      <h1>📦 Order Being Prepared</h1>
      <p style="margin: 10px 0 0 0; font-size: 16px;">Your order is being packed</p>
    </div>
    
    <div class="content">
      <p>Great news, ${data.customerName}! We're currently packing your order and getting it ready for shipment.</p>
      
      <div class="order-info">
        <h2>Order #${data.orderNumber}</h2>
        <div class="info-row">
          <span class="info-label">Status:</span>
          <span class="info-value"><span class="status-badge status-processing">Processing</span></span>
        </div>
        <div class="info-row">
          <span class="info-label">Items:</span>
          <span class="info-value">Being packed at our fulfillment center</span>
        </div>
      </div>

      ${data.subOrders && data.subOrders.length > 0 ? `
        <h3 style="margin-top: 30px;">Your Order Shipments</h3>
        <p style="color: #6c757d; font-size: 14px;">Your order will be shipped in ${data.subOrders.length} package${data.subOrders.length > 1 ? 's' : ''} from different locations for faster delivery:</p>
        
        ${data.subOrders.map((subOrder, index) => `
          <div class="shipment-card">
            <strong>Shipment ${index + 1}</strong>
            <div style="margin-top: 10px;">
              <div style="margin: 5px 0;">📍 From: ${subOrder.hubName}</div>
              <div style="margin: 5px 0;">🚚 Courier: ${subOrder.courierName}</div>
              <div style="margin: 5px 0;">Status: <span class="status-badge status-processing">Preparing</span></div>
            </div>
          </div>
        `).join('')}
      ` : ''}

      <div style="text-align: center;">
        <a href="${data.trackingUrl}" class="button">Track Your Order</a>
      </div>

      <p style="color: #6c757d; font-size: 14px; margin-top: 30px;">
        <strong>Next Steps:</strong><br>
        Once your package${data.subOrders && data.subOrders.length > 1 ? 's are' : ' is'} ready, we'll hand ${data.subOrders && data.subOrders.length > 1 ? 'them' : 'it'} over to our courier partner${data.subOrders && data.subOrders.length > 1 ? 's' : ''}. You'll receive tracking number${data.subOrders && data.subOrders.length > 1 ? 's' : ''} via email.
      </p>
    </div>

    <div class="footer">
      <p>Questions? We're here to help! <a href="mailto:support@julinemart.com">support@julinemart.com</a></p>
    </div>
  `;

  return {
    subject: `Order Processing - #${data.orderNumber}`,
    html: getBaseTemplate(content),
    text: `
Order Being Prepared

Hi ${data.customerName},

Your order #${data.orderNumber} is being packed and will ship soon!

Track your order: ${data.trackingUrl}

Questions? Email: support@julinemart.com
    `.trim(),
  };
};

// 3. ORDER SHIPPED EMAIL (with tracking numbers)
export const orderShippedEmail = (data: OrderEmailData): EmailTemplate => {
  const content = `
    <div class="header">
      <h1>🚚 Order Shipped!</h1>
      <p style="margin: 10px 0 0 0; font-size: 16px;">Your package${data.subOrders && data.subOrders.length > 1 ? 's are' : ' is'} on the way</p>
    </div>
    
    <div class="content">
      <p>Exciting news, ${data.customerName}! Your order has been shipped and is on its way to you.</p>
      
      <div class="order-info">
        <h2>Order #${data.orderNumber}</h2>
        <div class="info-row">
          <span class="info-label">Status:</span>
          <span class="info-value"><span class="status-badge status-in_transit">In Transit</span></span>
        </div>
        ${data.estimatedDelivery ? `
          <div class="info-row">
            <span class="info-label">Estimated Delivery:</span>
            <span class="info-value"><strong>${data.estimatedDelivery}</strong></span>
          </div>
        ` : ''}
        <div class="info-row">
          <span class="info-label">Delivery Address:</span>
          <span class="info-value">${data.deliveryCity}, ${data.deliveryState}</span>
        </div>
      </div>

      ${data.subOrders && data.subOrders.length > 0 ? `
        <h3 style="margin-top: 30px;">Track Your Shipments</h3>
        
        ${data.subOrders.map((subOrder, index) => `
          <div class="shipment-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
              <strong>Shipment ${index + 1}</strong>
              <span class="status-badge status-in_transit">In Transit</span>
            </div>
            
            <div style="margin: 10px 0;">
              <div style="color: #6c757d; font-size: 14px; margin-bottom: 5px;">Tracking Number:</div>
              <div class="tracking-number">${subOrder.trackingNumber}</div>
            </div>
            
            <div style="margin: 10px 0; font-size: 14px; color: #6c757d;">
              <div>📍 From: ${subOrder.hubName}</div>
              <div>🚚 Courier: ${subOrder.courierName}</div>
            </div>
          </div>
        `).join('')}
      ` : ''}

      <div style="text-align: center;">
        <a href="${data.trackingUrl}" class="button">Track Live Updates</a>
      </div>

      <div class="divider"></div>

      <h3>Delivery Tips</h3>
      <ul style="color: #6c757d;">
        <li>Make sure someone is available to receive the package</li>
        <li>Check the tracking link above for real-time updates</li>
        <li>You'll receive a notification when delivery is near</li>
        <li>Contact us immediately if there are any issues</li>
      </ul>
    </div>

    <div class="footer">
      <p><strong>Track your package:</strong> <a href="${data.trackingUrl}">Click here</a></p>
      <p>Need help? <a href="mailto:support@julinemart.com">support@julinemart.com</a> | +2347075825761</p>
    </div>
  `;

  return {
    subject: `Order Shipped! Track #${data.orderNumber}`,
    html: getBaseTemplate(content),
    text: `
Order Shipped!

Hi ${data.customerName},

Great news! Your order #${data.orderNumber} is on its way!

${data.subOrders && data.subOrders.length > 0 ? 
  data.subOrders.map((so, i) => `
Shipment ${i + 1}:
Tracking: ${so.trackingNumber}
From: ${so.hubName}
Courier: ${so.courierName}
`).join('\n') : ''}

${data.estimatedDelivery ? `Estimated Delivery: ${data.estimatedDelivery}` : ''}

Track your order: ${data.trackingUrl}

Questions? Email: support@julinemart.com
    `.trim(),
  };
};

// 4. OUT FOR DELIVERY EMAIL
export const outForDeliveryEmail = (data: OrderEmailData): EmailTemplate => {
  const content = `
    <div class="header">
      <h1>🎯 Out for Delivery!</h1>
      <p style="margin: 10px 0 0 0; font-size: 16px;">Your package will arrive today</p>
    </div>
    
    <div class="content">
      <p style="font-size: 18px;"><strong>Hi ${data.customerName},</strong></p>
      <p style="font-size: 16px;">Your order is out for delivery and should arrive today! Please ensure someone is available to receive it.</p>
      
      <div class="order-info" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white;">
        <h2 style="color: white; margin-top: 0;">Delivery Today!</h2>
        <div style="font-size: 18px; text-align: center; padding: 20px 0;">
          <div style="font-size: 32px; margin-bottom: 10px;">📦</div>
          <div><strong>Order #${data.orderNumber}</strong></div>
        </div>
      </div>

      <div class="order-info">
        <h3 style="margin-top: 0;">Delivery Address</h3>
        <p style="font-size: 16px; margin: 0;">
          ${data.deliveryAddress}<br>
          ${data.deliveryCity}, ${data.deliveryState}
        </p>
      </div>

      ${data.subOrders && data.subOrders.length > 0 ? `
        <h3>Tracking Information</h3>
        ${data.subOrders.map((subOrder, index) => `
          <div class="shipment-card">
            <div><strong>Shipment ${index + 1}</strong> - ${subOrder.courierName}</div>
            <div style="margin-top: 10px;">
              <div class="tracking-number">${subOrder.trackingNumber}</div>
            </div>
          </div>
        `).join('')}
      ` : ''}

      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <strong>⚠️ Please Note:</strong>
        <ul style="margin: 10px 0 0 0; padding-left: 20px;">
          <li>Ensure someone is home to receive the delivery</li>
          <li>Have your order number ready</li>
          <li>Check the package before signing</li>
        </ul>
      </div>

      <div style="text-align: center;">
        <a href="${data.trackingUrl}" class="button">Track Live Location</a>
      </div>
    </div>

    <div class="footer">
      <p><strong>Questions about your delivery?</strong></p>
      <p>Call us: +2347075825761| Email: <a href="mailto:support@julinemart.com">support@julinemart.com</a></p>
    </div>
  `;

  return {
    subject: `🎯 Out for Delivery Today - Order #${data.orderNumber}`,
    html: getBaseTemplate(content),
    text: `
Out for Delivery!

Hi ${data.customerName},

Your order #${data.orderNumber} is out for delivery and will arrive TODAY!

Please ensure someone is home to receive it.

Delivery Address:
${data.deliveryAddress}
${data.deliveryCity}, ${data.deliveryState}

Track: ${data.trackingUrl}

Questions? Call: +2347075825761
    `.trim(),
  };
};

// 5. ORDER DELIVERED EMAIL
export const orderDeliveredEmail = (data: OrderEmailData): EmailTemplate => {
  const content = `
    <div class="header" style="background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);">
      <h1>✅ Delivered Successfully!</h1>
      <p style="margin: 10px 0 0 0; font-size: 16px;">Your order has been delivered</p>
    </div>
    
    <div class="content">
      <p style="font-size: 18px;"><strong>Congratulations, ${data.customerName}!</strong></p>
      <p style="font-size: 16px;">Your order has been successfully delivered. We hope you love your purchase!</p>
      
      <div class="order-info" style="border: 3px solid #38ef7d;">
        <div style="text-align: center;">
          <div style="font-size: 48px; margin-bottom: 15px;">🎉</div>
          <h2 style="color: #11998e; margin: 0;">Order #${data.orderNumber}</h2>
          <p style="font-size: 14px; color: #6c757d; margin-top: 5px;">Delivered to ${data.deliveryCity}</p>
        </div>
      </div>

      <div style="background-color: #d1f2eb; border-left: 4px solid #38ef7d; padding: 20px; margin: 25px 0; border-radius: 8px;">
        <h3 style="margin-top: 0; color: #11998e;">💚 We'd Love Your Feedback!</h3>
        <p style="margin: 10px 0;">How was your experience with us? Your feedback helps us improve!</p>
        <div style="text-align: center; margin-top: 15px;">
          <a href="https://julinemart.com/reviews/order/${data.orderNumber}" class="button" style="background-color: #38ef7d;">Leave a Review</a>
        </div>
      </div>

      <div class="divider"></div>

      <h3>What's Next?</h3>
      <ul style="line-height: 1.8;">
        <li>🎁 Enjoy your purchase!</li>
        <li>📝 Leave a review to help other customers</li>
        <li>🔄 Need to return? Check our <a href="https://julinemart.com/returns">return policy</a></li>
        <li>💬 Share your experience on social media</li>
      </ul>

      <div style="text-align: center; margin-top: 30px;">
        <p style="font-size: 18px; color: #667eea;"><strong>Thank you for shopping with JulineMart!</strong></p>
      </div>
    </div>

    <div class="footer">
      <p><strong>Need help with your order?</strong></p>
      <p>Email: <a href="mailto:support@julinemart.com">support@julinemart.com</a> | Phone: +2347075825761</p>
      <p style="margin-top: 15px;">
        <a href="https://julinemart.com">Continue Shopping</a> | 
        <a href="${data.trackingUrl}">View Order Details</a>
      </p>
    </div>
  `;

  return {
    subject: `✅ Delivered! Order #${data.orderNumber}`,
    html: getBaseTemplate(content),
    text: `
Order Delivered Successfully!

Hi ${data.customerName},

Great news! Your order #${data.orderNumber} has been delivered to ${data.deliveryCity}.

We hope you love your purchase!

We'd love to hear from you:
Leave a review: https://julinemart.com/reviews/order/${data.orderNumber}

Thank you for shopping with JulineMart!

Questions? Email: support@julinemart.com
    `.trim(),
  };
};

// 6. ORDER CANCELLED EMAIL
export const orderCancelledEmail = (data: OrderEmailData & { cancellationReason?: string }): EmailTemplate => {
  const content = `
    <div class="header" style="background: linear-gradient(135deg, #f43b47 0%, #fc6767 100%);">
      <h1>Order Cancelled</h1>
      <p style="margin: 10px 0 0 0; font-size: 16px;">Your order has been cancelled</p>
    </div>
    
    <div class="content">
      <p>Hi ${data.customerName},</p>
      <p>Your order #${data.orderNumber} has been cancelled as requested.</p>
      
      <div class="order-info">
        <h2>Cancellation Details</h2>
        <div class="info-row">
          <span class="info-label">Order Number:</span>
          <span class="info-value">#${data.orderNumber}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Cancellation Date:</span>
          <span class="info-value">${new Date().toLocaleDateString()}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Order Amount:</span>
          <span class="info-value">₦${data.totalAmount.toLocaleString()}</span>
        </div>
        ${data.cancellationReason ? `
          <div class="info-row">
            <span class="info-label">Reason:</span>
            <span class="info-value">${data.cancellationReason}</span>
          </div>
        ` : ''}
      </div>

      <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
        <strong>💰 Refund Information</strong>
        <p style="margin: 10px 0 0 0;">
          If you've already made payment, your refund will be processed within 5-7 business days to your original payment method.
        </p>
      </div>

      <h3>We're Sorry to See You Go</h3>
      <p>We'd love to hear about your experience. Your feedback helps us improve.</p>

      <div style="text-align: center; margin: 30px 0;">
        <a href="https://julinemart.com" class="button" style="background-color: #667eea;">Continue Shopping</a>
      </div>

      <p style="color: #6c757d; font-size: 14px;">
        If you cancelled by mistake or have any questions, please contact our support team immediately.
      </p>
    </div>

    <div class="footer">
      <p><strong>Questions about your cancellation?</strong></p>
      <p>Email: <a href="mailto:support@julinemart.com">support@julinemart.com</a> | Phone: +2347075825761</p>
    </div>
  `;

  return {
    subject: `Order Cancelled - #${data.orderNumber}`,
    html: getBaseTemplate(content),
    text: `
Order Cancelled

Hi ${data.customerName},

Your order #${data.orderNumber} has been cancelled.

Order Amount: ₦${data.totalAmount.toLocaleString()}
${data.cancellationReason ? `Reason: ${data.cancellationReason}` : ''}

If you made payment, refunds will be processed in 5-7 business days.

Questions? Email: support@julinemart.com | Phone: +2347075825761
    `.trim(),
  };
};

export const emailTemplates = {
  orderConfirmation: orderConfirmationEmail,
  orderProcessing: orderProcessingEmail,
  orderShipped: orderShippedEmail,
  outForDelivery: outForDeliveryEmail,
  orderDelivered: orderDeliveredEmail,
  orderCancelled: orderCancelledEmail,
};
