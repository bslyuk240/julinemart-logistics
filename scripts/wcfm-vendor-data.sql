-- ============================================================
--  WCFM Vendor Data Extraction Queries
--  Run these on your WordPress MySQL DB (table prefix: wqpm_)
--  to find the real vendor metadata that needs migrating.
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- 0.  First: discover what vendor plugin tables exist
--     Run this to know which plugin is active (WCFM or Dokan)
-- ────────────────────────────────────────────────────────────
SHOW TABLES LIKE 'wqpm_%vendor%';
SHOW TABLES LIKE 'wqpm_dokan%';
SHOW TABLES LIKE 'wqpm_wcfm%';


-- ────────────────────────────────────────────────────────────
-- 1.  All vendor IDs + their WP user data
--     Works regardless of WCFM or Dokan — reads from usermeta
--     (wqpm_wcfm_marketplace_vendors table does NOT exist;
--      all vendor metadata lives in wqpm_usermeta)
-- ────────────────────────────────────────────────────────────
SELECT
    u.ID                      AS wp_user_id,
    u.user_login,
    u.user_email,
    u.display_name,
    u.user_registered,
    um_ph.meta_value           AS store_phone,
    um_addr.meta_value         AS store_address,
    um_city.meta_value         AS store_city,
    um_state.meta_value        AS store_state,
    um_country.meta_value      AS store_country,
    um_logo.meta_value         AS store_logo_id,
    um_banner.meta_value       AS store_banner_id,
    um_sname.meta_value        AS store_name_meta
FROM wqpm_users u
-- vendors have either wcfm_vendor OR seller capability
JOIN wqpm_usermeta cap
    ON cap.user_id = u.ID
    AND cap.meta_key = 'wqpm_capabilities'
    AND (
        cap.meta_value LIKE '%wcfm_vendor%'
        OR cap.meta_value LIKE '%seller%'
    )
LEFT JOIN wqpm_usermeta um_sname  ON um_sname.user_id  = u.ID AND um_sname.meta_key  = 'store_name'
LEFT JOIN wqpm_usermeta um_ph     ON um_ph.user_id     = u.ID AND um_ph.meta_key     = 'store_phone'
LEFT JOIN wqpm_usermeta um_addr   ON um_addr.user_id   = u.ID AND um_addr.meta_key   = 'store_address1'
LEFT JOIN wqpm_usermeta um_city   ON um_city.user_id   = u.ID AND um_city.meta_key   = 'store_city'
LEFT JOIN wqpm_usermeta um_state  ON um_state.user_id  = u.ID AND um_state.meta_key  = 'store_state'
LEFT JOIN wqpm_usermeta um_country ON um_country.user_id = u.ID AND um_country.meta_key = 'store_country'
LEFT JOIN wqpm_usermeta um_logo   ON um_logo.user_id   = u.ID AND um_logo.meta_key   IN ('_wcfmmp_profile_logo', 'dokan_profile_settings')
LEFT JOIN wqpm_usermeta um_banner ON um_banner.user_id = u.ID AND um_banner.meta_key IN ('_wcfmmp_profile_banner', 'dokan_profile_settings')
ORDER BY u.ID;


-- ────────────────────────────────────────────────────────────
-- 2.  WCFM Profile Settings blob (contains EVERYTHING)
--     The wcfmmp_profile_settings usermeta key holds a
--     serialised PHP array with store_name, phone, logo, etc.
--     Run this to dump the raw values — you can inspect them.
-- ────────────────────────────────────────────────────────────
SELECT
    u.ID         AS wp_user_id,
    u.user_email AS wp_email,
    um.meta_key,
    um.meta_value
FROM wqpm_users u
JOIN wqpm_usermeta cap
    ON cap.user_id = u.ID
    AND cap.meta_key = 'wqpm_capabilities'
    AND (cap.meta_value LIKE '%wcfm_vendor%' OR cap.meta_value LIKE '%seller%')
JOIN wqpm_usermeta um
    ON um.user_id = u.ID
    AND um.meta_key IN (
        'wcfmmp_profile_settings',
        '_wcfmmp_profile_logo',
        '_wcfmmp_profile_banner',
        'dokan_profile_settings',  -- Dokan equivalent
        'store_name',
        'store_phone',
        'store_address1',
        'store_city',
        'store_state',
        'store_postcode',
        'store_country',
        'ppp_title',
        'wcfm_commission'
    )
ORDER BY u.ID, um.meta_key;


-- ────────────────────────────────────────────────────────────
-- 3.  Store logos — resolve attachment ID → actual URL
--     First find all vendor logo attachment IDs, then get URLs
-- ────────────────────────────────────────────────────────────
SELECT
    logo_meta.user_id         AS wp_user_id,
    logo_meta.meta_value      AS logo_attachment_id,
    pm.meta_value             AS logo_url
FROM wqpm_usermeta logo_meta
JOIN wqpm_postmeta pm
    ON pm.post_id   = CAST(logo_meta.meta_value AS UNSIGNED)
    AND pm.meta_key = '_wp_attachment_metadata'
WHERE logo_meta.meta_key = '_wcfmmp_profile_logo'
  AND logo_meta.meta_value REGEXP '^[0-9]+$';

-- Alternative: get the full file path from guid
SELECT
    logo_meta.user_id    AS wp_user_id,
    logo_meta.meta_value AS attachment_id,
    p.guid               AS attachment_url
FROM wqpm_usermeta logo_meta
JOIN wqpm_posts p
    ON p.ID = CAST(logo_meta.meta_value AS UNSIGNED)
    AND p.post_type = 'attachment'
WHERE logo_meta.meta_key = '_wcfmmp_profile_logo'
  AND logo_meta.meta_value REGEXP '^[0-9]+$';


-- ────────────────────────────────────────────────────────────
-- 4.  Vendors whose WP email is a real email (not placeholder)
--     Use this to identify which vendors CAN receive invites
-- ────────────────────────────────────────────────────────────
SELECT
    u.ID         AS wp_user_id,
    u.user_email,
    um.meta_value AS store_name_raw
FROM wqpm_users u
JOIN wqpm_usermeta cap
    ON cap.user_id = u.ID
    AND cap.meta_key = 'wqpm_capabilities'
    AND cap.meta_value LIKE '%wcfm_vendor%'
LEFT JOIN wqpm_usermeta um
    ON um.user_id = u.ID
    AND um.meta_key = 'ppp_title'
WHERE u.user_email NOT LIKE '%@wcfm.local'
  AND u.user_email NOT LIKE '%@placeholder%'
  AND u.user_email NOT LIKE '%@localhost%'
ORDER BY u.ID;


-- ────────────────────────────────────────────────────────────
-- 5.  Products that are DRAFT — to understand what the catalog
--     migration missed (these need read+write or admin auth)
-- ────────────────────────────────────────────────────────────
SELECT
    p.ID          AS product_id,
    p.post_title  AS product_name,
    p.post_status,
    p.post_author AS wp_author_id,
    u.user_email  AS author_email,
    pm_sku.meta_value  AS sku,
    pm_price.meta_value AS price
FROM wqpm_posts p
JOIN wqpm_users u ON u.ID = p.post_author
LEFT JOIN wqpm_postmeta pm_sku   ON pm_sku.post_id   = p.ID AND pm_sku.meta_key   = '_sku'
LEFT JOIN wqpm_postmeta pm_price ON pm_price.post_id = p.ID AND pm_price.meta_key = '_price'
WHERE p.post_type   = 'product'
  AND p.post_status = 'draft'
ORDER BY p.post_author, p.ID;


-- ────────────────────────────────────────────────────────────
-- 6.  Quick summary: count by vendor + status
-- ────────────────────────────────────────────────────────────
SELECT
    p.post_author         AS wp_vendor_id,
    u.user_email,
    p.post_status,
    COUNT(*)              AS product_count
FROM wqpm_posts p
JOIN wqpm_users u ON u.ID = p.post_author
WHERE p.post_type = 'product'
GROUP BY p.post_author, u.user_email, p.post_status
ORDER BY p.post_author, p.post_status;


-- ────────────────────────────────────────────────────────────
-- 7.  WCFM bank / payout details (if stored)
-- ────────────────────────────────────────────────────────────
SELECT
    user_id   AS wp_user_id,
    meta_key,
    meta_value
FROM wqpm_usermeta
WHERE meta_key IN (
    'wcfm_withdrawal_method',
    'wcfm_bank_details',
    'wcfm_paypal_email',
    'wcfmmp_withdrawal_setting'
)
ORDER BY user_id;
