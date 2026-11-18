-- Tell customers, in the confirmation email, about the email fingerprint we keep.
update public.email_templates
set html_content = replace(html_content,
      'with your name, phone and address removed. This cannot be undone.',
      'with your name, phone and address removed. We also keep a one-way fingerprint of your email (never the address itself) so sign-up and referral rewards cannot be claimed twice. This cannot be undone.'),
    updated_at = now()
where type = 'account_deletion_confirm'
  and html_content like '%with your name, phone and address removed. This cannot be undone.%';
