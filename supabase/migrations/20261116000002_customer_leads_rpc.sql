-- Full customer/lead list for the public service API (customers.leads.list).
-- Includes email, so it is gated behind its own capability, separate from the
-- buyers-only customers.list. Covers every customers row plus guest buyers
-- (paid orders whose phone matches no customer), with purchase stats by phone.
create or replace function public.list_customer_leads(
  p_limit int default 50,
  p_offset int default 0,
  p_q text default null,
  p_has_ordered boolean default null,
  p_since timestamptz default null
)
returns table (
  customer_id uuid,
  first_name text,
  last_name text,
  email text,
  phone text,
  signed_up_at timestamptz,
  has_ordered boolean,
  order_count bigint,
  total_spent numeric,
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
           max(o.customer_email) as order_email,
           max(o.customer_phone) as order_phone,
           count(*) as order_count,
           coalesce(sum(o.total_amount), 0) as total_spent,
           max(o.created_at) as last_order_at
    from public.orders o
    where o.payment_status = 'paid'
      and length(regexp_replace(coalesce(o.customer_phone, ''), '\D', '', 'g')) >= 7
    group by 1
  ),
  cust as (
    select c.id as customer_id, c.first_name, c.last_name, c.email, c.phone,
           c.created_at as signed_up_at,
           right(regexp_replace(coalesce(c.phone, ''), '\D', '', 'g'), 10) as key
    from public.customers c
  ),
  combined as (
    select c.customer_id, c.first_name, c.last_name, c.email, c.phone, c.signed_up_at,
           (p.key is not null) as has_ordered,
           coalesce(p.order_count, 0) as order_count,
           coalesce(p.total_spent, 0) as total_spent,
           p.last_order_at
    from cust c
    left join paid p on length(c.key) >= 7 and p.key = c.key
    union all
    select null, split_part(p.order_name, ' ', 1),
           nullif(trim(substr(p.order_name, length(split_part(p.order_name, ' ', 1)) + 1)), ''),
           p.order_email, p.order_phone, null, true,
           p.order_count, p.total_spent, p.last_order_at
    from paid p
    where not exists (select 1 from cust c where length(c.key) >= 7 and c.key = p.key)
  ),
  filtered as (
    select * from combined x
    where (p_has_ordered is null or x.has_ordered = p_has_ordered)
      and (p_since is null or coalesce(x.last_order_at, x.signed_up_at) >= p_since)
      and (p_q is null or p_q = ''
           or coalesce(x.first_name, '') || ' ' || coalesce(x.last_name, '') || ' ' || coalesce(x.email, '') ilike '%' || p_q || '%')
  )
  select f.customer_id, f.first_name, f.last_name, f.email, f.phone, f.signed_up_at,
         f.has_ordered, f.order_count, f.total_spent, f.last_order_at,
         count(*) over () as total_count
  from filtered f
  order by coalesce(f.last_order_at, f.signed_up_at) desc nulls last
  limit greatest(1, least(p_limit, 100)) offset greatest(0, p_offset);
$$;

revoke all on function public.list_customer_leads(int, int, text, boolean, timestamptz) from public, anon, authenticated;
grant execute on function public.list_customer_leads(int, int, text, boolean, timestamptz) to service_role;
