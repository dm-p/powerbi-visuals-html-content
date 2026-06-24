// powerbi-visuals-tools webpack maps .svg to asset/inline → a base64 data URI.
declare module '*.svg' {
    const url: string;
    export default url;
}
