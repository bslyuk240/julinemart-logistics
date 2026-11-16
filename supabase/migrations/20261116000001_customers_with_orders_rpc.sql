-- Buyers-only customer list for the public service API (customers.list).
-- Orders link to customers by phone (no FK), so group paid orders by the last
-- 10 digits of the phone number. Email is deliberately not returned.
create or replace function public.list_customers_with_orders(
  p_limit int default 25,
  p_offset int default 0,
  p_since timestamptz default null,
  p_q text default null
)
returns table (
  customer_id uuid,
  first_name text,
  last_name text,
  phone text,
  order_count bigint,
  total_spent numeric,
  first_order_at timestamptz,
  last_order_at timestamptz,
  total_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  with paid as (
    select right(regexp_replace(o.customer_phone, '\D', '', 'g'), 10) as key,
           max(o.customer_name) as order_name,
           max(o.customer_phone) as order_phone,
           count(*) as order_count,
           coalesce(sum(o.total_amount), 0) as total_spent,
           min(o.created_at) as first_order_at,
           max(o.created_at) as last_order_at
    from public.orders o
    where o.payment_status = 'paid'
      and length(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')) >= 7
    group by 1
  ),
  joined as (
    select c.id as customer_id, c.first_name, c.last_name, c.phone,
           p.order_count, p.total_spent, p.first_order_at, p.last_order_at, p.order_name, p.order_phone
    from paid p
    left join lateral (
      select * from public.customers c2
      where right(regexp_replace(coalesce(c2.phone, ''), '\D', '', 'g'), 10) = p.key
      order by c2.created_at asc
      limit 1
    ) c on true
  ),
  filtered as (
    select * from joined j
    where (p_since is null or j.last_order_at >= p_since)
      and (p_q is null or p_q = ''
           or coalesce(j.first_name, '') || ' ' || coalesce(j.last_name, '') || ' ' || coalesce(j.order_name, '') ilike '%' || p_q || '%')
  )
  select f.customer_id,
         coalesce(f.first_name, split_part(f.order_name, ' ', 1)),
         coalesce(f.last_name, nullif(trim(substr(f.order_name, length(split_part(f.order_name, ' ', 1)) + 1)), '')),
         coalesce(f.phone, f.order_phone), f.order_count, f.total_spent, f.first_order_at, f.last_order_at,
         count(*) over () as total_count
  from filtered f
  order by f.last_order_at desc
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

revoke all on function public.list_customers_with_orders(int, int, timestamptz, text) from public, anon, authenticated;
grant execute on function public.list_customers_with_orders(int, int, timestamptz, text) to service_role;
