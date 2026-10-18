import React, { useRef, useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { supabase } from '../contexts/AuthContext';
import { HOMEPAGE_IMAGE_ACCEPT, uploadHomepageImageFile } from '../lib/homepageImageUpload';

interface Props {
  /** Receives the public URL once the image is stored. */
  onUploaded: (url: string) => void;
  hasImage?: boolean;
}

/** "Upload from device" for homepage banner images; fills the URL field it sits next to. */
export default function HomepageImageUploadButton({ onUploaded, hasImage }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    const { url, error: uploadError } = await uploadHomepageImageFile(supabase, file);
    setUploading(false);
    if (uploadError || !url) {
      setError(uploadError || 'Upload failed');
      return;
    }
    onUploaded(url);
  };

  return (
    <div className="space-y-1">
      <input ref={inputRef} type="file" accept={HOMEPAGE_IMAGE_ACCEPT} className="hidden" onChange={handleChange} />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-[36px] items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-60"
      >
        {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {uploading ? 'Uploading…' : hasImage ? 'Replace from device' : 'Upload from device'}
      </button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
