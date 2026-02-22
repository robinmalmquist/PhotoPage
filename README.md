# Photo Page

Minimal one-page photo gallery using plain `HTML`, `CSS`, and `JavaScript`.

## Structure

- `index.html`
- `styles.css`
- `script.js`
- `images/` (put your photo files here)

## How photo loading works

The page auto-loads images from `images/` in this order:

1. GitHub Contents API (automatic on GitHub Pages)
2. Directory listing from `images/` (works in many local static servers, including Live Server)
3. `images/manifest.json` fallback

### GitHub Pages mode (no manual list)

If hosted on GitHub Pages, the script infers your repo from the URL and fetches file names from `images/`.
You can then add/remove photos in `images/` and the page updates automatically.

If you use a custom domain, you can set an explicit repo config before loading `script.js`:

```html
<script>
  window.PHOTO_PAGE_CONFIG = {
    github: {
      owner: "your-github-username",
      repo: "your-repo-name",
      folderPath: "images"
    }
  };
</script>
```

### Non-GitHub hosting fallback

If you host elsewhere, create `images/manifest.json`:

```json
[
  "photo-01.jpg",
  "photo-02.jpg"
]
```

## Notes

- EXIF values shown in the photo modal: shutter speed, aperture, ISO.
- EXIF depends on metadata being present in the source file.
- EXIF parser is loaded from CDN, so internet access is needed unless you self-host that script.
- About/Contact text is in `index.html` and can be edited directly.
- For local development, use a local server (for example VS Code Live Server), not `file://`.
