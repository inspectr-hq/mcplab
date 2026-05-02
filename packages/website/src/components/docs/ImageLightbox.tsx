import React from 'react';
import { useState, useEffect, useCallback } from 'react';
import { X } from 'lucide-react';

const ImageLightbox = () => {
  const [src, setSrc] = useState<string | null>(null);
  const [alt, setAlt] = useState('');

  const close = useCallback(() => setSrc(null), []);

  useEffect(() => {
    const handler = (e: Event) => {
      const { src, alt } = (e as CustomEvent<{ src: string; alt: string }>).detail;
      setSrc(src);
      setAlt(alt);
    };
    document.addEventListener('open-lightbox', handler);
    return () => document.removeEventListener('open-lightbox', handler);
  }, []);

  useEffect(() => {
    if (!src) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [src, close]);

  if (!src) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
      onClick={close}
    >
      <button
        onClick={close}
        className="absolute right-4 top-4 rounded-full bg-background/80 p-2 text-foreground shadow backdrop-blur transition-colors hover:bg-background"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={src}
        alt={alt}
        className="max-h-[90vh] max-w-[90vw] rounded-xl border border-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
};

export default ImageLightbox;
