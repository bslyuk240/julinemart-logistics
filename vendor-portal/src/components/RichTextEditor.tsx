/**
 * Rich text editor (contenteditable + execCommand), aligned with JLO dashboard.
 * Preserves HTML from admin imports, including embedded images.
 */

import { useEffect, useRef, useCallback } from 'react';
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  RemoveFormatting,
  ImageIcon,
} from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
}

function isEmptyHtml(html: string): boolean {
  if (!html || !html.trim()) return true;
  try {
    const d = document.createElement('div');
    d.innerHTML = html;
    const text = (d.textContent || '').trim();
    if (text.length > 0) return false;
    return d.querySelector('img, video, iframe, picture') === null;
  } catch {
    return html.replace(/<[^>]*>/g, '').trim() === '';
  }
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write here…',
  minHeight = '120px',
}: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalChange = useRef(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    if (el.innerHTML !== (value || '')) {
      el.innerHTML = value || '';
    }
  }, [value]);

  const exec = (command: string, arg?: string) => {
    editorRef.current?.focus();
    document.execCommand(command, false, arg);
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  };

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      isInternalChange.current = true;
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  }, []);

  const ToolBtn = ({
    onClick,
    title,
    children,
  }: {
    onClick: () => void;
    title: string;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onMouseDown={(ev) => {
        ev.preventDefault();
        onClick();
      }}
      title={title}
      className="p-1.5 rounded hover:bg-gray-200 text-gray-600 hover:text-gray-900 transition-colors"
    >
      {children}
    </button>
  );

  const showPlaceholder = isEmptyHtml(value);

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-primary-500 focus-within:border-primary-500">
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex-wrap">
        <ToolBtn onClick={() => exec('bold')} title="Bold (Ctrl+B)">
          <Bold className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn onClick={() => exec('italic')} title="Italic (Ctrl+I)">
          <Italic className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn onClick={() => exec('underline')} title="Underline (Ctrl+U)">
          <Underline className="w-4 h-4" />
        </ToolBtn>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <ToolBtn onClick={() => exec('insertUnorderedList')} title="Bullet list">
          <List className="w-4 h-4" />
        </ToolBtn>
        <ToolBtn onClick={() => exec('insertOrderedList')} title="Numbered list">
          <ListOrdered className="w-4 h-4" />
        </ToolBtn>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <ToolBtn
          onClick={() => {
            const url = window.prompt('Image URL (https://…)');
            if (!url?.trim()) return;
            exec('insertImage', url.trim());
          }}
          title="Insert image from URL"
        >
          <ImageIcon className="w-4 h-4" />
        </ToolBtn>
        <div className="w-px h-4 bg-gray-300 mx-1" />
        <ToolBtn onClick={() => exec('removeFormat')} title="Clear formatting">
          <RemoveFormatting className="w-4 h-4" />
        </ToolBtn>
      </div>

      <div className="relative">
        {showPlaceholder && (
          <span className="absolute top-3 left-3 text-sm text-gray-400 pointer-events-none select-none z-0">
            {placeholder}
          </span>
        )}
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleInput}
          onPaste={handlePaste}
          style={{ minHeight }}
          className="relative z-[1] px-3 py-2.5 text-sm text-gray-900 outline-none max-w-none
            [&>ul]:list-disc [&>ul]:pl-5 [&>ol]:list-decimal [&>ol]:pl-5
            [&>p]:mb-1 [&>p:last-child]:mb-0
            [&_img]:max-w-full [&_img]:h-auto [&_img]:rounded-md [&_img]:my-2 [&_img]:block"
        />
      </div>
    </div>
  );
}
