import type { ComponentChildren } from 'preact';
import { APP_VERSION } from '@shared/app-version';

interface StandalonePageFrameProps {
  title: string;
  eyebrow?: ComponentChildren;
  children: ComponentChildren;
}

export default function StandalonePageFrame(props: StandalonePageFrameProps) {
  return (
    <div className="standalone-shell">
      <div className="standalone-brand standalone-brand-outside">
        <img src="/nodewarden-logo.svg" alt="NodeWarden logo" className="standalone-brand-logo" />
        <div>
          <span className="standalone-brand-wordmark" role="img" aria-label="NodeWarden" />
        </div>
      </div>

      <div className="auth-card">
        {props.eyebrow && <div className="standalone-eyebrow">{props.eyebrow}</div>}
        <h1 className="standalone-title">{props.title}</h1>
        {props.children}
      </div>

      <div className="standalone-footer">
        <a href="https://github.com/shuaiplus/NodeWarden" target="_blank" rel="noreferrer">NodeWarden Repository</a>
        <span> | </span>
        <a href="https://github.com/shuaiplus" target="_blank" rel="noreferrer">Author: @shuaiplus</a>
        <span> | </span>
        <a
          href="https://github.com/shuaiplus/NodeWarden/releases/latest"
          target="_blank"
          rel="noreferrer"
          className="standalone-version"
        >
          v{APP_VERSION}
        </a>
      </div>
    </div>
  );
}
