/**
 * ImageWithZoom - Component hiển thị ảnh với zoom khi hover
 * Dùng chung cho tất cả các trang có hiển thị ảnh sản phẩm
 * Sử dụng Portal để render zoom image ra ngoài container tránh bị cắt bởi overflow
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

interface ImageWithZoomProps {
  src: string;
  alt: string;
  className?: string;
  zoomSize?: number;
}

export function ImageWithZoom({
  src,
  alt,
  className,
  zoomSize = 280,
}: ImageWithZoomProps) {
  const [showZoom, setShowZoom] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    if (showZoom && imgRef.current) {
      const rect = imgRef.current.getBoundingClientRect();

      // Position zoom to the right of the image
      let top = rect.top;
      let left = rect.right + 8; // 8px gap to the right

      // Check if zoom would go off the right edge of viewport
      if (left + zoomSize > window.innerWidth) {
        // Position to the left of the image instead
        left = rect.left - zoomSize - 8;
      }

      // Check if zoom would go off the left edge
      if (left < 0) {
        left = 8;
      }

      // Check if zoom would go off the bottom
      if (top + zoomSize > window.innerHeight) {
        top = window.innerHeight - zoomSize - 8;
      }

      // Check if zoom would go off the top
      if (top < 0) {
        top = 8;
      }

      setPosition({ top, left });
    }
  }, [showZoom, zoomSize]);

  return (
    <>
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={cn('cursor-pointer', className)}
        onMouseEnter={() => setShowZoom(true)}
        onMouseLeave={() => setShowZoom(false)}
      />
      {showZoom &&
        createPortal(
          <div
            className="fixed bg-white rounded-lg shadow-2xl border-2 border-slate-200 p-1 pointer-events-none"
            style={{
              top: position.top,
              left: position.left,
              width: zoomSize,
              height: zoomSize,
              zIndex: 99999,
            }}
          >
            <img
              src={src}
              alt={alt}
              className="w-full h-full object-contain rounded"
            />
          </div>,
          document.body
        )}
    </>
  );
}

export default ImageWithZoom;
