import { Edition } from './visual-config.generated';
import { githubIcon, heartIcon, coffeeIcon } from './landing-icons';

export interface LandingLabels {
    headline: string;
    body: string;
    quickStart: string;
    examples: string;
    whatsNew: string;
    sandboxNote: string;
    sandboxNoteLink: string;
    valuesLabel: string;
    valuesField: string;
    valuesHint: string;
    compactBody: string;
    docs: string;
    openDocs: string;
}

export interface LandingUrls {
    docs: string;
    github: string;
    sponsor: string;
    coffee: string;
}

export interface SplashOptions {
    edition: Edition;
    version: string;
    markUrl: string;
    labels: LandingLabels;
    urls: LandingUrls;
    onLaunch: (url: string) => void;
}

interface EditionPresentation {
    suffix: string;
    suffixClass: string;
    accentVar: string;
}

const PRESENTATION: Record<Edition, EditionPresentation> = {
    flagship: { suffix: '', suffixClass: '', accentVar: 'var(--hc-accent-flagship)' },
    secure: {
        suffix: 'Secure',
        suffixClass: 'hc-landing-suffix--secure',
        accentVar: 'var(--hc-accent-secure)'
    },
    standalone: {
        suffix: '(Standalone)',
        suffixClass: 'hc-landing-suffix--standalone',
        accentVar: 'var(--hc-accent-standalone)'
    }
};

const node = (
    doc: Document,
    tag: string,
    cls?: string,
    text?: string
): HTMLElement => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
};

const iconLink = (
    doc: Document,
    cls: string,
    key: string,
    url: string,
    title: string,
    icon: SVGElement,
    onLaunch: (url: string) => void
): HTMLElement => {
    const a = node(doc, 'button', cls);
    a.setAttribute('type', 'button');
    a.setAttribute('title', title);
    a.setAttribute('aria-label', title);
    a.dataset.link = key;
    a.appendChild(icon);
    a.addEventListener('click', () => onLaunch(url));
    return a;
};

const textLink = (
    doc: Document,
    cls: string,
    text: string,
    url: string,
    onLaunch: (url: string) => void
): HTMLElement => {
    const b = node(doc, 'button', cls, text);
    b.setAttribute('type', 'button');
    b.addEventListener('click', () => onLaunch(url));
    return b;
};

export const buildSplash = (doc: Document, opts: SplashOptions): HTMLElement => {
    const { edition, version, markUrl, labels, urls, onLaunch } = opts;
    const p = PRESENTATION[edition];

    const root = node(doc, 'div', 'hc-landing');
    root.style.setProperty('--hc-edition-accent', p.accentVar);

    // ---- Header ----
    const header = node(doc, 'div', 'hc-landing-header');
    header.appendChild(node(doc, 'div', 'hc-landing-accent'));

    const mark = doc.createElement('img');
    mark.className = 'hc-landing-mark';
    mark.src = markUrl;
    mark.alt = '';
    header.appendChild(mark);

    const titleWrap = node(doc, 'div', 'hc-landing-title');
    const name = node(doc, 'div', 'hc-landing-name', 'HTML Content ');
    name.appendChild(
        node(doc, 'span', `hc-landing-suffix ${p.suffixClass}`.trim(), p.suffix)
    );
    titleWrap.appendChild(name);
    titleWrap.appendChild(
        node(doc, 'div', 'hc-landing-version', `Version ${version}`)
    );
    header.appendChild(titleWrap);

    const docsBtn = node(doc, 'button', 'hc-landing-docs', labels.docs);
    docsBtn.setAttribute('type', 'button');
    docsBtn.appendChild(node(doc, 'span', 'hc-landing-docs-arrow', '↗'));
    docsBtn.addEventListener('click', () => onLaunch(urls.docs));
    header.appendChild(docsBtn);

    const icons = node(doc, 'div', 'hc-landing-icons');
    icons.appendChild(
        iconLink(doc, 'hc-landing-iconlink', 'github', urls.github,
            'View source on GitHub', githubIcon(doc), onLaunch)
    );
    icons.appendChild(
        iconLink(doc, 'hc-landing-iconlink hc-landing-iconlink--heart', 'sponsor',
            urls.sponsor, 'Sponsor on GitHub', heartIcon(doc), onLaunch)
    );
    icons.appendChild(
        iconLink(doc, 'hc-landing-iconlink hc-landing-iconlink--coffee', 'coffee',
            urls.coffee, 'Buy me a coffee', coffeeIcon(doc), onLaunch)
    );
    header.appendChild(icons);
    root.appendChild(header);

    // ---- Body ----
    const body = node(doc, 'div', 'hc-landing-body');

    const watermark = doc.createElement('img');
    watermark.className = 'hc-landing-watermark';
    watermark.src = markUrl;
    watermark.alt = '';
    body.appendChild(watermark);

    const copy = node(doc, 'div', 'hc-landing-copy');
    copy.appendChild(node(doc, 'h1', 'hc-landing-headline', labels.headline));
    copy.appendChild(node(doc, 'p', 'hc-landing-lede', labels.body));
    copy.appendChild(node(doc, 'p', 'hc-landing-compact-body', labels.compactBody));

    const links = node(doc, 'div', 'hc-landing-links');
    links.appendChild(textLink(doc,
        'hc-landing-link hc-landing-link--brand', labels.quickStart, urls.docs, onLaunch));
    links.appendChild(textLink(doc,
        'hc-landing-link', labels.examples, urls.docs, onLaunch));
    links.appendChild(textLink(doc,
        'hc-landing-link', labels.whatsNew, urls.docs, onLaunch));
    copy.appendChild(links);

    const sandbox = node(doc, 'p', 'hc-landing-sandbox', `${labels.sandboxNote} `);
    sandbox.appendChild(
        textLink(doc, 'hc-landing-sandbox-link', labels.sandboxNoteLink, urls.docs, onLaunch)
    );
    copy.appendChild(sandbox);

    const openDocs = textLink(doc, 'hc-landing-opendocs', labels.openDocs, urls.docs, onLaunch);
    openDocs.appendChild(node(doc, 'span', undefined, ' ↗'));
    copy.appendChild(openDocs);

    body.appendChild(copy);

    // ---- Values cue ----
    const cue = node(doc, 'div', 'hc-landing-values');
    const cueLabel = node(doc, 'div', 'hc-landing-values-label');
    cueLabel.appendChild(node(doc, 'span', 'hc-landing-values-box'));
    cueLabel.appendChild(node(doc, 'span', undefined, labels.valuesLabel));
    cue.appendChild(cueLabel);
    const drop = node(doc, 'div', 'hc-landing-dropzone');
    const chip = node(doc, 'div', 'hc-landing-chip');
    chip.appendChild(node(doc, 'span', 'hc-landing-chip-grip', '⠿'));
    chip.appendChild(node(doc, 'span', 'hc-landing-chip-text', labels.valuesField));
    drop.appendChild(chip);
    drop.appendChild(node(doc, 'span', 'hc-landing-drophint', labels.valuesHint));
    cue.appendChild(drop);
    body.appendChild(cue);

    root.appendChild(body);
    return root;
};
