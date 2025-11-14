<?php
/**
 * Plugin Name: JulineMart Logistics Webhook Setup
 * Description: Provides an admin dashboard for configuring WooCommerce webhooks that sync orders into the JulineMart Logistics Orchestrator.
 * Version: 1.0
 * Author: JulineMart
 */

if ( ! defined( 'ABSPATH' ) ) {
  exit;
}

add_action( 'admin_menu', 'jlo_webhook_admin_menu' );
add_action( 'admin_post_jlo_save_webhook_settings', 'jlo_handle_webhook_settings' );
add_action( 'admin_post_jlo_test_webhook', 'jlo_handle_test_webhook' );
add_action( 'admin_post_jlo_recreate_webhook', 'jlo_handle_recreate_webhook' );
add_action( 'init', 'jlo_register_webhook', 20 );

function jlo_webhook_admin_menu() {
  add_submenu_page(
    'woocommerce',
    'JLO Webhooks',
    'JLO Webhooks',
    'manage_options',
    'jlo-webhook',
    'jlo_render_webhook_settings_page'
  );
}

function jlo_render_webhook_settings_page() {
  if ( ! current_user_can( 'manage_options' ) ) {
    return;
  }

  $webhook_url = get_option( 'jlo_webhook_url', '' );
  $webhook_secret = get_option( 'jlo_webhook_secret', '' );
  $webhook_id = get_option( 'jlo_webhook_id' );
  $webhook = null;
  if ( $webhook_id ) {
    if ( function_exists( 'wc_get_webhook' ) ) {
      $webhook = wc_get_webhook( $webhook_id );
    } elseif ( class_exists( 'WC_Webhook' ) ) {
      $webhook = new WC_Webhook( $webhook_id );
    }
  }

  $notice = '';
  if ( isset( $_GET['test_status'] ) ) {
    $notice = sanitize_text_field( $_GET['test_status'] );
  } elseif ( isset( $_GET['updated'] ) ) {
    $notice = 'Settings saved and webhook provisioned.';
  }

  ?>
  <div class="wrap">
    <h1>JulineMart WooCommerce Webhook</h1>
    <?php if ( $notice ) : ?>
      <div class="notice notice-success is-dismissible">
        <p><?php echo esc_html( $notice ); ?></p>
      </div>
    <?php endif; ?>

    <form action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" method="post">
      <input type="hidden" name="action" value="jlo_save_webhook_settings">
      <?php wp_nonce_field( 'jlo_webhook_settings' ); ?>

      <table class="form-table">
        <tr>
          <th scope="row">Webhook URL</th>
          <td>
            <input type="url" name="jlo_webhook_url" value="<?php echo esc_attr( $webhook_url ); ?>" class="regular-text" required>
            <p class="description">Set this to your production Netlify endpoint that receives WooCommerce order webhooks.</p>
          </td>
        </tr>
        <tr>
          <th scope="row">Webhook Secret</th>
          <td>
            <input type="text" name="jlo_webhook_secret" value="<?php echo esc_attr( $webhook_secret ); ?>" class="regular-text">
            <p class="description">Optional secret used to validate incoming requests.</p>
          </td>
        </tr>
        <tr>
          <th scope="row">Sync Status</th>
          <td>
            <?php if ( $webhook ) : ?>
              <strong><?php echo esc_html( $webhook->get_name() ); ?></strong> - <?php echo esc_html( ucfirst( $webhook->get_status() ) ); ?><br>
              <?php if ( method_exists( $webhook, 'get_date_created' ) ) : ?>
                <small>Last modified: <?php echo esc_html( wp_date( 'F j, Y H:i', $webhook->get_date_created()->getTimestamp() ) ); ?></small>
              <?php endif; ?>
            <?php else : ?>
              <span class="description">Webhook has not been configured yet.</span>
            <?php endif; ?>
          </td>
        </tr>
      </table>

      <?php submit_button( 'Save & Provision Webhook' ); ?>
    </form>

    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:20px;">
      <input type="hidden" name="action" value="jlo_test_webhook">
      <?php wp_nonce_field( 'jlo_test_webhook' ); ?>
      <button class="button button-secondary">Send Test Payload</button>
      <p class="description" style="margin-top:6px;">Dispatches a fake order payload to validate connectivity and logging.</p>
    </form>

    <form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" style="margin-top:20px;">
      <input type="hidden" name="action" value="jlo_recreate_webhook">
      <?php wp_nonce_field( 'jlo_recreate_webhook' ); ?>
      <button class="button">Recreate Webhook</button>
      <p class="description">Use this to recreate the webhook if it was deleted or invalidated.</p>
    </form>

    <h2 style="margin-top:40px;">Product Meta Requirements</h2>
    <p>Add the following custom fields to each WooCommerce product so that JLO can route the items correctly:</p>
    <ul>
      <li><strong>hub_id</strong> – UUID of the fulfillment hub (from the JLO hubs table).</li>
      <li><strong>vendor_id</strong> – Optional string to identify the vendor (defaults to <code>default-vendor</code>).</li>
    </ul>

    <h2>Status & Troubleshooting</h2>
    <p>
      The webhook posts order data to JLO and expects a 200 response. Responses are recorded in Supabase
      via the <code>webhook_errors</code> table when issues occur.
    </p>
  </div>
  <?php
}

function jlo_handle_webhook_settings() {
  if ( ! current_user_can( 'manage_options' ) ) {
    wp_die( 'Unauthorized' );
  }
  check_admin_referer( 'jlo_webhook_settings' );

  $url = isset( $_POST['jlo_webhook_url'] ) ? esc_url_raw( wp_unslash( $_POST['jlo_webhook_url'] ) ) : '';
  $secret = isset( $_POST['jlo_webhook_secret'] ) ? sanitize_text_field( wp_unslash( $_POST['jlo_webhook_secret'] ) ) : '';

  update_option( 'jlo_webhook_url', $url );
  update_option( 'jlo_webhook_secret', $secret );

  jlo_register_webhook( true );

  wp_redirect( admin_url( 'admin.php?page=jlo-webhook&updated=1' ) );
  exit;
}

function jlo_handle_test_webhook() {
  if ( ! current_user_can( 'manage_options' ) ) {
    wp_die( 'Unauthorized' );
  }
  check_admin_referer( 'jlo_test_webhook' );

  $url = get_option( 'jlo_webhook_url', '' );
  $secret = get_option( 'jlo_webhook_secret', '' );

  if ( ! $url ) {
    wp_redirect( admin_url( 'admin.php?page=jlo-webhook&test_status=' . urlencode( 'Webhook URL is not configured.' ) ) );
    exit;
  }

  $payload = [
    'id' => uniqid(),
    'status' => 'processing',
    'billing' => [
      'first_name' => 'Test',
      'last_name' => 'User',
      'email' => 'test@julinemart.com',
    ],
    'shipping' => [
      'address_1' => '1 Testing Way',
      'city' => 'Lagos',
      'state' => 'Lagos',
    ],
    'line_items' => [
      [
        'product_id' => 1,
        'name' => 'Test Product',
        'quantity' => 1,
        'price' => 100,
        'total' => 100,
        'meta_data' => [
          ['key' => 'hub_id', 'value' => 'default'],
          ['key' => 'vendor_id', 'value' => 'default-vendor'],
        ],
      ],
    ],
  ];

  $args = [
    'headers' => [
      'Content-Type' => 'application/json',
    ],
    'body' => wp_json_encode( $payload ),
    'timeout' => 20,
  ];

  $response = wp_remote_post( $url, $args );

  if ( is_wp_error( $response ) ) {
    $message = 'Test webhook failed: ' . $response->get_error_message();
  } else {
    $body = wp_remote_retrieve_body( $response );
    $message = 'Test webhook response: ' . wp_json_encode( json_decode( $body, true ) );
  }

  wp_redirect( admin_url( 'admin.php?page=jlo-webhook&test_status=' . urlencode( $message ) ) );
  exit;
}

function jlo_handle_recreate_webhook() {
  if ( ! current_user_can( 'manage_options' ) ) {
    wp_die( 'Unauthorized' );
  }
  check_admin_referer( 'jlo_recreate_webhook' );

  jlo_register_webhook( true );
  wp_redirect( admin_url( 'admin.php?page=jlo-webhook&updated=1' ) );
  exit;
}

function jlo_register_webhook( $force = false ) {
  if ( ! class_exists( 'WooCommerce' ) ) {
    return;
  }

  $url = get_option( 'jlo_webhook_url', '' );
  if ( ! $url ) {
    return;
  }

  $hookId = get_option( 'jlo_webhook_id' );
  $webhook = null;
  if ( $hookId ) {
    if ( function_exists( 'wc_get_webhook' ) ) {
      $webhook = wc_get_webhook( $hookId );
    } elseif ( class_exists( 'WC_Webhook' ) ) {
      $webhook = new WC_Webhook( $hookId );
    }
  }

  if ( ! $webhook ) {
    $webhook = new WC_Webhook();
  }

  $webhook->set_name( 'JulineMart Order Sync' );
  $webhook->set_user_id( get_current_user_id() ?: 1 );
  $webhook->set_topic( 'order.created' );
  $webhook->set_delivery_url( $url );
  $webhook->set_secret( get_option( 'jlo_webhook_secret', '' ) );
  $webhook->set_status( 'active' );
  $webhook->save();

  update_option( 'jlo_webhook_id', $webhook->get_id() );
}
