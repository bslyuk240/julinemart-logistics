-- Bring the vendor shipment-ready emails (label + waybill links) in line with
-- the branded template used by Order Confirmation/Shipped/Delivered/etc. —
-- logo header, gradient CTA buttons, consistent footer — instead of the
-- plain unstyled markup they shipped with originally.
update email_templates
set html_content = $tpl$<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shipment Created - JulineMart</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: #f5f5f5;
            line-height: 1.6;
        }
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
        }
        .header {
            background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
            padding: 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
        }
        .logo {
            width: 40px;
            height: 40px;
            flex-shrink: 0;
        }
        .header-content {
            text-align: left;
        }
        .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 11px;
            font-weight: 600;
        }
        .header p {
            color: #e9d5ff;
            margin: 5px 0 0 0;
            font-size: 11px;
        }
        .content {
            padding: 20px 15px;
        }
        .greeting {
            font-size: 9px;
            color: #1f2937;
            margin-bottom: 10px;
            font-weight: 600;
        }
        .message {
            color: #4b5563;
            font-size: 11px;
            margin-bottom: 15px;
            line-height: 1.4;
        }
        .order-box {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-left: 3px solid #f97316;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
        }
        .order-number {
            font-size: 10px;
            color: #92400e;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
            font-weight: 600;
        }
        .order-value {
            font-size: 11px;
            color: #1f2937;
            font-weight: 700;
            font-family: 'Courier New', monospace;
        }
        .divider {
            height: 1px;
            background: #e5e7eb;
            margin: 12px 0;
        }
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
            color: #ffffff !important;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            font-weight: 600;
            font-size: 11px;
            text-align: center;
            margin: 8px 4px;
            box-shadow: 0 2px 4px rgba(124, 58, 237, 0.2);
        }
        .secondary-button {
            display: inline-block;
            background: #ffffff;
            color: #7c3aed !important;
            padding: 6px 12px;
            text-decoration: none;
            border: 1px solid #7c3aed;
            border-radius: 4px;
            font-weight: 600;
            font-size: 10px;
            text-align: center;
            margin: 4px;
        }
        .footer {
            background-color: #f9fafb;
            padding: 15px;
            text-align: center;
            border-top: 2px solid #7c3aed;
        }
        .footer-text {
            color: #6b7280;
            font-size: 10px;
            margin-bottom: 8px;
        }
        .social-links {
            margin: 10px 0;
        }
        .social-links a {
            display: inline-block;
            margin: 0 5px;
            color: #7c3aed;
            text-decoration: none;
            font-size: 10px;
        }
        .contact-info {
            color: #9ca3af;
            font-size: 9px;
            margin-top: 8px;
        }
        @media only screen and (max-width: 600px) {
            .content {
                padding: 15px 10px;
            }
            .header h1 {
                font-size: 10px;
            }
            .cta-button, .secondary-button {
                display: block;
                width: 100%;
                margin: 4px 0;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- Header -->
        <div class="header">
            <img src="https://res.cloudinary.com/dupgdbwrt/image/upload/v1759968430/icon-192.png_fukoim.png" alt="JulineMart" class="logo">
            <div class="header-content">
            <h1>Shipment Created 📦</h1>
            <p>Print your label and get ready for pickup</p>
            </div>
        </div>

        <!-- Content -->
        <div class="content">
            <p class="greeting">Hi {{vendor_name}},</p>

            <p class="message">
                JulineMart has created the Fez shipment for order <strong>#{{order_number}}</strong>.
            </p>

            <!-- Tracking Number Box -->
            <div class="order-box">
                <div class="order-number">Tracking Number</div>
                <div class="order-value">{{tracking_number}}</div>
            </div>

            <div class="divider"></div>

            <center>
                <a href="{{label_url}}" class="cta-button">Print Shipping Label</a>
                <br>
                <a href="{{waybill_url}}" class="secondary-button">Print Waybill</a>
            </center>

            <div class="divider"></div>

            <p class="message" style="font-size: 10px; color: #6b7280;">
                <strong>What to do:</strong><br>
                1. Print the label and stick it on the package<br>
                2. Print the waybill for your records<br>
                3. Have the parcel ready at your shop — a Fez rider will pick it up
            </p>
        </div>

        <!-- Footer -->
        <div class="footer">
            <p class="footer-text">
                <strong>Need Help?</strong><br>
                Our vendor support team is here for you!
            </p>

            <div class="social-links">
                <a href="{{portal_orders_url}}">View in Portal</a> •
                <a href="mailto:info@julinemart.com">Contact Support</a>
            </div>

            <div class="contact-info">
                <p>
                    JulineMart - Nigeria's Trusted Marketplace<br>
                    Lagos • Warri • Abuja<br>
                    info@julinemart.com
                </p>
            </div>
        </div>
    </div>
</body>
</html>
$tpl$
where name = 'Vendor Shipment Ready Fez Pickup';

update email_templates
set html_content = $tpl$<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Shipment Created - JulineMart</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background-color: #f5f5f5;
            line-height: 1.6;
        }
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
        }
        .header {
            background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
            padding: 15px;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
        }
        .logo {
            width: 40px;
            height: 40px;
            flex-shrink: 0;
        }
        .header-content {
            text-align: left;
        }
        .header h1 {
            color: #ffffff;
            margin: 0;
            font-size: 11px;
            font-weight: 600;
        }
        .header p {
            color: #e9d5ff;
            margin: 5px 0 0 0;
            font-size: 11px;
        }
        .content {
            padding: 20px 15px;
        }
        .greeting {
            font-size: 9px;
            color: #1f2937;
            margin-bottom: 10px;
            font-weight: 600;
        }
        .message {
            color: #4b5563;
            font-size: 11px;
            margin-bottom: 15px;
            line-height: 1.4;
        }
        .order-box {
            background: linear-gradient(135deg, #fef3c7 0%, #fde68a 100%);
            border-left: 3px solid #f97316;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
        }
        .order-number {
            font-size: 10px;
            color: #92400e;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
            font-weight: 600;
        }
        .order-value {
            font-size: 11px;
            color: #1f2937;
            font-weight: 700;
            font-family: 'Courier New', monospace;
        }
        .hub-box {
            background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%);
            border-left: 3px solid #7c3aed;
            padding: 12px;
            border-radius: 6px;
            margin-bottom: 15px;
        }
        .hub-label {
            font-size: 10px;
            color: #5b21b6;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 4px;
            font-weight: 600;
        }
        .hub-value {
            font-size: 11px;
            color: #1f2937;
            font-weight: 700;
        }
        .hub-address {
            color: #4c1d95;
            font-size: 10px;
            margin-top: 4px;
        }
        .divider {
            height: 1px;
            background: #e5e7eb;
            margin: 12px 0;
        }
        .cta-button {
            display: inline-block;
            background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
            color: #ffffff !important;
            padding: 8px 16px;
            text-decoration: none;
            border-radius: 4px;
            font-weight: 600;
            font-size: 11px;
            text-align: center;
            margin: 8px 4px;
            box-shadow: 0 2px 4px rgba(124, 58, 237, 0.2);
        }
        .secondary-button {
            display: inline-block;
            background: #ffffff;
            color: #7c3aed !important;
            padding: 6px 12px;
            text-decoration: none;
            border: 1px solid #7c3aed;
            border-radius: 4px;
            font-weight: 600;
            font-size: 10px;
            text-align: center;
            margin: 4px;
        }
        .footer {
            background-color: #f9fafb;
            padding: 15px;
            text-align: center;
            border-top: 2px solid #7c3aed;
        }
        .footer-text {
            color: #6b7280;
            font-size: 10px;
            margin-bottom: 8px;
        }
        .social-links {
            margin: 10px 0;
        }
        .social-links a {
            display: inline-block;
            margin: 0 5px;
            color: #7c3aed;
            text-decoration: none;
            font-size: 10px;
        }
        .contact-info {
            color: #9ca3af;
            font-size: 9px;
            margin-top: 8px;
        }
        @media only screen and (max-width: 600px) {
            .content {
                padding: 15px 10px;
            }
            .header h1 {
                font-size: 10px;
            }
            .cta-button, .secondary-button {
                display: block;
                width: 100%;
                margin: 4px 0;
            }
        }
    </style>
</head>
<body>
    <div class="email-container">
        <!-- Header -->
        <div class="header">
            <img src="https://res.cloudinary.com/dupgdbwrt/image/upload/v1759968430/icon-192.png_fukoim.png" alt="JulineMart" class="logo">
            <div class="header-content">
            <h1>Shipment Created 📦</h1>
            <p>Print your label and drop off at the hub</p>
            </div>
        </div>

        <!-- Content -->
        <div class="content">
            <p class="greeting">Hi {{vendor_name}},</p>

            <p class="message">
                JulineMart has created the Fez shipment for order <strong>#{{order_number}}</strong>.
            </p>

            <!-- Tracking Number Box -->
            <div class="order-box">
                <div class="order-number">Tracking Number</div>
                <div class="order-value">{{tracking_number}}</div>
            </div>

            <!-- Drop-off Location Box -->
            <div class="hub-box">
                <div class="hub-label">Drop-off Location</div>
                <div class="hub-value">{{hub_name}}</div>
                <div class="hub-address">{{hub_address}}</div>
            </div>

            <div class="divider"></div>

            <center>
                <a href="{{label_url}}" class="cta-button">Print Shipping Label</a>
                <br>
                <a href="{{waybill_url}}" class="secondary-button">Print Waybill</a>
            </center>

            <div class="divider"></div>

            <p class="message" style="font-size: 10px; color: #6b7280;">
                <strong>What to do:</strong><br>
                1. Print the label and stick it on the package<br>
                2. Print the waybill for your records<br>
                3. Drop the parcel at the Fez hub above
            </p>
        </div>

        <!-- Footer -->
        <div class="footer">
            <p class="footer-text">
                <strong>Need Help?</strong><br>
                Our vendor support team is here for you!
            </p>

            <div class="social-links">
                <a href="{{portal_orders_url}}">View in Portal</a> •
                <a href="mailto:info@julinemart.com">Contact Support</a>
            </div>

            <div class="contact-info">
                <p>
                    JulineMart - Nigeria's Trusted Marketplace<br>
                    Lagos • Warri • Abuja<br>
                    info@julinemart.com
                </p>
            </div>
        </div>
    </div>
</body>
</html>
$tpl$
where name = 'Vendor Shipment Ready Fez Hub';
