import { Edition } from '../visual-config.generated';
import { githubIcon, heartIcon, coffeeIcon } from './icons';

/** Localised display strings for every text slot on the splash. */
export interface LandingLabels {
    headline: string;
    body: string;
    quickStart: string;
    whatsNew: string;
    sandboxNote: string;
    sandboxNoteLink: string;
    openDocs: string;
}

/** Outbound link targets for the splash's buttons and links. */
export interface LandingUrls {
    docs: string;
    quickStart: string;
    changelog: string;
    github: string;
    sponsor: string;
    coffee: string;
}

/** Everything buildSplash needs to render one splash instance. */
export interface SplashOptions {
    edition: Edition;
    version: string;
    /** Pre-localized channel warning (e.g. "BETA BUILD — NOT FOR PRODUCTION
     *  USE"); rendered as a badge under the version when present. */
    channelBadge?: string;
    markUrl: string;
    labels: LandingLabels;
    urls: LandingUrls;
    onLaunch: (url: string) => void;
}

/** Per-edition branding: name suffix and accent colour for the title. */
interface EditionPresentation {
    suffix: string;
    suffixClass: string;
    accentVar: string;
}

/** Arguments for the iconLink builder: an icon button that opens a URL. */
interface IconLinkOptions {
    cls: string;
    key: string;
    url: string;
    title: string;
    icon: SVGElement;
    onLaunch: (url: string) => void;
}

/** Arguments for the textLink builder: a text button that opens a URL. */
interface TextLinkOptions {
    cls: string;
    text: string;
    url: string;
    onLaunch: (url: string) => void;
}

/** Branding lookup: resolves each edition to its EditionPresentation. */
const PRESENTATION: Record<Edition, EditionPresentation> = {
    flagship: {
        suffix: '',
        suffixClass: '',
        accentVar: 'var(--hc-accent-flagship)'
    },
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

/**
 * Element factory: createElement with an optional class and text content.
 * Shared by every builder so the DOM is assembled without innerHTML.
 */
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

/**
 * Builds an icon-only button that invokes onLaunch(url) when clicked. Uses a
 * <button> (not <a>) with title/aria-label so it is accessible and cert-safe.
 */
const iconLink = (doc: Document, opts: IconLinkOptions): HTMLElement => {
    const { cls, key, url, title, icon, onLaunch } = opts;
    const a = node(doc, 'button', cls);
    a.setAttribute('type', 'button');
    a.setAttribute('title', title);
    a.setAttribute('aria-label', title);
    a.dataset.link = key;
    a.appendChild(icon);
    a.addEventListener('click', () => onLaunch(url));
    return a;
};

/**
 * Builds a text button that invokes onLaunch(url) when clicked. A <button>
 * rather than an <a> so navigation stays under the host's control.
 */
const textLink = (doc: Document, opts: TextLinkOptions): HTMLElement => {
    const { cls, text, url, onLaunch } = opts;
    const b = node(doc, 'button', cls, text);
    b.setAttribute('type', 'button');
    b.addEventListener('click', () => onLaunch(url));
    return b;
};

/**
 * Builds the header band: accent bar, product mark, edition-suffixed title
 * with version, and the GitHub/sponsor/coffee icon links.
 */
const buildHeader = (doc: Document, opts: SplashOptions): HTMLElement => {
    const { edition, version, channelBadge, markUrl, urls, onLaunch } = opts;
    const p = PRESENTATION[edition];

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
    if (channelBadge) {
        titleWrap.appendChild(
            node(doc, 'div', 'hc-landing-channel-badge', channelBadge)
        );
    }
    header.appendChild(titleWrap);

    const icons = node(doc, 'div', 'hc-landing-icons');
    const iconLinks: [string, string, string, string, () => SVGElement][] = [
        [
            '',
            'github',
            urls.github,
            'View source on GitHub',
            () => githubIcon(doc)
        ],
        [
            '--heart',
            'sponsor',
            urls.sponsor,
            'Sponsor on GitHub',
            () => heartIcon(doc)
        ],
        [
            '--coffee',
            'coffee',
            urls.coffee,
            'Buy me a coffee',
            () => coffeeIcon(doc)
        ]
    ];
    for (const [mod, key, url, title, icon] of iconLinks) {
        const cls = `hc-landing-iconlink${mod ? ` hc-landing-iconlink${mod}` : ''}`;
        icons.appendChild(
            iconLink(doc, {
                cls,
                key,
                url,
                title,
                icon: icon(),
                onLaunch
            })
        );
    }
    header.appendChild(icons);
    return header;
};

/**
 * Builds the body container holding the watermark image. buildSplash appends
 * the hero and footer into it afterwards.
 */
const buildBody = (doc: Document, opts: SplashOptions): HTMLElement => {
    const { edition, markUrl } = opts;
    const p = PRESENTATION[edition];

    const body = node(doc, 'div', 'hc-landing-body');

    const watermark = doc.createElement('img');
    watermark.className = 'hc-landing-watermark';
    watermark.src = markUrl;
    watermark.alt = '';
    body.appendChild(watermark);

    return body;
};

/**
 * Builds the hero: headline + the single body message. There is no drop cue —
 * field drags never reach the sandboxed iframe, so an in-visual dropzone can
 * never work (see docs/brainstorms/2026-07-02-landing-values-cue-removal.md).
 */
const buildHero = (doc: Document, opts: SplashOptions): HTMLElement => {
    const { labels } = opts;
    const hero = node(doc, 'div', 'hc-landing-hero');
    hero.appendChild(node(doc, 'h1', 'hc-landing-headline', labels.headline));
    hero.appendChild(node(doc, 'p', 'hc-landing-lede', labels.body));
    return hero;
};

/**
 * Builds the footer: quick-start and what's-new links, the sandbox note with
 * its docs link, and the open-docs action.
 */
const buildFooter = (doc: Document, opts: SplashOptions): HTMLElement => {
    const { edition, labels, urls, onLaunch } = opts;
    const p = PRESENTATION[edition];

    const footer = node(doc, 'div', 'hc-landing-footer');
    const links = node(doc, 'div', 'hc-landing-links');
    links.appendChild(
        textLink(doc, {
            cls: 'hc-landing-link hc-landing-link--brand',
            text: labels.quickStart,
            url: urls.quickStart,
            onLaunch
        })
    );
    links.appendChild(
        textLink(doc, {
            cls: 'hc-landing-link',
            text: labels.whatsNew,
            url: urls.changelog,
            onLaunch
        })
    );
    footer.appendChild(links);

    const sandbox = node(
        doc,
        'p',
        'hc-landing-sandbox',
        `${labels.sandboxNote} `
    );
    sandbox.appendChild(
        textLink(doc, {
            cls: 'hc-landing-sandbox-link',
            text: labels.sandboxNoteLink,
            url: urls.docs,
            onLaunch
        })
    );
    footer.appendChild(sandbox);

    const openDocs = textLink(doc, {
        cls: 'hc-landing-opendocs',
        text: labels.openDocs,
        url: urls.docs,
        onLaunch
    });
    openDocs.appendChild(node(doc, 'span', undefined, ' ↗'));
    footer.appendChild(openDocs);

    return footer;
};

/**
 * Assembles the full splash tree: sets the edition accent on the root, then
 * appends the header and the body (hero + footer). The entry point for the
 * landing module.
 */
export const buildSplash = (
    doc: Document,
    opts: SplashOptions
): HTMLElement => {
    const { edition } = opts;
    const p = PRESENTATION[edition];

    const root = node(doc, 'div', 'hc-landing');
    root.style.setProperty('--hc-edition-accent', p.accentVar);

    // ---- Header ----
    const header = buildHeader(doc, opts);
    root.appendChild(header);

    // ---- Body ----
    // In-flow hero (top) + footer (bottom). The body does not scroll itself —
    // the host's OverlayScrollbars owns overflow. The watermark anchors to the
    // body top and is clipped by .hc-landing's overflow.
    const body = buildBody(doc, opts);

    // Hero: headline + body message. Grows to fill spare height.
    const hero = buildHero(doc, opts);
    body.appendChild(hero);

    // Footer (actions): full-width band that flows under the hero + graphic.
    const footer = buildFooter(doc, opts);
    body.appendChild(footer);

    root.appendChild(body);
    return root;
};
