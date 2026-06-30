// Standalone data: URI sanitizer. Lives in its own module so that
// `attribute-policy.ts` can import `getSanitizedDataUri` without reaching
// into `backend.certified.ts` — that former import created a runtime-only
// circular dependency (`backend.certified.ts` imported the per-tag policy
// constants back from `attribute-policy.ts`). Relocating the function here
// breaks the cycle: this module depends only on `svg-payload-scan.ts`.

import {
    hasDangerousSvgPayload,
    SAFE_IMAGE_MIME_TYPES
} from './svg-payload-scan';

/**
 * Decide whether a data: URI is safe to keep, given its already-parsed,
 * lower-cased MIME type and the original URI string. Returns `null` when the
 * URI is allowed (the caller keeps the original `dataUri`); otherwise returns
 * the replacement value `'data:,'` that neutralises the blocked URI.
 *
 * This is a verbatim lift of the MIME/encoding decision branches that used to
 * live inline in `getSanitizedDataUri` — same checks, same order, same
 * literals, same warnings. Extracted only to keep `getSanitizedDataUri`'s body
 * simple.
 */
const blockedDataUriReplacement = (
    mimeType: string,
    dataUri: string
): string | null => {
    // Reuse the shared SAFE_IMAGE_MIME_TYPES set from svg-payload-scan.ts
    // so this entry point and isSafeImageDataUri stay in lockstep.
    if (!SAFE_IMAGE_MIME_TYPES.has(mimeType)) {
        console.warn(
            `Blocked data URI with unsafe MIME type: ${mimeType.slice(0, 64)}`
        );
        return 'data:,';
    }

    // Real binary images (png/jpeg/gif/webp/bmp) must be base64-encoded —
    // a non-base64 data:image/png is always smuggled non-binary content.
    // SVG is text by spec and DAX measures legitimately emit
    // `data:image/svg+xml;utf8,<svg ...>` (and the bare comma form), so
    // the base64 requirement is bypassed for image/svg+xml. Browsers
    // sandbox SVG loaded via <img>/<svg image>/<feImage> — script and
    // external resource references inside the SVG do not execute in
    // image-loading context (issue #143 follow-up).
    if (mimeType !== 'image/svg+xml' && !/^data:[^,]*;base64,/i.test(dataUri)) {
        console.warn(
            `Blocked data:${mimeType} URI: missing base64 encoding (smuggled non-binary content)`
        );
        return 'data:,';
    }

    // Defense-in-depth content scan for image/svg+xml. Modern Chromium
    // sandboxes SVG loaded via <img>/<image>/<feImage>/CSS url(), so
    // embedded scripts and event handlers do not execute in image
    // contexts. The sandbox guarantee is the load-bearing security
    // boundary — but it isn't uniform across every rendering surface a
    // Power BI report ends up in (older WebView2, mobile renderers,
    // export-to-PDF pipelines, etc.). Block payloads that contain
    // patterns the sandbox would normally neuter, so a future
    // sandbox-weak surface still rejects them at the sanitizer.
    if (mimeType === 'image/svg+xml' && hasDangerousSvgPayload(dataUri)) {
        console.warn(
            'Blocked data:image/svg+xml URI: payload contains script, event handler, foreignObject, or external href'
        );
        return 'data:,';
    }

    return null;
};

/**
 * Sanitize a data: URI for use in img src / href / xlink:href attributes.
 * Only allows specific safe image MIME types AND requires the URI to be
 * base64-encoded.
 */
export const getSanitizedDataUri = (dataUri: string): string => {
    if (!dataUri || !dataUri.startsWith('data:')) {
        return dataUri;
    }

    const mimeMatch = dataUri.match(/^data:([^;,]+)/i);
    if (!mimeMatch) {
        // No extractable MIME type (e.g. 'data:,payload', 'data:;base64,...').
        // RFC 2397 defaults missing MIME to text/plain — not on our allowlist.
        console.warn('Blocked data URI with no extractable MIME type');
        return 'data:,';
    }

    const mimeType = mimeMatch[1].toLowerCase();
    const blocked = blockedDataUriReplacement(mimeType, dataUri);
    if (blocked !== null) {
        return blocked;
    }

    return dataUri;
};
