/**
 * Homepage Content Editor
 *
 * Manages hero slider, announcement banner, and section configs
 * stored in Supabase `homepage_content` table.
 * Replaces the julinemart-pwa WordPress plugin entirely.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../contexts/AuthContext';

// ─── types ────────────────────────────────────────────────────────────────────

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

interface HeroAd {
  image_url: string;
  link: string;
}

interface HeroAds {
  left: HeroAd;
  right: HeroAd;
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
  content: Record<string, any>;
  is_active: boolean;
  display_order: number;
  updated_at: string;
}

// ─── API helper ───────────────────────────────────────────────────────────────

async function getAuthHeader(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  return `Bearer ${data.session?.access_token || ''}`;
}

function endpointUrl(path: string) {
  const base =
    (import.meta as any).env?.VITE_NETLIFY_FUNCTIONS_URL ||
    window.location.origin;
  return `${base.replace(/\/$/, '')}/.netlify/functions/${path}`;
}

async function apiGet<T>(path: string): Promise<T> {
  const auth = await getAuthHeader();
  const res = await fetch(endpointUrl(path), {
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return res.json();
}

async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const auth = await getAuthHeader();
  const res = await fetch(endpointUrl(path), {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} → ${res.status}`);
  return res.json();
}

// ─── sub-components ───────────────────────────────────────────────────────────

function SlideCard({
  slide,
  index,
  total,
  onChange,
  onDelete,
  onMove,
}: {
  slide: HeroSlide;
  index: number;
  total: number;
  onChange: (i: number, patch: Partial<HeroSlide>) => void;
  onDelete: (i: number) => void;
  onMove: (i: number, dir: -1 | 1) => void;
}) {
  return (
    <div style={styles.slideCard}>
      <div style={styles.slideHeader}>
        <span style={styles.slideNum}>Slide {index + 1}</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
            style={styles.iconBtn}
            title="Move up"
          >▲</button>
          <button
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
            style={styles.iconBtn}
            title="Move down"
          >▼</button>
          <button onClick={() => onDelete(index)} style={{ ...styles.iconBtn, color: '#ef4444' }} title="Delete">✕</button>
        </div>
      </div>

      <div style={styles.fieldGrid}>
        <label style={styles.label}>Type</label>
        <select
          value={slide.type}
          onChange={(e) => onChange(index, { type: e.target.value as HeroSlide['type'] })}
          style={styles.select}
        >
          <option value="image">Image</option>
          <option value="video">Video</option>
          <option value="gradient">Gradient</option>
        </select>

        <label style={styles.label}>Media URL</label>
        <input
          value={slide.media_url}
          onChange={(e) => onChange(index, { media_url: e.target.value })}
          placeholder="https://..."
          style={styles.input}
        />

        <label style={styles.label}>Title</label>
        <input
          value={slide.title}
          onChange={(e) => onChange(index, { title: e.target.value })}
          style={styles.input}
        />

        <label style={styles.label}>Description</label>
        <input
          value={slide.description}
          onChange={(e) => onChange(index, { description: e.target.value })}
          style={styles.input}
        />

        <label style={styles.label}>Button Text</label>
        <input
          value={slide.button_text}
          onChange={(e) => onChange(index, { button_text: e.target.value })}
          style={styles.input}
        />

        <label style={styles.label}>Button Link</label>
        <input
          value={slide.button_link}
          onChange={(e) => onChange(index, { button_link: e.target.value })}
          placeholder="/category/..."
          style={styles.input}
        />

        <label style={styles.label}>Overlay Opacity</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={slide.overlay_opacity}
            onChange={(e) => onChange(index, { overlay_opacity: parseFloat(e.target.value) })}
            style={{ flex: 1 }}
          />
          <span style={{ fontSize: 13, minWidth: 32 }}>{(slide.overlay_opacity * 100).toFixed(0)}%</span>
        </div>
      </div>
    </div>
  );
}

// ─── main component ───────────────────────────────────────────────────────────

export default function HomepageContent() {
  const [rows, setRows] = useState<HomepageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Local editable state
  const [slides, setSlides] = useState<HeroSlide[]>([]);
  const [banner, setBanner] = useState<BannerContent>({ enabled: true, text: '' });
  const [heroAds, setHeroAds] = useState<HeroAds>({ left: { image_url: '', link: '' }, right: { image_url: '', link: '' } });
  const [sections, setSections] = useState<HomepageRow[]>([]);

  const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    if (successTimer.current) clearTimeout(successTimer.current);
    successTimer.current = setTimeout(() => setSuccess(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ success: boolean; data: HomepageRow[] }>(
        'catalog-homepage?active_only=false'
      );
      setRows(res.data || []);

      const sliderRow = res.data.find((r) => r.key === 'hero_slider');
      const bannerRow = res.data.find((r) => r.key === 'announcement_bar');
      const heroAdsRow = res.data.find((r) => r.key === 'hero_ads');
      const sectionRows = res.data.filter((r) => r.type === 'section');

      setSlides(sliderRow?.content?.slides ?? []);
      const bc = bannerRow?.content ?? {};
      setBanner({ enabled: Boolean(bc.enabled ?? true), text: bc.text ?? '', bg_color: bc.bg_color, link: bc.link });
      if (heroAdsRow?.content) {
        setHeroAds({
          left: heroAdsRow.content.left ?? { image_url: '', link: '' },
          right: heroAdsRow.content.right ?? { image_url: '', link: '' },
        });
      }
      setSections(sectionRows);
    } catch (e: any) {
      setError(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // ── Slider actions ─────────────────────────────────────────────────────────

  const handleSlideChange = (i: number, patch: Partial<HeroSlide>) => {
    setSlides((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  };

  const handleSlideDelete = (i: number) => {
    setSlides((prev) => prev.filter((_, idx) => idx !== i));
  };

  const handleSlideMove = (i: number, dir: -1 | 1) => {
    setSlides((prev) => {
      const arr = [...prev];
      const j = i + dir;
      if (j < 0 || j >= arr.length) return prev;
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  };

  const addSlide = () => {
    setSlides((prev) => [
      ...prev,
      { type: 'image', media_url: '', title: '', description: '', button_text: '', button_link: '', overlay_opacity: 0.3 },
    ]);
  };

  const saveSlider = async () => {
    setSaving((s) => ({ ...s, hero_slider: true }));
    try {
      await apiPut('catalog-homepage?key=hero_slider', { content: { slides } });
      showSuccess('Hero slider saved');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving((s) => ({ ...s, hero_slider: false }));
    }
  };

  // ── Banner actions ─────────────────────────────────────────────────────────

  const saveBanner = async () => {
    setSaving((s) => ({ ...s, announcement_bar: true }));
    try {
      await apiPut('catalog-homepage?key=announcement_bar', { content: banner });
      showSuccess('Announcement bar saved');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving((s) => ({ ...s, announcement_bar: false }));
    }
  };

  // ── Hero Ads actions ───────────────────────────────────────────────────────

  const saveHeroAds = async () => {
    setSaving((s) => ({ ...s, hero_ads: true }));
    try {
      await apiPut('catalog-homepage?key=hero_ads', { content: heroAds });
      showSuccess('Hero ad banners saved');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving((s) => ({ ...s, hero_ads: false }));
    }
  };

  // ── Section actions ────────────────────────────────────────────────────────

  const saveSection = async (key: string, content: SectionContent, is_active: boolean) => {
    setSaving((s) => ({ ...s, [key]: true }));
    try {
      await apiPut(`catalog-homepage?key=${key}`, { content, is_active });
      showSuccess(`"${content.title}" section saved`);
      setSections((prev) =>
        prev.map((r) => r.key === key ? { ...r, content, is_active } : r)
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving((s) => ({ ...s, [key]: false }));
    }
  };

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading) return <div style={styles.page}><p style={styles.muted}>Loading...</p></div>;

  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Homepage Content</h1>
        <p style={styles.subtitle}>Manage hero slider, announcement bar, and product sections</p>
      </div>

      {error && (
        <div style={styles.errorBanner}>
          {error}
          <button onClick={() => setError(null)} style={styles.closeBannerBtn}>✕</button>
        </div>
      )}
      {success && <div style={styles.successBanner}>{success}</div>}

      {/* ── Hero Slider ─────────────────────────────────────────────────── */}
      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <h2 style={styles.sectionTitle}>Hero Slider</h2>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={addSlide} style={styles.secondaryBtn}>+ Add Slide</button>
            <button onClick={saveSlider} disabled={saving.hero_slider} style={styles.primaryBtn}>
              {saving.hero_slider ? 'Saving...' : 'Save Slider'}
            </button>
          </div>
        </div>

        {slides.length === 0 ? (
          <p style={styles.muted}>No slides yet. Click "+ Add Slide" to create one.</p>
        ) : (
          slides.map((slide, i) => (
            <SlideCard
              key={i}
              slide={slide}
              index={i}
              total={slides.length}
              onChange={handleSlideChange}
              onDelete={handleSlideDelete}
              onMove={handleSlideMove}
            />
          ))
        )}
      </section>

      {/* ── Hero Ad Banners ─────────────────────────────────────────────── */}
      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <div>
            <h2 style={styles.sectionTitle}>Hero Ad Banners</h2>
            <p style={{ ...styles.muted, marginTop: 2 }}>
              Left &amp; right static ads beside the main slider (desktop only). Design at <strong>220 × 371px</strong> or any proportional size.
            </p>
          </div>
          <button onClick={saveHeroAds} disabled={saving.hero_ads} style={styles.primaryBtn}>
            {saving.hero_ads ? 'Saving...' : 'Save Ads'}
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {(['left', 'right'] as const).map((side) => (
            <div key={side} style={styles.slideCard}>
              <p style={{ ...styles.slideNum, marginBottom: 12 }}>{side === 'left' ? '◀ Left Ad' : 'Right Ad ▶'}</p>
              <div style={styles.fieldGrid}>
                <label style={styles.label}>Image URL</label>
                <input
                  value={heroAds[side].image_url}
                  onChange={(e) => setHeroAds((a) => ({ ...a, [side]: { ...a[side], image_url: e.target.value } }))}
                  placeholder="https://res.cloudinary.com/..."
                  style={styles.input}
                />
                <label style={styles.label}>Link</label>
                <input
                  value={heroAds[side].link}
                  onChange={(e) => setHeroAds((a) => ({ ...a, [side]: { ...a[side], link: e.target.value } }))}
                  placeholder="/category/electronics"
                  style={styles.input}
                />
              </div>
              {heroAds[side].image_url && (
                <img
                  src={heroAds[side].image_url}
                  alt={`${side} ad preview`}
                  style={{ marginTop: 12, width: '100%', maxHeight: 140, objectFit: 'cover', borderRadius: 6 }}
                />
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── Announcement Banner ─────────────────────────────────────────── */}
      <section style={styles.section}>
        <div style={styles.sectionHead}>
          <h2 style={styles.sectionTitle}>Announcement Bar</h2>
          <button onClick={saveBanner} disabled={saving.announcement_bar} style={styles.primaryBtn}>
            {saving.announcement_bar ? 'Saving...' : 'Save Banner'}
          </button>
        </div>

        <div style={styles.fieldGrid}>
          <label style={styles.label}>Enabled</label>
          <label style={styles.toggle}>
            <input
              type="checkbox"
              checked={banner.enabled}
              onChange={(e) => setBanner((b) => ({ ...b, enabled: e.target.checked }))}
            />
            <span style={{ marginLeft: 8 }}>{banner.enabled ? 'Visible' : 'Hidden'}</span>
          </label>

          <label style={styles.label}>Text</label>
          <input
            value={banner.text}
            onChange={(e) => setBanner((b) => ({ ...b, text: e.target.value }))}
            placeholder="Free Shipping on orders over ₦10,000"
            style={styles.input}
          />

          <label style={styles.label}>Background Color</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="color"
              value={banner.bg_color || '#1d4ed8'}
              onChange={(e) => setBanner((b) => ({ ...b, bg_color: e.target.value }))}
              style={{ width: 40, height: 32, border: 'none', padding: 0, cursor: 'pointer' }}
            />
            <input
              value={banner.bg_color || '#1d4ed8'}
              onChange={(e) => setBanner((b) => ({ ...b, bg_color: e.target.value }))}
              style={{ ...styles.input, width: 100 }}
            />
          </div>

          <label style={styles.label}>Link (optional)</label>
          <input
            value={banner.link || ''}
            onChange={(e) => setBanner((b) => ({ ...b, link: e.target.value }))}
            placeholder="/sale"
            style={styles.input}
          />
        </div>

        {banner.enabled && banner.text && (
          <div style={{ ...styles.bannerPreview, backgroundColor: banner.bg_color || '#1d4ed8' }}>
            {banner.text}
          </div>
        )}
      </section>

      {/* ── Homepage Sections ────────────────────────────────────────────── */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Product Sections</h2>
        <p style={styles.muted} >Each section pulls products by tag or category slug from the catalog.</p>

        {sections.map((row) => {
          const content = row.content as SectionContent;
          return (
            <SectionEditor
              key={row.key}
              row={row}
              onSave={(c, active) => saveSection(row.key, c, active)}
              saving={!!saving[row.key]}
            />
          );
        })}
      </section>
    </div>
  );
}

function SectionEditor({
  row,
  onSave,
  saving,
}: {
  row: HomepageRow;
  onSave: (content: SectionContent, is_active: boolean) => void;
  saving: boolean;
}) {
  const [content, setContent] = useState<SectionContent>(row.content as SectionContent);
  const [isActive, setIsActive] = useState(row.is_active);

  return (
    <div style={styles.sectionCard}>
      <div style={styles.sectionCardHead}>
        <span style={styles.sectionKey}>{row.key}</span>
        <label style={styles.toggle}>
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          <span style={{ marginLeft: 6, fontSize: 13 }}>{isActive ? 'Active' : 'Hidden'}</span>
        </label>
      </div>

      <div style={styles.fieldGrid}>
        <label style={styles.label}>Section Title</label>
        <input
          value={content.title}
          onChange={(e) => setContent((c) => ({ ...c, title: e.target.value }))}
          style={styles.input}
        />

        <label style={styles.label}>Tag Slug</label>
        <input
          value={content.tag_slug || ''}
          onChange={(e) => setContent((c) => ({ ...c, tag_slug: e.target.value }))}
          placeholder="flash-sale"
          style={styles.input}
        />

        <label style={styles.label}>Category Slug</label>
        <input
          value={content.category_slug || ''}
          onChange={(e) => setContent((c) => ({ ...c, category_slug: e.target.value }))}
          placeholder="electronics"
          style={styles.input}
        />

        <label style={styles.label}>Display Limit</label>
        <input
          type="number"
          min={1}
          max={50}
          value={content.display_limit}
          onChange={(e) => setContent((c) => ({ ...c, display_limit: parseInt(e.target.value) || 10 }))}
          style={{ ...styles.input, width: 80 }}
        />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
        <button
          onClick={() => onSave(content, isActive)}
          disabled={saving}
          style={styles.primaryBtn}
        >
          {saving ? 'Saving...' : 'Save Section'}
        </button>
      </div>
    </div>
  );
}

// ─── styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: { padding: 24, maxWidth: 860, margin: '0 auto' },
  header: { marginBottom: 28 },
  title: { fontSize: 22, fontWeight: 700, margin: 0 },
  subtitle: { fontSize: 14, color: '#6b7280', marginTop: 4 },
  muted: { color: '#9ca3af', fontSize: 14 },

  section: {
    background: '#fff',
    border: '1px solid #e5e7eb',
    borderRadius: 10,
    padding: 24,
    marginBottom: 20,
  },
  sectionHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 16, fontWeight: 600, margin: 0 },

  slideCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    background: '#f9fafb',
  },
  slideHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  slideNum: { fontWeight: 600, fontSize: 14, color: '#374151' },

  sectionCard: {
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    background: '#f9fafb',
  },
  sectionCardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionKey: { fontWeight: 600, fontSize: 13, color: '#6b7280', fontFamily: 'monospace' },

  fieldGrid: { display: 'grid', gridTemplateColumns: '140px 1fr', gap: '10px 16px', alignItems: 'center' },
  label: { fontSize: 13, fontWeight: 500, color: '#374151' },
  input: {
    width: '100%',
    padding: '7px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
    outline: 'none',
    boxSizing: 'border-box',
  },
  select: {
    padding: '7px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 6,
    fontSize: 14,
  },
  toggle: { display: 'flex', alignItems: 'center', cursor: 'pointer', fontSize: 14 },

  primaryBtn: {
    padding: '8px 18px',
    background: '#2563eb',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer',
  },
  secondaryBtn: {
    padding: '8px 14px',
    background: '#f3f4f6',
    color: '#374151',
    border: '1px solid #d1d5db',
    borderRadius: 7,
    fontSize: 14,
    cursor: 'pointer',
  },
  iconBtn: {
    background: 'none',
    border: '1px solid #e5e7eb',
    borderRadius: 4,
    padding: '2px 6px',
    cursor: 'pointer',
    fontSize: 12,
    color: '#6b7280',
  },

  errorBanner: {
    background: '#fee2e2',
    border: '1px solid #fca5a5',
    color: '#b91c1c',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 16,
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: 14,
  },
  successBanner: {
    background: '#d1fae5',
    border: '1px solid #6ee7b7',
    color: '#065f46',
    borderRadius: 8,
    padding: '10px 14px',
    marginBottom: 16,
    fontSize: 14,
  },
  closeBannerBtn: { background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c', fontWeight: 700 },

  bannerPreview: {
    marginTop: 14,
    padding: '10px 16px',
    borderRadius: 6,
    color: '#fff',
    fontSize: 14,
    textAlign: 'center',
  },
};
