import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import { Globe } from 'lucide-preact';
import type { Cipher } from '@/lib/types';
import {
  getWebsiteIconStatus,
  markWebsiteIconErrored,
  markWebsiteIconLoaded,
  preloadWebsiteIcon,
  subscribeWebsiteIconStatus,
} from '@/lib/website-icon-cache';
import { firstCipherUri, hostFromUri, websiteIconUrl } from '@/lib/website-utils';

const ICON_LOAD_ROOT_MARGIN = '180px 0px';

interface WebsiteIconProps {
  cipher: Cipher;
  fallback?: ComponentChildren;
}

export default function WebsiteIcon(props: WebsiteIconProps) {
  const host = useMemo(() => hostFromUri(firstCipherUri(props.cipher)), [props.cipher]);
  const src = host ? websiteIconUrl(host) : '';
  const nodeRef = useRef<HTMLSpanElement | null>(null);
  const [shouldLoad, setShouldLoad] = useState(() => (host ? getWebsiteIconStatus(host) === 'loaded' : true));
  const [status, setStatus] = useState(() => (host ? getWebsiteIconStatus(host) : 'idle'));

  useEffect(() => {
    if (!host) {
      setShouldLoad(true);
      setStatus('idle');
      return;
    }
    const nextStatus = getWebsiteIconStatus(host);
    setShouldLoad(nextStatus === 'loaded');
    setStatus(nextStatus);
    return subscribeWebsiteIconStatus(host, setStatus);
  }, [host]);

  useEffect(() => {
    if (!host || shouldLoad || status === 'loaded' || status === 'error') return;
    const node = nodeRef.current;
    if (!node) return;
    if (typeof IntersectionObserver !== 'function') {
      setShouldLoad(true);
      return;
    }

    let cancelled = false;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue;
          if (!cancelled) setShouldLoad(true);
          observer.disconnect();
          break;
        }
      },
      { rootMargin: ICON_LOAD_ROOT_MARGIN }
    );

    observer.observe(node);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [host, shouldLoad, status]);

  useEffect(() => {
    if (!host || !src || !shouldLoad || status === 'loaded' || status === 'error') return;
    let disposed = false;
    void preloadWebsiteIcon(host, src).then((nextStatus) => {
      if (!disposed) setStatus(nextStatus);
    });
    return () => {
      disposed = true;
    };
  }, [host, src, shouldLoad, status]);

  if (!host || status === 'error') {
    return <span className="list-icon-fallback">{props.fallback ?? <Globe size={18} />}</span>;
  }

  return (
    <span className="list-icon-stack" ref={nodeRef}>
      {status !== 'loaded' && <span className="list-icon-fallback">{props.fallback ?? <Globe size={18} />}</span>}
      {status === 'loaded' && (
        <img
          className="list-icon loaded"
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => markWebsiteIconLoaded(host)}
          onError={() => markWebsiteIconErrored(host)}
        />
      )}
    </span>
  );
}
