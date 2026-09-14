-- Add a "Print waybill" link to the vendor shipment-ready emails, alongside
-- the existing "Print shipping label" link. Both now require a signed print
-- token (see netlify/functions/services/printToken.js) instead of a Bearer
-- JWT, so the vendor can open them straight from the email with no login.
update email_templates
set
  html_content = replace(
    replace(
      html_content,
      '<p style="margin:12px 0 0 0"><a href="{{label_url}}" style="color:#7c3aed;font-weight:600">Print shipping label</a></p>',
      '<p style="margin:12px 0 0 0"><a href="{{label_url}}" style="color:#7c3aed;font-weight:600">Print shipping label</a></p>' || chr(13) || chr(10) || '    <p style="margin:8px 0 0 0"><a href="{{waybill_url}}" style="color:#7c3aed;font-weight:600">Print waybill</a></p>'
    ),
    '<li>Print the label and stick it on the package</li>',
    '<li>Print the label and stick it on the package</li>' || chr(13) || chr(10) || '    <li>Print the waybill for your records</li>'
  ),
  text_content = replace(
    text_content,
    'Print label: {{label_url}}.',
    'Print label: {{label_url}}. Print waybill: {{waybill_url}}.'
  )
where name in ('Vendor Shipment Ready Fez Pickup', 'Vendor Shipment Ready Fez Hub')
  and html_content not like '%{{waybill_url}}%';
