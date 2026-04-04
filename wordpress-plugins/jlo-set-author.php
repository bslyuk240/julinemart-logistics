<?php
/**
 * JulineMart – Set Product Author
 *
 * Exposes a trusted REST endpoint so the JLO Netlify backend can update
 * the WordPress post_author of a product (required for WCFM vendor assignment).
 *
 * Upload to: wp-content/mu-plugins/jlo-set-author.php
 * No activation needed – mu-plugins load automatically.
 *
 * Endpoint : POST /wp-json/jlo/v1/set-product-author
 * Auth     : WordPress Application Password (Basic)
 *            Uses the same WP_MEDIA_USERNAME + WORDPRESS_APP_PASSWORD
 *            that are already in the Netlify env vars.
 * Body     : { "product_id": 1234, "author_id": 10 }
 */

add_action( 'rest_api_init', function () {
    register_rest_route( 'jlo/v1', '/set-product-author', [
        'methods'             => [ 'POST', 'PUT' ],
        'callback'            => 'jlo_set_product_author_cb',
        'permission_callback' => function () {
            // Requires a logged-in user with product-editing rights.
            // The Netlify function authenticates via WP Application Password.
            return current_user_can( 'edit_others_products' );
        },
        'args' => [
            'product_id' => [
                'required'          => true,
                'type'              => 'integer',
                'minimum'           => 1,
                'sanitize_callback' => 'absint',
            ],
            'author_id' => [
                'required'          => true,
                'type'              => 'integer',
                'minimum'           => 1,
                'sanitize_callback' => 'absint',
            ],
        ],
    ] );
} );

function jlo_set_product_author_cb( WP_REST_Request $request ) {
    $product_id = (int) $request->get_param( 'product_id' );
    $author_id  = (int) $request->get_param( 'author_id' );

    // Verify the post exists and is a product
    $post = get_post( $product_id );
    if ( ! $post || $post->post_type !== 'product' ) {
        return new WP_Error(
            'not_found',
            "Product {$product_id} not found",
            [ 'status' => 404 ]
        );
    }

    // Verify the target author user exists
    $author = get_userdata( $author_id );
    if ( ! $author ) {
        return new WP_Error(
            'invalid_author',
            "User {$author_id} not found",
            [ 'status' => 400 ]
        );
    }

    // Update post_author
    $result = wp_update_post(
        [ 'ID' => $product_id, 'post_author' => $author_id ],
        true // return WP_Error on failure
    );

    if ( is_wp_error( $result ) ) {
        return new WP_Error(
            'update_failed',
            $result->get_error_message(),
            [ 'status' => 500 ]
        );
    }

    // Also write the WCFM meta keys for belt-and-suspenders
    update_post_meta( $product_id, '_wcfm_product_author',   (string) $author_id );
    update_post_meta( $product_id, '_wcfm_vendor_id',        (string) $author_id );
    update_post_meta( $product_id, 'wcfm_vendor_id',         (string) $author_id );
    update_post_meta( $product_id, '_woocommerce_vendor_id', (string) $author_id );

    return rest_ensure_response( [
        'success'     => true,
        'product_id'  => $product_id,
        'author_id'   => $author_id,
        'post_author' => (int) get_post_field( 'post_author', $product_id ),
        'author_name' => $author->display_name,
    ] );
}
