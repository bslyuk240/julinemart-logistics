import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Loader, Plus, Trash2 } from 'lucide-react';
import { useNotification } from '../../contexts/NotificationContext';
import { PullToRefresh } from '../PullToRefresh';
import { Sheet } from '../Sheet';
import { TABBAR_SPACE } from '../lib/functionsAuth';
import { catalogFetch, catalogJson } from '../lib/catalogApi';

type Tab = 'slider' | 'banner' | 'sections';

interface HeroSlide {
  type: 'image' | 'video' | 'gradient';
  media_url: string;
  title: string;
  description: string;
  button_text: string;
  button_link: string;
  overlay_opacity: number;
}

interface BannerContent {
  enabled: boolean;
  text: string;
  bg_color?: string;
  link?: string;
}

interface SectionContent {
  title: string;
  tag_slug?: string;
  category_slug?: string;
  display_limit: number;
}

interface HomepageRow {
  id: string;
  type: 'slider' | 'banner' | 'section';
  key: string;
  content: Record<string, unknown>;
  is_active: boolean;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'slider', label: 'Hero slider' },
  { key: 'banner', label: 'Banner' },
  { key: 'sections', label: 'Sections' },
];

const emptySlide = (): HeroSlide => ({
  type: 'image',
  media_url: '',
  title: '',
  description: '',
  button_text: '',
  button_link: '',
  overlay_opacity: 0.3,
});

export default function MobileHomepageContent() {
  const notification = useNotification();
  const [tab, setTab] = useState<Tab>('slider');
  const [loading, setLoading] = useState(true);
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [banner, setBanner] = useState<BannerContent>({ enabled: true, text: '', bg_color: '#1d4ed8' });
  const [sections, setSections] = useState<HomepageRow[]>([]);
  const [saving, setSaving] = useState<string | null>(null);
  const [editSlideIdx, setEditSlideIdx] = useState<number | null>(null);
  const [editSectionKey, setEditSectionKey] = useState<string | null>(null);
  const [newSectionOpen, setNewSectionOpen] = useState(false);
  const [newSectionKey, setNewSectionKey] = useState('');
  const [newSectionTitle, setNewSectionTitle] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await catalogFetch('catalog-homepage?active_only=false');
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Failed to load');
      const rows: HomepageRow[] = json.data || [];
      const sliderRow = rows.find((r) => r.key === 'hero_slider');
      const bannerRow = rows.find((r) => r.key === 'announcement_bar');
      setSlides((sliderRow?.content?.slides as HeroSlide[]) ?? []);
      const bc = bannerRow?.content ?? {};
      setBanner({
        enabled: Boolean(bc.enabled ?? true),
        text: String(bc.text ?? ''),
        bg_color: bc.bg_color ? String(bc.bg_color) : '#1d4ed8',
        link: bc.link ? String(bc.link) : '',
      });
      setSections(rows.filter((r) => r.type === 'section'));
    } catch (err) {
      notification.error('Load failed', err instanceof Error ? err.message : 'Unable to load homepage content');
    } finally {
      setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSlider = async () => {
    setSaving('slider');
    try {
      await catalogJson('catalog-homepage?key=hero_slider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: { slides } }),
      });
      notification.success('Saved', 'Hero slider updated');
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setSaving(null);
    }
  };

  const saveBanner = async () => {
    setSaving('banner');
    try {
      await catalogJson('catalog-homepage?key=announcement_bar', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: banner }),
      });
      notification.success('Saved', 'Announcement bar updated');
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setSaving(null);
    }
  };

  const saveSection = async (key: string, content: SectionContent, is_active: boolean) => {
    setSaving(key);
    try {
      await catalogJson(`catalog-homepage?key=${key}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, is_active }),
      });
      setSections((prev) =>
        prev.map((r) =>
          r.key === key ? { ...r, content: content as unknown as Record<string, unknown>, is_active } : r,
        ),
      );
      notification.success('Saved', `Section "${content.title}" updated`);
      setEditSectionKey(null);
    } catch (err) {
      notification.error('Save failed', err instanceof Error ? err.message : 'Unable to save');
    } finally {
      setSaving(null);
    }
  };

  const addSection = async () => {
    const key = newSectionKey.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key) return;
    try {
      const json = await catalogJson<{ data: HomepageRow }>('catalog-homepage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          content: { title: newSectionTitle.trim() || key, tag_slug: '', display_limit: 10 },
        }),
      });
      setSections((prev) => [...prev, json.data]);
      setNewSectionOpen(false);
      setNewSectionKey('');
      setNewSectionTitle('');
      notification.success('Created', `Section "${key}" added`);
    } catch (err) {
      notification.error('Create failed', err instanceof Error ? err.message : 'Unable to create section');
    }
  };

  const editingSection = editSectionKey ? sections.find((s) => s.key === editSectionKey) : null;

  return (
    <>
      <PullToRefresh onRefresh={load}>
        <div className="space-y-3 p-4" style={{ paddingBottom: TABBAR_SPACE }}>
          <div>
            <h1 className="text-lg font-bold text-gray-900">Homepage Content</h1>
            <p className="text-xs text-gray-500">Hero, banner, and product sections</p>
          </div>

          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`shrink-0 rounded-full px-3.5 py-2 text-sm font-medium ${
                  tab === key ? 'bg-primary-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="flex justify-center py-12">
              <Loader className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : tab === 'slider' ? (
            <div className="space-y-3">
              {slides.length === 0 ? (
                <div className="rounded-xl bg-white p-4 text-sm text-gray-500 ring-1 ring-gray-100">No slides yet.</div>
              ) : (
                slides.map((slide, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setEditSlideIdx(i)}
                    className="flex w-full items-center gap-3 rounded-xl bg-white p-3 text-left ring-1 ring-gray-100"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-100">
                      {slide.media_url ? (
                        <img src={slide.media_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-xs text-gray-400">{i + 1}</span>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-gray-900">{slide.title || `Slide ${i + 1}`}</p>
                      <p className="truncate text-xs text-gray-500">{slide.type}</p>
                    </div>
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (i === 0) return;
                          setSlides((prev) => {
                            const arr = [...prev];
                            [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
                            return arr;
                          });
                        }}
                        className="text-gray-400"
                      >
                        <ChevronUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (i >= slides.length - 1) return;
                          setSlides((prev) => {
                            const arr = [...prev];
                            [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
                            return arr;
                          });
                        }}
                        className="text-gray-400"
                      >
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </div>
                  </button>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  setSlides((prev) => [...prev, emptySlide()]);
                  setEditSlideIdx(slides.length);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-3 text-sm font-semibold text-gray-600"
              >
                <Plus className="h-4 w-4" />
                Add slide
              </button>
              <button
                type="button"
                disabled={saving === 'slider'}
                onClick={saveSlider}
                className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === 'slider' ? 'Saving…' : 'Save slider'}
              </button>
            </div>
          ) : tab === 'banner' ? (
            <div className="space-y-3 rounded-xl bg-white p-4 ring-1 ring-gray-100">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={banner.enabled}
                  onChange={(e) => setBanner((b) => ({ ...b, enabled: e.target.checked }))}
                />
                Show announcement bar
              </label>
              <input
                type="text"
                value={banner.text}
                onChange={(e) => setBanner((b) => ({ ...b, text: e.target.value }))}
                placeholder="Banner text"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
              <input
                type="text"
                value={banner.bg_color || ''}
                onChange={(e) => setBanner((b) => ({ ...b, bg_color: e.target.value }))}
                placeholder="#1d4ed8"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
              <input
                type="text"
                value={banner.link || ''}
                onChange={(e) => setBanner((b) => ({ ...b, link: e.target.value }))}
                placeholder="Link (optional)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
              {banner.enabled && banner.text && (
                <div className="rounded-lg px-3 py-2 text-center text-sm font-medium text-white" style={{ backgroundColor: banner.bg_color || '#1d4ed8' }}>
                  {banner.text}
                </div>
              )}
              <button
                type="button"
                disabled={saving === 'banner'}
                onClick={saveBanner}
                className="w-full rounded-xl bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {saving === 'banner' ? 'Saving…' : 'Save banner'}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {sections.map((row) => {
                const content = row.content as unknown as SectionContent;
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => setEditSectionKey(row.key)}
                    className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left ring-1 ring-gray-100"
                  >
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{content.title || row.key}</p>
                      <p className="text-xs text-gray-500">
                        {row.is_active ? 'Active' : 'Hidden'} · limit {content.display_limit ?? 10}
                      </p>
                    </div>
                  </button>
                );
              })}
              <button
                type="button"
                onClick={() => setNewSectionOpen(true)}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-gray-300 py-3 text-sm font-semibold text-gray-600"
              >
                <Plus className="h-4 w-4" />
                Add section
              </button>
            </div>
          )}
        </div>
      </PullToRefresh>

      {editSlideIdx != null && slides[editSlideIdx] && (
        <Sheet open onClose={() => setEditSlideIdx(null)} ariaLabel="Edit slide">
          <h3 className="text-base font-bold">Slide {editSlideIdx + 1}</h3>
          <div className="space-y-3">
            <select
              value={slides[editSlideIdx].type}
              onChange={(e) =>
                setSlides((prev) =>
                  prev.map((s, i) => (i === editSlideIdx ? { ...s, type: e.target.value as HeroSlide['type'] } : s)),
                )
              }
              className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
              style={{ fontSize: '16px' }}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="gradient">Gradient</option>
            </select>
            {['media_url', 'title', 'description', 'button_text', 'button_link'].map((field) => (
              <input
                key={field}
                type="text"
                value={String((slides[editSlideIdx] as unknown as Record<string, string>)[field] || '')}
                onChange={(e) =>
                  setSlides((prev) =>
                    prev.map((s, i) => (i === editSlideIdx ? { ...s, [field]: e.target.value } : s)),
                  )
                }
                placeholder={field.replace('_', ' ')}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
                style={{ fontSize: '16px' }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => {
              setSlides((prev) => prev.filter((_, i) => i !== editSlideIdx));
              setEditSlideIdx(null);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-red-200 py-2.5 text-sm font-semibold text-red-600"
          >
            <Trash2 className="h-4 w-4" />
            Remove slide
          </button>
        </Sheet>
      )}

      {editingSection && (
        <SectionEditor
          row={editingSection}
          saving={saving === editingSection.key}
          onClose={() => setEditSectionKey(null)}
          onSave={(content, is_active) => saveSection(editingSection.key, content, is_active)}
        />
      )}

      <Sheet open={newSectionOpen} onClose={() => setNewSectionOpen(false)} ariaLabel="New section">
        <h3 className="text-base font-bold">New product section</h3>
        <div className="space-y-3">
          <input
            type="text"
            value={newSectionKey}
            onChange={(e) => setNewSectionKey(e.target.value)}
            placeholder="Key (e.g. trending)"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
          <input
            type="text"
            value={newSectionTitle}
            onChange={(e) => setNewSectionTitle(e.target.value)}
            placeholder="Display title"
            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm"
            style={{ fontSize: '16px' }}
          />
        </div>
        <button type="button" onClick={addSection} className="rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white">
          Create section
        </button>
      </Sheet>
    </>
  );
}

function SectionEditor({
  row,
  saving,
  onClose,
  onSave,
}: {
  row: HomepageRow;
  saving: boolean;
  onClose: () => void;
  onSave: (content: SectionContent, is_active: boolean) => void;
}) {
  const content = row.content as unknown as SectionContent;
  const [title, setTitle] = useState(content.title || '');
  const [tagSlug, setTagSlug] = useState(content.tag_slug || '');
  const [categorySlug, setCategorySlug] = useState(content.category_slug || '');
  const [displayLimit, setDisplayLimit] = useState(String(content.display_limit ?? 10));
  const [isActive, setIsActive] = useState(row.is_active);

  return (
    <Sheet open onClose={onClose} ariaLabel="Edit section">
      <h3 className="text-base font-bold">{row.key}</h3>
      <div className="space-y-3">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        <input type="text" value={tagSlug} onChange={(e) => setTagSlug(e.target.value)} placeholder="Tag slug" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        <input type="text" value={categorySlug} onChange={(e) => setCategorySlug(e.target.value)} placeholder="Category slug" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        <input type="number" value={displayLimit} onChange={(e) => setDisplayLimit(e.target.value)} placeholder="Display limit" className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm" style={{ fontSize: '16px' }} />
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
          Section visible on storefront
        </label>
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={() =>
          onSave(
            {
              title: title.trim(),
              tag_slug: tagSlug.trim() || undefined,
              category_slug: categorySlug.trim() || undefined,
              display_limit: Number(displayLimit) || 10,
            },
            isActive,
          )
        }
        className="rounded-lg bg-primary-600 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save section'}
      </button>
    </Sheet>
  );
}
