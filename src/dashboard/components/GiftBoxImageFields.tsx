import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Star, Trash2, Upload } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { GIFT_IMAGE_ACCEPT, uploadGiftBoxImageFile } from '../lib/giftImageUpload';

type Props = {
  coverUrl: string;
  galleryUrls: string[];
  onCoverChange: (url: string) => void;
  onGalleryChange: (urls: string[]) => void;
  onError?: (message: string) => void;
};

export default function GiftBoxImageFields({
  coverUrl,
  galleryUrls,
  onCoverChange,
  onGalleryChange,
  onError,
}: Props) {
  const coverInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCover, setUploadingCover] = useState(false);
  const [uploadingGallery, setUploadingGallery] = useState(false);

  const uploadFile = async (file: File): Promise<string | null> => {
    const { url, error } = await uploadGiftBoxImageFile(supabase, file);
    if (error) {
      onError?.(error);
      return null;
    }
    return url;
  };

  const handleCoverUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploadingCover(true);
    const url = await uploadFile(file);
    setUploadingCover(false);
    if (url) onCoverChange(url);
  };

  const handleGalleryUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    e.target.value = '';
    if (!files.length) return;
    setUploadingGallery(true);
    const uploaded: string[] = [];
    for (const file of files) {
      const url = await uploadFile(file);
      if (url) uploaded.push(url);
    }
    setUploadingGallery(false);
    if (uploaded.length) onGalleryChange([...galleryUrls, ...uploaded]);
  };

  const setAsCover = (url: string) => {
    const rest = galleryUrls.filter((u) => u !== url);
    if (coverUrl && coverUrl !== url) rest.unshift(coverUrl);
    onGalleryChange(rest);
    onCoverChange(url);
  };

  const removeGallery = (url: string) => {
    onGalleryChange(galleryUrls.filter((u) => u !== url));
  };

  return (
    <div className="space-y-4 rounded-xl border border-gray-200 bg-gray-50/80 p-4">
      <div>
        <p className="text-sm font-semibold text-gray-900">Cover image</p>
        <p className="mt-0.5 text-xs text-gray-500">Shown on the catalog and gift box page.</p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-xl border border-gray-200 bg-white">
          {coverUrl ? (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img src={coverUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-gray-300">
              <ImagePlus className="h-8 w-8" />
            </div>
          )}
          {uploadingCover ? (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80">
              <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={coverInputRef}
            type="file"
            accept={GIFT_IMAGE_ACCEPT}
            className="hidden"
            onChange={handleCoverUpload}
          />
          <button
            type="button"
            disabled={uploadingCover}
            onClick={() => coverInputRef.current?.click()}
            className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            <Upload className="h-4 w-4" />
            {coverUrl ? 'Replace from device' : 'Upload from device'}
          </button>
          <label className="block">
            <span className="sr-only">Cover image URL</span>
            <input
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="Or paste image URL"
              value={coverUrl}
              onChange={(e) => onCoverChange(e.target.value.trim())}
            />
          </label>
        </div>
      </div>

      <div className="border-t border-gray-200 pt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-gray-900">Additional images</p>
            <p className="text-xs text-gray-500">Optional gallery on the gift box page.</p>
          </div>
          <input
            ref={galleryInputRef}
            type="file"
            accept={GIFT_IMAGE_ACCEPT}
            multiple
            className="hidden"
            onChange={handleGalleryUpload}
          />
          <button
            type="button"
            disabled={uploadingGallery}
            onClick={() => galleryInputRef.current?.click()}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-800 hover:bg-gray-50 disabled:opacity-60"
          >
            {uploadingGallery ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="h-3.5 w-3.5" />
            )}
            Add photos
          </button>
        </div>

        {galleryUrls.length === 0 ? (
          <p className="rounded-lg border border-dashed border-gray-200 bg-white px-3 py-6 text-center text-xs text-gray-500">
            No extra photos yet — upload from your phone or computer.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {galleryUrls.map((url) => (
              <li key={url} className="group relative aspect-square overflow-hidden rounded-lg border border-gray-200 bg-white">
                {/* eslint-disable-next-line jsx-a11y/alt-text */}
                <img src={url} alt="" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 flex gap-0.5 bg-black/55 p-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100">
                  <button
                    type="button"
                    title="Set as cover"
                    onClick={() => setAsCover(url)}
                    className="flex flex-1 items-center justify-center rounded py-1 text-white hover:bg-white/20"
                  >
                    <Star className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    title="Remove"
                    onClick={() => removeGallery(url)}
                    className="flex flex-1 items-center justify-center rounded py-1 text-white hover:bg-white/20"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
