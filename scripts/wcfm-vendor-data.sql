-- ============================================================
--  Vendor Data Extraction Queries  (WCFM + Dokan hybrid install)
--  Table prefix: wqpm_
--  Confirmed tables:
--    wqpm_wcfm_marketplace_product_multivendor  ← product→vendor map
--    wqpm_wcfm_marketplace_vendor_ledger        ← financials
--    wqpm_dokan_orders / vendor_balance / etc.
--  Vendor profile data lives in wqpm_usermeta (no separate vendor table)
-- ============================================================


-- ────────────────────────────────────────────────────────────
-- 1.  Inspect the WCFM multivendor table structure
--     (tells us the exact column names before we query it)
-- ────────────────────────────────────────────────────────────
DESCRIBE wqpm_wcfm_marketplace_product_multivendor;


-- ────────────────────────────────────────────────────────────
-- 2.  All distinct vendors from the WCFM product→vendor table
--     + their real WP user email and store metadata
-- ────────────────────────────────────────────────────────────
SELECT
    mv.vendor_id                AS wp_vendor_id,
    u.user_email                AS real_email,
    u.display_name              AS display_name,
    um_sname.meta_value         AS store_name,
    um_ph.meta_value            AS store_phone,
    um_addr.meta_value          AS store_address,
    um_city.meta_value          AS store_city,
    um_state.meta_value         AS store_state,
    um_logo.meta_value          AS store_logo_attachment_id,
    COUNT(mv.product_id)        AS product_count
FROM (
    SELECT DISTINCT vendor_id, product_id
    FROM wqpm_wcfm_marketplace_product_multivendor
) mv
JOIN wqpm_users u ON u.ID = mv.vendor_id
LEFT JOIN wqpm_usermeta um_sname  ON um_sname.user_id  = mv.vendor_id AND um_sname.meta_key  = 'store_name'
LEFT JOIN wqpm_usermeta um_ph     ON um_ph.user_id     = mv.vendor_id AND um_ph.meta_key     = 'store_phone'
LEFT JOIN wqpm_usermeta um_addr   ON um_addr.user_id   = mv.vendor_id AND um_addr.meta_key   = 'store_address1'
LEFT JOIN wqpm_usermeta um_city   ON um_city.user_id   = mv.vendor_id AND um_city.meta_key   = 'store_city'
LEFT JOIN wqpm_usermeta um_state  ON um_state.user_id  = mv.vendor_id AND um_state.meta_key  = 'store_state'
LEFT JOIN wqpm_usermeta um_logo   ON um_logo.user_id   = mv.vendor_id AND um_logo.meta_key   = '_wcfmmp_profile_logo'
GROUP BY mv.vendor_id, u.user_email, u.display_name,
         um_sname.meta_value, um_ph.meta_value, um_addr.meta_value,
         um_city.meta_value, um_state.meta_value, um_logo.meta_value
ORDER BY mv.vendor_id;


-- ────────────────────────────────────────────────────────────
-- 3.  All usermeta keys for vendors — run this if Query 2
--     shows empty store_name/phone (helps find the right keys)
-- ────────────────────────────────────────────────────────────
SELECT DISTINCT meta_key
FROM wqpm_usermeta
WHERE user_id IN (
    SELECT DISTINCT vendor_id FROM wqpm_wcfm_marketplace_product_multivendor
)
AND meta_key NOT LIKE 'session_%'
AND meta_key NOT LIKE '_transient_%'
ORDER BY meta_key;


-- ────────────────────────────────────────────────────────────
-- 4.  All vendor usermeta values (the full dump)
--     Replace the IN list with actual vendor IDs from Query 2
-- ────────────────────────────────────────────────────────────
SELECT
    um.user_id,
    u.user_email,
    um.meta_key,
    LEFT(um.meta_value, 200) AS meta_value_preview
FROM wqpm_usermeta um
JOIN wqpm_users u ON u.ID = um.user_id
WHERE um.user_id IN (
    SELECT DISTINCT vendor_id FROM wqpm_wcfm_marketplace_product_multivendor
)
AND um.meta_key IN (
    'store_name',
    'store_phone',
    'store_address1',
    'store_city',
    'store_state',
    'store_postcode',
    'store_country',
    '_wcfmmp_profile_logo',
    '_wcfmmp_profile_banner',
    'wcfmmp_profile_settings',
    'dokan_profile_settings',
    'ppp_title',
    'wcfm_commission'
)
ORDER BY um.user_id, um.meta_key;


-- ────────────────────────────────────────────────────────────
-- 5.  Products per vendor with status (shows drafts too)
-- ────────────────────────────────────────────────────────────
SELECT
    mv.vendor_id,
    u.user_email,
    p.post_status,
    COUNT(*)        AS product_count
FROM wqpm_wcfm_marketplace_product_multivendor mv
JOIN wqpm_posts p  ON p.ID = mv.product_id AND p.post_type = 'product'
JOIN wqpm_users u  ON u.ID = mv.vendor_id
GROUP BY mv.vendor_id, u.user_email, p.post_status
ORDER BY mv.vendor_id, p.post_status;


-- ────────────────────────────────────────────────────────────
-- 6.  Draft products with vendor + SKU (for migration)
-- ────────────────────────────────────────────────────────────
SELECT
    mv.vendor_id,
    u.user_email        AS vendor_email,
    p.ID                AS product_id,
    p.post_title        AS product_name,
    p.post_status,
    pm_sku.meta_value   AS sku,
    pm_price.meta_value AS price
FROM wqpm_wcfm_marketplace_product_multivendor mv
JOIN wqpm_posts p      ON p.ID = mv.product_id AND p.post_type = 'product' AND p.post_status = 'draft'
JOIN wqpm_users u      ON u.ID = mv.vendor_id
LEFT JOIN wqpm_postmeta pm_sku   ON pm_sku.post_id   = p.ID AND pm_sku.meta_key   = '_sku'
LEFT JOIN wqpm_postmeta pm_price ON pm_price.post_id = p.ID AND pm_price.meta_key = '_price'
ORDER BY mv.vendor_id, p.ID;


-- ────────────────────────────────────────────────────────────
-- 7.  Resolve logo attachment ID → actual file URL
-- ────────────────────────────────────────────────────────────
SELECT
    um.user_id         AS wp_vendor_id,
    um.meta_value      AS attachment_id,
    p.guid             AS logo_url
FROM wqpm_usermeta um
JOIN wqpm_posts p
    ON p.ID = CAST(um.meta_value AS UNSIGNED)
    AND p.post_type = 'attachment'
WHERE um.meta_key = '_wcfmmp_profile_logo'
  AND um.meta_value REGEXP '^[0-9]+$'
  AND um.user_id IN (
      SELECT DISTINCT vendor_id FROM wqpm_wcfm_marketplace_product_multivendor
  );
