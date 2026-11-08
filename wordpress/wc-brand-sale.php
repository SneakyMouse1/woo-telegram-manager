<?php
/**
 * WooCommerce Brand Sale: brand-wide discounts stored in the database (managed by the bot via REST).
 *
 * The sale config is stored in the 'custom_brand_sale_config' option:
 *   [ 'version' => int, 'start' => unix ts, 'end' => unix ts, 'discounts' => [ term_id => percent ] ]
 * While the option does not exist, the sale is inactive (see wc_brand_sale_defaults()).
 * The first sale is created by the bot via PUT.
 *
 * REST (requires authentication, manage_woocommerce capability, Application Password):
 *   GET    /wp-json/wc-brand-sale/v1/brand-sale   current sale
 *   PUT    /wp-json/wc-brand-sale/v1/brand-sale   replace sale entirely
 *   DELETE /wp-json/wc-brand-sale/v1/brand-sale   end sale immediately
 *   GET    /wp-json/wc-brand-sale/v1/brands       list of brands for selection
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

// ---------------------------------------------------------------------------
// 1. Sale configuration (DB option instead of hardcode)
// ---------------------------------------------------------------------------

// Empty config: until the bot saves a sale, there are no discounts (start = 0 means "inactive")
function wc_brand_sale_defaults() {
    return [
        'version'   => 1,
        'start'     => 0,
        'end'       => 0,
        'discounts' => [],
    ];
}

function wc_brand_sale_taxonomies() {
    return [ 'pwb-brand', 'yith_product_brand', 'product_brand', 'pa_brand', 'pa_brend' ];
}

function get_brand_sale_config() {
    $c = get_option( 'custom_brand_sale_config', null );
    if ( ! is_array( $c ) ) {
        $c = wc_brand_sale_defaults();
    }

    $discounts = [];
    foreach ( (array) ( $c['discounts'] ?? [] ) as $term_id => $pct ) {
        $discounts[ (int) $term_id ] = (float) $pct;
    }

    return [
        'version'   => (int) ( $c['version'] ?? 1 ),
        'start'     => (int) ( $c['start'] ?? 0 ),
        'end'       => (int) ( $c['end'] ?? 0 ),
        'discounts' => $discounts,
    ];
}

function get_custom_brand_discounts() {
    return get_brand_sale_config()['discounts'];
}

function get_custom_brand_sale_bounds() {
    $c = get_brand_sale_config();
    return [ $c['start'], $c['end'] ];
}

function is_custom_brand_sale_active() {
    list( $sale_start, $sale_end ) = get_custom_brand_sale_bounds();
    $now = time();

    return ( $sale_start > 0 && $now >= $sale_start && $now <= $sale_end );
}

// State string: changes on sale start/end AND on any config edit (version)
function wc_brand_sale_status_string() {
    return is_custom_brand_sale_active()
        ? 'active:' . get_brand_sale_config()['version']
        : 'inactive';
}

// ---------------------------------------------------------------------------
// 2. Check: whether the product/variation currently has an active manual sale
// ---------------------------------------------------------------------------

function has_valid_manual_sale_price( $product ) {
    if ( ! is_a( $product, 'WC_Product' ) ) {
        return false;
    }

    $product_id = $product->get_id();
    $sale_price = get_post_meta( $product_id, '_sale_price', true );

    if ( '' === $sale_price || null === $sale_price || (float) $sale_price <= 0 ) {
        return false;
    }

    // Sale price must be strictly lower than regular price (same as native WooCommerce)
    $regular_price = (float) $product->get_regular_price();
    if ( $regular_price > 0 && (float) $sale_price >= $regular_price ) {
        return false;
    }

    $current_time = time();
    $date_from    = get_post_meta( $product_id, '_sale_price_dates_from', true );
    $date_to      = get_post_meta( $product_id, '_sale_price_dates_to', true );

    if ( ! empty( $date_from ) && $current_time < (int) $date_from ) {
        return false;
    }

    if ( ! empty( $date_to ) && $current_time > (int) $date_to ) {
        return false;
    }

    return true;
}

// ---------------------------------------------------------------------------
// 3. Brand discount for a specific product (version in cache key)
// ---------------------------------------------------------------------------

function get_product_brand_discount_percent( $product ) {
    if ( ! is_custom_brand_sale_active() || ! is_a( $product, 'WC_Product' ) ) {
        return 0;
    }

    $product_id = $product->is_type( 'variation' ) ? $product->get_parent_id() : $product->get_id();

    $cache_key       = 'p_brand_disc_' . get_brand_sale_config()['version'] . '_' . $product_id;
    $cached_discount = wp_cache_get( $cache_key, 'brand_sales' );
    if ( false !== $cached_discount ) {
        return (float) $cached_discount;
    }

    $discounts      = get_custom_brand_discounts();
    $found_discount = 0;

    foreach ( wc_brand_sale_taxonomies() as $taxonomy ) {
        if ( taxonomy_exists( $taxonomy ) ) {
            $brand_terms = wp_get_post_terms( $product_id, $taxonomy, [ 'fields' => 'ids' ] );
            if ( ! is_wp_error( $brand_terms ) && ! empty( $brand_terms ) ) {
                foreach ( $brand_terms as $term_id ) {
                    if ( isset( $discounts[ $term_id ] ) ) {
                        $found_discount = (float) $discounts[ $term_id ];
                        break 2;
                    }
                }
            }
        }
    }

    wp_cache_set( $cache_key, $found_discount, 'brand_sales', 3600 );
    return $found_discount;
}

// ---------------------------------------------------------------------------
// 4. Price filters for simple products and individual variations
// ---------------------------------------------------------------------------

add_filter( 'woocommerce_product_get_sale_price', 'apply_brand_sale_price', 99, 2 );
add_filter( 'woocommerce_product_variation_get_sale_price', 'apply_brand_sale_price', 99, 2 );
function apply_brand_sale_price( $sale_price, $product ) {
    if ( ! is_custom_brand_sale_active() || ! is_a( $product, 'WC_Product' ) ) {
        return $sale_price;
    }

    $discount_percent = get_product_brand_discount_percent( $product );
    $regular_price    = (float) $product->get_regular_price();
    $manual_is_valid  = has_valid_manual_sale_price( $product );

    // Brand is not part of the sale: keep only a valid manual discount,
    // clear expired ("zombie") sale prices
    if ( $discount_percent <= 0 || $regular_price <= 0 ) {
        return $manual_is_valid ? $sale_price : '';
    }

    $brand_calculated_price = round( $regular_price * ( 1 - ( $discount_percent / 100 ) ), wc_get_price_decimals() );

    if ( $manual_is_valid ) {
        return (string) min( (float) $sale_price, $brand_calculated_price );
    }

    return (string) $brand_calculated_price;
}

add_filter( 'woocommerce_product_get_price', 'apply_brand_active_price', 99, 2 );
add_filter( 'woocommerce_product_variation_get_price', 'apply_brand_active_price', 99, 2 );
function apply_brand_active_price( $price, $product ) {
    if ( ! is_custom_brand_sale_active() || ! is_a( $product, 'WC_Product' ) ) {
        return $price;
    }

    // Variable parent price is calculated from variations (see hash filters below)
    if ( $product->is_type( 'variable' ) ) {
        return $price;
    }

    // get_sale_price() has already passed through apply_brand_sale_price()
    $sale_price = $product->get_sale_price();
    if ( '' !== $sale_price && null !== $sale_price && false !== $sale_price && (float) $sale_price > 0 ) {
        return $sale_price;
    }

    // No active discount: do not trust potentially stale _price, return regular price
    $regular_price = $product->get_regular_price();
    if ( '' !== $regular_price && null !== $regular_price && false !== $regular_price ) {
        return $regular_price;
    }

    return $price;
}

add_filter( 'woocommerce_product_is_on_sale', 'apply_brand_is_on_sale', 99, 2 );
add_filter( 'woocommerce_product_variation_is_on_sale', 'apply_brand_is_on_sale', 99, 2 );
function apply_brand_is_on_sale( $is_on_sale, $product ) {
    if ( ! is_a( $product, 'WC_Product' ) ) {
        return $is_on_sale;
    }
    if ( $is_on_sale ) {
        return true;
    }
    return ( get_product_brand_discount_percent( $product ) > 0 );
}

// ---------------------------------------------------------------------------
// 5. Variation price cache (min-max ranges). version in hash: changing percentages
//    mid-sale immediately recalculates price ranges.
// ---------------------------------------------------------------------------

add_filter( 'woocommerce_variation_prices_sale_price', 'apply_brand_variation_hash_price', 99, 3 );
add_filter( 'woocommerce_variation_prices_price', 'apply_brand_variation_hash_price', 99, 3 );
function apply_brand_variation_hash_price( $price, $variation, $product ) {
    if ( ! is_custom_brand_sale_active() || ! is_a( $variation, 'WC_Product' ) ) {
        return $price;
    }

    $discount_percent = get_product_brand_discount_percent( $product );
    $regular_price    = (float) $variation->get_regular_price();

    if ( $regular_price <= 0 ) {
        return $price;
    }

    $manual_is_valid   = has_valid_manual_sale_price( $variation );
    $manual_sale_price = $manual_is_valid ? (float) get_post_meta( $variation->get_id(), '_sale_price', true ) : 0;

    if ( $discount_percent <= 0 ) {
        return $manual_is_valid ? (string) $manual_sale_price : (string) $regular_price;
    }

    $brand_calculated_price = round( $regular_price * ( 1 - ( $discount_percent / 100 ) ), wc_get_price_decimals() );

    if ( $manual_is_valid ) {
        return (string) min( $manual_sale_price, $brand_calculated_price );
    }

    return (string) $brand_calculated_price;
}

add_filter( 'woocommerce_get_variation_prices_hash', 'append_brand_sale_to_variation_hash', 99, 3 );
function append_brand_sale_to_variation_hash( $hash, $product, $display ) {
    $hash['brand_promo_state'] = wc_brand_sale_status_string();
    return $hash;
}

// ---------------------------------------------------------------------------
// 6. WooCommerce REST API (parent variable products, for the Telegram bot)
// ---------------------------------------------------------------------------

add_filter( 'woocommerce_rest_prepare_product_object', 'enrich_rest_api_variable_product_prices', 99, 3 );
function enrich_rest_api_variable_product_prices( $response, $product, $request ) {
    if ( ! is_custom_brand_sale_active() || ! is_a( $product, 'WC_Product' ) || ! $product->is_type( 'variable' ) ) {
        return $response;
    }

    $variation_prices = $product->get_variation_prices( true );
    if ( empty( $variation_prices['price'] ) || empty( $variation_prices['regular_price'] ) ) {
        return $response;
    }

    $decimals    = wc_get_price_decimals();
    $min_price   = (float) min( $variation_prices['price'] );
    $min_regular = (float) min( $variation_prices['regular_price'] );
    $on_sale     = ( $min_price < $min_regular );

    $response_data = $response->get_data();

    $response_data['regular_price'] = wc_format_decimal( $min_regular, $decimals );
    $response_data['sale_price']    = $on_sale ? wc_format_decimal( $min_price, $decimals ) : '';
    $response_data['price']         = wc_format_decimal( $min_price, $decimals );
    $response_data['on_sale']       = $on_sale;

    $response->set_data( $response_data );

    return $response;
}

// ---------------------------------------------------------------------------
// 7. Lifecycle: purge caches on state change (start, end, config edit)
// ---------------------------------------------------------------------------

add_action( 'init', 'manage_brand_sale_lifecycle' );
function manage_brand_sale_lifecycle() {
    $state_option_key = 'custom_brand_sale_status_flag';
    $current_status   = wc_brand_sale_status_string();
    $saved_status     = get_option( $state_option_key, 'inactive' );

    if ( $current_status !== $saved_status ) {
        update_option( $state_option_key, $current_status );
        wc_brand_sale_purge_all_caches();
    }
}

function wc_brand_sale_purge_all_caches() {
    do_action( 'litespeed_purge_all' );

    if ( function_exists( 'rocket_clean_domain' ) ) {
        rocket_clean_domain();
    }

    schedule_batched_wc_cache_clear();
}

function schedule_batched_wc_cache_clear() {
    if ( ! wp_next_scheduled( 'process_batch_clear_wc_transients', [ 0 ] ) ) {
        wp_schedule_single_event( time(), 'process_batch_clear_wc_transients', [ 0 ] );
    }
}

add_action( 'process_batch_clear_wc_transients', 'run_batch_clear_wc_transients' );
function run_batch_clear_wc_transients( $offset = 0 ) {
    $batch_size = 100;

    $product_ids = get_posts( [
        'post_type'      => [ 'product', 'product_variation' ],
        'posts_per_page' => $batch_size,
        'offset'         => (int) $offset,
        'fields'         => 'ids',
        'post_status'    => 'publish',
        'orderby'        => 'ID',
        'order'          => 'ASC',
    ] );

    if ( ! empty( $product_ids ) ) {
        foreach ( $product_ids as $id ) {
            wc_delete_product_transients( $id );
            // Keys p_brand_disc_* include version, so older entries are bypassed automatically.
        }

        wp_schedule_single_event( time() + 2, 'process_batch_clear_wc_transients', [ (int) $offset + $batch_size ] );
    }
}

// ---------------------------------------------------------------------------
// 8. REST API for sale management (for the bot)
// ---------------------------------------------------------------------------

function wc_brand_sale_rest_can_manage() {
    return current_user_can( 'manage_woocommerce' );
}

add_action( 'rest_api_init', function () {
    register_rest_route( 'wc-brand-sale/v1', '/brand-sale', [
        [
            'methods'             => 'GET',
            'permission_callback' => 'wc_brand_sale_rest_can_manage',
            'callback'            => 'wc_brand_sale_rest_get_sale',
        ],
        [
            'methods'             => 'PUT',
            'permission_callback' => 'wc_brand_sale_rest_can_manage',
            'callback'            => 'wc_brand_sale_rest_save_sale',
        ],
        [
            'methods'             => 'DELETE',
            'permission_callback' => 'wc_brand_sale_rest_can_manage',
            'callback'            => 'wc_brand_sale_rest_end_sale',
        ],
    ] );

    register_rest_route( 'wc-brand-sale/v1', '/brands', [
        'methods'             => 'GET',
        'permission_callback' => 'wc_brand_sale_rest_can_manage',
        'callback'            => 'wc_brand_sale_rest_list_brands',
    ] );
} );

function wc_brand_sale_response() {
    $c      = get_brand_sale_config();
    $brands = [];

    foreach ( $c['discounts'] as $term_id => $pct ) {
        $term               = get_term( $term_id );
        $brands[ $term_id ] = [
            'name'     => ( $term && ! is_wp_error( $term ) ) ? $term->name : null,
            'discount' => $pct,
        ];
    }

    return rest_ensure_response( [
        'version'   => $c['version'],
        'start'     => $c['start'],
        'end'       => $c['end'],
        'active'    => is_custom_brand_sale_active(),
        'now'       => time(),
        'discounts' => $c['discounts'],
        'brands'    => $brands,
    ] );
}

function wc_brand_sale_rest_get_sale() {
    return wc_brand_sale_response();
}

function wc_brand_sale_rest_list_brands() {
    $out = [];

    foreach ( wc_brand_sale_taxonomies() as $taxonomy ) {
        if ( ! taxonomy_exists( $taxonomy ) ) {
            continue;
        }
        $terms = get_terms( [ 'taxonomy' => $taxonomy, 'hide_empty' => false ] );
        if ( is_wp_error( $terms ) ) {
            continue;
        }
        foreach ( $terms as $t ) {
            $out[] = [
                'id'       => (int) $t->term_id,
                'name'     => $t->name,
                'taxonomy' => $taxonomy,
                'count'    => (int) $t->count,
            ];
        }
    }

    usort( $out, function ( $a, $b ) {
        return strcasecmp( $a['name'], $b['name'] );
    } );

    return rest_ensure_response( $out );
}

// Writes the new config, increments version, and purges caches. Single write entry point.
function wc_brand_sale_commit_brand_sale( array $new ) {
    $new['version'] = get_brand_sale_config()['version'] + 1;

    update_option( 'custom_brand_sale_config', $new, true );
    update_option( 'custom_brand_sale_status_flag', wc_brand_sale_status_string() );

    wc_brand_sale_purge_all_caches();

    return wc_brand_sale_response();
}

function wc_brand_sale_rest_save_sale( WP_REST_Request $r ) {
    $start     = (int) $r->get_param( 'start' );
    $end       = (int) $r->get_param( 'end' );
    $discounts = $r->get_param( 'discounts' );

    if ( $start <= 0 || $end <= $start ) {
        return new WP_Error( 'wc_brand_sale_bad_dates', 'start and end must be unix timestamps in seconds, end > start', [ 'status' => 400 ] );
    }

    if ( ! is_array( $discounts ) || empty( $discounts ) ) {
        return new WP_Error( 'wc_brand_sale_no_discounts', 'discounts: object {term_id: percent} required, at least one brand', [ 'status' => 400 ] );
    }

    $clean = [];
    foreach ( $discounts as $term_id => $pct ) {
        $term_id = (int) $term_id;
        $pct     = (int) $pct;
        $term    = get_term( $term_id );

        if ( ! $term || is_wp_error( $term ) || ! in_array( $term->taxonomy, wc_brand_sale_taxonomies(), true ) ) {
            return new WP_Error( 'wc_brand_sale_bad_brand', "term_id $term_id is not a brand", [ 'status' => 400 ] );
        }
        if ( $pct < 1 || $pct > 90 ) {
            return new WP_Error( 'wc_brand_sale_bad_percent', "Percentage for $term_id must be between 1 and 90", [ 'status' => 400 ] );
        }
        $clean[ $term_id ] = $pct;
    }

    return wc_brand_sale_commit_brand_sale( [ 'start' => $start, 'end' => $end, 'discounts' => $clean ] );
}

function wc_brand_sale_rest_end_sale() {
    $c = get_brand_sale_config();

    return wc_brand_sale_commit_brand_sale( [
        'start'     => $c['start'],
        'end'       => time() - 1,
        'discounts' => $c['discounts'],
    ] );
}
