<?php
/**
 * Add this code to your theme's functions.php
 * OR create a custom plugin with this code
 * 
 * This automatically configures WooCommerce webhooks
 * to send orders to your JLO system
 */

add_action('init', 'jlo_setup_woocommerce_webhooks');

function jlo_setup_woocommerce_webhooks() {
    // Only run once
    if (get_option('jlo_webhooks_configured')) {
        return;
    }

    // Check if WooCommerce is active
    if (!class_exists('WooCommerce')) {
        return;
    }

    // Your JLO webhook URL
    $webhook_url = 'https://jlo.julinemart.com/.netlify/functions/woocommerce-webhook';

    // Create webhook for order.created
    $webhook = new WC_Webhook();
    $webhook->set_name('JLO Order Sync');
    $webhook->set_user_id(1); // Use admin user ID
    $webhook->set_topic('order.created');
    $webhook->set_delivery_url($webhook_url);
    $webhook->set_status('active');
    $webhook->save();

    // Mark as configured
    update_option('jlo_webhooks_configured', true);
    
    error_log('JLO: WooCommerce webhook configured successfully');
}

// Optional: Reset webhook setup (for testing)
// delete_option('jlo_webhooks_configured');
