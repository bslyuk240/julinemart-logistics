import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader, Sparkles } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import type { CampaignWizardForm } from '../lib/campaignWizardDraft';

export interface CampaignAiResult {
  headline: string;
  subtitle: string;
  badge_text: string;
  cta_label: string;
  vendor_story: string;
}

interface LookupCategory {
  id: string;
  name: string;
}

interface CampaignAiAssistantProps {
  form: Pick<
    CampaignWizardForm,
    | 'public_title'
    | 'campaign_objective'
    | 'target_type'
    | 'vendor_name'
    | 'product_category_id'
    | 'hero_headline'
    | 'hero_subtitle'
    | 'hero_badge_text'
    | 'hero_cta_label'
    | 'vendor_story'
  >;
  categories: LookupCategory[];
  aiContext: string;
  onAiContextChange: (value: string) => void;
  aiResult: CampaignAiResult | null;
  onAiResultChange: (value: CampaignAiResult | null) => void;
  onApply: (patch: Partial<CampaignWizardForm>) => void;
}

export function CampaignAiAssistant({
  form,
  categories,
  aiContext,
  onAiContextChange,
  aiResult,
  onAiResultChange,
  onApply,
}: CampaignAiAssistantProps) {
  const { session } = useAuth();
  const notification = useNotification();
  const [aiOpen, setAiOpen] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);

  async function generateCampaignAiDraft() {
    if (!session?.access_token) {
      notification.error('Unauthorized', 'Please sign in again.');
      return;
    }
    setAiGenerating(true);
    onAiResultChange(null);
    try {
      const functionsBase = import.meta.env.VITE_NETLIFY_FUNCTIONS_BASE || '/.netlify/functions';
      const categoryName = categories.find((c) => c.id === form.product_category_id)?.name || '';
      const res = await fetch(`${functionsBase}/admin-ai-campaign-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          public_title: form.public_title,
          campaign_objective: form.campaign_objective,
          target_type: form.target_type,
          vendor_name: form.vendor_name,
          category_name: categoryName,
          context: aiContext,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'AI draft failed');
      onAiResultChange(json.data as CampaignAiResult);
    } catch (err) {
      notification.error('AI Draft', err instanceof Error ? err.message : 'Failed to generate draft');
    } finally {
      setAiGenerating(false);
    }
  }

  function applyAll() {
    if (!aiResult) return;
    onApply({
      hero_headline: aiResult.headline || form.hero_headline,
      hero_subtitle: aiResult.subtitle || form.hero_subtitle,
      hero_badge_text: aiResult.badge_text || form.hero_badge_text,
      hero_cta_label: aiResult.cta_label || form.hero_cta_label,
      vendor_story:
        form.target_type === 'vendor' && aiResult.vendor_story ? aiResult.vendor_story : form.vendor_story,
    });
    notification.success('Applied', 'AI suggestions applied to the form');
  }

  const suggestions: Array<{
    key: string;
    label: string;
    value: string;
    apply: () => void;
  }> = aiResult
    ? [
        { key: 'headline', label: 'Headline', value: aiResult.headline, apply: () => onApply({ hero_headline: aiResult.headline }) },
        { key: 'subtitle', label: 'Subtitle', value: aiResult.subtitle, apply: () => onApply({ hero_subtitle: aiResult.subtitle }) },
        { key: 'badge_text', label: 'Badge text', value: aiResult.badge_text, apply: () => onApply({ hero_badge_text: aiResult.badge_text }) },
        { key: 'cta_label', label: 'CTA label', value: aiResult.cta_label, apply: () => onApply({ hero_cta_label: aiResult.cta_label }) },
        ...(form.target_type === 'vendor' && aiResult.vendor_story
          ? [
              {
                key: 'vendor_story',
                label: 'Vendor story',
                value: aiResult.vendor_story,
                apply: () => onApply({ vendor_story: aiResult.vendor_story }),
              },
            ]
          : []),
      ].filter((s) => s.value)
    : [];

  return (
    <div className="overflow-hidden rounded-xl border border-purple-200 bg-purple-50/40">
      <button
        type="button"
        onClick={() => setAiOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-3 text-left transition-colors hover:bg-purple-50"
      >
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-purple-800">
            <Sparkles className="h-4 w-4 shrink-0 text-purple-500" />
            Draft landing page copy with AI
          </span>
          <span className="text-xs font-normal text-purple-500">Headline, subtitle, vendor story &amp; more</span>
        </span>
        {aiOpen ? <ChevronUp className="h-4 w-4 shrink-0 text-purple-400" /> : <ChevronDown className="h-4 w-4 shrink-0 text-purple-400" />}
      </button>

      {aiOpen && (
        <div className="space-y-3 border-t border-purple-200 px-3 pb-3">
          <div className="pt-3">
            <label className="mb-1 block text-xs font-medium text-gray-600">
              Extra context <span className="text-gray-400">(optional — e.g. &quot;30% off all sneakers this weekend&quot;)</span>
            </label>
            <input
              type="text"
              value={aiContext}
              onChange={(e) => {
                onAiContextChange(e.target.value);
                onAiResultChange(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void generateCampaignAiDraft();
                }
              }}
              placeholder="Describe the promotion in a sentence…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2.5 text-sm focus:ring-2 focus:ring-purple-400"
              style={{ fontSize: '16px' }}
            />
            <p className="mt-1 text-xs text-gray-500">
              Uses the public title, objective, target type{form.vendor_name ? ', vendor name' : ''} and category already filled in above.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void generateCampaignAiDraft()}
            disabled={aiGenerating}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-700 disabled:opacity-60"
          >
            {aiGenerating ? (
              <>
                <Loader className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate
              </>
            )}
          </button>

          {aiResult && suggestions.length > 0 && (
            <div className="space-y-2 rounded-lg border border-purple-200 bg-white p-3">
              {suggestions.map(({ key, label, value, apply }) => (
                <div key={key}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{label}</p>
                      <p className="whitespace-pre-line text-sm text-gray-900">{value}</p>
                    </div>
                    <button
                      type="button"
                      onClick={apply}
                      className="shrink-0 rounded-lg bg-purple-100 px-3 py-1.5 text-xs font-semibold text-purple-700 transition-colors hover:bg-purple-200"
                    >
                      Use
                    </button>
                  </div>
                  <div className="mt-2 border-t border-gray-100" />
                </div>
              ))}
              <button
                type="button"
                onClick={applyAll}
                className="w-full rounded-lg bg-purple-600 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-purple-700"
              >
                Use all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
