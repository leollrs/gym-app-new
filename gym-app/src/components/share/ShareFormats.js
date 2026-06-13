// Share card format dimensions.
// Kept in sync with the reference design's ShareFormats dict.

export const ShareFormats = {
  story:    { w: 270, h: 480, label: '9:16', sub: 'Story' },
  square:   { w: 360, h: 360, label: '1:1',  sub: 'Feed'  },
  portrait: { w: 310, h: 388, label: '4:5',  sub: 'Portrait' },
};

// Full-resolution export sizes (used when rasterizing to PNG).
export const ShareExportSizes = {
  story:    { w: 1080, h: 1920 },
  square:   { w: 1080, h: 1080 },
  portrait: { w: 1080, h: 1350 },
};

// Brand fonts for the cards. These render in the on-screen preview via the
// Google-CDN @font-face, and in the EXPORT via the base64 @font-face embedded
// at raster time (see embeddedFonts.js + rasterizeNode) — so preview === upload.
export const TuFont = {
  display: '"Familjen Grotesk", "Archivo", system-ui, sans-serif',
  body: '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif',
};

export default ShareFormats;
