import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Loader, Trash2 } from 'lucide-react';
import { supabase } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { CampaignAiAssistant, type CampaignAiResult } from '../components/CampaignAiAssistant';
import { Sheet } from '../Sheet';
import {
  ALL_SECTIONS,
  CampaignWizardForm,
  SectionType,
  WIZARD_STEPS,
  clearCampaignWizardDraft,
  draftHasContent,
  emptyCampaignWizardForm,
  emptySections,
  loadCampaignWizardDraft,
  saveCampaignWizardDraft,
  slugifyCampaign,
} from '../lib/campaignWizardDraft';

interface LookupVoucher {
  id: string;
  code: string;
  campaign_name: string;
}

interface LookupCategory {
  id: string;
  name: string;
  parent_id: string | null;
}

interface LookupVendor {
  id: string;
  store_name: string;
  logo_url: string | null;
  woocommerce_vendor_id: string | null;
}

interface CampaignWizardProps {
  open: boolean;
  editingId: string | null;
  seedForm: CampaignWizardForm | null;
  seedSections?: Record<SectionType, { visible: boolean; order: number }>;
  onClose: () => void;
  onSaved: () => void;
}

const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm text-gray-900';
const labelCls = 'mb-1 block text-xs font-medium text-gray-600';

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

export function CampaignWizard({ open, editingId, seedForm, seedSections, onClose, onSaved }: CampaignWizardProps) {
  const notification = useNotification();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<CampaignWizardForm>(emptyCampaignWizardForm);
  const [sections, setSections] = useState(emptySections);
  const [saving, setSaving] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [vouchers, setVouchers] = useState<LookupVoucher[]>([]);
  const [categories, setCategories] = useState<LookupCategory[]>([]);
  const [vendorsList, setVendorsList] = useState<LookupVendor[]>([]);
  const [aiContext, setAiContext] = useState('');
  const [aiResult, setAiResult] = useState<CampaignAiResult | null>(null);
  const hydratedRef = useRef(false);
  const persistSkipRef = useRef(true);

  const categoryOptions = useMemo(() => {
    const byParent = new Map<string | null, LookupCategory[]>();
    categories.forEach((c) => {
      const key = c.parent_id;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(c);
    });
    byParent.forEach((list) => list.sort((a, b) => a.name.localeCompare(b.name)));

    const result: { id: string; name: string; depth: number }[] = [];
    const visited = new Set<string>();
    function walk(parentId: string | null, depth: number) {
      for (const c of byParent.get(parentId) || []) {
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        result.push({ id: c.id, name: c.name, depth });
        walk(c.id, depth + 1);
      }
    }
    walk(null, 0);
    categories.forEach((c) => {
      if (!visited.has(c.id)) result.push({ id: c.id, name: c.name, depth: 0 });
    });
    return result;
  }, [categories]);

  const loadLookups = useCallback(async () => {
    const [{ data: v }, { data: c }, { data: vend }] = await Promise.all([
      supabase.from('campaign_vouchers').select('id, code, campaign_name').eq('status', 'active'),
      supabase.from('categories').select('id, name, parent_id').order('name'),
      supabase.from('vendors').select('id, store_name, logo_url, woocommerce_vendor_id').eq('is_active', true).order('store_name'),
    ]);
    setVouchers(v || []);
    setCategories(c || []);
    setVendorsList(vend || []);
  }, []);

  // Hydrate form from draft or seed when wizard opens.
  useEffect(() => {
    if (!open) {
      hydratedRef.current = false;
      persistSkipRef.current = true;
      return;
    }
    if (hydratedRef.current) return;
    hydratedRef.current = true;

    void loadLookups();

    const draft = loadCampaignWizardDraft(editingId);
    if (draft && draftHasContent(draft)) {
      setForm(draft.form);
      setSections(draft.sections);
      setStep(Math.min(draft.step, WIZARD_STEPS.length - 1));
      setRestoredDraft(true);
    } else if (seedForm) {
      setForm(seedForm);
      setSections(seedSections || emptySections());
      setStep(0);
      setRestoredDraft(false);
    } else {
      setForm(emptyCampaignWizardForm());
      setSections(emptySections());
      setStep(0);
      setRestoredDraft(false);
    }
    setAiContext('');
    setAiResult(null);

    // Skip persisting the hydration write-back.
    persistSkipRef.current = true;
    requestAnimationFrame(() => {
      persistSkipRef.current = false;
    });
  }, [open, editingId, seedForm, seedSections, loadLookups]);

  // Auto-persist draft on every change while open.
  useEffect(() => {
    if (!open || persistSkipRef.current) return;
    saveCampaignWizardDraft({ editingId, step, form, sections });
  }, [open, editingId, step, form, sections]);

  const patchForm = (patch: Partial<CampaignWizardForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const aiAssistant = (
    <CampaignAiAssistant
      form={form}
      categories={categories}
      aiContext={aiContext}
      onAiContextChange={setAiContext}
      aiResult={aiResult}
      onAiResultChange={setAiResult}
      onApply={patchForm}
    />
  );

  const validateStep = (index: number): boolean => {
    if (index === 0) {
      if (!form.internal_name.trim() || !form.public_title.trim()) {
        notification.error('Required fields', 'Internal name and public title are required');
        return false;
      }
    }
    return true;
  };

  const goNext = () => {
    if (!validateStep(step)) return;
    setStep((s) => Math.min(s + 1, WIZARD_STEPS.length - 1));
  };

  const goBack = () => setStep((s) => Math.max(s - 1, 0));

  const discardDraft = () => {
    if (!window.confirm('Discard this draft? Unsaved changes will be lost.')) return;
    clearCampaignWizardDraft(editingId);
    setForm(emptyCampaignWizardForm());
    setSections(emptySections());
    setStep(0);
    setRestoredDraft(false);
    setAiContext('');
    setAiResult(null);
    onClose();
  };

  const buildPayload = () => {
    const voucher = vouchers.find((v) => v.id === form.offer_voucher_id);
    const selectedVendor = vendorsList.find((v) => v.id === form.target_id);
    const rawStoreLink = form.vendor_store_link.trim();
    const normalizedStoreLink = (() => {
      if (!rawStoreLink) {
        const routeKey = selectedVendor?.woocommerce_vendor_id || form.target_id.trim();
        return routeKey ? `/vendor/${routeKey}` : undefined;
      }
      if (/^https?:\/\//i.test(rawStoreLink) || rawStoreLink.startsWith('/vendor/')) return rawStoreLink;
      return `/vendor/${rawStoreLink.replace(/^\//, '')}`;
    })();

    return {
      internal_name: form.internal_name.trim(),
      public_title: form.public_title.trim(),
      slug: form.slug.trim() || slugifyCampaign(form.public_title),
      campaign_objective: form.campaign_objective.trim() || null,
      status: form.status,
      start_date: form.start_date ? new Date(form.start_date).toISOString() : null,
      end_date: form.end_date ? new Date(form.end_date).toISOString() : null,
      target_type: form.target_type,
      target_id: form.target_id.trim() || null,
      hero_config: {
        headline: form.hero_headline.trim(),
        subtitle: form.hero_subtitle.trim(),
        ctaLabel: form.hero_cta_label.trim() || 'Shop Now',
        badgeText: form.hero_badge_text.trim() || undefined,
        heroImageDesktop: form.hero_image_desktop.trim() || form.hero_image_mobile.trim() || undefined,
        heroImageMobile: form.hero_image_mobile.trim() || form.hero_image_desktop.trim() || undefined,
        introductoryVideoUrl: form.hero_intro_video.trim() || undefined,
      },
      vendor_override:
        form.target_type === 'vendor' && form.target_id.trim()
          ? {
              vendorId: form.target_id.trim(),
              name: form.vendor_name.trim() || undefined,
              story: form.vendor_story.trim() || undefined,
              location: form.vendor_location.trim() || undefined,
              yearsOperating: form.vendor_years_operating === '' ? undefined : Number(form.vendor_years_operating),
              storeLinkUrl: normalizedStoreLink,
              logoUrl: form.vendor_logo.trim() || undefined,
              shopImageUrl: form.vendor_shop_image.trim() || undefined,
              introVideoUrl: form.vendor_intro_video.trim() || undefined,
            }
          : {},
      product_selection_rules: {
        source: form.product_source,
        vendorId: form.target_type === 'vendor' && form.target_id.trim() ? form.target_id.trim() : undefined,
        categoryIds: (() => {
          if (form.product_category_id) return [form.product_category_id];
          if (form.target_type === 'category' && form.target_id.trim()) return [form.target_id.trim()];
          return undefined;
        })(),
        manualProductIds: form.product_manual_ids
          ? form.product_manual_ids.split(',').map((s) => s.trim()).filter(Boolean)
          : undefined,
        minimumRating: form.product_min_rating === '' ? undefined : Number(form.product_min_rating),
        inStockOnly: form.product_in_stock_only,
        discountedOnly: form.product_discounted_only,
        maxProducts: Number(form.product_max_products) || 12,
      },
      review_rules: {
        scope: form.review_scope,
        minimumRating: form.review_min_rating === '' ? undefined : Number(form.review_min_rating),
        maxReviews: Number(form.review_max_reviews) || 5,
        verifiedPurchaseOnly: form.review_verified_only,
      },
      offer_config: voucher
        ? { voucherId: voucher.id, couponCode: voucher.code, displayText: voucher.campaign_name }
        : {},
    };
  };

  const saveSectionsToDb = async (campaignId: string) => {
    await supabase.from('campaign_sections').delete().eq('campaign_id', campaignId);
    const mediaItems = form.media_gallery_items.filter((item) => item.url.trim());
    const rows = ALL_SECTIONS.map((type) => ({
      campaign_id: campaignId,
      section_type: type,
      order_index: sections[type].order,
      is_visible: sections[type].visible,
      config: type === 'media_gallery' ? { items: mediaItems } : {},
    }));
    const { error } = await supabase.from('campaign_sections').insert(rows);
    if (error) throw error;
  };

  const save = async () => {
    if (!validateStep(0)) {
      setStep(0);
      return;
    }
    setSaving(true);
    try {
      const payload = buildPayload();
      let campaignId = editingId;

      if (editingId) {
        const { error } = await supabase.from('campaigns').update(payload).eq('id', editingId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from('campaigns').insert(payload).select('id').single();
        if (error) throw error;
        campaignId = data.id;
      }

      await saveSectionsToDb(campaignId!);
      clearCampaignWizardDraft(editingId);
      notification.success('Saved', editingId ? 'Campaign updated' : 'Campaign created');
      onSaved();
      onClose();
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setSaving(false);
    }
  };

  const currentStep = WIZARD_STEPS[step];
  const progress = ((step + 1) / WIZARD_STEPS.length) * 100;

  const renderStep = () => {
    switch (currentStep.id) {
      case 'overview':
        return (
          <div className="space-y-3">
            <Field label="Internal name *">
              <input
                value={form.internal_name}
                onChange={(e) => patchForm({ internal_name: e.target.value })}
                placeholder="Summer kitchen promo"
                className={inputCls}
                style={{ fontSize: '16px' }}
              />
            </Field>
            <Field label="Public title *">
              <input
                value={form.public_title}
                onChange={(e) =>
                  patchForm({
                    public_title: e.target.value,
                    slug: form.slug || slugifyCampaign(e.target.value),
                  })
                }
                placeholder="Kitchen World Summer Sale"
                className={inputCls}
                style={{ fontSize: '16px' }}
              />
            </Field>
            <Field label="URL slug">
              <input
                value={form.slug}
                onChange={(e) => patchForm({ slug: slugifyCampaign(e.target.value) })}
                placeholder="kitchen-world-summer"
                className={`${inputCls} font-mono`}
                style={{ fontSize: '16px' }}
              />
            </Field>
            <Field label="Objective">
              <textarea
                value={form.campaign_objective}
                onChange={(e) => patchForm({ campaign_objective: e.target.value })}
                rows={2}
                placeholder="Drive traffic to vendor storefront…"
                className={inputCls}
                style={{ fontSize: '16px' }}
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => patchForm({ status: e.target.value as CampaignWizardForm['status'] })}
                className={inputCls}
                style={{ fontSize: '16px' }}
              >
                {(['draft', 'scheduled', 'active', 'paused', 'expired', 'archived'] as const).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Start">
                <input
                  type="datetime-local"
                  value={form.start_date}
                  onChange={(e) => patchForm({ start_date: e.target.value })}
                  className={inputCls}
                  style={{ fontSize: '16px' }}
                />
              </Field>
              <Field label="End">
                <input
                  type="datetime-local"
                  value={form.end_date}
                  onChange={(e) => patchForm({ end_date: e.target.value })}
                  className={inputCls}
                  style={{ fontSize: '16px' }}
                />
              </Field>
            </div>
          </div>
        );

      case 'hero':
        return (
          <div className="space-y-3">
            {aiAssistant}
            <Field label="Headline">
              <input value={form.hero_headline} onChange={(e) => patchForm({ hero_headline: e.target.value })} className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <Field label="Subtitle">
              <textarea value={form.hero_subtitle} onChange={(e) => patchForm({ hero_subtitle: e.target.value })} rows={2} className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <Field label="CTA label">
              <input value={form.hero_cta_label} onChange={(e) => patchForm({ hero_cta_label: e.target.value })} className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <Field label="Badge text">
              <input value={form.hero_badge_text} onChange={(e) => patchForm({ hero_badge_text: e.target.value })} placeholder="Limited time" className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <Field label="Hero image (desktop URL)">
              <input value={form.hero_image_desktop} onChange={(e) => patchForm({ hero_image_desktop: e.target.value })} placeholder="https://…" className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <Field label="Hero image (mobile URL)">
              <input value={form.hero_image_mobile} onChange={(e) => patchForm({ hero_image_mobile: e.target.value })} placeholder="https://…" className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <Field label="Intro video URL">
              <input value={form.hero_intro_video} onChange={(e) => patchForm({ hero_intro_video: e.target.value })} placeholder="https://…" className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
          </div>
        );

      case 'target':
        return (
          <div className="space-y-3">
            {aiAssistant}
            {form.target_type === 'vendor' && !form.vendor_name && (
              <p className="text-xs text-purple-700">Select a vendor below, then regenerate AI copy for a tailored vendor story.</p>
            )}
            <Field label="Target type">
              <select
                value={form.target_type}
                onChange={(e) => {
                  const next = e.target.value as CampaignWizardForm['target_type'];
                  patchForm({
                    target_type: next,
                    target_id: '',
                    product_category_id: '',
                    product_source: next === 'product' ? 'manual' : next === 'vendor' || next === 'category' ? 'rules_based' : form.product_source,
                    review_scope:
                      next === 'vendor' ? 'vendor' : next === 'category' ? 'category' : next === 'product' ? 'product' : form.review_scope,
                  });
                }}
                className={inputCls}
                style={{ fontSize: '16px' }}
              >
                {(['vendor', 'category', 'product', 'collection', 'multi_vendor', 'general'] as const).map((t) => (
                  <option key={t} value={t}>
                    {t.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>

            {form.target_type === 'vendor' && (
              <Field label="Vendor">
                <select
                  value={form.target_id}
                  onChange={(e) => {
                    const v = vendorsList.find((x) => x.id === e.target.value);
                    const routeKey = v?.woocommerce_vendor_id || e.target.value;
                    patchForm({
                      target_id: e.target.value,
                      vendor_name: v?.store_name || '',
                      vendor_logo: v?.logo_url || '',
                      vendor_store_link: routeKey ? `/vendor/${routeKey}` : '',
                      product_category_id: '',
                      review_scope: 'vendor',
                    });
                  }}
                  className={inputCls}
                  style={{ fontSize: '16px' }}
                >
                  <option value="">Select vendor…</option>
                  {vendorsList.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.store_name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {form.target_type === 'category' && (
              <Field label="Category">
                <select value={form.target_id} onChange={(e) => patchForm({ target_id: e.target.value, review_scope: 'category' })} className={inputCls} style={{ fontSize: '16px' }}>
                  <option value="">Select category…</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {'—'.repeat(c.depth)} {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {(form.target_type === 'product' || form.target_type === 'collection') && (
              <Field label="Target ID">
                <input value={form.target_id} onChange={(e) => patchForm({ target_id: e.target.value })} placeholder="UUID or ID" className={inputCls} style={{ fontSize: '16px' }} />
              </Field>
            )}

            {form.target_type === 'vendor' && (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary-600">Vendor story</p>
                <Field label="Display name">
                  <input value={form.vendor_name} onChange={(e) => patchForm({ vendor_name: e.target.value })} className={inputCls} style={{ fontSize: '16px' }} />
                </Field>
                <Field label="Story">
                  <textarea value={form.vendor_story} onChange={(e) => patchForm({ vendor_story: e.target.value })} rows={3} className={inputCls} style={{ fontSize: '16px' }} />
                </Field>
                <Field label="Location">
                  <input value={form.vendor_location} onChange={(e) => patchForm({ vendor_location: e.target.value })} className={inputCls} style={{ fontSize: '16px' }} />
                </Field>
                <Field label="Years operating">
                  <input
                    type="number"
                    min={0}
                    value={form.vendor_years_operating}
                    onChange={(e) => patchForm({ vendor_years_operating: e.target.value === '' ? '' : Number(e.target.value) })}
                    className={inputCls}
                    style={{ fontSize: '16px' }}
                  />
                </Field>
              </>
            )}
          </div>
        );

      case 'products':
        return (
          <div className="space-y-3">
            <Field label="Product source">
              <select value={form.product_source} onChange={(e) => patchForm({ product_source: e.target.value as CampaignWizardForm['product_source'] })} className={inputCls} style={{ fontSize: '16px' }}>
                <option value="automatic">Automatic</option>
                <option value="rules_based">Rules based</option>
                <option value="manual">Manual IDs</option>
              </select>
            </Field>
            {form.product_source !== 'manual' && form.target_type !== 'category' && (
              <Field label="Filter category (optional)">
                <select value={form.product_category_id} onChange={(e) => patchForm({ product_category_id: e.target.value })} className={inputCls} style={{ fontSize: '16px' }}>
                  <option value="">Any category</option>
                  {categoryOptions.map((c) => (
                    <option key={c.id} value={c.id}>
                      {'—'.repeat(c.depth)} {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {form.product_source === 'manual' && (
              <Field label="Product IDs (comma-separated)">
                <textarea value={form.product_manual_ids} onChange={(e) => patchForm({ product_manual_ids: e.target.value })} rows={2} placeholder="id1, id2, …" className={inputCls} style={{ fontSize: '16px' }} />
              </Field>
            )}
            <Field label="Max products">
              <input type="number" min={1} max={48} value={form.product_max_products} onChange={(e) => patchForm({ product_max_products: Number(e.target.value) || 12 })} className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <Field label="Minimum rating">
              <input type="number" min={0} max={5} step={0.1} value={form.product_min_rating} onChange={(e) => patchForm({ product_min_rating: e.target.value === '' ? '' : Number(e.target.value) })} className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.product_in_stock_only} onChange={(e) => patchForm({ product_in_stock_only: e.target.checked })} className="rounded" />
              In stock only
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.product_discounted_only} onChange={(e) => patchForm({ product_discounted_only: e.target.checked })} className="rounded" />
              Discounted only
            </label>
          </div>
        );

      case 'reviews':
        return (
          <div className="space-y-3">
            <Field label="Review scope">
              <select value={form.review_scope} onChange={(e) => patchForm({ review_scope: e.target.value as CampaignWizardForm['review_scope'] })} className={inputCls} style={{ fontSize: '16px' }}>
                {(['product', 'featured_products', 'vendor', 'category', 'mixed'] as const).map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, ' ')}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Minimum rating">
              <input type="number" min={0} max={5} step={0.5} value={form.review_min_rating} onChange={(e) => patchForm({ review_min_rating: e.target.value === '' ? '' : Number(e.target.value) })} className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <Field label="Max reviews">
              <input type="number" min={1} max={20} value={form.review_max_reviews} onChange={(e) => patchForm({ review_max_reviews: Number(e.target.value) || 5 })} className={inputCls} style={{ fontSize: '16px' }} />
            </Field>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={form.review_verified_only} onChange={(e) => patchForm({ review_verified_only: e.target.checked })} className="rounded" />
              Verified purchases only
            </label>
          </div>
        );

      case 'offer':
        return (
          <div className="space-y-3">
            <p className="text-xs text-gray-500">Link an active voucher to show an offer block on the landing page.</p>
            <Field label="Voucher">
              <select value={form.offer_voucher_id} onChange={(e) => patchForm({ offer_voucher_id: e.target.value })} className={inputCls} style={{ fontSize: '16px' }}>
                <option value="">None</option>
                {vouchers.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.code} — {v.campaign_name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        );

      case 'review':
        return (
          <div className="space-y-3 text-sm">
            <div className="rounded-lg bg-gray-50 p-3">
              <p className="font-semibold text-gray-900">{form.public_title || 'Untitled campaign'}</p>
              <p className="text-xs text-gray-500">{form.internal_name}</p>
              <p className="mt-1 font-mono text-xs text-primary-600">/{form.slug || slugifyCampaign(form.public_title) || '…'}</p>
            </div>
            <dl className="space-y-2 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Status</dt>
                <dd className="font-medium capitalize">{form.status}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Target</dt>
                <dd className="font-medium capitalize">{form.target_type.replace(/_/g, ' ')}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Products</dt>
                <dd className="font-medium">{form.product_source} · max {form.product_max_products}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-gray-500">Reviews</dt>
                <dd className="font-medium">{form.review_scope} · up to {form.review_max_reviews}</dd>
              </div>
              {form.offer_voucher_id && (
                <div className="flex justify-between gap-2">
                  <dt className="text-gray-500">Voucher</dt>
                  <dd className="font-medium">{vouchers.find((v) => v.id === form.offer_voucher_id)?.code || 'Linked'}</dd>
                </div>
              )}
            </dl>
            <p className="text-xs text-gray-400">QR codes, analytics & section ordering remain on desktop.</p>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Sheet open={open} onClose={onClose} ariaLabel="Campaign wizard">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-base font-bold">{editingId ? 'Edit campaign' : 'New campaign'}</h3>
          <p className="text-xs text-gray-500">
            Step {step + 1} of {WIZARD_STEPS.length}: {currentStep.title}
          </p>
        </div>
        <button type="button" onClick={discardDraft} className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-red-600" aria-label="Discard draft">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-primary-600 transition-all duration-300" style={{ width: `${progress}%` }} />
      </div>

      {restoredDraft && (
        <p className="rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800">Draft restored — your progress was saved locally.</p>
      )}

      <p className="text-xs text-gray-400">{currentStep.subtitle}</p>

      <div className="min-h-0 flex-1">{renderStep()}</div>

      <div className="flex gap-2 pt-1">
        {step > 0 ? (
          <button type="button" onClick={goBack} className="flex flex-1 items-center justify-center gap-1 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700">
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>
        ) : (
          <button type="button" onClick={onClose} className="flex-1 rounded-xl border border-gray-200 py-3 text-sm font-semibold text-gray-700">
            Close
          </button>
        )}

        {step < WIZARD_STEPS.length - 1 ? (
          <button type="button" onClick={goNext} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white">
            Next
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" disabled={saving} onClick={() => void save()} className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60">
            {saving ? <Loader className="h-4 w-4 animate-spin" /> : null}
            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create campaign'}
          </button>
        )}
      </div>
    </Sheet>
  );
}
